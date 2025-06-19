// src/trading/trading_market_estimates.ts
import { TradingConfig } from './trading_config.js';
import { TradingMarket } from './trading_market.js';
import { Position, PositionStatus } from './trading_position.js';

/**
 * Interest rate breakdown showing all components
 */
export interface InterestRate {
    /** Base borrowing rate from utilization */
    baseRate: number;
    /** Utilization rate (0-1) */
    utilization: number;
    /** Leverage multiplier applied to base rate */
    leverageMultiplier: number;
    /** Average leverage across all positions */
    averageLeverage: number;
    /** Final rate per second for long positions */
    longRate: number;
    /** Final rate per second for short positions */
    shortRate: number;
    /** Ratio of long to short positions (>1 = more longs, <1 = more shorts) */
    longShortRatio: number;
    /** Total value locked in this market */
    totalValueLocked: number;
    /** Available liquidity for new positions */
    availableLiquidity: number;
    /** Annual percentage rate for display (converted from per-second rate) */
    longAPR: number;
    /** Annual percentage rate for display (converted from per-second rate) */
    shortAPR: number;
}

/**
 * Position P&L breakdown including all components
 */
export interface PositionPnL {
    /** Raw P&L from price movement */
    pnl: number;
    /** Total interest/borrowing fees */
    interest: number;
    /** Net P&L after fees (pnl - interest) */
    netPnl: number;
    /** P&L percentage relative to collateral */
    pnlPercent: number;
    /** Net P&L percentage relative to collateral */
    netPnlPercent: number;
    /** True if position can be liquidated */
    canLiquidate: boolean;
    /** Remaining collateral after P&L */
    remainingCollateral: number;
}

/**
 * TradingMarketEstimates provides calculation utilities for trading markets
 * All calculations mirror the smart contract logic
 */
export class TradingMarketEstimates {
    constructor(
        private config: TradingConfig,
        private market: TradingMarket
    ) { }



    /**
     * Calculate current interest rates and market metrics
     * @param vaultBalance Current vault balance
     * @returns Interest rate breakdown with all market metrics
     */
    calculateInterestRate(vaultBalance: number): InterestRate {
        const utilization = this._calculateUtilization(vaultBalance);
        const baseRate = this._calculateBorrowingRateFromUtilization(utilization);
        const leverageMultiplier = this._calculateLeverageMultiplier();
        const averageLeverage = this._calculateAverageLeverage();
        const longShortRatio = this._calculateLongShortRatio();

        // Apply leverage multiplier to base rate
        const adjustedRate = baseRate * leverageMultiplier;

        // TODO: Implement long/short rate adjustment based on skew
        // For now, both sides pay the same rate
        const longRate = adjustedRate;
        const shortRate = adjustedRate;

        // Convert per-second rates to annual percentage rates
        // Assuming rates are hourly rates converted to per-second
        const secondsPerYear = 365 * 24 * 60 * 60;
        const longAPR = longRate * 3600 * 100; // Convert to hourly then to percentage
        const shortAPR = shortRate * 3600 * 100;

        // Calculate TVL and available liquidity
        const totalValueLocked = this.market.longCollateral + this.market.shortCollateral;
        const allocatedLiquidity = vaultBalance * this.market.totalAvailable;
        const totalBorrowed = this.market.longBorrowed + this.market.shortBorrowed;
        const availableLiquidity = Math.max(0, allocatedLiquidity - totalBorrowed);

        return {
            baseRate,
            utilization,
            leverageMultiplier,
            averageLeverage,
            longRate,
            shortRate,
            longShortRatio,
            totalValueLocked,
            availableLiquidity,
            longAPR,
            shortAPR
        };
    }

    /**
     * Calculate position P&L including all fees and metrics
     * @param position The position to calculate P&L for
     * @param currentPrice Current asset price
     * @returns Complete P&L breakdown
     */
    calculatePnL(position: Position, currentPrice: number): PositionPnL {
        // Calculate raw P&L
        const size = position.collateral * position.leverage;
        const priceDiff = position.isLong
            ? currentPrice - position.entryPrice
            : position.entryPrice - currentPrice;

        const pnl = (size * priceDiff) / position.entryPrice;

        // Calculate interest
        const interest = this._calculatePositionInterest(position);

        const netPnl = pnl - interest;

        // Calculate percentages
        const pnlPercent = (pnl / position.collateral) * 100;
        const netPnlPercent = (netPnl / position.collateral) * 100;

        // Check liquidation
        const remainingCollateral = position.collateral + netPnl;
        const canLiquidate = this._canBeLiquidated(position.collateral, netPnl);

        return {
            pnl,
            interest,
            netPnl,
            pnlPercent,
            netPnlPercent,
            canLiquidate,
            remainingCollateral
        };
    }

    /**
     * Calculate accrued interest for a position
     */
    private _calculatePositionInterest(position: Position): number {
        if (position.status !== PositionStatus.Open) {
            return 0;
        }

        const borrowedAmount = position.collateral * (position.leverage - 1);
        if (borrowedAmount <= 0) {
            return 0;
        }

        // Get the appropriate index based on position type
        const currentIndex = position.isLong
            ? this.market.longInterestIndex
            : this.market.shortInterestIndex;

        const positionIndex = position.positionIndex;

        if (currentIndex <= positionIndex) {
            return 0;
        }

        // Calculate growth factor (how much the index has grown)
        // Indices represent compound growth multipliers in 18 decimal precision
        // e.g., 1.05 * 10^18 means 5% growth
        const indexRatio = Number(currentIndex) / Number(positionIndex);
        const growthFactor = indexRatio - 1; // Subtract 1 to get the growth percentage

        // Apply growth to borrowed amount
        const interest = borrowedAmount * growthFactor;

        return interest;
    }

    /**
     * Calculate market utilization rate
     */
    private _calculateUtilization(vaultBalance: number): number {
        const totalBorrowed = this.market.longBorrowed + this.market.shortBorrowed;

        // Calculate allocated liquidity for this market
        const allocatedLiquidity = vaultBalance * this.market.totalAvailable;

        if (allocatedLiquidity === 0) {
            return 1; // 100% utilization if no liquidity
        }

        return Math.min(totalBorrowed / allocatedLiquidity, 1);
    }

    /**
     * Calculate average leverage across all positions
     */
    private _calculateAverageLeverage(): number {
        const totalCollateral = this.market.longCollateral + this.market.shortCollateral;

        if (totalCollateral === 0) {
            return 1; // 1x leverage
        }

        const longNotional = this.market.longCollateral + this.market.longBorrowed;
        const shortNotional = this.market.shortCollateral + this.market.shortBorrowed;
        const totalNotional = longNotional + shortNotional;

        return totalNotional / totalCollateral;
    }

    /**
     * Calculate long/short ratio
     */
    private _calculateLongShortRatio(): number {
        const longNotional = this.market.longCollateral + this.market.longBorrowed;
        const shortNotional = this.market.shortCollateral + this.market.shortBorrowed;

        if (shortNotional === 0) {
            return longNotional > 0 ? 10 : 1; // 10:1 or 1:1
        }

        return longNotional / shortNotional;
    }

    /**
     * Calculate leverage multiplier for borrowing fees
     */
    private _calculateLeverageMultiplier(): number {
        const averageLeverage = this._calculateAverageLeverage();
        const leverageInt = Math.floor(averageLeverage);

        if (leverageInt <= 0) {
            return 1; // 1.0x multiplier
        }

        // 1.01^leverage approximation using simple compound interest
        // Each leverage level adds 1% to the multiplier
        const multiplier = 1 + (leverageInt * 0.01);

        return Math.min(multiplier, 2); // Cap at 2x
    }

    /**
     * Check if a position can be liquidated
     */
    private _canBeLiquidated(collateral: number, netPnl: number): boolean {
        const maintenanceMargin = collateral * this.market.liquidationThreshold;
        const remainingCollateral = collateral + netPnl;

        return remainingCollateral < maintenanceMargin;
    }

    /**
     * Calculate borrowing rate from utilization using kink model
     */
    private _calculateBorrowingRateFromUtilization(utilization: number): number {
        const minRate = this.market.minHourlyRate;
        const targetRate = this.market.targetHourlyRate;
        const maxRate = this.market.maxHourlyRate;
        const targetUtilization = this.market.targetUtilization;

        if (utilization <= targetUtilization) {
            // Below kink: gradual increase from min to target
            const rateRange = targetRate - minRate;
            const utilizationRatio = utilization / targetUtilization;
            const additionalRate = rateRange * utilizationRatio;
            return minRate + additionalRate;
        } else {
            // Above kink: sharp increase from target to max
            const rateRange = maxRate - targetRate;
            const excessUtilization = utilization - targetUtilization;
            const remainingCapacity = 1 - targetUtilization;

            if (remainingCapacity === 0) {
                return maxRate;
            }

            const utilizationRatio = excessUtilization / remainingCapacity;
            const additionalRate = rateRange * utilizationRatio;
            return targetRate + additionalRate;
        }
    }
}