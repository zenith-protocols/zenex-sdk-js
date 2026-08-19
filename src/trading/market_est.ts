import { SCALAR_18 } from '../math/fixed.js';
import {
    formatHourlyPercent,
    formatPercent,
    formatPrice,
    formatToken,
    formatTokenFloor,
} from '../float.js';
import type { Market } from './market.js';
import type { PriceInput } from './price.js';
import { resolvePrice } from './price.js';
import type { PriceData } from './internal/math.js';
import { mulDivFloor } from '../math/fixed.js';
import {
    borrowingRate,
    exitPrice,
    marketFundingRatesPerSide,
    marketSidePnl,
} from './internal/math.js';
import {
    cappedNetPnl,
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    evaluateVaultWithdrawGates,
} from './internal/vault.js';

/** One side's approximate view of the book and its rates. For display only. */
export interface SideRatesEstimate {
    /** Reserve utilization of the side's own half of the vault, percent. */
    utilizationPercent: number;
    /** Borrowing rate the side would pay, percent of notional per hour. */
    borrowRatePercent1h: number;
    /**
     * Funding rate this side's trader pays, percent of notional per hour.
     * Positive: the side pays; negative: it receives (the payer's charge
     * re-spread over this side's notional). Zero when the stored rate is 0.
     */
    fundingRatePercent1h: number;
    /** Whether this side is charged borrowing now (dominant side pays; a tie charges both). */
    charged: boolean;
    /** Entry notional held by the side, settlement-token units. */
    notional: number;
    /** Margin posted by the side, settlement-token units. */
    margin: number;
    /** Open interest, base-token units. */
    openInterestTokens: number;
    /** Open interest valued at the estimate price, settlement-token units. */
    openInterestValue: number;
    /**
     * Notional that can still open on this side before an open gate trips
     * (`max_util_open` headroom at the estimate price, or `max_open_interest`
     * headroom), settlement-token units. The "available liquidity" / max-size
     * number.
     */
    openCapacity: number;
    /**
     * Net rate this side's trader pays per hour, percent of notional:
     * `fundingRatePercent1h` plus `borrowRatePercent1h` when the side is
     * charged borrowing. Positive: the trader pays; negative: it earns.
     */
    netRatePercent1h: number;
}

/**
 * The float projection of {@link Market}'s exact methods, for display. Plain
 * data: serializes, spreads into props, survives a query cache. Never feed
 * any of it back into a transaction.
 */
export interface MarketEstimate {
    /** Stored funding rate, percent per hour. Positive: longs pay shorts. Not floored. */
    fundingRatePercent1h: number;
    /** Funding rate a payer is actually charged, percent per hour: unsigned, floored at `fundingMin`, zero at zero. */
    fundingChargeRatePercent1h: number;
    /** Best bid the estimate was priced at (18-dec scalar, as a float). */
    bid: number;
    /** Best ask the estimate was priced at (18-dec scalar, as a float). */
    ask: number;
    /** Unix seconds the estimate's price was observed by the oracle. */
    publishTime: number;
    /** Vault margin balance, settlement-token units. */
    vaultAssets: number;
    /** Vault shares in circulation, share units. */
    vaultSupply: number;
    /** Max leverage the initial-margin requirement allows (`1 / initMargin`). */
    maxLeverage: number;
    /** Long-side utilization and borrow APR at the current book. */
    long: SideRatesEstimate;
    /** Short-side utilization and borrow APR at the current book. */
    short: SideRatesEstimate;
    /** Vault share price, assets per share (uPnL-aware at the estimate price). */
    sharePrice: number;
    /** Long-side traders' unrealized PnL, token units. Positive: traders up, vault down. */
    longPnl: number;
    /** Short-side traders' unrealized PnL, token units. */
    shortPnl: number;
    /** Net unrealized trader PnL across both sides, token units — the quantity share pricing nets out. */
    netPnl: number;
    /**
     * Largest redeem that clears the exit gates (utilization and pending-PnL
     * headroom), share units, floor-rounded so the value round-trips through
     * an input field and `parseAtomic` without exceeding the true maximum.
     * `0` when withdrawals are fully gated.
     */
    maxRedeemableShares: number;
}

function sideEstimate(
    market: Market,
    p: PriceData,
    price: PriceInput,
    isLong: boolean,
): SideRatesEstimate {
    const data = market.data;
    const config = market.config;
    const decimals = market.assetDecimals;

    const own = isLong ? data.tokens.long : data.tokens.short;
    const other = isLong ? data.tokens.short : data.tokens.long;
    const charged = own >= other;
    const utilization = market.utilization(isLong, price);
    const borrowPerSec = borrowingRate(config, utilization);
    const fundingSplit = marketFundingRatesPerSide(data, config);
    const fundingPerSec = isLong ? fundingSplit.long : fundingSplit.short;

    const borrow1h = formatHourlyPercent(borrowPerSec);
    const funding1h = formatHourlyPercent(fundingPerSec);

    const mark = exitPrice(p, isLong);
    return {
        utilizationPercent: formatPercent(utilization),
        borrowRatePercent1h: borrow1h,
        fundingRatePercent1h: funding1h,
        charged,
        notional: formatToken(
            isLong ? data.notional.long : data.notional.short,
            decimals,
        ),
        margin: formatToken(
            isLong ? data.margin.long : data.margin.short,
            decimals,
        ),
        openInterestTokens: formatToken(own, decimals),
        openInterestValue: formatToken(
            mulDivFloor(own, mark, SCALAR_18),
            decimals,
        ),
        openCapacity: formatTokenFloor(
            market.openCapacity(isLong, price),
            decimals,
        ),
        netRatePercent1h: funding1h + (charged ? borrow1h : 0),
    };
}

/** Largest asset withdrawal that clears the exit gates, by binary search. */
function maxWithdrawableAssets(market: Market, p: PriceData): bigint {
    const passes = (assetsOut: bigint): boolean => {
        try {
            evaluateVaultWithdrawGates(
                market.data,
                market.config,
                p,
                market.vaultAssets - assetsOut,
            );
            return true;
        } catch {
            return false;
        }
    };
    if (!passes(0n)) return 0n;
    let low = 0n;
    let high = market.vaultAssets;
    while (low < high) {
        const mid = low + (high - low + 1n) / 2n;
        if (passes(mid)) low = mid;
        else high = mid - 1n;
    }
    return low;
}

/**
 * Compute the market's display estimate at `price` (bare bigint =
 * zero-spread), against the market as passed — pass `market.accrue(price)`
 * for numbers advanced to now. Every figure is computed by the exact
 * mirrors and converted to `number` at this boundary only; a keeper reads
 * the same {@link Market} methods directly for exact bigints.
 */
export function estimateMarket(
    market: Market,
    price: PriceInput,
): MarketEstimate {
    const p = resolvePrice(price);
    const data = market.data;
    const config = market.config;
    const decimals = market.assetDecimals;
    const shareDecimals = decimals + market.vaultDecimalsOffset;

    const magnitude =
        data.fundingRate < 0n ? -data.fundingRate : data.fundingRate;
    const chargedMagnitude =
        data.fundingRate === 0n
            ? 0n
            : magnitude > config.fundingMin
              ? magnitude
              : config.fundingMin;

    // Share price and max redeem run in the redeem direction: capped uPnL
    // maximized against the redeemer, mirroring the fill.
    const vault = market.vaultAtomic();
    const redeemPnl = cappedNetPnl(data, config, p, market.vaultAssets, true);
    let sharePrice = 0;
    let maxRedeemableShares = 0;
    try {
        const oneShare = 10n ** BigInt(shareDecimals);
        sharePrice = formatToken(
            convertVaultSharesToAssets(vault, oneShare, redeemPnl),
            decimals,
        );
        const maxAssets = maxWithdrawableAssets(market, p);
        let shares = convertVaultAssetsToShares(vault, maxAssets, redeemPnl);
        if (shares > vault.totalSupply) shares = vault.totalSupply;
        maxRedeemableShares = formatTokenFloor(shares, shareDecimals);
    } catch {
        // Insolvent basis (pending PnL exceeds vault assets): both read 0.
    }

    const longPnl = marketSidePnl(data, p, true, true);
    const shortPnl = marketSidePnl(data, p, false, true);

    return {
        fundingRatePercent1h: formatHourlyPercent(data.fundingRate),
        fundingChargeRatePercent1h: formatHourlyPercent(chargedMagnitude),
        bid: formatPrice(p.bid),
        ask: formatPrice(p.ask),
        publishTime: Number(p.publishTime),
        vaultAssets: formatToken(market.vaultAssets, decimals),
        vaultSupply: formatToken(market.vaultShares, shareDecimals),
        maxLeverage:
            config.initMargin === 0n
                ? Infinity
                : Number(SCALAR_18) / Number(config.initMargin),
        long: sideEstimate(market, p, price, true),
        short: sideEstimate(market, p, price, false),
        sharePrice,
        longPnl: formatToken(longPnl, decimals),
        shortPnl: formatToken(shortPnl, decimals),
        netPnl: formatToken(
            cappedNetPnl(data, config, p, market.vaultAssets, true),
            decimals,
        ),
        maxRedeemableShares,
    };
}
