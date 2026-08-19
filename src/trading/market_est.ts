import { SCALAR_18 } from '../math/fixed.js';
import {
    formatAnnualPercent,
    formatPercent,
    formatToken,
    formatTokenFloor,
} from '../float.js';
import type { Market } from './market.js';
import type { PriceInput } from './price.js';
import { resolvePrice } from './price.js';
import type { PriceData } from './internal/math.js';
import { mulDivFloor } from '../math/fixed.js';
import { borrowingRate, exitPrice, marketSidePnl } from './internal/math.js';
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
    /** Borrowing rate the side would pay, annualized percent. */
    borrowAprPercent: number;
    /** Whether this side is charged borrowing now (dominant side pays; a tie charges both). */
    charged: boolean;
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
     * Net rate this side's trader pays per hour, percent of notional.
     * Positive: the trader pays; negative: the trader earns. Combines the
     * floored funding charge (with the receiver side credited at the payer
     * magnitude re-spread over the receiver's notional) and the borrowing
     * rate when this side is charged it.
     */
    netRatePercent1h: number;
}

/**
 * The float projection of {@link Market}'s exact methods, for display. Plain
 * data: serializes, spreads into props, survives a query cache. Never feed
 * any of it back into a transaction.
 */
export interface MarketEstimate {
    /** Stored funding rate, annualized percent. Positive: longs pay shorts. Not floored. */
    fundingAprPercent: number;
    /** Funding rate a payer is actually charged: unsigned, floored at `fundingMin`, zero at zero. */
    fundingChargeAprPercent: number;
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

/**
 * Compute the market's display estimate at `price` (bare bigint =
 * zero-spread), against the market as passed — pass `market.accrue(price)`
 * for numbers advanced to now. Every figure is computed by the exact
 * mirrors and converted to `number` at this boundary only; a keeper reads
 * the same {@link Market} methods directly for exact bigints.
 */
/** Per-hour percent of a per-second SCALAR_18 rate. */
function percentPerHour(perSecondRate: bigint): number {
    return (Number(perSecondRate) / Number(SCALAR_18)) * 3600 * 100;
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

    // Funding leg, signed toward what THIS side's trader pays: the payer
    // side is charged the floored magnitude; the receiver side is credited
    // the payer's charge re-spread over the receiver's notional.
    let fundingPerSec = 0n;
    if (data.fundingRate !== 0n) {
        const longsPay = data.fundingRate > 0n;
        const magnitude =
            data.fundingRate < 0n ? -data.fundingRate : data.fundingRate;
        const chargedMagnitude =
            magnitude > config.fundingMin ? magnitude : config.fundingMin;
        if (isLong === longsPay) {
            fundingPerSec = chargedMagnitude;
        } else {
            const payerNotional = longsPay
                ? data.notional.long
                : data.notional.short;
            const receiverNotional = longsPay
                ? data.notional.short
                : data.notional.long;
            fundingPerSec =
                receiverNotional > 0n
                    ? -mulDivFloor(
                          chargedMagnitude,
                          payerNotional,
                          receiverNotional,
                      )
                    : 0n;
        }
    }
    const netPerHour =
        percentPerHour(fundingPerSec) +
        (charged ? percentPerHour(borrowPerSec) : 0);

    const mark = exitPrice(p, isLong);
    return {
        utilizationPercent: formatPercent(utilization),
        borrowAprPercent: formatAnnualPercent(borrowPerSec),
        charged,
        openInterestTokens: formatToken(own, decimals),
        openInterestValue: formatToken(
            mulDivFloor(own, mark, SCALAR_18),
            decimals,
        ),
        openCapacity: formatTokenFloor(
            market.openCapacity(isLong, price),
            decimals,
        ),
        netRatePercent1h: netPerHour,
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
        fundingAprPercent: formatAnnualPercent(data.fundingRate),
        fundingChargeAprPercent: formatAnnualPercent(chargedMagnitude),
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
