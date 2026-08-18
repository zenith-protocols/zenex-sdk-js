import type { MarketData, TradingConfig } from '../contracts/trading/trading_types.js';
import type { PriceData } from '../trading/market/types.js';
import { reserveUtilization, sideCapacity, sideReserved } from '../trading/market/capacity.js';
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
 * Computes approximate borrowing utilization and APR for one side of the
 * market, at its current book. For display only.
 *
 * Only the dominant side (the one holding strictly more base tokens) is
 * actually charged the borrowing rate. A tie charges both sides. `charged`
 * reports whether this side is charged now, so a UI can show the rate a
 * side would pay without implying it is paying.
 *
 * @param vaultAssets Total vault assets, settlement-token decimals.
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
 * The market's current funding rate as an approximate annualized percent,
 * for display only.
 *
 * Positive means longs pay shorts. Negative means shorts pay longs. This is
 * the raw stored rate. It is not floored at `fundingMin`. The floor applies
 * only to the charged magnitude at accrual, so a small stored rate can
 * display below the minimum a position is actually charged. Use
 * {@link fundingChargeApr} for the charged rate.
 */
export function fundingApr(market: MarketData): number {
    return formatAnnualPercent(market.fundingRate);
}

/**
 * The funding rate a payer is actually charged, as an approximate unsigned
 * annualized percent. For display only.
 *
 * Applies the same floor as accrual: `max(|fundingRate|, fundingMin)`. Zero
 * when the rate is zero, because a zero rate charges nothing.
 */
export function fundingChargeApr(market: MarketData, config: TradingConfig): number {
    if (market.fundingRate === 0n) return 0;
    const magnitude =
        market.fundingRate < 0n ? -market.fundingRate : market.fundingRate;
    const charged = magnitude > config.fundingMin ? magnitude : config.fundingMin;
    return formatAnnualPercent(charged);
}

/** Max leverage the initial-margin requirement allows, as an approximate float (`1 / initMargin`). For display only. */
export function maxLeverage(config: TradingConfig): number {
    if (config.initMargin === 0n) return Infinity;
    return Number(SCALAR_18) / Number(config.initMargin);
}
