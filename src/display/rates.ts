// =============================================================================
// Annualized rate display.
//
// The contract stores every rate as a per-second SCALAR_18 value, which is
// unreadable in a UI. These annualize the EXACT rate computed by the market
// mirrors — they never re-derive the kink curve or the funding velocity in
// floats. Approximate, display only.
// =============================================================================

import type { MarketData, TradingConfig } from '../contracts/trading/trading_types.js';
import type { PriceData } from '../trading/market/types.js';
import {
    reserveUtilization,
    sideCapacity,
    sideReserved,
} from '../trading/market/capacity.js';
import { borrowingRate } from '../trading/market/rates.js';
import { SCALAR_18 } from '../math/fixed.js';
import { formatAnnualPercent, formatPercent } from './format.js';

export interface SideRates {
    /** Reserve utilization of the side's own half of the vault, percent. */
    utilizationPercent: number;
    /** Borrowing rate charged to the side, annualized percent. */
    borrowAprPercent: number;
}

/**
 * Borrowing utilization and APR for one side, at the market's current book.
 *
 * Mirrors the accrual's own per-side measurement: each side reserves against
 * its own half of the vault, and only the dominant side (strictly greater base
 * tokens) is actually charged — a tie charges both. `charged` reports that, so
 * a UI can show the rate a side *would* pay without implying it is paying.
 */
export function sideRates(
    market: MarketData,
    config: TradingConfig,
    price: PriceData,
    vaultAssets: bigint,
    isLong: boolean,
): SideRates & { charged: boolean } {
    const capacity = sideCapacity(vaultAssets, config.maxUtilOpen);
    const utilization = reserveUtilization(sideReserved(market, price, isLong), capacity);
    const own = isLong ? market.tokens.long : market.tokens.short;
    const other = isLong ? market.tokens.short : market.tokens.long;

    return {
        utilizationPercent: formatPercent(utilization),
        borrowAprPercent: formatAnnualPercent(borrowingRate(config, utilization)),
        charged: own >= other,
    };
}

/**
 * The market's current funding rate, annualized percent.
 *
 * Positive means longs pay shorts; negative means shorts pay longs. This is the
 * stored rate, which is NOT floored at `fundingMin` — the floor applies to the
 * charged magnitude at accrual, so a very small stored rate can display below
 * the minimum it would actually be charged at. Use {@link fundingChargeApr} for
 * what a position is charged.
 */
export function fundingApr(market: MarketData): number {
    return formatAnnualPercent(market.fundingRate);
}

/**
 * The funding rate a payer is actually charged, annualized percent (unsigned).
 *
 * Mirrors the accrual's `max(|fundingRate|, fundingMin)` flooring. Zero when
 * the rate is zero, since a zero rate charges nothing at all.
 */
export function fundingChargeApr(market: MarketData, config: TradingConfig): number {
    if (market.fundingRate === 0n) return 0;
    const magnitude =
        market.fundingRate < 0n ? -market.fundingRate : market.fundingRate;
    const charged = magnitude > config.fundingMin ? magnitude : config.fundingMin;
    return formatAnnualPercent(charged);
}

/** Max leverage the initial-margin requirement allows, as a float (`1 / initMargin`). */
export function maxLeverage(config: TradingConfig): number {
    if (config.initMargin === 0n) return Infinity;
    return Number(SCALAR_18) / Number(config.initMargin);
}
