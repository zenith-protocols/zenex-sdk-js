import { SCALAR_18 } from './math/fixed.js';
import { formatAtomic } from './math/atomic.js';

/**
 * Convert a float to a fixed-point bigint at `decimals` places.
 * Pass the settlement token's decimals for a token amount, or 18 for a
 * SCALAR_18 quantity. Rounds to the nearest atomic unit.
 * @param x The float value to convert.
 * @param decimals The number of decimal places the result is scaled to.
 * @deprecated A JavaScript number cannot represent every decimal exactly, so
 * this can round. Never use it for a value that goes into a transaction. Use
 * `parseAtomic` with decimal text instead.
 */
export function toFixed(x: number, decimals: number): bigint {
    return BigInt(Math.round(x * 10 ** decimals));
}

/**
 * Convert a fixed-point bigint at `decimals` places to a float, for display
 * only.
 * Pass the settlement token's decimals for a token amount, or 18 for a
 * SCALAR_18 quantity. A `number` cannot hold every atomic value exactly, so
 * never use the result for a value that goes into a transaction.
 * @param x The atomic value to convert.
 * @param decimals The number of decimal places `x` is scaled to.
 */
export function toFloat(x: bigint, decimals: number): number {
    return Number(x) / 10 ** decimals;
}

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
 * Converts a per-second `SCALAR_18` rate to a per-hour percentage, the one
 * unit rates are quoted in across the estimate tier. Signed; simple,
 * non-compounding, matching how the contract's indices accrue.
 */
export function formatHourlyPercent(perSecondRate: bigint): number {
    return formatRatio(perSecondRate) * 3600 * 100;
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

/**
 * Converts an exact token amount to the largest float whose text never
 * exceeds it, for MAX-button values. Both `String(x)` and
 * `x.toFixed(decimals)` read at most `value`, so either parses back through
 * `parseAtomic` at `decimals` without exceeding the original. Below 1e-6,
 * or at 1e21 and above, `String(x)` prints exponent notation, which
 * `parseAtomic` rejects: use `toFixed`, or render the bigint with
 * `formatAtomic`.
 *
 * @throws {RangeError} if `decimals` is not an integer in `[0, 38]`.
 */
export function formatTokenFloor(value: bigint, decimals: number): number {
    checkDecimals(decimals);
    // The nearest float can print as a decimal just above `value` once the
    // amount needs more digits than a float holds; step down until neither
    // text form exceeds it.
    let result = Number(formatAtomic(value, decimals));
    while (
        textExceeds(String(result), value, decimals) ||
        textExceeds(result.toFixed(decimals), value, decimals)
    ) {
        result = nextDown(result);
    }
    return result;
}

const BIT_VIEW = new DataView(new ArrayBuffer(8));

/** The float immediately below `x`, toward negative infinity. */
function nextDown(x: number): number {
    if (x === 0) return -Number.MIN_VALUE;
    BIT_VIEW.setFloat64(0, x);
    const bits = BIT_VIEW.getBigUint64(0);
    BIT_VIEW.setBigUint64(0, x > 0 ? bits - 1n : bits + 1n);
    return BIT_VIEW.getFloat64(0);
}

const NUMBER_TEXT = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

/**
 * Whether the number text reads above `value / 10^decimals`, or, in plain
 * notation, carries more fraction digits than `decimals` allows.
 */
function textExceeds(text: string, value: bigint, decimals: number): boolean {
    const match = NUMBER_TEXT.exec(text);
    if (match === null) return true;
    const fraction = match[3] ?? '';
    if (match[4] === undefined && fraction.length > decimals) return true;
    const magnitude = BigInt(match[2] + fraction);
    const digits = match[1] === '-' ? -magnitude : magnitude;
    const shift =
        BigInt(match[4] ?? 0) - BigInt(fraction.length) + BigInt(decimals);
    return shift >= 0n
        ? digits * 10n ** shift > value
        : digits > value * 10n ** -shift;
}
