import { describe, expect, it } from 'vitest';
import { formatTokenFloor } from '../../src/float.js';
import { formatAtomic, parseAtomic } from '../../src/math/atomic.js';

// A MAX button renders formatTokenFloor's float and parses it back with
// parseAtomic. The parsed amount must never exceed the true balance, or the
// order it builds escrows more than the wallet holds.

/** `x.toFixed(decimals)`, read back exactly; it too turns exponent from 1e21. */
function fixedValue(x: number, decimals: number): bigint | undefined {
    const text = x.toFixed(decimals);
    return text.includes('e') ? undefined : parseAtomic(text, decimals);
}

/** The shortest text JavaScript prints, read back exactly. */
function textValue(x: number, decimals: number): bigint | undefined {
    const text = String(x);
    return text.includes('e') ? undefined : parseAtomic(text, decimals);
}

describe('formatTokenFloor never exceeds the original', () => {
    it('floors the live mainnet share supply (13 share decimals)', () => {
        const supply = 101_250_511_114_930_157n;
        const shown = formatTokenFloor(supply, 13);
        expect(textValue(shown, 13)! <= supply).toBe(true);
        expect(fixedValue(shown, 13)! <= supply).toBe(true);
        // The plain double floor printed 10125.051111493016, three units over.
        expect(shown).toBe(10125.051111493014);
    });

    it('holds across magnitudes and decimals', () => {
        let seed = 0x2545f491;
        const next = () => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return BigInt(seed >>> 0);
        };
        for (let round = 0; round < 20_000; round++) {
            const decimals = Number(next() % 19n);
            const digits = Number(next() % 22n) + 1;
            let value = 0n;
            for (let i = 0; i < digits; i++) value = value * 10n + (next() % 10n);
            const shown = formatTokenFloor(value, decimals);
            const label = `${value} at ${decimals}`;
            const fixed = fixedValue(shown, decimals);
            if (fixed !== undefined) expect(fixed <= value, label).toBe(true);
            const parsed = textValue(shown, decimals);
            if (parsed !== undefined) expect(parsed <= value, label).toBe(true);
            // And it stays the nearest float a few steps below the value.
            const nearest = Number(formatAtomic(value, decimals));
            expect(Math.abs(nearest - shown) <= Math.abs(nearest) * 1e-14, label).toBe(true);
        }
    });

    it('keeps exact values exact', () => {
        expect(formatTokenFloor(123_456_789n, 7)).toBe(12.3456789);
        expect(formatTokenFloor(0n, 7)).toBe(0);
        expect(formatTokenFloor(-123_456_789n, 7)).toBe(-12.3456789);
    });

    it('returns a tiny value exactly, though String() prints it in exponent form', () => {
        const shown = formatTokenFloor(5n, 7);
        expect(shown).toBe(5e-7);
        expect(String(shown)).toBe('5e-7');
        expect(parseAtomic(shown.toFixed(7), 7)).toBe(5n);
    });

    it('rejects an unusable decimals count', () => {
        for (const decimals of [-1, 1.5, 39, Number.NaN]) {
            expect(() => formatTokenFloor(1n, decimals)).toThrow(RangeError);
        }
    });
});
