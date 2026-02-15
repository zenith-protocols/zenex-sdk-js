import { rpc, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { Asset, assetFromScVal } from '../asset.js';
import { toFloat, toFixed, SCALAR_18, mulFloor, mulCeil, divCeil } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';

// Market configuration (matches Rust MarketConfig)
export interface MarketConfig {
    asset: Asset;
    enabled: boolean;
    maxPayout: number;
    minCollateral: number;
    maxCollateral: number;
    initMargin: number;
    maintenanceMargin: number;
    baseFee: number;
    priceImpactScalar: number;
    baseHourlyRate: number; // In SCALAR_18
    ratioCap: number; // SCALAR_18 precision
}

// Market data (matches Rust MarketData)
export interface MarketData {
    longNotionalSize: number;
    shortNotionalSize: number;
    longInterestIndex: bigint;
    shortInterestIndex: bigint;
    lastUpdate: number;
}



/**
 * Market - Trading market class with config and dynamic data
 *
 * Contains both configuration and real-time market data with automatic descaling.
 * Markets are now indexed by assetIndex (u32) rather than Asset.
 */
export class Market implements MarketConfig, MarketData {
    // Market identity
    assetIndex: number;
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
    ratioCap: number;

    // Dynamic market data (matches Rust MarketData)
    longNotionalSize: number;
    shortNotionalSize: number;
    longInterestIndex: bigint;
    shortInterestIndex: bigint;
    lastUpdate: number;

    constructor(assetIndex: number, data: MarketConfig & MarketData) {
        this.assetIndex = assetIndex;
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
        this.ratioCap = data.ratioCap;
        this.longNotionalSize = data.longNotionalSize;
        this.shortNotionalSize = data.shortNotionalSize;
        this.longInterestIndex = data.longInterestIndex;
        this.shortInterestIndex = data.shortInterestIndex;
        this.lastUpdate = data.lastUpdate;
    }

    // === Static Loaders ===

    /**
     * Load trading market data from the blockchain by asset index
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @param assetIndex - The asset index to load market data for
     * @returns A new Market instance with current data, or null if not found
     */
    public static async load(
        network: Network,
        contractId: string,
        assetIndex: number
    ): Promise<Market | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const keys = [
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                xdr.ScVal.scvU32(assetIndex)
            ]),
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                xdr.ScVal.scvU32(assetIndex)
            ])
        ];

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            if (response.entries.length < 2) return null;

            const configScVal = response.entries[0].val.contractData().val();
            const dataScVal = response.entries[1].val.contractData().val();

            return Market.fromScVals(assetIndex, configScVal, dataScVal);
        } catch {
            return null;
        }
    }

    /**
     * Load multiple trading markets in a single RPC call
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @param assetIndices - Array of asset indices to load market data for
     * @returns Array of Market instances (only includes successfully loaded markets)
     */
    public static async loadMultiple(
        network: Network,
        contractId: string,
        assetIndices: number[]
    ): Promise<Market[]> {
        if (assetIndices.length === 0) return [];

        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const markets: Market[] = [];

        const keys: xdr.LedgerKey[] = [];
        assetIndices.forEach((assetIndex) => {
            keys.push(persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                xdr.ScVal.scvU32(assetIndex)
            ]));

            keys.push(persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                xdr.ScVal.scvU32(assetIndex)
            ]));
        });

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            for (let i = 0; i < assetIndices.length; i++) {
                const configIndex = i * 2;
                const dataIndex = i * 2 + 1;

                if (configIndex < response.entries.length && dataIndex < response.entries.length) {
                    try {
                        const configScVal = response.entries[configIndex].val.contractData().val();
                        const dataScVal = response.entries[dataIndex].val.contractData().val();
                        const market = Market.fromScVals(assetIndices[i], configScVal, dataScVal);
                        markets.push(market);
                    } catch (error) {
                        console.error(`Failed to parse market for asset index ${assetIndices[i]}:`, error);
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
        assetIndex: number,
        configVal: xdr.ScVal,
        dataVal: xdr.ScVal
    ): Market {
        const config = Market.parseMarketConfig(configVal);
        const data = Market.parseMarketData(dataVal);

        return new Market(assetIndex, {
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
                case 'asset':
                    config.asset = assetFromScVal(value);
                    break;
                case 'enabled':
                    config.enabled = value.b();
                    break;
                case 'max_payout':
                    config.maxPayout = toFloat(scValToBigInt(value), 7);
                    break;
                case 'min_collateral':
                    config.minCollateral = toFloat(scValToBigInt(value), 7);
                    break;
                case 'max_collateral':
                    config.maxCollateral = toFloat(scValToBigInt(value), 7);
                    break;
                case 'init_margin':
                    config.initMargin = toFloat(scValToBigInt(value), 7);
                    break;
                case 'maintenance_margin':
                    config.maintenanceMargin = toFloat(scValToBigInt(value), 7);
                    break;
                case 'base_fee':
                    config.baseFee = toFloat(scValToBigInt(value), 7);
                    break;
                case 'price_impact_scalar':
                    config.priceImpactScalar = toFloat(scValToBigInt(value), 7);
                    break;
                case 'base_hourly_rate':
                    // This is in SCALAR_18
                    config.baseHourlyRate = Number(scValToBigInt(value)) / 1e18;
                    break;
                case 'ratio_cap':
                    config.ratioCap = Number(scValToBigInt(value)) / 1e18;
                    break;
            }
        });

        if (!config.asset) {
            throw new Error('Market config missing asset');
        }

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
                case 'long_notional_size':
                    data.longNotionalSize = toFloat(scValToBigInt(value), 7);
                    break;
                case 'short_notional_size':
                    data.shortNotionalSize = toFloat(scValToBigInt(value), 7);
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

    /**
     * Calculate funding rates based on market imbalance (mirrors interest.rs calc_interest).
     *
     * Returns hourly interest rates as percentages.
     * Positive = paying, negative = receiving.
     *
     * @returns { longRate, shortRate } as percentage numbers (e.g. 0.001 means 0.001%)
     */
    getInterestRates(): { longRate: number; shortRate: number } {
        const DISCOUNT_FACTOR = 800_000_000_000_000_000n; // 0.8 in SCALAR_18

        const baseRate = toFixed(this.baseHourlyRate, 18);
        const ratioCap = toFixed(this.ratioCap, 18);
        const longNotional = toFixed(this.longNotionalSize, 7);
        const shortNotional = toFixed(this.shortNotionalSize, 7);

        const hasLongs = longNotional > 0n;
        const hasShorts = shortNotional > 0n;

        let longRate: bigint;
        let shortRate: bigint;

        if (!hasLongs && !hasShorts) {
            // No positions — both sides pay base rate
            longRate = baseRate;
            shortRate = baseRate;
        } else if (hasLongs && !hasShorts) {
            // Only longs
            longRate = baseRate;
            shortRate = -mulFloor(baseRate, DISCOUNT_FACTOR, SCALAR_18);
        } else if (!hasLongs && hasShorts) {
            // Only shorts
            longRate = -mulFloor(baseRate, DISCOUNT_FACTOR, SCALAR_18);
            shortRate = baseRate;
        } else if (longNotional === shortNotional) {
            // Equal positions
            longRate = baseRate;
            shortRate = baseRate;
        } else {
            // Imbalanced market
            const isLongDominant = longNotional > shortNotional;
            const dominant = isLongDominant ? longNotional : shortNotional;
            const minority = isLongDominant ? shortNotional : longNotional;

            // Ratio capped at ratio_cap (use ceil for protocol safety)
            // Both dominant/minority are SCALAR_7 — they cancel, SCALAR_18 sets output precision
            const rawRatio = divCeil(dominant, minority, SCALAR_18);
            const ratio = rawRatio < ratioCap ? rawRatio : ratioCap;
            const squared = mulCeil(ratio, ratio, SCALAR_18);

            // Dominant side pays: base_rate * ratio
            const pay = mulCeil(baseRate, ratio, SCALAR_18);
            // Minority side receives: -0.8 * base_rate * ratio²
            const receive = -mulFloor(
                mulFloor(baseRate, DISCOUNT_FACTOR, SCALAR_18),
                squared,
                SCALAR_18
            );

            if (isLongDominant) {
                longRate = pay;
                shortRate = receive;
            } else {
                longRate = receive;
                shortRate = pay;
            }
        }

        // Convert from SCALAR_18 bigint to percentage number
        return {
            longRate: Number(longRate) / 1e18 * 100,
            shortRate: Number(shortRate) / 1e18 * 100,
        };
    }
}
