/** The single v2 fixed-point scalar (18 decimals): rates, fees, ratios, margins, indices. */
export const SCALAR_18 = BigInt(1000000000000000000);

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

// Performs floor(x * y / z): true floor toward -inf for every sign, matching
// the contract's `fixed_mul_floor` / `fixed_div_floor`.
function mulDivFloor(x: bigint, y: bigint, z: bigint): bigint {
  const r = x * y;
  const quotient = r / z;
  const remainder = r % z;
  return remainder !== 0n && (r < 0n) !== (z < 0n) ? quotient - 1n : quotient;
}

// Performs ceil(x * y / z): true ceil toward +inf for every sign, matching
// the contract's `fixed_mul_ceil` / `fixed_div_ceil`.
function mulDivCeil(x: bigint, y: bigint, z: bigint): bigint {
  const r = x * y;
  const quotient = r / z;
  const remainder = r % z;
  return remainder !== 0n && (r < 0n) === (z < 0n) ? quotient + 1n : quotient;
}
