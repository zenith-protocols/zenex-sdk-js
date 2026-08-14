export const I128_MIN = -(2n ** 127n);
export const I128_MAX = 2n ** 127n - 1n;
export const SCALAR_18 = 1_000_000_000_000_000_000n;

/** Basis-point denominator: 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;

export function checkedI128(value: bigint): bigint {
    if (typeof value !== 'bigint') {
        throw new TypeError('i128 value must be a bigint');
    }
    if (value < I128_MIN || value > I128_MAX) {
        throw new RangeError('value is outside the i128 range');
    }
    return value;
}

export function addI128(left: bigint, right: bigint): bigint {
    return checkedI128(checkedI128(left) + checkedI128(right));
}

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

export function mulDivFloor(left: bigint, right: bigint, denominator: bigint): bigint {
    const numerator = checkedI128(left) * checkedI128(right);
    return checkedI128(divFloor(numerator, checkedI128(denominator)));
}

export function mulDivCeil(left: bigint, right: bigint, denominator: bigint): bigint {
    const numerator = checkedI128(left) * checkedI128(right);
    return checkedI128(divCeil(numerator, checkedI128(denominator)));
}

/** Validate a basis-point fraction in [0, 10_000] (10_000 = 100%). */
export function checkedBps(value: bigint): bigint {
    const bps = checkedI128(value);
    if (bps < 0n || bps > BPS_DENOMINATOR) {
        throw new RangeError('basis points must be between 0 and 10000');
    }
    return bps;
}
