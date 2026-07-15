import { mulDivCeil, mulDivFloor } from './math/fixed.js';

export * from './math/fixed.js';

/**
 * Convert a float to fixed-point at `decimals`. Token amounts are per-deployment
 * (pass the settlement token's decimals); SCALAR_18 quantities pass 18.
 */
export function toFixed(x: number, decimals: number): bigint {
    return BigInt(Math.round(x * 10 ** decimals));
}

/**
 * Convert a fixed-point value at `decimals` to a float. Token amounts are
 * per-deployment (pass the settlement token's decimals); SCALAR_18 quantities
 * pass 18.
 */
export function toFloat(x: bigint, decimals: number): number {
    return Number(x) / 10 ** decimals;
}

export function mulFloor(x: bigint, y: bigint, denominator: bigint): bigint {
    return mulDivFloor(x, y, denominator);
}

export function mulCeil(x: bigint, y: bigint, denominator: bigint): bigint {
    return mulDivCeil(x, y, denominator);
}

export function divFloor(x: bigint, y: bigint, denominator: bigint): bigint {
    return mulDivFloor(x, denominator, y);
}

export function divCeil(x: bigint, y: bigint, denominator: bigint): bigint {
    return mulDivCeil(x, denominator, y);
}
