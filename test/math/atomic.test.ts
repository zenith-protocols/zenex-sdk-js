import { describe, expect, it } from 'vitest';
import { formatAtomic, parseAtomic } from '../../src/math/atomic.js';

describe('exact decimal-text atomic conversion', () => {
    it.each([
        ['12.3456789', 7, 123_456_789n],
        ['-12.3456789', 7, -123_456_789n],
        ['0', 7, 0n],
        ['-0.0', 7, 0n],
        ['42', 0, 42n],
        ['0.0000001', 7, 1n],
        [`1.${'0'.repeat(37)}1`, 38, 10n ** 38n + 1n],
    ])('parses %s at %i decimals exactly', (text, decimals, expected) => {
        expect(parseAtomic(text, decimals)).toBe(expected);
    });

    it.each([
        [123_456_789n, 7, '12.3456789'],
        [-123_456_789n, 7, '-12.3456789'],
        [1n, 7, '0.0000001'],
        [120_000_000n, 7, '12'],
        [123_400_000n, 7, '12.34'],
        [0n, 38, '0'],
        [-0n, 7, '0'],
        [10n ** 38n + 1n, 38, `1.${'0'.repeat(37)}1`],
    ])('formats %s at %i decimals canonically', (value, decimals, expected) => {
        expect(formatAtomic(value, decimals)).toBe(expected);
    });

    it.each([
        '',
        ' ',
        ' 1',
        '1 ',
        '+1',
        '01',
        '-01',
        '.5',
        '1.',
        '1e3',
        'NaN',
        'Infinity',
        '--1',
        '1_000',
    ])('rejects invalid decimal text %j', (text) => {
        expect(() => parseAtomic(text, 7)).toThrow(SyntaxError);
    });

    it('rejects excess precision without rounding or truncating', () => {
        expect(() => parseAtomic('1.00000001', 7)).toThrow(RangeError);
        expect(() => parseAtomic('1.0', 0)).toThrow(RangeError);
        expect(() => parseAtomic('0.00000000', 7)).toThrow(RangeError);
    });

    it('rejects JavaScript number input at runtime', () => {
        expect(() => parseAtomic(1.1 as never, 7)).toThrowError(
            new TypeError('decimal value must be text, not a number'),
        );
        expect(() => formatAtomic(1 as never, 7)).toThrow(TypeError);
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'parseAtomic throws naturally for unusable decimal count %s',
        (decimals) => {
            // No explicit decimals validation remains; BigInt conversion and
            // exponent semantics reject these with platform RangeErrors.
            expect(() => parseAtomic('1.1', decimals)).toThrow(RangeError);
        },
    );
});
