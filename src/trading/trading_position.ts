import { rpc, xdr, scValToBigInt, Address } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { toFloat, toFixed, SCALAR_7, SCALAR_18, mulFloor, mulCeil, divFloor, divCeil } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import { Market, type MarketConfig } from './trading_market.js';
import { TradingConfigData } from './trading_config.js';

// Error codes matching Rust TradingError
// Client-side order validation errors.
// Codes 702-726 mirror contract TradingError. Codes 729-730 are SDK-only
// (the contract does not emit dedicated trigger validation error codes).
export enum OrderValidationError {
    MarketDisabled = 702,
    NegativeValueNotAllowed = 723,
    NotionalBelowMinimum = 724,
    NotionalAboveMaximum = 725,
    LeverageAboveMaximum = 726,
    InvalidTakeProfitPrice = 729,  // SDK-only, not a contract error code
    InvalidStopLossPrice = 730,    // SDK-only, not a contract error code
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
    marketId: number;
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
    marketId: number;
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
        this.marketId = data.marketId;
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
     * @param getFeedDecimals - Callback to resolve feed exponent magnitude by marketId
     */
    public static async loadMultiple(
        network: Network,
        contractId: string,
        positionIds: number[],
        getFeedDecimals: (marketId: number) => number,
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

        const response = await stellarRpc.getLedgerEntries(...keys);

        // Build map from XDR key → entry value
        const entryMap = new Map<string, xdr.LedgerEntryData>();
        for (const entry of response.entries) {
            entryMap.set(entry.key.toXDR('base64'), entry.val);
        }

        for (let i = 0; i < positionIds.length; i++) {
            const entryVal = entryMap.get(keys[i].toXDR('base64'));
            if (!entryVal) continue;

            try {
                const position = Position.fromScVal(entryVal.contractData().val(), positionIds[i], getFeedDecimals);
                positions.push(position);
            } catch {
                // skip unparseable entry
            }
        }

        return positions;
    }

    /**
     * Parse Position from ScVal (matches Rust Position struct)
     * @param val - The ScVal to parse
     * @param id - Position ID (from storage key, not in struct)
     * @param priceDecimalsOrLookup - Feed exponent magnitude, or callback to resolve by marketId
     * @internal
     */
    static fromScVal(
        val: xdr.ScVal,
        id: number = 0,
        priceDecimalsOrLookup: number | ((marketId: number) => number),
    ): Position {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid position data: expected map');
        }

        let user: string | undefined;
        let filled: boolean | undefined;
        let marketId: number | undefined;
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
                case 'market_id':
                    marketId = entry.val().u32();
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
            marketId === undefined ||
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
            ? priceDecimalsOrLookup(marketId)
            : priceDecimalsOrLookup;

        return new Position({
            id,
            user,
            filled,
            marketId,
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
        // leverage check: fixed_mul_ceil(notional, margin, SCALAR_7) > collateral
        // Matches contract: self.notional.fixed_mul_ceil(e, &margin, &SCALAR_7) > self.col
        const notionalBig = toFixed(notional, 7);
        const marginBig = toFixed(marketConfig.margin, 7);
        const collateralBig = toFixed(collateral, 7);
        if (mulCeil(notionalBig, marginBig, SCALAR_7) > collateralBig) {
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
     * Mirrors the contract's market.open() fee logic in fixed-point:
     *   base_fee = fixed_mul_ceil(notional, fee_rate, SCALAR_7)
     *   impact_fee = fixed_div_ceil(notional, impact, SCALAR_7)
     *   position.col -= base_fee + impact_fee
     */
    static grossCollateral(params: GrossCollateralParams): GrossCollateralResult {
        const { collateral, notional, isLong, marketConfig, tradingConfig, lNotional, sNotional } = params;

        const notionalBig = toFixed(notional, 7);
        const longNotionalBig = toFixed(lNotional, 7);
        const shortNotionalBig = toFixed(sNotional, 7);

        // Determine if this position would be on the dominant side
        const isDominant = isLong
            ? (longNotionalBig + notionalBig) > shortNotionalBig
            : (shortNotionalBig + notionalBig) > longNotionalBig;

        const feeRate = toFixed(isDominant ? tradingConfig.feeDom : tradingConfig.feeNonDom, 7);
        const impactBig = toFixed(marketConfig.impact, 7);

        const baseFee = mulCeil(notionalBig, feeRate, SCALAR_7);
        const impactFee = impactBig > 0n ? divFloor(notionalBig, impactBig, SCALAR_7) : 0n;
        const fee = toFloat(baseFee + impactFee, 7);

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
     * Compute raw fee components in bigint (token_decimals = SCALAR_7).
     * Shared by getFeeBreakdown() and getLiquidationPrice() to avoid float round-trips.
     * @internal
     */
    private _computeRawFees(
        market: Market,
        tradingConfig: TradingConfigData,
    ): { baseFee: bigint; priceImpact: bigint; funding: bigint; borrowingFee: bigint } {
        const notionalBig = toFixed(this.notional, 7);
        const impactScalar = toFixed(market.impact, 7);

        const longNotional = toFixed(market.lNotional, 7);
        const shortNotional = toFixed(market.sNotional, 7);
        const isDominantAfterClose = this.long
            ? (longNotional - notionalBig) > shortNotional
            : (shortNotional - notionalBig) > longNotional;

        const baseFeeRate = isDominantAfterClose
            ? toFixed(tradingConfig.feeNonDom, 7)
            : toFixed(tradingConfig.feeDom, 7);

        const baseFee = mulCeil(notionalBig, baseFeeRate, SCALAR_7);
        const priceImpact = divFloor(notionalBig, impactScalar, SCALAR_7);

        const currentFundingIndex = this.long ? market.lFundIdx : market.sFundIdx;
        const fundingDiff = currentFundingIndex - this.fundIdx;
        const funding = fundingDiff >= 0n
            ? mulCeil(notionalBig, fundingDiff, SCALAR_18)
            : mulFloor(notionalBig, fundingDiff, SCALAR_18);

        const currentBorrowingIndex = this.long ? market.lBorrIdx : market.sBorrIdx;
        const borrowingFee = mulCeil(notionalBig, currentBorrowingIndex - this.borrIdx, SCALAR_18);

        return { baseFee, priceImpact, funding, borrowingFee };
    }

    /**
     * Get the fee breakdown for closing this position.
     *
     * @param market - The market data for price impact, funding, and borrowing calculation
     * @param tradingConfig - The trading config for base fee rates
     */
    getFeeBreakdown(market: Market, tradingConfig: TradingConfigData): FeeBreakdown {
        const { baseFee, priceImpact, funding, borrowingFee } = this._computeRawFees(market, tradingConfig);

        return {
            baseFee: toFloat(baseFee, 7),
            priceImpact: toFloat(priceImpact, 7),
            funding: toFloat(funding, 7),
            borrowingFee: toFloat(borrowingFee, 7),
            total: toFloat(baseFee + priceImpact + funding + borrowingFee, 7),
        };
    }

    /**
     * Calculate the position's profit and loss using fixed-point arithmetic.
     *
     * Mirrors contract (position.rs settle()):
     *   ratio = price_diff.fixed_div_floor(entry_price, price_scalar)
     *   pnl = notional.fixed_mul_floor(ratio, price_scalar)
     *
     * @param currentPrice - The current market price
     * @param market - Market for fee calculation
     * @param tradingConfig - Trading config for fee rates
     */
    calculatePnL(currentPrice: number, market?: Market, tradingConfig?: TradingConfigData): PositionPnL {
        const emptyFee: FeeBreakdown = { baseFee: 0, priceImpact: 0, funding: 0, borrowingFee: 0, total: 0 };
        if (!this.filled) {
            return { pnl: 0, fee: emptyFee, netPnl: 0 };
        }

        const priceScalar = BigInt(10 ** this.priceDecimals);
        const priceDiffBig = this.long
            ? toFixed(currentPrice, this.priceDecimals) - toFixed(this.entryPrice, this.priceDecimals)
            : toFixed(this.entryPrice, this.priceDecimals) - toFixed(currentPrice, this.priceDecimals);
        const ratio = divFloor(priceDiffBig, toFixed(this.entryPrice, this.priceDecimals), priceScalar);
        const pnlBig = mulFloor(toFixed(this.notional, 7), ratio, priceScalar);
        const pnl = toFloat(pnlBig, 7);

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
     * Uses fixed-point arithmetic matching contract settle().
     */
    getBreakdown(currentPrice: number, market: Market, tradingConfig: TradingConfigData): PositionBreakdown {
        if (!this.filled) {
            return { pnl: 0, baseFee: 0, impactFee: 0, funding: 0, borrowingFee: 0, totalFee: 0, equity: this.col, netPnl: 0, returnPct: 0 };
        }

        const priceScalar = BigInt(10 ** this.priceDecimals);
        const priceDiffBig = this.long
            ? toFixed(currentPrice, this.priceDecimals) - toFixed(this.entryPrice, this.priceDecimals)
            : toFixed(this.entryPrice, this.priceDecimals) - toFixed(currentPrice, this.priceDecimals);
        const ratio = divFloor(priceDiffBig, toFixed(this.entryPrice, this.priceDecimals), priceScalar);
        const pnlBig = mulFloor(toFixed(this.notional, 7), ratio, priceScalar);
        const pnl = toFloat(pnlBig, 7);

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
     * Computes fees entirely in bigint to avoid float round-trip precision loss.
     *
     * @param market - The market containing funding/borrowing indices and liq_fee
     * @param tradingConfig - The trading config for fee rates
     */
    getLiquidationPrice(market: Market, tradingConfig: TradingConfigData): number {
        if (!this.filled) return 0;

        // ADL adjustment: scale notional by current_adl_idx / position.adl_idx
        // (matches contract position.rs settle() lines 181-184)
        const adlIndex = this.long ? market.lAdlIdx : market.sAdlIdx;
        let notionalBig = toFixed(this.notional, 7);
        if (this.adlIdx !== adlIndex && this.adlIdx !== 0n) {
            notionalBig = mulFloor(notionalBig, adlIndex, this.adlIdx);
        }

        const collateral = toFixed(this.col, 7);
        const entryPrice = toFixed(this.entryPrice, this.priceDecimals);
        const liqFee = toFixed(market.liqFee, 7);

        // Compute total fee in bigint — no float round-trip
        const { baseFee, priceImpact, funding, borrowingFee } = this._computeRawFees(market, tradingConfig);
        const totalFee = baseFee + priceImpact + funding + borrowingFee;

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
