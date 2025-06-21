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