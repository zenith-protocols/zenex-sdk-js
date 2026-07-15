import { checkedI128 } from './fixed.js';

export interface ExactRatio {
    readonly numerator: bigint;
    readonly denominator: bigint;
}

export interface NormalizeExactRatioOptions {
    readonly label: string;
    readonly minimum: 0n | 1n;
    readonly allowOne: boolean;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
    let divisor = left;
    let remainder = right;
    while (remainder !== 0n) {
        const next = divisor % remainder;
        divisor = remainder;
        remainder = next;
    }
    return divisor;
}

/** @internal Validate and reduce a nonnegative exact rational value. */
export function normalizeExactRatio(
    input: ExactRatio,
    options: NormalizeExactRatioOptions,
): ExactRatio {
    if (!input || typeof input !== 'object') {
        throw new TypeError(`${options.label} ratio is required`);
    }
    const numerator = checkedI128(input.numerator);
    const denominator = checkedI128(input.denominator);
    if (denominator <= 0n) {
        throw new RangeError(`${options.label} denominator must be positive`);
    }
    if (numerator < options.minimum) {
        throw new RangeError(
            `${options.label} numerator must be ${
                options.minimum === 0n ? 'nonnegative' : 'positive'
            }`,
        );
    }
    if (
        numerator > denominator ||
        (!options.allowOne && numerator === denominator)
    ) {
        throw new RangeError(
            `${options.label} must be ${
                options.allowOne ? 'at most one' : 'less than one'
            }`,
        );
    }

    const divisor = greatestCommonDivisor(numerator, denominator);
    return {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
    };
}
