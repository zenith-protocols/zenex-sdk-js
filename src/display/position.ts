// =============================================================================
// Position display.
//
// Wraps the exact estimate mirrors in `src/trading/position/estimates.ts` and
// converts each value at its own scale. Approximate, display only — never feed
// these back into an order.
//
// Like the mirrors it wraps, this marks a RAW stored position at a single price
// without settling accruals into margin, and does not extrapolate the accrual
// indices past the market's last on-chain accrual. Between keeper touches it
// slightly overstates equity. For a checked result at a declared ledger, use
// `liquidationState` / `quotePositionAction` and format the bigints yourself.
// =============================================================================

import type {
    MarketData,
    Position,
    TradingConfig,
} from '../contracts/trading/trading_types.js';
import type { PriceData } from '../trading/market/types.js';
import { exitPrice } from '../trading/market/capacity.js';
import {
    liquidationPrice,
    pendingBorrowing,
    pendingFunding,
    positionEquity,
    positionPnl,
    unlockedNotional,
} from '../trading/position/estimates.js';
import { SCALAR_18 } from '../math/fixed.js';
import { formatPrice, formatToken } from './format.js';

export interface PositionDisplay {
    /** Open size, token units. */
    notional: number;
    /** Posted margin, token units. */
    margin: number;
    /** Mark-to-market PnL at the adverse close price, token units. */
    pnl: number;
    /** Margin + PnL - pending accruals, token units. */
    equity: number;
    /** Pending funding: positive is owed by the trader, negative is earned. */
    pendingFunding: number;
    /** Pending borrowing, token units (never negative). */
    pendingBorrowing: number;
    /** notional / equity, e.g. `3.5` for 3.5x. `0` on non-positive equity. */
    leverage: number;
    /** Average entry price, or `0` with no open size. */
    entryPrice: number;
    /** Price at which equity meets the maintenance margin. */
    liquidationPrice: number;
    /**
     * equity / maintenance requirement. Above `1` is healthy, below `1` is
     * liquidatable. `Infinity` with no requirement, `0` at zero equity.
     */
    healthFactor: number;
    /**
     * Signed move from the mark to the liquidation price, as a percent of the
     * mark. Positive means the liquidation price is still away from the mark in
     * the safe direction; negative means it has already been crossed.
     */
    liquidationDistancePercent: number;
    /** Notional not under the decrease lock at `now`, token units. */
    unlockedNotional: number;
}

/**
 * Format a stored position for display at `price`.
 *
 * `decimals` is the settlement token's decimals, from the deployment — token
 * amounts use it, while prices and the derived ratios do not.
 */
export function positionDisplay(
    position: Position,
    market: MarketData,
    config: TradingConfig,
    price: PriceData,
    isLong: boolean,
    decimals: number,
    now: bigint,
): PositionDisplay {
    const mark = exitPrice(price, isLong);
    const equityRaw = positionEquity(position, market, mark, SCALAR_18, isLong);
    const liqRaw = liquidationPrice(position, config, market, isLong);

    // Both round up as the contract does, so the displayed headroom never reads
    // safer than the chain's own check.
    const maintenanceRaw =
        (position.notional * config.maintenanceMargin + SCALAR_18 - 1n) / SCALAR_18;

    const entryRaw =
        position.tokens === 0n
            ? 0n
            : (position.notional * SCALAR_18) / position.tokens;

    const markFloat = formatPrice(mark);
    const liqFloat = formatPrice(liqRaw);
    // Signed toward safety: a long is safe while the mark sits above the
    // liquidation price, a short while it sits below.
    const distance =
        markFloat === 0
            ? 0
            : ((isLong ? markFloat - liqFloat : liqFloat - markFloat) / markFloat) * 100;

    return {
        notional: formatToken(position.notional, decimals),
        margin: formatToken(position.margin, decimals),
        pnl: formatToken(positionPnl(position, mark, SCALAR_18, isLong), decimals),
        equity: formatToken(equityRaw, decimals),
        pendingFunding: formatToken(pendingFunding(position, market, isLong), decimals),
        pendingBorrowing: formatToken(
            pendingBorrowing(position, market, isLong),
            decimals,
        ),
        leverage:
            equityRaw <= 0n ? 0 : Number(position.notional) / Number(equityRaw),
        entryPrice: formatPrice(entryRaw),
        liquidationPrice: liqFloat,
        healthFactor:
            maintenanceRaw === 0n
                ? Infinity
                : Number(equityRaw) / Number(maintenanceRaw),
        liquidationDistancePercent: distance,
        unlockedNotional: formatToken(unlockedNotional(position, now), decimals),
    };
}
