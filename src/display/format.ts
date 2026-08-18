import { SCALAR_18 } from '../math/fixed.js';

/** Seconds in a year, matching the contract's `SECONDS_PER_YEAR`. */
export const SECONDS_PER_YEAR = 31_536_000;

function checkDecimals(decimals: number): void {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
        throw new RangeError('decimals must be an integer in [0, 38]');
    }
}

/**
 * Converts an exact token amount to an approximate float, for display only.
 * Never feed the result back into a transaction: build one with the exact
 * bigint instead.
 *
 * @param decimals The settlement token's decimals for this deployment. Do
 * not hardcode `7`. A wrong value breaks silently on a deployment whose
 * token differs.
 */
export function formatToken(value: bigint, decimals: number): number {
    checkDecimals(decimals);
    return Number(value) / 10 ** decimals;
}

/**
 * Converts a `SCALAR_18` ratio to an approximate float fraction, for display
 * only. `SCALAR_18` becomes `1`.
 *
 * Use it for margin factors, utilization, and any other 18-dec fraction. For
 * a percentage, multiply by 100, or use {@link formatPercent}.
 */
export function formatRatio(value: bigint): number {
    return Number(value) / Number(SCALAR_18);
}

/**
 * Converts a `SCALAR_18` ratio to an approximate percentage, for display
 * only: `SCALAR_18 / 10n` becomes `10`.
 */
export function formatPercent(value: bigint): number {
    return formatRatio(value) * 100;
}

/**
 * Converts a price to an approximate float, for display only.
 *
 * Prices are always 18-dec, regardless of the settlement token's decimals.
 * Do not pass a settlement-token `decimals` value here.
 */
export function formatPrice(value: bigint): number {
    return Number(value) / Number(SCALAR_18);
}

/**
 * Converts a per-second `SCALAR_18` rate to an approximate annualized
 * percentage, for display only.
 *
 * Uses simple, non-compounding annualization to match how the contract's
 * indices accrue: `rate * SECONDS_PER_YEAR`. Signed: a negative funding rate
 * stays negative, meaning shorts pay.
 */
export function formatAnnualPercent(perSecondRate: bigint): number {
    return formatRatio(perSecondRate) * SECONDS_PER_YEAR * 100;
}
