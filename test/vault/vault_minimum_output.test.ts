import { describe, expect, it } from 'vitest';
import { I128_MAX } from '../../src/math/fixed.js';
import {
    deriveVaultMinimumOutput,
    type DeriveVaultMinimumOutputInput,
} from '../../src/vault/quote.js';

const assumptions = [
    'minimum output is derived from a caller-supplied estimated fill output',
    'vault order fill output can change before keeper execution',
];

function derive(
    overrides: Partial<DeriveVaultMinimumOutputInput> = {},
) {
    return deriveVaultMinimumOutput({
        reference: {
            kind: 'estimate',
            output: 20_000_000_000_000_003n,
        },
        maximumSlippage: { numerator: 5n, denominator: 1_000n },
        ...overrides,
    });
}

describe('deriveVaultMinimumOutput', () => {
    it('floors an exact bigint reference bound and retains estimate provenance', () => {
        expect(derive()).toEqual({
            kind: 'estimate',
            assumptions,
            value: {
                reference: {
                    kind: 'estimate',
                    output: 20_000_000_000_000_003n,
                },
                maximumSlippage: { numerator: 1n, denominator: 200n },
                rounding: 'floor',
                minOut: 19_900_000_000_000_002n,
            },
        });
    });

    it('keeps zero slippage exact and canonical', () => {
        expect(
            derive({
                reference: { kind: 'estimate', output: I128_MAX },
                maximumSlippage: { numerator: 0n, denominator: 10_000n },
            }),
        ).toEqual({
            kind: 'estimate',
            assumptions,
            value: {
                reference: { kind: 'estimate', output: I128_MAX },
                maximumSlippage: { numerator: 0n, denominator: 1n },
                rounding: 'floor',
                minOut: I128_MAX,
            },
        });
    });

    it('maps full slippage and a zero reference to zero atomics', () => {
        const full = derive({
            reference: { kind: 'estimate', output: 99n },
            maximumSlippage: { numerator: 25n, denominator: 25n },
        });
        const empty = derive({
            reference: { kind: 'estimate', output: 0n },
            maximumSlippage: { numerator: 1n, denominator: 3n },
        });

        expect(full).toMatchObject({
            kind: 'estimate',
            value: {
                maximumSlippage: { numerator: 1n, denominator: 1n },
                minOut: 0n,
            },
        });
        expect(empty).toMatchObject({
            kind: 'estimate',
            value: { minOut: 0n },
        });
    });

    it.each([
        [
            'an exact reference discriminator',
            {
                reference: { kind: 'exact', output: 100n },
            },
        ],
        [
            'a negative reference output',
            {
                reference: { kind: 'estimate', output: -1n },
            },
        ],
        [
            'a zero denominator',
            {
                maximumSlippage: { numerator: 0n, denominator: 0n },
            },
        ],
        [
            'a negative denominator',
            {
                maximumSlippage: { numerator: 0n, denominator: -1n },
            },
        ],
        [
            'a negative numerator',
            {
                maximumSlippage: { numerator: -1n, denominator: 10n },
            },
        ],
        [
            'a numerator above the denominator',
            {
                maximumSlippage: { numerator: 11n, denominator: 10n },
            },
        ],
        [
            'a numeric reference output',
            {
                reference: { kind: 'estimate', output: 100 },
            },
        ],
        [
            'a numeric rational component',
            {
                maximumSlippage: { numerator: 5, denominator: 100n },
            },
        ],
    ] as const)('rejects %s without inventing an estimate', (_label, input) => {
        expect(
            derive(
                input as unknown as Partial<DeriveVaultMinimumOutputInput>,
            ),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });

    it('reports atomics outside i128 as contract overflow', () => {
        expect(
            derive({
                reference: { kind: 'estimate', output: I128_MAX + 1n },
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_OVERFLOW',
        });
        expect(
            derive({
                maximumSlippage: {
                    numerator: 0n,
                    denominator: I128_MAX + 1n,
                },
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_OVERFLOW',
        });
    });
});
