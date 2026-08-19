import { describe, expect, it } from 'vitest';
import {
    I128_MAX,
    I128_MIN,
    addI128,
    checkedI128,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../../src/math/fixed.js';

describe('checked contract fixed-point primitives', () => {
    it('uses mathematical floor and ceil for every sign combination', () => {
        expect(mulDivFloor(-1n, 1n, 2n)).toBe(-1n);
        expect(mulDivCeil(-1n, 1n, 2n)).toBe(0n);
        expect(mulDivFloor(1n, 1n, -2n)).toBe(-1n);
        expect(mulDivCeil(1n, 1n, -2n)).toBe(0n);
        expect(mulDivFloor(-1n, 1n, -2n)).toBe(0n);
        expect(mulDivCeil(-1n, 1n, -2n)).toBe(1n);
    });

    it('rejects division by zero', () => {
        expect(() => mulDivFloor(1n, 1n, 0n)).toThrowError(new RangeError('division by zero'));
        expect(() => mulDivCeil(1n, 1n, 0n)).toThrowError(new RangeError('division by zero'));
    });

    it('accepts only i128 inputs and results', () => {
        expect(checkedI128(I128_MIN)).toBe(I128_MIN);
        expect(checkedI128(I128_MAX)).toBe(I128_MAX);
        expect(() => checkedI128(I128_MIN - 1n)).toThrow(RangeError);
        expect(() => checkedI128(I128_MAX + 1n)).toThrow(RangeError);
        expect(() => mulDivFloor(I128_MAX, 2n, 1n)).toThrow(RangeError);
        expect(() => mulDivCeil(I128_MAX + 1n, 1n, 1n)).toThrow(RangeError);
    });

    it('checks addition and subtraction at the i128 boundary', () => {
        expect(addI128(I128_MAX - 1n, 1n)).toBe(I128_MAX);
        expect(subI128(I128_MIN + 1n, 1n)).toBe(I128_MIN);
        expect(() => addI128(I128_MAX, 1n)).toThrow(RangeError);
        expect(() => subI128(I128_MIN, 1n)).toThrow(RangeError);
    });
});
