/** Lowest value a Soroban i128 can hold. */
export const I128_MIN = -(2n ** 127n);
/** Highest value a Soroban i128 can hold. */
export const I128_MAX = 2n ** 127n - 1n;
/** Fixed-point scale for 18-decimal values, where `SCALAR_18` equals 1.0. */
export const SCALAR_18 = 1_000_000_000_000_000_000n;

/** Basis-point denominator: 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;

/**
 * Check that a value is a bigint within the i128 range.
 * @param value The value to check.
 * @throws {TypeError} if value is not a bigint.
 * @throws {RangeError} if value is outside the i128 range.
 */
export function checkedI128(value: bigint): bigint {
    if (typeof value !== 'bigint') {
        throw new TypeError('i128 value must be a bigint');
    }
    if (value < I128_MIN || value > I128_MAX) {
        throw new RangeError('value is outside the i128 range');
    }
    return value;
}

/**
 * Add two i128 values.
 * @param left A value in the i128 range.
 * @param right A value in the i128 range.
 * @throws {TypeError} if left or right is not a bigint.
 * @throws {RangeError} if left, right, or the sum is outside the i128 range.
 */
export function addI128(left: bigint, right: bigint): bigint {
    return checkedI128(checkedI128(left) + checkedI128(right));
}

/**
 * Subtract `right` from `left` as i128 values.
 * @param left A value in the i128 range.
 * @param right A value in the i128 range.
 * @throws {TypeError} if left or right is not a bigint.
 * @throws {RangeError} if left, right, or the difference is outside the i128 range.
 */
export function subI128(left: bigint, right: bigint): bigint {
    return checkedI128(checkedI128(left) - checkedI128(right));
}

function divFloor(numerator: bigint, denominator: bigint): bigint {
    if (denominator === 0n) throw new RangeError('division by zero');
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return remainder !== 0n && ((remainder < 0n) !== (denominator < 0n))
        ? quotient - 1n
        : quotient;
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
    if (denominator === 0n) throw new RangeError('division by zero');
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return remainder !== 0n && ((remainder < 0n) === (denominator < 0n))
        ? quotient + 1n
        : quotient;
}

/**
 * Multiply `left` by `right`, then divide by `denominator`. Rounds the exact
 * result down toward negative infinity.
 * Pass `denominator` as `SCALAR_18` to descale after multiplying two
 * 18-decimal values.
 * @param left A value in the i128 range.
 * @param right A value in the i128 range.
 * @param denominator The divisor. Must not be zero.
 * @throws {RangeError} if denominator is zero, or if left, right, or the result is outside the i128 range.
 */
export function mulDivFloor(left: bigint, right: bigint, denominator: bigint): bigint {
    const numerator = checkedI128(left) * checkedI128(right);
    return checkedI128(divFloor(numerator, checkedI128(denominator)));
}

/**
 * Multiply `left` by `right`, then divide by `denominator`. Rounds the exact
 * result up toward positive infinity.
 * Pass `denominator` as `SCALAR_18` to descale after multiplying two
 * 18-decimal values.
 * @param left A value in the i128 range.
 * @param right A value in the i128 range.
 * @param denominator The divisor. Must not be zero.
 * @throws {RangeError} if denominator is zero, or if left, right, or the result is outside the i128 range.
 */
export function mulDivCeil(left: bigint, right: bigint, denominator: bigint): bigint {
    const numerator = checkedI128(left) * checkedI128(right);
    return checkedI128(divCeil(numerator, checkedI128(denominator)));
}

/**
 * Check that value is a basis-point fraction in the range 0 to 10_000 (100%).
 * @param value A value in the i128 range, expressed in basis points.
 * @throws {TypeError} if value is not a bigint.
 * @throws {RangeError} if value is outside 0 to 10_000.
 */
export function checkedBps(value: bigint): bigint {
    const bps = checkedI128(value);
    if (bps < 0n || bps > BPS_DENOMINATOR) {
        throw new RangeError('basis points must be between 0 and 10000');
    }
    return bps;
}
