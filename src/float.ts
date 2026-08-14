/**
 * Convert a float to fixed-point at `decimals`. Token amounts are per-deployment
 * (pass the settlement token's decimals); SCALAR_18 quantities pass 18.
 *
 * @deprecated Unsafe for transaction inputs because JavaScript numbers can
 * round. Use `parseAtomic` with decimal text instead.
 */
export function toFixed(x: number, decimals: number): bigint {
    return BigInt(Math.round(x * 10 ** decimals));
}

/**
 * Convert a fixed-point value at `decimals` to a float, for display only.
 * Token amounts are per-deployment (pass the settlement token's decimals);
 * SCALAR_18 quantities pass 18.
 */
export function toFloat(x: bigint, decimals: number): number {
    return Number(x) / 10 ** decimals;
}
