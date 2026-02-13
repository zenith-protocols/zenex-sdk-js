import { rpc, xdr, scValToBigInt, scValToNative, Address } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { toFloat, toFixed, SCALAR_7, SCALAR_18, mulFloor, mulCeil, divCeil } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import { Market } from './trading_market.js';

// Fee breakdown for a position
export interface FeeBreakdown {
    baseFee: number;
    priceImpact: number;
    interest: number;
    total: number;
}

// PnL calculation result
export interface PositionPnL {
    pnl: number;
    fee: FeeBreakdown;
    netPnl: number;
}

// Position data for SDK consumers (descaled)
export interface PositionData {
    id: number;
    user: string;
    filled: boolean;
    assetIndex: number;
    isLong: boolean;
    stopLoss: number;
    takeProfit: number;
    entryPrice: number;
    collateral: number;
    notionalSize: number;
    interestIndex: bigint; // Keep as bigint for precision
    createdAt: number;
}

/**
 * Position - Trading position class with loaders and computed properties
 *
 * Represents a trading position with automatic descaling of values.
 * Use TradingConfig.getAsset(position.assetIndex) to resolve the asset.
 */
export class Position implements PositionData {
    id: number;
    user: string;
    filled: boolean;
    assetIndex: number;
    isLong: boolean;
    stopLoss: number;
    takeProfit: number;
    entryPrice: number;
    collateral: number;
    notionalSize: number;
    interestIndex: bigint;
    createdAt: number;

    constructor(data: PositionData) {
        this.id = data.id;
        this.user = data.user;
        this.filled = data.filled;
        this.assetIndex = data.assetIndex;
        this.isLong = data.isLong;
        this.stopLoss = data.stopLoss;
        this.takeProfit = data.takeProfit;
        this.entryPrice = data.entryPrice;
        this.collateral = data.collateral;
        this.notionalSize = data.notionalSize;
        this.interestIndex = data.interestIndex;
        this.createdAt = data.createdAt;
    }

    // === Static Loaders ===

    /**
     * Load user's position IDs from the blockchain
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @param userId - The user address
     * @returns Array of position IDs
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
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @param positionId - The position ID to load
     * @returns A new Position instance with current data, or null if not found
     */
    public static async load(
        network: Network,
        contractId: string,
        positionId: number
    ): Promise<Position | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const key = persistentLedgerKey(contractId, [
            xdr.ScVal.scvSymbol('Position'),
            xdr.ScVal.scvU32(positionId)
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return null;

            return Position.fromScVal(response.entries[0].val.contractData().val());
        } catch {
            return null;
        }
    }

    /**
     * Load multiple positions in a single RPC call
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @param positionIds - Array of position IDs to load
     * @returns Array of Position instances (only includes successfully loaded positions)
     */
    public static async loadMultiple(
        network: Network,
        contractId: string,
        positionIds: number[]
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

            response.entries.forEach((entry) => {
                try {
                    const position = Position.fromScVal(entry.val.contractData().val());
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
     * @internal
     */
    static fromScVal(val: xdr.ScVal): Position {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid position data: expected map');
        }

        let id: number | undefined;
        let user: string | undefined;
        let filled: boolean | undefined;
        let assetIndex: number | undefined;
        let isLong: boolean | undefined;
        let stopLoss: bigint | undefined;
        let takeProfit: bigint | undefined;
        let entryPrice: bigint | undefined;
        let collateral: bigint | undefined;
        let notionalSize: bigint | undefined;
        let interestIndex: bigint | undefined;
        let createdAt: bigint | undefined;

        map.forEach((entry) => {
            const key = entry.key().sym().toString();

            switch (key) {
                case 'id':
                    id = entry.val().u32();
                    break;
                case 'user':
                    user = Address.fromScVal(entry.val()).toString();
                    break;
                case 'filled':
                    filled = entry.val().b();
                    break;
                case 'asset_index':
                    assetIndex = scValToNative(entry.val()) as number;
                    break;
                case 'is_long':
                    isLong = entry.val().b();
                    break;
                case 'stop_loss':
                    stopLoss = scValToBigInt(entry.val());
                    break;
                case 'take_profit':
                    takeProfit = scValToBigInt(entry.val());
                    break;
                case 'entry_price':
                    entryPrice = scValToBigInt(entry.val());
                    break;
                case 'collateral':
                    collateral = scValToBigInt(entry.val());
                    break;
                case 'notional_size':
                    notionalSize = scValToBigInt(entry.val());
                    break;
                case 'interest_index':
                    interestIndex = scValToBigInt(entry.val());
                    break;
                case 'created_at':
                    createdAt = scValToBigInt(entry.val());
                    break;
            }
        });

        if (
            id === undefined ||
            user === undefined ||
            filled === undefined ||
            assetIndex === undefined ||
            isLong === undefined ||
            stopLoss === undefined ||
            takeProfit === undefined ||
            entryPrice === undefined ||
            collateral === undefined ||
            notionalSize === undefined ||
            interestIndex === undefined ||
            createdAt === undefined
        ) {
            throw new Error('Missing required position fields');
        }

        return new Position({
            id,
            user,
            filled,
            assetIndex,
            isLong,
            stopLoss: toFloat(stopLoss, 14),
            takeProfit: toFloat(takeProfit, 14),
            entryPrice: toFloat(entryPrice, 14),
            collateral: toFloat(collateral, 7),
            notionalSize: toFloat(notionalSize, 7),
            interestIndex,
            createdAt: Number(createdAt),
        });
    }

    // === Computed Properties ===

    /**
     * Get leverage (notional / collateral)
     */
    get leverage(): number {
        if (this.collateral === 0) return 0;
        return this.notionalSize / this.collateral;
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
        return this.isLong ? 'Long' : 'Short';
    }

    /**
     * Get the fee breakdown for closing this position.
     * Uses fixed-point math (ceil rounding for fees, floor for interest).
     *
     * @param market - The market data for fee and interest calculation
     * @returns Fee breakdown with baseFee, priceImpact, interest, and total
     */
    getFeeBreakdown(market: Market): FeeBreakdown {
        const notionalSize = toFixed(this.notionalSize, 7);
        const baseFeeRate = toFixed(market.baseFee, 7);
        const priceImpactScalar = toFixed(market.priceImpactScalar, 7);

        // Base fee is charged when market is balanced or position is on the dominant side
        const longNotional = toFixed(market.longNotionalSize, 7);
        const shortNotional = toFixed(market.shortNotionalSize, 7);
        const shouldPayBaseFee = longNotional === shortNotional
            || (longNotional > shortNotional && this.isLong)
            || (shortNotional > longNotional && !this.isLong);

        const baseFee = shouldPayBaseFee
            ? mulCeil(notionalSize, baseFeeRate, SCALAR_7)
            : 0n;

        const priceImpact = divCeil(notionalSize, priceImpactScalar, SCALAR_7);

        const currentIndex = this.isLong
            ? market.longInterestIndex
            : market.shortInterestIndex;
        const interest = mulFloor(notionalSize, currentIndex - this.interestIndex, SCALAR_18);

        return {
            baseFee: toFloat(baseFee, 7),
            priceImpact: toFloat(priceImpact, 7),
            interest: toFloat(interest, 7),
            total: toFloat(baseFee + priceImpact + interest, 7),
        };
    }

    /**
     * Calculate the position's profit and loss
     * @param currentPrice - The current market price of the asset
     * @param market - Optional market for fee and interest calculation
     * @returns The position's PnL breakdown
     */
    calculatePnL(currentPrice: number, market?: Market): PositionPnL {
        if (!this.filled) {
            return { pnl: 0, fee: { baseFee: 0, priceImpact: 0, interest: 0, total: 0 }, netPnl: 0 };
        }

        const priceDiff = this.isLong
            ? currentPrice - this.entryPrice
            : this.entryPrice - currentPrice;
        const pnl = this.notionalSize * (priceDiff / this.entryPrice);

        const fee = market
            ? this.getFeeBreakdown(market)
            : { baseFee: 0, priceImpact: 0, interest: 0, total: 0 };

        return {
            pnl,
            fee,
            netPnl: pnl - fee.total,
        };
    }

    /**
     * Get the liquidation price for the position
     *
     * Uses fixed-point arithmetic to match the contract:
     * 1. Get total fees via getFeeBreakdown
     * 2. Calculate required margin (notional_size * maintenance_margin)
     * 3. Solve: collateral + pnl - fees = requiredMargin
     * 4. Derive liquidation price from the required pnl
     *
     * @param market - The market containing margin requirements and interest indices
     * @returns The liquidation price level
     */
    getLiquidationPrice(market: Market): number {
        if (!this.filled) return 0;

        const notionalSize = toFixed(this.notionalSize, 7);
        const collateral = toFixed(this.collateral, 7);
        const maintenanceMargin = toFixed(market.maintenanceMargin, 7);
        const entryPrice = toFixed(this.entryPrice, 7);
        const totalFee = toFixed(this.getFeeBreakdown(market).total, 7);

        const requiredMargin = mulFloor(notionalSize, maintenanceMargin, SCALAR_7);
        const requiredPnl = requiredMargin - collateral + totalFee;

        const priceChangeRatio = mulFloor(requiredPnl, SCALAR_7, notionalSize);
        const priceDelta = mulFloor(entryPrice, priceChangeRatio, SCALAR_7);

        const liquidationPrice = this.isLong
            ? entryPrice + priceDelta
            : entryPrice - priceDelta;

        return Math.max(0, Number(liquidationPrice) / 1e7);
    }
}
