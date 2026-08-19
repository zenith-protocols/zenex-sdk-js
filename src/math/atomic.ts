const DECIMAL_TEXT = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/**
 * Parse canonical base-10 text into atomic units at `decimals` places, with
 * no rounding or floating-point step.
 * Accepts an optional leading `-`, a whole part with no leading zeros, and an
 * optional fractional part. Rejects a leading `+`, scientific notation, and a
 * `number` argument.
 * @param value Canonical decimal text, such as `"12.5"` or `"-0.001"`.
 * @param decimals The number of decimal places the atomic result uses.
 * @throws {TypeError} if value is a number instead of text.
 * @throws {SyntaxError} if value is not canonical base-10 text.
 * @throws {RangeError} if value has more fractional digits than `decimals`.
 */
export function parseAtomic(value: string, decimals: number): bigint {
    if (typeof value === 'number') {
        throw new TypeError('decimal value must be text, not a number');
    }
    const places = decimals;
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

/**
 * Format atomic units at `decimals` places as canonical base-10 text.
 * Trailing zeros in the fraction are dropped, and a whole value has no
 * decimal point.
 * @param value The atomic value to format.
 * @param decimals The number of decimal places `value` is scaled to.
 * @throws {TypeError} if value is not a bigint.
 */
export function formatAtomic(value: bigint, decimals: number): string {
    if (typeof value !== 'bigint') {
        throw new TypeError('atomic value must be a bigint');
    }
    const places = decimals;
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
