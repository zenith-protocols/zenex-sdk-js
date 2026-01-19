import { i128, SCALAR_7 } from '../types/primitives.js';

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

/**
 * Descale using SCALAR_7 constant
 */
export function descale7(value: bigint): number {
    return Number(value) / Number(SCALAR_7);
}

/**
 * Scale using SCALAR_7 constant
 */
export function scale7(value: number): bigint {
    return BigInt(Math.round(value * Number(SCALAR_7)));
}
