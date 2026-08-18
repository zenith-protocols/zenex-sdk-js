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
