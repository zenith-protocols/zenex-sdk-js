import { describe, expect, expectTypeOf, it } from 'vitest';
import {
    QuoteResult,
    decodeLedgerSequence,
    estimate,
    exact,
    unavailable,
} from '../../src/quote/result.js';

function describeResult(result: QuoteResult<bigint>): string {
    switch (result.kind) {
        case 'exact':
            return `${result.ledger}:${result.priceTime}:${result.value}`;
        case 'estimate':
            return `${result.assumptions.join(',')}:${result.value}`;
        case 'unavailable':
            return `${result.code}:${result.reason}`;
        default: {
            const exhaustive: never = result;
            return exhaustive;
        }
    }
}

describe('quote results and provenance', () => {
    it('preserves exact bigint source time above the safe integer boundary', () => {
        const priceTime = 9_007_199_254_740_993n;
        const result = exact(42n, 4_294_967_295, priceTime);

        expect(result).toEqual({ kind: 'exact', value: 42n, ledger: 4_294_967_295, priceTime });
        expect(describeResult(result)).toBe('4294967295:9007199254740993:42');
        expectTypeOf(result.priceTime).toEqualTypeOf<bigint>();
    });

    it('accepts a ledger only as a safe nonnegative u32 integer', () => {
        expect(decodeLedgerSequence(0)).toBe(0);
        expect(decodeLedgerSequence(4_294_967_295)).toBe(4_294_967_295);
        expect(() => decodeLedgerSequence(-1)).toThrow(RangeError);
        expect(() => decodeLedgerSequence(1.5)).toThrow(RangeError);
        expect(() => decodeLedgerSequence(4_294_967_296)).toThrow(RangeError);
        expect(() => decodeLedgerSequence(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
        expect(() => decodeLedgerSequence(1n)).toThrow(TypeError);
    });

    it('rejects invalid exact quote provenance', () => {
        expect(() => exact(1n, -1, 1n)).toThrow(RangeError);
        expect(() => exact(1n, 1, -1n)).toThrow(RangeError);
        expect(() => exact(1n, 1, 2n ** 64n)).toThrow(RangeError);
    });

    it('constructs estimate and unavailable variants without fake exact provenance', () => {
        const estimated = estimate(7n, ['market accrual not advanced']);
        const missing = unavailable<bigint>('MISSING_STATE', 'market state is absent');

        expect(estimated).toEqual({
            kind: 'estimate',
            value: 7n,
            assumptions: ['market accrual not advanced'],
        });
        expect(missing).toEqual({
            kind: 'unavailable',
            code: 'MISSING_STATE',
            reason: 'market state is absent',
        });
        expect(describeResult(estimated)).toBe('market accrual not advanced:7');
        expect(describeResult(missing)).toBe('MISSING_STATE:market state is absent');
    });
});
