import { rpc, xdr, scValToBigInt, Address } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { toFloat, toFixed, SCALAR_7, SCALAR_18, mulFloor, mulCeil, divCeil } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import { Market, type MarketConfig } from './trading_market.js';
import { TradingConfigData } from './trading_config.js';

// Error codes matching Rust TradingError
export enum OrderValidationError {
    MarketDisabled = 702,
    NegativeValueNotAllowed = 723,
    NotionalBelowMinimum = 724,
    NotionalAboveMaximum = 725,
    LeverageAboveMaximum = 726,
    InvalidTakeProfitPrice = 729,
    InvalidStopLossPrice = 730,
}

// Input for fee-adjusted collateral calculation
export interface GrossCollateralParams {
    collateral: number;     // desired post-fee collateral
    notional: number;       // position size
    isLong: boolean;
    marketConfig: MarketConfig;
    tradingConfig: TradingConfigData;
    lNotional: number;      // current long notional on market
    sNotional: number;      // current short notional on market
}

export interface GrossCollateralResult {
    collateral: number;     // collateral to send to the contract
    fee: number;            // estimated opening fee
}

// Input for client-side order validation
export interface ValidateOrderParams {
    collateral: number;
    notional: number;
    entryPrice: number;
    isLong: boolean;
    tp: number;
    sl: number;
    marketConfig: MarketConfig;
    tradingConfig: TradingConfigData;
}

// Fee breakdown for a position
export interface FeeBreakdown {
    baseFee: number;
    priceImpact: number;
    funding: number;
    borrowingFee: number;
    total: number;
}

// PnL calculation result
export interface PositionPnL {
    pnl: number;
    fee: FeeBreakdown;
    netPnl: number;
}

// Full position breakdown for display
export interface PositionBreakdown {
    pnl: number;              // raw price pnl
    baseFee: number;
    impactFee: number;
    funding: number;
    borrowingFee: number;
    totalFee: number;
    equity: number;           // collateral + pnl - totalFee (clamped >= 0)
    netPnl: number;           // pnl - totalFee (clamped >= -collateral)
    returnPct: number;        // netPnl / collateral * 100
}

// Position data for SDK consumers (descaled)
export interface PositionData {
    id: number;
    user: string;
    filled: boolean;
    feed: number;
    long: boolean;
    sl: number;
    tp: number;
    entryPrice: number;
    col: number;
    notional: number;
    fundIdx: bigint;     // SCALAR_18
    borrIdx: bigint;     // SCALAR_18
    adlIdx: bigint;      // SCALAR_18
    createdAt: number;
    priceDecimals: number; // feed exponent magnitude (e.g. 8 for Pyth -8)
}

/**
 * Position - Trading position class with loaders and computed properties
 */
export class Position implements PositionData {
    id: number;
    user: string;
    filled: boolean;
    feed: number;
    long: boolean;
    sl: number;
    tp: number;
    entryPrice: number;
    col: number;
    notional: number;
    fundIdx: bigint;
    borrIdx: bigint;
    adlIdx: bigint;
    createdAt: number;
    priceDecimals: number;

    constructor(data: PositionData) {
        this.id = data.id;
        this.user = data.user;
        this.filled = data.filled;
        this.feed = data.feed;
        this.long = data.long;
        this.sl = data.sl;
        this.tp = data.tp;
        this.entryPrice = data.entryPrice;
        this.col = data.col;
        this.notional = data.notional;
        this.fundIdx = data.fundIdx;
        this.borrIdx = data.borrIdx;
        this.adlIdx = data.adlIdx;
        this.createdAt = data.createdAt;
        this.priceDecimals = data.priceDecimals;
    }

    // === Static Loaders ===

    /**
     * Load user's position IDs from the blockchain
     */
    public static async loadUserPositionIds(
        network: Network,
        contractId: string,
        userId: string
    ): Promise<number[]> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const key = persistentLedgerKey(contractId, [
            xdr.ScVal.scvSymbol('UserPositions'),
            Address.fromString(userId).toScVal()
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return [];

            const scVal = response.entries[0].val.contractData().val();
            const vec = scVal.vec();
            if (!vec) return [];

            return vec.map(val => val.u32());
        } catch {
            return [];
        }
    }

    /**
     * Load a single trading position from the blockchain
     * @param priceDecimals - Feed exponent magnitude for descaling price fields (e.g. 8 for Pyth -8)
     */
    public static async load(
        network: Network,
        contractId: string,
        positionId: number,
        priceDecimals: number,
    ): Promise<Position | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const key = persistentLedgerKey(contractId, [
            xdr.ScVal.scvSymbol('Position'),
            xdr.ScVal.scvU32(positionId)
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return null;

            return Position.fromScVal(response.entries[0].val.contractData().val(), positionId, priceDecimals);
        } catch {
            return null;
        }
    }

    /**
     * Load multiple positions in a single RPC call
     * @param getFeedDecimals - Callback to resolve feed exponent magnitude by feedId
     */
    public static async loadMultiple(
        network: Network,
        contractId: string,
        positionIds: number[],
        getFeedDecimals: (feedId: number) => number,
    ): Promise<Position[]> {
        if (positionIds.length === 0) return [];

        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const positions: Position[] = [];

        const keys = positionIds.map(id =>
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('Position'),
                xdr.ScVal.scvU32(id)
            ])
        );

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            response.entries.forEach((entry, i) => {
                try {
                    const position = Position.fromScVal(entry.val.contractData().val(), positionIds[i], getFeedDecimals);
                    positions.push(position);
                } catch (error) {
                    console.error('Failed to parse position:', error);
                }
            });
        } catch (error) {
            console.error('Failed to load positions:', error);
        }

        return positions;
    }

    /**
     * Parse Position from ScVal (matches Rust Position struct)
     * @param val - The ScVal to parse
     * @param id - Position ID (from storage key, not in struct)
     * @param priceDecimalsOrLookup - Feed exponent magnitude, or callback to resolve by feedId
     * @internal
     */
    static fromScVal(
        val: xdr.ScVal,
        id: number = 0,
        priceDecimalsOrLookup: number | ((feedId: number) => number),
    ): Position {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid position data: expected map');
        }

        let user: string | undefined;
        let filled: boolean | undefined;
        let feed: number | undefined;
        let long: boolean | undefined;
        let sl: bigint | undefined;
        let tp: bigint | undefined;
        let entryPrice: bigint | undefined;
        let col: bigint | undefined;
        let notional: bigint | undefined;
        let fundIdx: bigint | undefined;
        let borrIdx: bigint | undefined;
        let adlIdx: bigint | undefined;
        let createdAt: bigint | undefined;

        map.forEach((entry) => {
            const key = entry.key().sym().toString();

            switch (key) {
                case 'user':
                    user = Address.fromScVal(entry.val()).toString();
                    break;
                case 'filled':
                    filled = entry.val().b();
                    break;
                case 'feed':
                    feed = entry.val().u32();
                    break;
                case 'long':
                    long = entry.val().b();
                    break;
                case 'sl':
                    sl = scValToBigInt(entry.val());
                    break;
                case 'tp':
                    tp = scValToBigInt(entry.val());
                    break;
                case 'entry_price':
                    entryPrice = scValToBigInt(entry.val());
                    break;
                case 'col':
                    col = scValToBigInt(entry.val());
                    break;
                case 'notional':
                    notional = scValToBigInt(entry.val());
                    break;
                case 'fund_idx':
                    fundIdx = scValToBigInt(entry.val());
                    break;
                case 'borr_idx':
                    borrIdx = scValToBigInt(entry.val());
                    break;
                case 'adl_idx':
                    adlIdx = scValToBigInt(entry.val());
                    break;
                case 'created_at':
                    createdAt = scValToBigInt(entry.val());
                    break;
            }
        });

        if (
            user === undefined ||
            filled === undefined ||
            feed === undefined ||
            long === undefined ||
            sl === undefined ||
            tp === undefined ||
            entryPrice === undefined ||
            col === undefined ||
            notional === undefined ||
            fundIdx === undefined ||
            borrIdx === undefined ||
            adlIdx === undefined ||
            createdAt === undefined
        ) {
            throw new Error('Missing required position fields');
        }

        const priceDecimals = typeof priceDecimalsOrLookup === 'function'
            ? priceDecimalsOrLookup(feed)
            : priceDecimalsOrLookup;

        return new Position({
            id,
            user,
            filled,
            feed,
            long,
            sl: toFloat(sl, priceDecimals),
            tp: toFloat(tp, priceDecimals),
            entryPrice: toFloat(entryPrice, priceDecimals),
            col: toFloat(col, 7),
            notional: toFloat(notional, 7),
            fundIdx,
            borrIdx,
            adlIdx,
            createdAt: Number(createdAt),
            priceDecimals,
        });
    }

    // === Client-Side Validation ===

    /**
     * Validate order parameters client-side, mirroring contract checks.
     * Returns null if valid, or the error code if invalid.
     */
    static validateOrder(params: ValidateOrderParams): OrderValidationError | null {
        const { collateral, notional, entryPrice, isLong, tp, sl, marketConfig, tradingConfig } = params;

        // Position.validate() checks
        if (notional <= 0 || entryPrice <= 0 || collateral <= 0 || tp < 0 || sl < 0) {
            return OrderValidationError.NegativeValueNotAllowed;
        }
        if (!marketConfig.enabled) {
            return OrderValidationError.MarketDisabled;
        }
        if (notional < tradingConfig.minNotional) {
            return OrderValidationError.NotionalBelowMinimum;
        }
        if (notional > tradingConfig.maxNotional) {
            return OrderValidationError.NotionalAboveMaximum;
        }
        // leverage check: notional * margin > collateral means leverage too high
        if (notional * marketConfig.margin > collateral) {
            return OrderValidationError.LeverageAboveMaximum;
        }

        // validate_triggers() checks — not enforced by contract on create, but useful for UX
        if (tp > 0) {
            if (isLong && tp <= entryPrice) {
                return OrderValidationError.InvalidTakeProfitPrice;
            }
            if (!isLong && tp >= entryPrice) {
                return OrderValidationError.InvalidTakeProfitPrice;
            }
        }
        if (sl > 0) {
            if (isLong && sl >= entryPrice) {
                return OrderValidationError.InvalidStopLossPrice;
            }
            if (!isLong && sl <= entryPrice) {
                return OrderValidationError.InvalidStopLossPrice;
            }
        }

        return null;
    }

    /**
     * Calculate the collateral to send to the contract so that the post-fee
     * collateral equals the desired amount.
     *
     * Mirrors the contract's market.open() fee logic:
     *   base_fee = notional * fee_rate (dominant or non-dominant)
     *   impact_fee = notional / impact
     *   position.col -= base_fee + impact_fee
     */
    static grossCollateral(params: GrossCollateralParams): GrossCollateralResult {
        const { collateral, notional, isLong, marketConfig, tradingConfig, lNotional, sNotional } = params;

        // Determine if this position would be on the dominant side
        const isDominant = isLong
            ? (lNotional + notional) > sNotional
            : (sNotional + notional) > lNotional;

        const feeRate = isDominant ? tradingConfig.feeDom : tradingConfig.feeNonDom;
        const baseFee = notional * feeRate;
        const impactFee = marketConfig.impact > 0 ? notional / marketConfig.impact : 0;
        const fee = baseFee + impactFee;

        return {
            collateral: collateral + fee,
            fee,
        };
    }

    // === Computed Properties ===

    /**
     * Get leverage (notional / collateral)
     */
    get leverage(): number {
        if (this.col === 0) return 0;
        return this.notional / this.col;
    }

    /**
     * Check if position is an open filled position
     */
    isOpen(): boolean {
        return this.filled;
    }

    /**
     * Get human-readable direction
     */
    getDirection(): string {
        return this.long ? 'Long' : 'Short';
    }

    /**
     * Get the fee breakdown for closing this position.
     *
     * @param market - The market data for price impact, funding, and borrowing calculation
     * @param tradingConfig - The trading config for base fee rates
     */
    getFeeBreakdown(market: Market, tradingConfig: TradingConfigData): FeeBreakdown {
        const notionalBig = toFixed(this.notional, 7);
        const impactScalar = toFixed(market.impact, 7);

        // Closing from dominant side rebalances -> lower fee; from non-dominant worsens -> higher fee
        const longNotional = toFixed(market.lNotional, 7);
        const shortNotional = toFixed(market.sNotional, 7);
        // When closing, we're removing notional, so check is_dominant with -notional
        const closingIsDominant = this.long
            ? (longNotional - notionalBig) < shortNotional
            : (shortNotional - notionalBig) < longNotional;

        const baseFeeRate = closingIsDominant
            ? toFixed(tradingConfig.feeNonDom, 7)
            : toFixed(tradingConfig.feeDom, 7);

        const baseFee = mulCeil(notionalBig, baseFeeRate, SCALAR_7);
        const priceImpact = divCeil(notionalBig, impactScalar, SCALAR_7);

        const currentFundingIndex = this.long
            ? market.lFundIdx
            : market.sFundIdx;
        const funding = mulFloor(notionalBig, currentFundingIndex - this.fundIdx, SCALAR_18);

        const currentBorrowingIndex = this.long
            ? market.lBorrIdx
            : market.sBorrIdx;
        const borrowingFee = mulCeil(notionalBig, currentBorrowingIndex - this.borrIdx, SCALAR_18);

        return {
            baseFee: toFloat(baseFee, 7),
            priceImpact: toFloat(priceImpact, 7),
            funding: toFloat(funding, 7),
            borrowingFee: toFloat(borrowingFee, 7),
            total: toFloat(baseFee + priceImpact + funding + borrowingFee, 7),
        };
    }

    /**
     * Calculate the position's profit and loss
     * @param currentPrice - The current market price
     * @param market - Market for fee calculation
     * @param tradingConfig - Trading config for fee rates
     */
    calculatePnL(currentPrice: number, market?: Market, tradingConfig?: TradingConfigData): PositionPnL {
        const emptyFee: FeeBreakdown = { baseFee: 0, priceImpact: 0, funding: 0, borrowingFee: 0, total: 0 };
        if (!this.filled) {
            return { pnl: 0, fee: emptyFee, netPnl: 0 };
        }

        const priceDiff = this.long
            ? currentPrice - this.entryPrice
            : this.entryPrice - currentPrice;
        const pnl = this.notional * (priceDiff / this.entryPrice);

        const fee = (market && tradingConfig)
            ? this.getFeeBreakdown(market, tradingConfig)
            : emptyFee;

        return {
            pnl,
            fee,
            netPnl: pnl - fee.total,
        };
    }

    /**
     * Full position breakdown: PnL, fee components, equity, and return.
     * Use for position rows and close previews.
     */
    getBreakdown(currentPrice: number, market: Market, tradingConfig: TradingConfigData): PositionBreakdown {
        if (!this.filled) {
            return { pnl: 0, baseFee: 0, impactFee: 0, funding: 0, borrowingFee: 0, totalFee: 0, equity: this.col, netPnl: 0, returnPct: 0 };
        }

        const priceDiff = this.long
            ? currentPrice - this.entryPrice
            : this.entryPrice - currentPrice;
        const pnl = this.notional * (priceDiff / this.entryPrice);

        const fee = this.getFeeBreakdown(market, tradingConfig);
        const netPnl = Math.max(-this.col, pnl - fee.total);
        const equity = Math.max(0, this.col + pnl - fee.total);
        const returnPct = this.col > 0 ? (netPnl / this.col) * 100 : 0;

        return {
            pnl,
            baseFee: fee.baseFee,
            impactFee: fee.priceImpact,
            funding: fee.funding,
            borrowingFee: fee.borrowingFee,
            totalFee: fee.total,
            equity,
            netPnl,
            returnPct,
        };
    }

    /**
     * Get the liquidation price for the position.
     * Uses the per-market liq_fee as the liquidation threshold.
     *
     * @param market - The market containing funding/borrowing indices and liq_fee
     * @param tradingConfig - The trading config for fee rates
     */
    getLiquidationPrice(market: Market, tradingConfig: TradingConfigData): number {
        if (!this.filled) return 0;

        const notionalBig = toFixed(this.notional, 7);
        const collateral = toFixed(this.col, 7);
        const entryPrice = toFixed(this.entryPrice, this.priceDecimals);
        const liqFee = toFixed(market.liqFee, 7);
        const totalFee = toFixed(this.getFeeBreakdown(market, tradingConfig).total, 7);

        // Liquidation threshold: equity <= liq_fee * notional
        const requiredMargin = mulFloor(notionalBig, liqFee, SCALAR_7);
        const requiredPnl = requiredMargin - collateral + totalFee;

        const priceChangeRatio = mulFloor(requiredPnl, SCALAR_7, notionalBig);
        const priceDelta = mulFloor(entryPrice, priceChangeRatio, SCALAR_7);

        const liquidationPrice = this.long
            ? entryPrice + priceDelta
            : entryPrice - priceDelta;

        return Math.max(0, Number(liquidationPrice) / 10 ** this.priceDecimals);
    }
}
