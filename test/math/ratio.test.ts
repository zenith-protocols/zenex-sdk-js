import { describe, expect, it } from 'vitest';
import { normalizeExactRatio } from '../../src/math/ratio.js';

describe('normalizeExactRatio', () => {
    it('reduces an exact bigint ratio', () => {
        expect(
            normalizeExactRatio(
                { numerator: 50n, denominator: 10_000n },
                {
                    label: 'maximum slippage',
                    minimum: 0n,
                    allowOne: false,
                },
            ),
        ).toEqual({ numerator: 1n, denominator: 200n });
    });

    it('retains canonical zero', () => {
        expect(
            normalizeExactRatio(
                { numerator: 0n, denominator: 10_000n },
                {
                    label: 'maximum slippage',
                    minimum: 0n,
                    allowOne: false,
                },
            ),
        ).toEqual({ numerator: 0n, denominator: 1n });
    });

    it.each([
        [
            { numerator: -1n, denominator: 2n },
            'maximum slippage numerator must be nonnegative',
        ],
        [
            { numerator: 1n, denominator: 0n },
            'maximum slippage denominator must be positive',
        ],
        [
            { numerator: 1n, denominator: 1n },
            'maximum slippage must be less than one',
        ],
        [
            { numerator: 3n, denominator: 2n },
            'maximum slippage must be less than one',
        ],
    ])('rejects an invalid strict ratio %#', (ratio, reason) => {
        expect(() =>
            normalizeExactRatio(ratio, {
                label: 'maximum slippage',
                minimum: 0n,
                allowOne: false,
            }),
        ).toThrow(reason);
    });

    it('accepts the inclusive one boundary when requested', () => {
        expect(
            normalizeExactRatio(
                { numerator: 100n, denominator: 100n },
                {
                    label: 'vault maximum slippage',
                    minimum: 0n,
                    allowOne: true,
                },
            ),
        ).toEqual({ numerator: 1n, denominator: 1n });
    });

    it('requires a positive numerator for size fractions', () => {
        expect(() =>
            normalizeExactRatio(
                { numerator: 0n, denominator: 1n },
                {
                    label: 'position size fraction',
                    minimum: 1n,
                    allowOne: true,
                },
            ),
        ).toThrow('position size fraction numerator must be positive');
    });

    it.each([
        [null, 'maximum slippage ratio is required'],
        [{ numerator: 1, denominator: 2n }, 'i128 value must be a bigint'],
        [{ numerator: 1n, denominator: 2 }, 'i128 value must be a bigint'],
    ])('rejects a malformed ratio %#', (ratio, reason) => {
        expect(() =>
            normalizeExactRatio(ratio as never, {
                label: 'maximum slippage',
                minimum: 0n,
                allowOne: false,
            }),
        ).toThrow(reason);
    });
});
