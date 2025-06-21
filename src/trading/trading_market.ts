import { Address, rpc, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../index.ts';
import { Asset } from './trading_contract.js';
import { descale } from '../utils/scaling.js';
import { persistentLedgerKey } from '../ledger_entry_helper.js';

/**
 * TradingMarket contains both configuration and dynamic data for a trading market.
 * All monetary values are automatically descaled to JavaScript numbers
 */
export class TradingMarket {
    constructor(
        // Core market identity
        public asset: Asset,

        // Market configuration (changes rarely)
        /** Whether trading is enabled for this market */
        public enabled: boolean,
        /** Maximum allowed leverage (e.g., 10 = 10x) */
        public maxLeverage: number,
        /** Maximum payout rate (e.g., 0.9 = 90%) */
        public maxPayout: number,
        /** Minimum collateral amount required */
        public minCollateral: number,
        /** Maximum collateral amount allowed */
        public maxCollateral: number,
        /** Liquidation threshold (e.g., 0.85 = 85%) */
        public liquidationThreshold: number,
        /** Total available liquidity for this market */
        public totalAvailable: number,

        // Fee configuration
        /** Base trading fee (e.g., 0.001 = 0.1%) */
        public baseFee: number,
        /** Price impact scalar for slippage calculation */
        public priceImpactScalar: number,

        // Interest rate configuration
        /** Minimum hourly funding rate */
        public minHourlyRate: number,
        /** Maximum hourly funding rate */
        public maxHourlyRate: number,
        /** Target hourly funding rate */
        public targetHourlyRate: number,
        /** Target utilization ratio (0-1) */
        public targetUtilization: number,

        // Dynamic market data (changes frequently)
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
        /** Accumulated interest index for longs */
        public longInterestIndex: bigint, // Keep as bigint for precision
        /** Accumulated interest index for shorts */
        public shortInterestIndex: bigint, // Keep as bigint for precision
        /** Last update timestamp in seconds */
        public lastUpdate: number
    ) { }

    /**
     * Load trading market data from the blockchain
     * @param network - The Stellar network to connect to
     * @param tradingId - The trading contract address
     * @param asset - The asset to load market data for
     * @returns A new TradingMarket instance with current data, or null if not found
     */
    public static async load(
        network: Network,
        tradingId: string,
        asset: Asset
    ): Promise<TradingMarket | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        // Convert asset to ScVal
        const assetScVal = TradingMarket.assetToScVal(asset);

        const keys = [
            persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                assetScVal
            ]),
            persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('MarketData'),
                assetScVal
            ])
        ];

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            if (response.entries.length < 2) return null;

            const configScVal = response.entries[0].val.contractData().val();
            const dataScVal = response.entries[1].val.contractData().val();

            return TradingMarket.fromScVals(asset, configScVal, dataScVal);
        } catch {
            return null;
        }
    }

    /**
     * Load multiple trading markets in a single RPC call
     * @param network - The Stellar network to connect to
     * @param tradingId - The trading contract address
     * @param assets - Array of assets to load market data for
     * @returns Array of TradingMarket instances (only includes successfully loaded markets)
     */
    public static async loadMultiple(
        network: Network,
        tradingId: string,
        assets: Asset[]
    ): Promise<TradingMarket[]> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const markets: TradingMarket[] = [];

        // Build all keys for all assets (2 keys per asset: config and data)
        const keys: xdr.LedgerKey[] = [];
        assets.forEach((asset) => {
            const assetScVal = TradingMarket.assetToScVal(asset);

            // Config key
            keys.push(persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                assetScVal
            ]));

            // Data key
            keys.push(persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('MarketData'),
                assetScVal
            ]));
        });

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            // Process pairs of entries (config + data)
            for (let i = 0; i < assets.length; i++) {
                const configIndex = i * 2;
                const dataIndex = i * 2 + 1;

                // Check if we have both config and data for this asset
                if (configIndex < response.entries.length && dataIndex < response.entries.length) {
                    try {
                        const configScVal = response.entries[configIndex].val.contractData().val();
                        const dataScVal = response.entries[dataIndex].val.contractData().val();
                        const market = TradingMarket.fromScVals(assets[i], configScVal, dataScVal);
                        markets.push(market);
                    } catch (error) {
                        console.error(`Failed to parse market for asset ${i}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load markets:', error);
        }

        return markets;
    }

    /**
     * Create a TradingMarket from raw ScVal data
     * @internal
     * @param asset - The asset this market represents
     * @param configVal - The ScVal containing market configuration
     * @param dataVal - The ScVal containing market data
     * @returns Parsed TradingMarket
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
     * @internal
     * @param val - The ScVal containing the market config.
     * @returns The parsed MarketConfig.
     */
    private static parseMarketConfig(val: xdr.ScVal): any {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid market config data');
        }

        const config: any = {};

        map.forEach((entry) => {
            const key = entry.key().sym().toString();
            const value = entry.val();

            switch (key) {
                case 'enabled':
                    config.enabled = value.b();
                    break;
                case 'max_leverage':
                    config.maxLeverage = value.u32() / 100; // Convert from 1000 to 10.0
                    break;
                case 'max_payout':
                    config.maxPayout = descale(scValToBigInt(value), 7);
                    break;
                case 'min_collateral':
                    config.minCollateral = descale(scValToBigInt(value), 7);
                    break;
                case 'max_collateral':
                    config.maxCollateral = descale(scValToBigInt(value), 7);
                    break;
                case 'liquidation_threshold':
                    config.liquidationThreshold = descale(scValToBigInt(value), 7);
                    break;
                case 'total_available':
                    config.totalAvailable = descale(scValToBigInt(value), 7);
                    break;
                case 'base_fee':
                    config.baseFee = descale(scValToBigInt(value), 7);
                    break;
                case 'price_impact_scalar':
                    config.priceImpactScalar = descale(scValToBigInt(value), 7);
                    break;
                case 'min_hourly_rate':
                    config.minHourlyRate = descale(scValToBigInt(value), 7);
                    break;
                case 'max_hourly_rate':
                    config.maxHourlyRate = descale(scValToBigInt(value), 7);
                    break;
                case 'target_hourly_rate':
                    config.targetHourlyRate = descale(scValToBigInt(value), 7);
                    break;
                case 'target_utilization':
                    config.targetUtilization = descale(scValToBigInt(value), 7);
                    break;
            }
        });

        return config;
    }

    /**
     * Parse MarketData from contract storage value.
     * @internal
     * @param val - The ScVal containing the market data.
     * @returns The parsed MarketData.
     */
    private static parseMarketData(val: xdr.ScVal): any {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid market data');
        }

        const data: any = {};

        map.forEach((entry) => {
            const key = entry.key().sym().toString();
            const value = entry.val();

            switch (key) {
                case 'long_collateral':
                    data.longCollateral = descale(scValToBigInt(value), 7);
                    break;
                case 'long_borrowed':
                    data.longBorrowed = descale(scValToBigInt(value), 7);
                    break;
                case 'long_count':
                    data.longCount = value.u32();
                    break;
                case 'short_collateral':
                    data.shortCollateral = descale(scValToBigInt(value), 7);
                    break;
                case 'short_borrowed':
                    data.shortBorrowed = descale(scValToBigInt(value), 7);
                    break;
                case 'short_count':
                    data.shortCount = value.u32();
                    break;
                case 'long_interest_index':
                    data.longInterestIndex = scValToBigInt(value);
                    break;
                case 'short_interest_index':
                    data.shortInterestIndex = scValToBigInt(value);
                    break;
                case 'last_update':
                    data.lastUpdate = Number(scValToBigInt(value));
                    break;
            }
        });

        return data;
    }

    /**
     * Get total collateral across both long and short positions
     */
    getTotalCollateral(): number {
        return this.longCollateral + this.shortCollateral;
    }

    /**
     * Get total borrowed across both long and short positions
     */
    getTotalBorrowed(): number {
        return this.longBorrowed + this.shortBorrowed;
    }

    /**
     * Get current utilization ratio (0-1)
     */
    getUtilization(): number {
        if (this.totalAvailable === 0) return 0;
        return this.getTotalBorrowed() / this.totalAvailable;
    }

    /**
     * Get total number of positions (long + short)
     */
    getTotalPositions(): number {
        return this.longCount + this.shortCount;
    }
}