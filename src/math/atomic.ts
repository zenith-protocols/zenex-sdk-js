const MAX_DECIMAL_PLACES = 38;
const DECIMAL_TEXT = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function checkedDecimals(decimals: number): number {
    if (
        !Number.isSafeInteger(decimals) ||
        decimals < 0 ||
        decimals > MAX_DECIMAL_PLACES
    ) {
        throw new RangeError(
            `decimals must be an integer between 0 and ${MAX_DECIMAL_PLACES}`,
        );
    }
    return decimals;
}

/**
 * Parse exact base-10 text into atomic units without floating-point arithmetic.
 * The input is never rounded or truncated.
 */
export function parseAtomic(value: string, decimals: number): bigint {
    if (typeof value === 'number') {
        throw new TypeError('decimal value must be text, not a number');
    }
    if (typeof value !== 'string') {
        throw new TypeError('decimal value must be text');
    }
    const places = checkedDecimals(decimals);
    const match = DECIMAL_TEXT.exec(value);
    if (match === null) {
        throw new SyntaxError('decimal value is not canonical base-10 text');
    }

    const fraction = match[3] ?? '';
    if (fraction.length > places) {
        throw new RangeError(
            `decimal value exceeds the configured ${places} decimal places`,
        );
    }
    const scale = 10n ** BigInt(places);
    const whole = BigInt(match[2]) * scale;
    const fractional =
        fraction.length === 0 ? 0n : BigInt(fraction.padEnd(places, '0'));
    const magnitude = whole + fractional;
    return match[1] === '-' ? -magnitude : magnitude;
}

/** Format atomic units as canonical base-10 text with explicit decimals. */
export function formatAtomic(value: bigint, decimals: number): string {
    if (typeof value !== 'bigint') {
        throw new TypeError('atomic value must be a bigint');
    }
    const places = checkedDecimals(decimals);
    if (value === 0n) return '0';
    if (places === 0) return value.toString();

    const negative = value < 0n;
    const magnitude = negative ? -value : value;
    const padded = magnitude.toString().padStart(places + 1, '0');
    const whole = padded.slice(0, -places);
    const fraction = padded.slice(-places).replace(/0+$/, '');
    const sign = negative ? '-' : '';
    return fraction.length === 0
        ? `${sign}${whole}`
        : `${sign}${whole}.${fraction}`;
}
