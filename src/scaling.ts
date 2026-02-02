import { i128 } from './types/primitives.js';

/**
 * Descale a bigint value to a JavaScript number
 * @param value - The scaled bigint value
 * @param decimals - Number of decimal places (default: 7)
 * @returns The descaled number
 */
export function descale(value: i128, decimals: number = 7): number {
    const scalar = Math.pow(10, decimals);
    return Number(value) / scalar;
}

/**
 * Scale a JavaScript number to a bigint
 * @param value - The JavaScript number
 * @param decimals - Number of decimal places (default: 7)
 * @returns The scaled bigint
 */
export function scale(value: number, decimals: number = 7): i128 {
    const scalar = Math.pow(10, decimals);
    return BigInt(Math.round(value * scalar));
}

// ============================================================================
// Fixed-Point Arithmetic Helpers
// ============================================================================
// These functions match the Sentinel/Contract fixed-point math for consistent
// liquidation price calculations. They use BigInt internally for precision.

export const SCALAR_7 = 10_000_000n;
export const SCALAR_14 = 100_000_000_000_000n;
export const SCALAR_18 = 1_000_000_000_000_000_000n;

/**
 * Floor division that handles negative numbers correctly.
 * floor(-7 / 3) = -3 (not -2 as with truncating division)
 */
function divFloor(r: bigint, z: bigint): bigint {
    const quotient = r / z;
    const remainder = r % z;

    // If remainder is non-zero and signs differ, subtract 1 from quotient
    if (remainder !== 0n && (r < 0n) !== (z < 0n)) {
        return quotient - 1n;
    }
    return quotient;
}

/**
 * Ceiling division that handles negative numbers correctly.
 * ceil(7 / 3) = 3 (not 2 as with truncating division)
 */
function divCeil(r: bigint, z: bigint): bigint {
    const quotient = r / z;
    const remainder = r % z;

    // If remainder is non-zero and signs are the same, add 1 to quotient
    if (remainder !== 0n && (r < 0n) === (z < 0n)) {
        return quotient + 1n;
    }
    return quotient;
}

/**
 * Calculate floor(x * y / denominator)
 * Matches Sentinel's fixed_mul_floor for contract-compatible calculations.
 *
 * @param x - First operand (scaled value)
 * @param y - Second operand (scaled value)
 * @param denominator - The scalar to divide by
 * @returns floor(x * y / denominator)
 */
export function fixedMulFloor(x: bigint, y: bigint, denominator: bigint): bigint {
    if (denominator === 0n) {
        throw new Error('Division by zero in fixedMulFloor');
    }
    const r = x * y;
    return divFloor(r, denominator);
}

/**
 * Calculate ceil(x * y / denominator)
 * Matches Sentinel's fixed_mul_ceil for contract-compatible calculations.
 * Used for fee calculations (rounds up to avoid undercharging).
 *
 * @param x - First operand (scaled value)
 * @param y - Second operand (scaled value)
 * @param denominator - The scalar to divide by
 * @returns ceil(x * y / denominator)
 */
export function fixedMulCeil(x: bigint, y: bigint, denominator: bigint): bigint {
    if (denominator === 0n) {
        throw new Error('Division by zero in fixedMulCeil');
    }
    const r = x * y;
    return divCeil(r, denominator);
}

/**
 * Calculate floor(x * denominator / y)
 * Matches Sentinel's fixed_div_floor for contract-compatible calculations.
 *
 * @param x - Numerator (scaled value)
 * @param y - Denominator (the value to divide by)
 * @param denominator - The scalar to multiply by before dividing
 * @returns floor(x * denominator / y)
 */
export function fixedDivFloor(x: bigint, y: bigint, denominator: bigint): bigint {
    if (y === 0n) {
        throw new Error('Division by zero in fixedDivFloor');
    }
    const r = x * denominator;
    return divFloor(r, y);
}

/**
 * Calculate ceil(x * denominator / y)
 * Matches Sentinel's fixed_div_ceil for contract-compatible calculations.
 * Used for fee calculations (rounds up).
 *
 * @param x - Numerator (scaled value)
 * @param y - Denominator (the value to divide by)
 * @param denominator - The scalar to multiply by before dividing
 * @returns ceil(x * denominator / y)
 */
export function fixedDivCeil(x: bigint, y: bigint, denominator: bigint): bigint {
    if (y === 0n) {
        throw new Error('Division by zero in fixedDivCeil');
    }
    const r = x * denominator;
    return divCeil(r, y);
}
