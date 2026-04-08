import { rpc, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { toFloat } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import { TradingConfigData } from './trading_config.js';

// Market configuration (matches Rust MarketConfig)
export interface MarketConfig {
    enabled: boolean;
    maxUtil: number;
    rVarMarket: number;
    margin: number;
    liqFee: number;
    impact: number;
}

// Market data (matches Rust MarketData)
export interface MarketData {
    lNotional: number;
    sNotional: number;
    lFundIdx: bigint;    // SCALAR_18
    sFundIdx: bigint;    // SCALAR_18
    lBorrIdx: bigint;    // SCALAR_18
    sBorrIdx: bigint;    // SCALAR_18
    lEntryWt: number;
    sEntryWt: number;
    fundRate: bigint;    // SCALAR_18, positive = longs pay
    lastUpdate: number;
    lAdlIdx: bigint;     // SCALAR_18
    sAdlIdx: bigint;     // SCALAR_18
}

/**
 * Market - Trading market class with config and dynamic data
 *
 * Contains both configuration and real-time market data.
 * Markets are indexed by feedId (Pyth Lazer feed ID).
 */
export class Market implements MarketConfig, MarketData {
    // Market identity
    feedId: number;

    // Market configuration
    enabled: boolean;
    maxUtil: number;
    rVarMarket: number;
    margin: number;
    liqFee: number;
    impact: number;

    // Dynamic market data
    lNotional: number;
    sNotional: number;
    lFundIdx: bigint;
    sFundIdx: bigint;
    lBorrIdx: bigint;
    sBorrIdx: bigint;
    lEntryWt: number;
    sEntryWt: number;
    fundRate: bigint;
    lastUpdate: number;
    lAdlIdx: bigint;
    sAdlIdx: bigint;

    constructor(feedId: number, data: MarketConfig & MarketData) {
        this.feedId = feedId;
        this.enabled = data.enabled;
        this.maxUtil = data.maxUtil;
        this.rVarMarket = data.rVarMarket;
        this.margin = data.margin;
        this.liqFee = data.liqFee;
        this.impact = data.impact;
        this.lNotional = data.lNotional;
        this.sNotional = data.sNotional;
        this.lFundIdx = data.lFundIdx;
        this.sFundIdx = data.sFundIdx;
        this.lBorrIdx = data.lBorrIdx;
        this.sBorrIdx = data.sBorrIdx;
        this.lEntryWt = data.lEntryWt;
        this.sEntryWt = data.sEntryWt;
        this.fundRate = data.fundRate;
        this.lastUpdate = data.lastUpdate;
        this.lAdlIdx = data.lAdlIdx;
        this.sAdlIdx = data.sAdlIdx;
    }

    // === Static Loaders ===

    /**
     * Load trading market data from the blockchain by feed ID
     */
    public static async load(
        network: Network,
        contractId: string,
        feedId: number
    ): Promise<Market | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const keys = [
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                xdr.ScVal.scvU32(feedId)
            ]),
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                xdr.ScVal.scvU32(feedId)
            ])
        ];

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            if (response.entries.length < 2) return null;

            const configScVal = response.entries[0].val.contractData().val();
            const dataScVal = response.entries[1].val.contractData().val();

            return Market.fromScVals(feedId, configScVal, dataScVal);
        } catch {
            return null;
        }
    }

    /**
     * Load multiple trading markets in a single RPC call
     */
    public static async loadMultiple(
        network: Network,
        contractId: string,
        feedIds: number[]
    ): Promise<Market[]> {
        if (feedIds.length === 0) return [];

        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const markets: Market[] = [];

        const keys: xdr.LedgerKey[] = [];
        feedIds.forEach((feedId) => {
            keys.push(persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                xdr.ScVal.scvU32(feedId)
            ]));

            keys.push(persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                xdr.ScVal.scvU32(feedId)
            ]));
        });

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            for (let i = 0; i < feedIds.length; i++) {
                const configIndex = i * 2;
                const dataIndex = i * 2 + 1;

                if (configIndex < response.entries.length && dataIndex < response.entries.length) {
                    try {
                        const configScVal = response.entries[configIndex].val.contractData().val();
                        const dataScVal = response.entries[dataIndex].val.contractData().val();
                        const market = Market.fromScVals(feedIds[i], configScVal, dataScVal);
                        markets.push(market);
                    } catch (error) {
                        console.error(`Failed to parse market for feed ID ${feedIds[i]}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load markets:', error);
        }

        return markets;
    }

    /** @internal */
    static fromScVals(
        feedId: number,
        configVal: xdr.ScVal,
        dataVal: xdr.ScVal
    ): Market {
        const config = Market.parseMarketConfig(configVal);
        const data = Market.parseMarketData(dataVal);

        return new Market(feedId, {
            ...config,
            ...data,
        });
    }

    /** @internal */
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
                case 'max_util':
                    config.maxUtil = toFloat(scValToBigInt(value), 7);
                    break;
                case 'r_var_market':
                    config.rVarMarket = toFloat(scValToBigInt(value), 18);
                    break;
                case 'margin':
                    config.margin = toFloat(scValToBigInt(value), 7);
                    break;
                case 'liq_fee':
                    config.liqFee = toFloat(scValToBigInt(value), 7);
                    break;
                case 'impact':
                    config.impact = toFloat(scValToBigInt(value), 7);
                    break;
            }
        });

        return config as MarketConfig;
    }

    /** @internal */
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
                case 'l_notional':
                    data.lNotional = toFloat(scValToBigInt(value), 7);
                    break;
                case 's_notional':
                    data.sNotional = toFloat(scValToBigInt(value), 7);
                    break;
                case 'l_fund_idx':
                    data.lFundIdx = scValToBigInt(value);
                    break;
                case 's_fund_idx':
                    data.sFundIdx = scValToBigInt(value);
                    break;
                case 'l_borr_idx':
                    data.lBorrIdx = scValToBigInt(value);
                    break;
                case 's_borr_idx':
                    data.sBorrIdx = scValToBigInt(value);
                    break;
                case 'l_entry_wt':
                    data.lEntryWt = toFloat(scValToBigInt(value), 7);
                    break;
                case 's_entry_wt':
                    data.sEntryWt = toFloat(scValToBigInt(value), 7);
                    break;
                case 'fund_rate':
                    data.fundRate = scValToBigInt(value);
                    break;
                case 'last_update':
                    data.lastUpdate = Number(scValToBigInt(value));
                    break;
                case 'l_adl_idx':
                    data.lAdlIdx = scValToBigInt(value);
                    break;
                case 's_adl_idx':
                    data.sAdlIdx = scValToBigInt(value);
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
        return this.lNotional + this.sNotional;
    }

    /**
     * Get market skew (positive = more longs, negative = more shorts)
     */
    getSkew(): number {
        return this.lNotional - this.sNotional;
    }

    /**
     * Estimate the opening fee for a position.
     * Needs TradingConfigData for fee rates since they live in trading config now.
     *
     * @param notionalSize - Notional size of the position
     * @param isLong - True for long, false for short
     * @param tradingConfig - Trading config with fee rates
     */
    estimateOpenFee(notionalSize: number, isLong: boolean, tradingConfig: TradingConfigData): number {
        // Check if this trade is on the dominant side
        const isDominant = isLong
            ? (this.lNotional + notionalSize) > this.sNotional
            : (this.sNotional + notionalSize) > this.lNotional;

        const baseFee = isDominant
            ? notionalSize * tradingConfig.feeDom
            : notionalSize * tradingConfig.feeNonDom;
        const priceImpact = notionalSize / this.impact;

        return baseFee + priceImpact;
    }

    /**
     * Get market utilization (total notional / vault balance), capped at 1.0.
     *
     * @param vaultBalance - Total assets in the vault (descaled number)
     * @returns Utilization ratio (0..1)
     */
    getUtilization(vaultBalance: number): number {
        if (vaultBalance <= 0) return 0;
        const total = this.lNotional + this.sNotional;
        return Math.min(total / vaultBalance, 1);
    }

    /**
     * Get the current borrowing rate per hour for the dominant side.
     *
     * Formula: rBase × (1 + rVar × util^5) × rVarMarket
     * Only the side with more notional pays.
     *
     * @param config - Trading config (rBase, rVar as SCALAR_18 bigints)
     * @param vaultBalance - Total assets in the vault (descaled number)
     * @returns { longRate, shortRate } as percentage per hour. Only the dominant side is nonzero.
     */
    getBorrowingRates(config: TradingConfigData, vaultBalance: number): { longRate: number; shortRate: number } {
        const L = this.lNotional;
        const S = this.sNotional;

        if (L === S) return { longRate: 0, shortRate: 0 };

        const util = this.getUtilization(vaultBalance);
        const rBase = Number(config.rBase) / 1e18;
        const rVar = config.rVar;  // already descaled (SCALAR_18 → number)
        const rVarMarket = this.rVarMarket;

        // util^5
        const u2 = util * util;
        const u4 = u2 * u2;
        const u5 = u4 * util;

        // multiplier = 1 + rVar × util^5
        const multiplier = 1 + rVar * u5;
        const rate = rBase * multiplier * rVarMarket;

        const ratePercent = rate * 100;

        if (L > S) {
            return { longRate: ratePercent, shortRate: 0 };
        } else {
            return { longRate: 0, shortRate: ratePercent };
        }
    }

    /**
     * Get the current funding rate as a percentage per hour.
     *
     * Computed client-side from L/S sizes and base rate so it's always
     * up-to-date (the on-chain stored rate only refreshes on execute_apply_funding).
     *
     * Formula: baseRate * |L - S| / (L + S)
     * Positive = longs pay, negative = shorts pay.
     *
     * @param rFunding - Base hourly funding rate (SCALAR_18 precision bigint from TradingConfigData)
     * @returns { longRate, shortRate } as percentage numbers
     */
    getFundingRates(rFunding: bigint): { longRate: number; shortRate: number } {
        const L = this.lNotional;
        const S = this.sNotional;
        const total = L + S;

        if (total === 0) {
            return { longRate: 0, shortRate: 0 };
        }

        const baseRate = Number(rFunding) / 1e18;
        const imbalance = Math.abs(L - S);
        // Pay rate per unit (same as on-chain calc_funding_rate)
        const payRate = baseRate * (imbalance / total);

        if (L >= S) {
            // Longs pay payRate per unit
            // Shorts receive payRate x (L/S) per unit (self-balancing)
            const receiveRate = S > 0 ? payRate * (L / S) : 0;
            return {
                longRate: payRate * 100,
                shortRate: -receiveRate * 100,
            };
        } else {
            // Shorts pay payRate per unit
            // Longs receive payRate x (S/L) per unit (self-balancing)
            const receiveRate = L > 0 ? payRate * (S / L) : 0;
            return {
                longRate: -receiveRate * 100,
                shortRate: payRate * 100,
            };
        }
    }
}
