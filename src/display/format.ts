// =============================================================================
// Decimals-aware conversions for display.
//
// Every number produced here is a float and is therefore APPROXIMATE. Nothing
// in this directory may be fed back into a transaction: quote with the exact
// bigint surfaces (`quotePositionAction`, `quoteTradeFees`, `applyOrder`) and
// parse user input with `parseAtomic`, which never rounds.
//
// This module lives outside `src/math/` and `src/trading/` on purpose. The
// architecture linter (`npm run architecture:check`) forbids floats inside
// those directories, so the quote and apply paths stay provably exact while
// display work happens here.
//
// The value this adds over a bare `Number(x) / 1e7` is the scale itself. The
// SDK returns three different scales and confusing them is silent and wrong:
//
//   - token amounts  -> the settlement token's decimals, PER DEPLOYMENT
//   - ratios/rates   -> SCALAR_18
//   - prices         -> fixed 18-dec (never the token's decimals)
//
// Take `decimals` from the deployment's settlement token. Do not hardcode it.
// =============================================================================

import { SCALAR_18 } from '../math/fixed.js';

/** Seconds in a year, matching the contract's `SECONDS_PER_YEAR`. */
export const SECONDS_PER_YEAR = 31_536_000;

function checkDecimals(decimals: number): void {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
        throw new RangeError('decimals must be an integer in [0, 38]');
    }
}

/**
 * A token amount at the settlement token's `decimals`, as a float.
 *
 * Pass the deployment's token decimals — this is the value most often
 * hardcoded to `7` by mistake, which breaks silently on any deployment whose
 * settlement token differs.
 */
export function formatToken(value: bigint, decimals: number): number {
    checkDecimals(decimals);
    return Number(value) / 10 ** decimals;
}

/**
 * A `SCALAR_18` ratio as a float fraction: `SCALAR_18` becomes `1`.
 *
 * Use for margin factors, utilization, and any other 18-dec fraction. For a
 * percentage multiply by 100, or use {@link formatPercent}.
 */
export function formatRatio(value: bigint): number {
    return Number(value) / Number(SCALAR_18);
}

/** A `SCALAR_18` ratio as a percentage: `SCALAR_18 / 10n` becomes `10`. */
export function formatPercent(value: bigint): number {
    return formatRatio(value) * 100;
}

/**
 * A price as a float. Prices are fixed 18-dec regardless of the settlement
 * token's decimals — that asymmetry is why this is its own function.
 */
export function formatPrice(value: bigint): number {
    return Number(value) / Number(SCALAR_18);
}

/**
 * A per-second `SCALAR_18` rate as an annualized percentage.
 *
 * Simple (non-compounding) annualization, matching how the contract's indices
 * accrue: `rate * SECONDS_PER_YEAR`. Signed — a negative funding rate stays
 * negative, meaning shorts pay.
 */
export function formatAnnualPercent(perSecondRate: bigint): number {
    return formatRatio(perSecondRate) * SECONDS_PER_YEAR * 100;
}
