import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { SCALAR_18, mulFloor, mulCeil, divCeil } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import { MarketData, TradingConfig, parseMarketData } from './trading_types.js';

// =============================================================================
// v2 market math and loader.
//
// Every formula is ported from
// `zenex-contracts/trading/src/trading/market_data.rs` (`side_pnl`, `net_pnl`,
// `skew_split`) and `market.rs::trade_fees` (branch v2/dev). The market is a
// single per-contract singleton in v2.
//
// Truncation semantics match `trading_position.ts`: `mulCeil` is true ceil for
// every sign; `mulFloor` (BigInt truncation toward zero) matches true floor for
// the non-negative products used here. `priceScalar` is the SCALAR_18 scalar
// baked into `tokens` (see `trading_position.ts`); callers pass `SCALAR_18`.
// =============================================================================

/** The base + impact trade fee for a skew-split fill (token-dec), with the split legs. */
export interface SkewSplitFees {
    /** Worsening notional leg (moves the book further from balance), token-dec. */
    worsening: bigint;
    /** Improving notional leg (moves the book toward balance), token-dec. */
    improving: bigint;
    /** Trade fee: `fee_dom` on the worsening leg plus `fee_non_dom` on the improving leg. */
    base: bigint;
    /** Price-impact fee: `worsening / impact_divisor`, charged on the worsening leg only. */
    impact: bigint;
}

/**
 * Signed pending PnL of `is_long`'s side, token-dec, floored at the negation of
 * the side's posted collateral.
 *
 * Ports `MarketData::side_pnl`. The Rust marks the two sides at bid/ask by a
 * `maximize` flag; this single-price form uses the trader-conservative marking
 * (long at floor, short at ceil, matching `math::pnl`), which equals
 * `side_pnl(maximize = false)` at zero bid/ask spread. `priceScalar` = SCALAR_18
 * for v2.
 */
export function sidePnl(marketData: MarketData, price: bigint, priceScalar: bigint, isLong: boolean): bigint {
    const pnl = isLong
        ? mulFloor(marketData.tokens.long, price, priceScalar) - marketData.notional.long
        : marketData.notional.short - mulCeil(marketData.tokens.short, price, priceScalar);
    const sideCollateral = isLong ? marketData.collateral.long : marketData.collateral.short;
    const floor = -sideCollateral;
    return pnl > floor ? pnl : floor;
}

/**
 * Signed net pending trader PnL across both sides, token-dec.
 *
 * Ports `MarketData::net_pnl`: `sidePnl(long) + sidePnl(short)` at the same
 * marking. This is the vault's share mispricing (positive = shares overstate
 * fair value by unpaid profit).
 */
export function netPnl(marketData: MarketData, price: bigint, priceScalar: bigint): bigint {
    return sidePnl(marketData, price, priceScalar, true) + sidePnl(marketData, price, priceScalar, false);
}

/**
 * Market utilization as a SCALAR_18 ratio: open interest / vault balance.
 *
 * Follows the config's utilization definition (`util = open interest / vault`),
 * summing both sides' notional. Returns `0` for a non-positive vault balance.
 * This is the notional-based display ratio, distinct from the price-bearing
 * reserve (`MarketData::reserved`) that the on-chain open cap gates against.
 * The ratio is not capped, so it can exceed SCALAR_18.
 */
export function utilization(marketData: MarketData, vaultBalance: bigint): bigint {
    if (vaultBalance <= 0n) {
        return 0n;
    }
    const openInterest = marketData.notional.long + marketData.notional.short;
    // floor(openInterest * SCALAR_18 / vaultBalance); non-negative product.
    return mulFloor(openInterest, SCALAR_18, vaultBalance);
}

/**
 * Split a signed token change on `is_long`'s side into its worsening/improving
 * legs and compute the resulting trade fees, token-dec.
 *
 * Ports `MarketData::skew_split` and `Market::trade_fees`. The token change is
 * split by its effect on the book's token imbalance, then that split is mapped
 * pro-rata onto the fill's `signedNotional`: the worsening notional rounds up
 * (`ceil(|notional| * worseningTokens / |signedTokens|)`), the improving leg
 * takes the exact remainder. The base fee charges `fee_dom` (ceil) on the
 * worsening notional and `fee_non_dom` (ceil) on the improving notional; the
 * impact fee is `ceil(worseningNotional * SCALAR_18 / impact_divisor)` on the
 * worsening leg only.
 *
 * Note: `Market::trade_fees` takes both the signed notional and signed tokens;
 * the token change drives the skew split while the notional is what the fee is
 * charged on. The brief listed only `signedTokens`, so `signedNotional` is added
 * here to port the mapping faithfully.
 */
export function skewSplitFees(
    config: TradingConfig,
    marketData: MarketData,
    isLong: boolean,
    signedNotional: bigint,
    signedTokens: bigint,
): SkewSplitFees {
    // --- skew_split ---
    const imbPre = marketData.tokens.long - marketData.tokens.short;
    const imbPost = isLong ? imbPre + signedTokens : imbPre - signedTokens;

    const abs = (x: bigint) => (x < 0n ? -x : x);
    const deltaTokens = abs(signedTokens);

    let worseningTokens: bigint;
    let improvingTokens: bigint;
    if (imbPre !== 0n && imbPost !== 0n && (imbPre < 0n) !== (imbPost < 0n)) {
        // The change crosses the balance point: the run to zero improves, the overshoot worsens.
        worseningTokens = abs(imbPost);
        improvingTokens = abs(imbPre);
    } else if (abs(imbPost) > abs(imbPre)) {
        worseningTokens = deltaTokens;
        improvingTokens = 0n;
    } else {
        worseningTokens = 0n;
        improvingTokens = deltaTokens;
    }

    // --- trade_fees: map the token split onto the notional pro-rata ---
    const notional = abs(signedNotional);
    // Worsening notional rounds up (dominant fee errs high); improving takes the remainder.
    const worsening = deltaTokens === 0n ? 0n : mulCeil(notional, worseningTokens, deltaTokens);
    const improving = notional - worsening;

    const base =
        mulCeil(worsening, config.feeDom, SCALAR_18) + mulCeil(improving, config.feeNonDom, SCALAR_18);
    // apply_divisor: ceil(worsening * SCALAR_18 / impact_divisor).
    const impact = divCeil(worsening, config.impactDivisor, SCALAR_18);

    return { worsening, improving, base, impact };
}

/**
 * MarketView - loader for the v2 market singleton.
 *
 * Wraps the `MarketData` persistent entry (equivalent to the `get_market_data`
 * view) and exposes the pure market math as instance methods. Mirrors the v1
 * loader role, adapted to the single-market v2 storage.
 */
export class MarketView {
    constructor(public readonly data: MarketData) {}

    /**
     * Load the market singleton (`DataKey::MarketData`) from persistent
     * storage. Returns `null` when the entry is absent.
     */
    public static async load(network: Network, contractId: string): Promise<MarketView | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const key = persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('MarketData')]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return null;
            const native = scValToNative(response.entries[0].val.contractData().val());
            return new MarketView(parseMarketData(native));
        } catch {
            return null;
        }
    }

    /** Signed pending PnL of `isLong`'s side (`priceScalar` = SCALAR_18 for v2). */
    sidePnl(price: bigint, isLong: boolean, priceScalar: bigint = SCALAR_18): bigint {
        return sidePnl(this.data, price, priceScalar, isLong);
    }

    /** Signed net pending trader PnL across both sides. */
    netPnl(price: bigint, priceScalar: bigint = SCALAR_18): bigint {
        return netPnl(this.data, price, priceScalar);
    }

    /** Open interest / vault balance as a SCALAR_18 ratio. */
    utilization(vaultBalance: bigint): bigint {
        return utilization(this.data, vaultBalance);
    }

    /** Trade fees for a skew-split fill on `isLong`'s side. */
    skewSplitFees(config: TradingConfig, isLong: boolean, signedNotional: bigint, signedTokens: bigint): SkewSplitFees {
        return skewSplitFees(config, this.data, isLong, signedNotional, signedTokens);
    }
}
