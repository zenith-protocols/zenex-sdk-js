// src/trading/trading_market.ts
import { Address, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Asset } from './trading_contract.js';
import { descale } from '../utils/scaling.js';
import { i128, u32, u64 } from '../index.js';

/**
 * Manages ledger data for a single trading market.
 * All numeric values are automatically descaled to JavaScript numbers.
 */
export class TradingMarket {
    constructor(
        /** The asset being traded in this market */
        public asset: Asset,

        // === Market Configuration ===
        /** Whether the market is enabled */
        public enabled: boolean,
        /** Maximum leverage allowed (e.g., 10 for 10x) */
        public maxLeverage: number,
        /** Maximum payout per position */
        public maxPayout: number,
        /** Minimum collateral required */
        public minCollateral: number,
        /** Maximum collateral allowed */
        public maxCollateral: number,
        /** Liquidation threshold (0-1, e.g., 0.05 = 5%) */
        public liquidationThreshold: number,
        /** Total funds available for this market as percentage (0-1) */
        public totalAvailable: number,
        /** Base fee rate (0-1, e.g., 0.0005 = 0.05%) */
        public baseFee: number,
        /** Price impact scalar for fee calculation */
        public priceImpactScalar: number,
        /** Minimum hourly borrowing rate */
        public minHourlyRate: number,
        /** Maximum hourly borrowing rate */
        public maxHourlyRate: number,
        /** Target hourly borrowing rate at target utilization */
        public targetHourlyRate: number,
        /** Target utilization threshold (0-1, e.g., 0.8 = 80%) */
        public targetUtilization: number,

        // === Market Data ===
        /** Total collateral in long positions */
        public longCollateral: number,
        /** Total borrowed amount for long positions */
        public longBorrowed: number,
        /** Number of open long positions */
        public longCount: number,
        /** Total collateral in short positions */
        public shortCollateral: number,
        /** Total borrowed amount for short positions */
        public shortBorrowed: number,
        /** Number of open short positions */
        public shortCount: number,
        /** Current long interest index (kept as bigint - 18 decimals) */
        public longInterestIndex: bigint,
        /** Current short interest index (kept as bigint - 18 decimals) */
        public shortInterestIndex: bigint,
        /** Last update timestamp (seconds) */
        public lastUpdate: number
    ) { }

    /**
     * Create a TradingMarket instance from raw config and data ScVals
     */
    static fromScVals(
        asset: Asset,
        configVal: xdr.ScVal,
        dataVal: xdr.ScVal
    ): TradingMarket {
        const config = this.parseMarketConfig(configVal);
        const data = this.parseMarketData(dataVal);

        return new TradingMarket(
            asset,
            // Config values
            config.enabled,
            config.maxLeverage,
            config.maxPayout,
            config.minCollateral,
            config.maxCollateral,
            config.liquidationThreshold,
            config.totalAvailable,
            config.baseFee,
            config.priceImpactScalar,
            config.minHourlyRate,
            config.maxHourlyRate,
            config.targetHourlyRate,
            config.targetUtilization,
            // Data values
            data.longCollateral,
            data.longBorrowed,
            data.longCount,
            data.shortCollateral,
            data.shortBorrowed,
            data.shortCount,
            data.longInterestIndex,
            data.shortInterestIndex,
            data.lastUpdate
        );
    }

    /**
     * Convert an Asset type to ScVal for use in ledger keys.
     * @param asset - The asset to convert.
     * @returns The ScVal representation of the asset.
     */
    static assetToScVal(asset: Asset): xdr.ScVal {
        // Create a union type ScVal
        if (asset.tag === 'Stellar') {
            const address = asset.values[0] instanceof Address
                ? asset.values[0]
                : Address.fromString(asset.values[0]);

            return xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Stellar'),
                address.toScVal()
            ]);
        } else if (asset.tag === 'Other') {
            return xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Other'),
                xdr.ScVal.scvSymbol(asset.values[0])
            ]);
        }

        throw new Error('Invalid asset type');
    }

    /**
     * Parse MarketConfig from contract storage value.
     * @param val - The ScVal containing the market config.
     * @returns The parsed MarketConfig.
     */
    private static parseMarketConfig(val: xdr.ScVal): {
        enabled: boolean;
        maxLeverage: number;
        maxPayout: number;
        minCollateral: number;
        maxCollateral: number;
        liquidationThreshold: number;
        totalAvailable: number;
        baseFee: number;
        priceImpactScalar: number;
        minHourlyRate: number;
        maxHourlyRate: number;
        targetHourlyRate: number;
        targetUtilization: number;
    } {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid market config: expected map');
        }

        let enabled: boolean | undefined;
        let maxLeverage: u32 | undefined;
        let maxPayout: i128 | undefined;
        let minCollateral: i128 | undefined;
        let maxCollateral: i128 | undefined;
        let liquidationThreshold: i128 | undefined;
        let totalAvailable: i128 | undefined;
        let baseFee: i128 | undefined;
        let priceImpactScalar: i128 | undefined;
        let minHourlyRate: i128 | undefined;
        let maxHourlyRate: i128 | undefined;
        let targetHourlyRate: i128 | undefined;
        let targetUtilization: i128 | undefined;

        map.forEach((entry) => {
            const key = entry.key().sym().toString();

            switch (key) {
                case 'enabled':
                    enabled = entry.val().b();
                    break;
                case 'max_leverage':
                    maxLeverage = entry.val().u32();
                    break;
                case 'max_payout':
                    maxPayout = scValToBigInt(entry.val());
                    break;
                case 'min_collateral':
                    minCollateral = scValToBigInt(entry.val());
                    break;
                case 'max_collateral':
                    maxCollateral = scValToBigInt(entry.val());
                    break;
                case 'liquidation_threshold':
                    liquidationThreshold = scValToBigInt(entry.val());
                    break;
                case 'total_available':
                    totalAvailable = scValToBigInt(entry.val());
                    break;
                case 'base_fee':
                    baseFee = scValToBigInt(entry.val());
                    break;
                case 'price_impact_scalar':
                    priceImpactScalar = scValToBigInt(entry.val());
                    break;
                case 'min_hourly_rate':
                    minHourlyRate = scValToBigInt(entry.val());
                    break;
                case 'max_hourly_rate':
                    maxHourlyRate = scValToBigInt(entry.val());
                    break;
                case 'target_hourly_rate':
                    targetHourlyRate = scValToBigInt(entry.val());
                    break;
                case 'target_utilization':
                    targetUtilization = scValToBigInt(entry.val());
                    break;
            }
        });

        // Validate all required fields
        if (
            enabled === undefined ||
            maxLeverage === undefined ||
            maxPayout === undefined ||
            minCollateral === undefined ||
            maxCollateral === undefined ||
            liquidationThreshold === undefined ||
            totalAvailable === undefined ||
            baseFee === undefined ||
            priceImpactScalar === undefined ||
            minHourlyRate === undefined ||
            maxHourlyRate === undefined ||
            targetHourlyRate === undefined ||
            targetUtilization === undefined
        ) {
            throw new Error('Missing required market config fields');
        }

        return {
            enabled: enabled,
            maxLeverage: Number(maxLeverage) / 100, // Convert 200 to 2.0
            maxPayout: descale(maxPayout, 7),
            minCollateral: descale(minCollateral, 7),
            maxCollateral: descale(maxCollateral, 7),
            liquidationThreshold: descale(liquidationThreshold, 7),
            totalAvailable: descale(totalAvailable, 7),
            baseFee: descale(baseFee, 7),
            priceImpactScalar: descale(priceImpactScalar, 7),
            minHourlyRate: descale(minHourlyRate, 7),
            maxHourlyRate: descale(maxHourlyRate, 7),
            targetHourlyRate: descale(targetHourlyRate, 7),
            targetUtilization: descale(targetUtilization, 7),
        };
    }

    /**
     * Parse MarketData from contract storage value.
     * @param val - The ScVal containing the market data.
     * @returns The parsed MarketData.
     */
    private static parseMarketData(val: xdr.ScVal): {
        longCollateral: number;
        longBorrowed: number;
        longCount: number;
        shortCollateral: number;
        shortBorrowed: number;
        shortCount: number;
        longInterestIndex: bigint;
        shortInterestIndex: bigint;
        lastUpdate: number;
    } {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid market data: expected map');
        }

        let longCollateral: i128 | undefined;
        let longBorrowed: i128 | undefined;
        let longCount: u32 | undefined;
        let shortCollateral: i128 | undefined;
        let shortBorrowed: i128 | undefined;
        let shortCount: u32 | undefined;
        let longInterestIndex: i128 | undefined;
        let shortInterestIndex: i128 | undefined;
        let lastUpdate: u64 | undefined;

        map.forEach((entry) => {
            const key = entry.key().sym().toString();

            switch (key) {
                case 'long_collateral':
                    longCollateral = scValToBigInt(entry.val());
                    break;
                case 'long_borrowed':
                    longBorrowed = scValToBigInt(entry.val());
                    break;
                case 'long_count':
                    longCount = entry.val().u32();
                    break;
                case 'short_collateral':
                    shortCollateral = scValToBigInt(entry.val());
                    break;
                case 'short_borrowed':
                    shortBorrowed = scValToBigInt(entry.val());
                    break;
                case 'short_count':
                    shortCount = entry.val().u32();
                    break;
                case 'long_interest_index':
                    longInterestIndex = scValToBigInt(entry.val());
                    break;
                case 'short_interest_index':
                    shortInterestIndex = scValToBigInt(entry.val());
                    break;
                case 'last_update':
                    lastUpdate = scValToBigInt(entry.val());
                    break;
            }
        });

        // Validate required fields
        if (
            longCollateral === undefined ||
            longBorrowed === undefined ||
            longCount === undefined ||
            shortCollateral === undefined ||
            shortBorrowed === undefined ||
            shortCount === undefined ||
            longInterestIndex === undefined ||
            shortInterestIndex === undefined ||
            lastUpdate === undefined
        ) {
            throw new Error('Missing required market data fields');
        }

        return {
            longCollateral: descale(longCollateral, 7),
            longBorrowed: descale(longBorrowed, 7),
            longCount: Number(longCount),
            shortCollateral: descale(shortCollateral, 7),
            shortBorrowed: descale(shortBorrowed, 7),
            shortCount: Number(shortCount),
            longInterestIndex: longInterestIndex, // Keep as bigint (18 decimals)
            shortInterestIndex: shortInterestIndex, // Keep as bigint (18 decimals)
            lastUpdate: Number(lastUpdate),
        };
    }

    /**
     * Calculate current utilization rate for this market
     * @returns Utilization rate as a decimal (0-1)
     */
    get utilization(): number {
        const totalBorrowed = this.longBorrowed + this.shortBorrowed;
        if (totalBorrowed === 0) return 0;

        // Since totalAvailable is already a percentage, we need to consider
        // the actual allocated liquidity based on vault balance
        // This is a simplified calculation - actual implementation would need vault balance
        return Math.min(totalBorrowed / (this.totalAvailable * 1000000), 1); // Placeholder
    }
}