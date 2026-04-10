import { rpc, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { toFloat, toFixed, mulFloor, mulCeil, divFloor, divCeil, SCALAR_7, SCALAR_18 } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import { TradingConfigData } from './trading_config.js';

// Market configuration (matches Rust MarketConfig)
export interface MarketConfig {
    feedId: number;
    enabled: boolean;
    maxUtil: number;
    rVarMarket: bigint;
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
 * Markets are indexed by marketId. Each market has a feedId (Pyth Lazer feed ID)
 * stored in its config.
 */
export class Market implements MarketConfig, MarketData {
    // Market identity
    marketId: number;

    // Market configuration (feedId = Pyth price feed from config)
    feedId: number;
    enabled: boolean;
    maxUtil: number;
    rVarMarket: bigint;
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

    constructor(marketId: number, data: MarketConfig & MarketData) {
        this.marketId = marketId;
        this.feedId = data.feedId;
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
     * Load trading market data from the blockchain by market ID
     */
    public static async load(
        network: Network,
        contractId: string,
        marketId: number
    ): Promise<Market | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const keys = [
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                xdr.ScVal.scvU32(marketId)
            ]),
            persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                xdr.ScVal.scvU32(marketId)
            ])
        ];

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            if (response.entries.length < 2) return null;

            const configScVal = response.entries[0].val.contractData().val();
            const dataScVal = response.entries[1].val.contractData().val();

            return Market.fromScVals(marketId, configScVal, dataScVal);
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
        marketIds: number[]
    ): Promise<Market[]> {
        if (marketIds.length === 0) return [];

        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const markets: Market[] = [];

        const configKeys: xdr.LedgerKey[] = [];
        const dataKeys: xdr.LedgerKey[] = [];
        const allKeys: xdr.LedgerKey[] = [];

        marketIds.forEach((marketId) => {
            const ck = persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                xdr.ScVal.scvU32(marketId)
            ]);
            const dk = persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketData'),
                xdr.ScVal.scvU32(marketId)
            ]);
            configKeys.push(ck);
            dataKeys.push(dk);
            allKeys.push(ck, dk);
        });

        const response = await stellarRpc.getLedgerEntries(...allKeys);

        // Build map from XDR key → entry value
        const entryMap = new Map<string, xdr.LedgerEntryData>();
        for (const entry of response.entries) {
            entryMap.set(entry.key.toXDR('base64'), entry.val);
        }

        for (let i = 0; i < marketIds.length; i++) {
            const configEntry = entryMap.get(configKeys[i].toXDR('base64'));
            const dataEntry = entryMap.get(dataKeys[i].toXDR('base64'));
            if (!configEntry || !dataEntry) continue;

            try {
                const configScVal = configEntry.contractData().val();
                const dataScVal = dataEntry.contractData().val();
                const market = Market.fromScVals(marketIds[i], configScVal, dataScVal);
                markets.push(market);
            } catch {
                continue;
            }
        }

        return markets;
    }

    /** @internal */
    static fromScVals(
        marketId: number,
        configVal: xdr.ScVal,
        dataVal: xdr.ScVal
    ): Market {
        const config = Market.parseMarketConfig(configVal);
        const data = Market.parseMarketData(dataVal);

        return new Market(marketId, {
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
                case 'feed_id':
                    config.feedId = value.u32();
                    break;
                case 'enabled':
                    config.enabled = value.b();
                    break;
                case 'max_util':
                    config.maxUtil = toFloat(scValToBigInt(value), 7);
                    break;
                case 'r_var_market':
                    config.rVarMarket = scValToBigInt(value);
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
     * Mirrors contract fixed-point rounding: mulCeil for base fee, divCeil for impact.
     *
     * @param notionalSize - Notional size of the position (descaled number)
     * @param isLong - True for long, false for short
     * @param tradingConfig - Trading config with fee rates
     */
    estimateOpenFee(notionalSize: number, isLong: boolean, tradingConfig: TradingConfigData): number {
        const notionalBig = toFixed(notionalSize, 7);
        const longNotional = toFixed(this.lNotional, 7);
        const shortNotional = toFixed(this.sNotional, 7);

        // Check if this trade is on the dominant side
        const isDominant = isLong
            ? (longNotional + notionalBig) > shortNotional
            : (shortNotional + notionalBig) > longNotional;

        const feeRate = toFixed(isDominant ? tradingConfig.feeDom : tradingConfig.feeNonDom, 7);
        const impactBig = toFixed(this.impact, 7);

        // Contract: fixed_mul_ceil for base fee, fixed_div_floor for impact
        const baseFee = mulCeil(notionalBig, feeRate, SCALAR_7);
        const priceImpact = divFloor(notionalBig, impactBig, SCALAR_7);

        return toFloat(baseFee + priceImpact, 7);
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
     * Mirrors on-chain calc_borrowing_rate exactly in fixed-point bigint:
     *   rate = r_base + r_var × util_vault^5 + r_var_market × util_market^3
     *
     * All rate values are SCALAR_18. Utilizations are SCALAR_7.
     * Power operations use mulCeil with SCALAR_7 denominator.
     *
     * @param config - Trading config (rBase, rVar as SCALAR_18 bigints)
     * @param vaultBalance - Total assets in the vault (descaled number)
     * @param totalNotional - Total notional across all markets (descaled number)
     * @returns { longRate, shortRate } as percentage per hour. Only the dominant side is nonzero.
     */
    getBorrowingRates(
        config: TradingConfigData,
        vaultBalance: number,
        totalNotional: number,
    ): { longRate: number; shortRate: number } {
        const L = toFixed(this.lNotional, 7);
        const S = toFixed(this.sNotional, 7);

        if (L === 0n && S === 0n) return { longRate: 0, shortRate: 0 };

        // All rates in SCALAR_18
        const rBase = config.rBase;
        const rVar = config.rVar;                         // bigint (SCALAR_18)
        const rVarMarket = this.rVarMarket;  // already bigint (SCALAR_18)

        let rate = rBase;

        // --- calc_util for vault ---
        // Contract: cap = vault_balance.fixed_mul_floor(max_util, SCALAR_7)
        //           util = min(notional.fixed_div_ceil(cap, SCALAR_7), SCALAR_7)
        const vaultBalanceBig = toFixed(vaultBalance, 7);
        const totalNotionalBig = toFixed(totalNotional, 7);
        const maxUtilGlobal = toFixed(config.maxUtil, 7);

        // Vault term: r_var × util_vault^5
        if (rVar > 0n && vaultBalanceBig > 0n) {
            const cap = mulFloor(vaultBalanceBig, maxUtilGlobal, SCALAR_7);
            let utilVault = 0n;
            if (cap > 0n && totalNotionalBig > 0n) {
                const raw = divCeil(totalNotionalBig, cap, SCALAR_7);
                utilVault = raw < SCALAR_7 ? raw : SCALAR_7;
            }
            if (utilVault > 0n) {
                const u2 = mulCeil(utilVault, utilVault, SCALAR_7);
                const u4 = mulCeil(u2, u2, SCALAR_7);
                const u5 = mulCeil(u4, utilVault, SCALAR_7);
                rate += mulCeil(rVar, u5, SCALAR_7);
            }
        }

        // Market term: r_var_market × util_market^3
        if (rVarMarket > 0n && vaultBalanceBig > 0n) {
            const marketNotional = L + S;
            const maxUtilMarket = toFixed(this.maxUtil, 7);
            const cap = mulFloor(vaultBalanceBig, maxUtilMarket, SCALAR_7);
            let utilMarket = 0n;
            if (cap > 0n && marketNotional > 0n) {
                const raw = divCeil(marketNotional, cap, SCALAR_7);
                utilMarket = raw < SCALAR_7 ? raw : SCALAR_7;
            }
            if (utilMarket > 0n) {
                const u2 = mulCeil(utilMarket, utilMarket, SCALAR_7);
                const u3 = mulCeil(u2, utilMarket, SCALAR_7);
                rate += mulCeil(rVarMarket, u3, SCALAR_7);
            }
        }

        const ratePercent = toFloat(rate, 18) * 100;

        // Contract: L > S → longs pay, S > L → shorts pay, L == S (both > 0) → both pay
        if (L > S) {
            return { longRate: ratePercent, shortRate: 0 };
        } else if (S > L) {
            return { longRate: 0, shortRate: ratePercent };
        } else {
            return { longRate: ratePercent, shortRate: ratePercent };
        }
    }

    /**
     * Get the funding rates for both sides as percentage per hour.
     *
     * The paying side rate is `fundRate` (already stored on-chain).
     * The receive side mirrors the contract's fixed-point path:
     *   ratio = pay_notional / recv_notional  (SCALAR_18, floor)
     *   recv_delta = pay_delta × ratio         (SCALAR_18, floor)
     *
     * @returns { longRate, shortRate } as percentage numbers.
     *   Positive = paying, negative = receiving.
     */
    getFundingRates(): { longRate: number; shortRate: number } {
        const L = toFixed(this.lNotional, 7);
        const S = toFixed(this.sNotional, 7);
        const absFundRate = this.fundRate < 0n ? -this.fundRate : this.fundRate;

        if (absFundRate === 0n || L === 0n || S === 0n) {
            return { longRate: 0, shortRate: 0 };
        }

        const payRate = toFloat(absFundRate, 18);
        const [payNotional, recvNotional] = this.fundRate > 0n ? [L, S] : [S, L];

        // Mirror contract: ratio = pay / recv (SCALAR_18 floor), recv = pay × ratio (floor)
        const ratio = divFloor(payNotional, recvNotional, SCALAR_18);
        const recvRate = toFloat(mulFloor(absFundRate, ratio, SCALAR_18), 18);

        if (this.fundRate > 0n) {
            return {
                longRate: payRate * 100,
                shortRate: -recvRate * 100,
            };
        } else {
            return {
                longRate: -recvRate * 100,
                shortRate: payRate * 100,
            };
        }
    }
}
