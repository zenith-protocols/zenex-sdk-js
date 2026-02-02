import { rpc, xdr, scValToBigInt, scValToNative, Address } from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';
import { PositionStatus, PositionPnL, PositionData } from '../types/trading.js';
import { descale, scale, SCALAR_7, SCALAR_18, fixedMulFloor, fixedMulCeil, fixedDivCeil } from '../scaling.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import { Market } from './market.js';

/**
 * Position - Trading position class with loaders and computed properties
 *
 * Represents a trading position with automatic descaling of values.
 * Use TradingConfig.getAsset(position.assetIndex) to resolve the asset.
 */
export class Position implements PositionData {
    id: number;
    user: string;
    status: PositionStatus;
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
        this.status = data.status;
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
        let status: PositionStatus | undefined;
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
                case 'status':
                    const statusVariant = entry.val().vec();
                    if (statusVariant && statusVariant.length > 0) {
                        const variantName = statusVariant[0].sym().toString();
                        status = variantName as PositionStatus;
                    }
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
            status === undefined ||
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
            status,
            assetIndex,
            isLong,
            stopLoss: descale(stopLoss, 14),
            takeProfit: descale(takeProfit, 14),
            entryPrice: descale(entryPrice, 14),
            collateral: descale(collateral, 7),
            notionalSize: descale(notionalSize, 7),
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
     * Check if position is active (open or pending)
     */
    isActive(): boolean {
        return this.status === PositionStatus.Open || this.status === PositionStatus.Pending;
    }

    /**
     * Check if position is closed
     */
    isClosed(): boolean {
        return this.status === PositionStatus.Closed;
    }

    /**
     * Get human-readable direction
     */
    getDirection(): string {
        return this.isLong ? 'Long' : 'Short';
    }

    /**
     * Calculate the position's profit and loss
     * @param currentPrice - The current market price of the asset
     * @param market - Optional market for interest calculation
     * @returns The position's PnL breakdown
     */
    calculatePnL(currentPrice: number, market?: Market): PositionPnL {
        if (!this.isActive() || this.status === PositionStatus.Pending) {
            return { pnl: 0, interest: 0, fee: 0, netPnl: 0 };
        }

        // PnL = notional_size * (price_change / entry_price)
        const priceDiff = this.isLong
            ? currentPrice - this.entryPrice
            : this.entryPrice - currentPrice;

        const priceChangeRatio = priceDiff / this.entryPrice;
        const pnl = this.notionalSize * priceChangeRatio;

        // Interest calculation
        let interest = 0;
        if (market) {
            const currentIndex = this.isLong
                ? market.longInterestIndex
                : market.shortInterestIndex;

            const indexDiff = Number(currentIndex - this.interestIndex) / 1e18;
            interest = this.notionalSize * indexDiff;
        }

        // Fee estimation (base fee + price impact)
        let fee = 0;
        if (market) {
            // Determine if base fee should be paid on close
            // Base fee is charged when:
            // - Market is balanced (long == short), OR
            // - Position is on the dominant side
            const isLongDominant = market.longNotionalSize > market.shortNotionalSize;
            const isShortDominant = market.shortNotionalSize > market.longNotionalSize;
            const isBalanced = market.longNotionalSize === market.shortNotionalSize;

            const shouldPayBaseFee = isBalanced
                || (isLongDominant && this.isLong)
                || (isShortDominant && !this.isLong);

            const baseFee = shouldPayBaseFee ? this.notionalSize * market.baseFee : 0;
            fee = baseFee;
            fee += this.notionalSize / market.priceImpactScalar;
            fee += interest;
        }

        return {
            pnl,
            interest,
            fee,
            netPnl: pnl - fee,
        };
    }

    /**
     * Get the liquidation price for the position
     *
     * Formula matches smart contract using fixed-point arithmetic:
     * 1. Calculate total fees (base + price impact + interest)
     *    - base_fee is only charged when closing on the dominant side or when balanced
     *    - Fees use ceil rounding (rounds up to avoid undercharging)
     * 2. Calculate required margin (notional_size * maintenance_margin)
     *    - Uses floor rounding (minimum margin needed)
     * 3. Solve: collateral + pnl - fees = requiredMargin
     * 4. Liquidation price = entry_price + entry_price * priceChangeRatio / SCALAR_7
     *
     * This implementation uses BigInt fixed-point math to match the Sentinel/Contract
     * calculations exactly, avoiding floating-point precision issues.
     *
     * @param market - The market containing margin requirements and interest indices
     * @returns The liquidation price level
     */
    getLiquidationPrice(market: Market): number {
        if (!this.isActive() || this.status === PositionStatus.Pending) return 0;

        // Convert to scaled BigInt values (SCALAR_7 precision)
        const notionalSize = scale(this.notionalSize, 7);
        const collateral = scale(this.collateral, 7);
        const baseFeeRate = scale(market.baseFee, 7);
        const priceImpactScalar = scale(market.priceImpactScalar, 7);
        const maintenanceMargin = scale(market.maintenanceMargin, 7);
        // Entry price uses SCALAR_14 in contract, but we store descaled. Scale to SCALAR_7 for ratio calc.
        const entryPrice = scale(this.entryPrice, 7);

        // Get scaled market notional sizes for dominance check
        const longNotionalSize = scale(market.longNotionalSize, 7);
        const shortNotionalSize = scale(market.shortNotionalSize, 7);

        // Determine if base fee should be paid on close
        // Base fee is charged when:
        // - Market is balanced (long == short), OR
        // - Position is on the dominant side
        const isLongDominant = longNotionalSize > shortNotionalSize;
        const isShortDominant = shortNotionalSize > longNotionalSize;
        const isBalanced = longNotionalSize === shortNotionalSize;

        const shouldPayBaseFee = isBalanced
            || (isLongDominant && this.isLong)
            || (isShortDominant && !this.isLong);

        // 1. Calculate base fee (notional_size * base_fee / SCALAR_7) - ceil rounding
        const baseFee = shouldPayBaseFee
            ? fixedMulCeil(notionalSize, baseFeeRate, SCALAR_7)
            : 0n;

        // 2. Calculate price impact fee (notional_size * SCALAR_7 / price_impact_scalar) - ceil rounding
        const priceImpactFee = fixedDivCeil(notionalSize, priceImpactScalar, SCALAR_7);

        // 3. Calculate accrued interest
        // Interest fee = notional_size * (current_index - entry_index) / SCALAR_18
        const currentInterestIndex = this.isLong
            ? market.longInterestIndex
            : market.shortInterestIndex;
        const indexDiff = currentInterestIndex - this.interestIndex;
        // Use floor for interest (matches contract behavior)
        const interestFee = fixedMulFloor(notionalSize, indexDiff, SCALAR_18);

        // 4. Total fees
        const totalFee = baseFee + priceImpactFee + interestFee;

        // 5. Calculate required margin (notional_size * maintenance_margin / SCALAR_7) - floor rounding
        const requiredMargin = fixedMulFloor(notionalSize, maintenanceMargin, SCALAR_7);

        // 6. Calculate required PnL at liquidation
        // At liquidation: collateral + pnl - fees = requiredMargin
        // Therefore: pnl = requiredMargin - collateral + fees
        const requiredPnl = requiredMargin - collateral + totalFee;

        // 7. Calculate price change ratio
        // ratio = required_pnl * SCALAR_7 / notional_size (floor rounding)
        const priceChangeRatio = fixedMulFloor(requiredPnl, SCALAR_7, notionalSize);

        // 8. Calculate liquidation price based on position direction
        // price_delta = entry_price * price_change_ratio / SCALAR_7
        const priceDelta = fixedMulFloor(entryPrice, priceChangeRatio, SCALAR_7);

        let liquidationPrice: bigint;
        if (this.isLong) {
            // For long: liquidation price is below entry (negative PnL needed)
            // liq_price = entry_price + price_delta (price_delta is negative for longs)
            liquidationPrice = entryPrice + priceDelta;
        } else {
            // For short: liquidation price is above entry
            // liq_price = entry_price - price_delta
            liquidationPrice = entryPrice - priceDelta;
        }

        // Convert back to number (descale from SCALAR_7)
        const result = Number(liquidationPrice) / 1e7;
        return Math.max(0, result);
    }

    /**
     * Check if position is liquidatable at current price
     * @param currentPrice - Current market price
     * @param market - Market with margin requirements
     * @returns True if position can be liquidated
     */
    isLiquidatable(currentPrice: number, market: Market): boolean {
        if (!this.isActive() || this.status === PositionStatus.Pending) return false;

        const pnlResult = this.calculatePnL(currentPrice, market);
        const remainingValue = this.collateral + pnlResult.netPnl;
        const minimumRequired = this.notionalSize * market.maintenanceMargin;

        return remainingValue < minimumRequired;
    }

    /**
     * Check if take profit is triggered
     */
    checkTakeProfit(currentPrice: number): boolean {
        if (this.takeProfit === 0) return false;
        return this.isLong
            ? currentPrice >= this.takeProfit
            : currentPrice <= this.takeProfit;
    }

    /**
     * Check if stop loss is triggered
     */
    checkStopLoss(currentPrice: number): boolean {
        if (this.stopLoss === 0) return false;
        return this.isLong
            ? currentPrice <= this.stopLoss
            : currentPrice >= this.stopLoss;
    }
}
