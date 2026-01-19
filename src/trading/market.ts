import { rpc, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';
import { Asset } from '../types/asset.js';
import { MarketConfig, MarketData, MarketInfo } from '../types/trading.js';
import { descale } from '../internal/scaling.js';
import { persistentLedgerKey, assetToScVal } from '../internal/ledger-keys.js';

/**
 * Market - Trading market class with config and dynamic data
 *
 * Contains both configuration and real-time market data with automatic descaling.
 */
export class Market implements MarketInfo {
    // Market identity
    asset: Asset;

    // Market configuration (matches Rust MarketConfig)
    enabled: boolean;
    maxPayout: number;
    minCollateral: number;
    maxCollateral: number;
    initMargin: number;
    maintenanceMargin: number;
    baseFee: number;
    priceImpactScalar: number;
    baseHourlyRate: number;

    // Dynamic market data (matches Rust MarketData)
    longCollateral: number;
    longNotionalSize: number;
    shortCollateral: number;
    shortNotionalSize: number;
    longInterestIndex: bigint;
    shortInterestIndex: bigint;
    lastUpdate: number;

    constructor(data: MarketInfo) {
        this.asset = data.asset;
        this.enabled = data.enabled;
        this.maxPayout = data.maxPayout;
        this.minCollateral = data.minCollateral;
        this.maxCollateral = data.maxCollateral;
        this.initMargin = data.initMargin;
        this.maintenanceMargin = data.maintenanceMargin;
        this.baseFee = data.baseFee;
        this.priceImpactScalar = data.priceImpactScalar;
        this.baseHourlyRate = data.baseHourlyRate;
        this.longCollateral = data.longCollateral;
        this.longNotionalSize = data.longNotionalSize;
        this.shortCollateral = data.shortCollateral;
        this.shortNotionalSize = data.shortNotionalSize;
        this.longInterestIndex = data.longInterestIndex;
        this.shortInterestIndex = data.shortInterestIndex;
        this.lastUpdate = data.lastUpdate;
    }

    // === Static Loaders ===

    /**
     * Load trading market data from the blockchain
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @param asset - The asset to load market data for
     * @returns A new Market instance with current data, or null if not found
     */
    public static async load(
        network: Network,
        contractId: string,
        asset: Asset
    ): Promise<Market | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const assetScVal = assetToScVal(asset);

        const keys = [
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                assetScVal
            ]),
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                assetScVal
            ])
        ];

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            if (response.entries.length < 2) return null;

            const configScVal = response.entries[0].val.contractData().val();
            const dataScVal = response.entries[1].val.contractData().val();

            return Market.fromScVals(asset, configScVal, dataScVal);
        } catch {
            return null;
        }
    }

    /**
     * Load multiple trading markets in a single RPC call
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @param assets - Array of assets to load market data for
     * @returns Array of Market instances (only includes successfully loaded markets)
     */
    public static async loadMultiple(
        network: Network,
        contractId: string,
        assets: Asset[]
    ): Promise<Market[]> {
        if (assets.length === 0) return [];

        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const markets: Market[] = [];

        const keys: xdr.LedgerKey[] = [];
        assets.forEach((asset) => {
            const assetScVal = assetToScVal(asset);

            keys.push(persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                assetScVal
            ]));

            keys.push(persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                assetScVal
            ]));
        });

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            for (let i = 0; i < assets.length; i++) {
                const configIndex = i * 2;
                const dataIndex = i * 2 + 1;

                if (configIndex < response.entries.length && dataIndex < response.entries.length) {
                    try {
                        const configScVal = response.entries[configIndex].val.contractData().val();
                        const dataScVal = response.entries[dataIndex].val.contractData().val();
                        const market = Market.fromScVals(assets[i], configScVal, dataScVal);
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
     * Create a Market from raw ScVal data
     * @internal
     */
    static fromScVals(
        asset: Asset,
        configVal: xdr.ScVal,
        dataVal: xdr.ScVal
    ): Market {
        const config = Market.parseMarketConfig(configVal);
        const data = Market.parseMarketData(dataVal);

        return new Market({
            asset,
            ...config,
            ...data,
        });
    }

    /**
     * Parse MarketConfig from contract storage value (matches Rust MarketConfig)
     * @internal
     */
    private static parseMarketConfig(val: xdr.ScVal): MarketConfig {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid market config data');
        }

        const config: Partial<MarketConfig> = {};

        map.forEach((entry) => {
            const key = entry.key().sym().toString();
            const value = entry.val();

            switch (key) {
                case 'enabled':
                    config.enabled = value.b();
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
                case 'init_margin':
                    config.initMargin = descale(scValToBigInt(value), 7);
                    break;
                case 'maintenance_margin':
                    config.maintenanceMargin = descale(scValToBigInt(value), 7);
                    break;
                case 'base_fee':
                    config.baseFee = descale(scValToBigInt(value), 7);
                    break;
                case 'price_impact_scalar':
                    config.priceImpactScalar = descale(scValToBigInt(value), 7);
                    break;
                case 'base_hourly_rate':
                    // This is in SCALAR_18
                    config.baseHourlyRate = Number(scValToBigInt(value)) / 1e18;
                    break;
            }
        });

        return config as MarketConfig;
    }

    /**
     * Parse MarketData from contract storage value (matches Rust MarketData)
     * @internal
     */
    private static parseMarketData(val: xdr.ScVal): MarketData {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid market data');
        }

        const data: Partial<MarketData> = {};

        map.forEach((entry) => {
            const key = entry.key().sym().toString();
            const value = entry.val();

            switch (key) {
                case 'long_collateral':
                    data.longCollateral = descale(scValToBigInt(value), 7);
                    break;
                case 'long_notional_size':
                    data.longNotionalSize = descale(scValToBigInt(value), 7);
                    break;
                case 'short_collateral':
                    data.shortCollateral = descale(scValToBigInt(value), 7);
                    break;
                case 'short_notional_size':
                    data.shortNotionalSize = descale(scValToBigInt(value), 7);
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

        return data as MarketData;
    }

    // === Computed Properties ===

    /**
     * Get total collateral across both long and short positions
     */
    getTotalCollateral(): number {
        return this.longCollateral + this.shortCollateral;
    }

    /**
     * Get total notional size
     */
    getTotalNotionalSize(): number {
        return this.longNotionalSize + this.shortNotionalSize;
    }

    /**
     * Get market skew (positive = more longs, negative = more shorts)
     */
    getSkew(): number {
        return this.longNotionalSize - this.shortNotionalSize;
    }

    /**
     * Estimate the opening fee for a position
     * @param notionalSize - Notional size of the position
     * @param isLong - True for long, false for short
     * @returns Estimated fee
     */
    estimateOpenFee(notionalSize: number, isLong: boolean): number {
        // Check if this trade balances the market (no base fee)
        const wouldBalance = isLong
            ? (this.longNotionalSize + notionalSize) <= this.shortNotionalSize
            : (this.shortNotionalSize + notionalSize) <= this.longNotionalSize;

        const baseFee = wouldBalance ? 0 : notionalSize * this.baseFee;
        const priceImpact = notionalSize / this.priceImpactScalar;

        return baseFee + priceImpact;
    }
}
