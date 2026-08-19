import { describe, expect, it } from 'vitest';
import { I128_MAX } from '../../src/math/fixed.js';
import {
    deriveVaultMinimumOutput,
    type DeriveVaultMinimumOutputInput,
} from '../../src/trading/internal/vault.js';

const assumptions = [
    'minimum output is derived from a caller-supplied estimated fill output',
    'vault order fill output can change before keeper execution',
    'minimum output is rounded down in atomic units',
];

function derive(
    overrides: Partial<DeriveVaultMinimumOutputInput> = {},
) {
    return deriveVaultMinimumOutput({
        reference: {
            kind: 'estimate',
            output: 20_000_000_000_000_003n,
        },
        maximumSlippageBps: 50n,
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
                maximumSlippageBps: 50n,
                rounding: 'floor',
                minOut: 19_900_000_000_000_002n,
            },
        });
    });

    it('keeps zero slippage exact', () => {
        expect(
            derive({
                reference: { kind: 'estimate', output: I128_MAX },
                maximumSlippageBps: 0n,
            }),
        ).toEqual({
            kind: 'estimate',
            assumptions,
            value: {
                reference: { kind: 'estimate', output: I128_MAX },
                maximumSlippageBps: 0n,
                rounding: 'floor',
                minOut: I128_MAX,
            },
        });
    });

    it('maps full slippage and a zero reference to zero atomics', () => {
        const full = derive({
            reference: { kind: 'estimate', output: 99n },
            maximumSlippageBps: 10_000n,
        });
        const empty = derive({
            reference: { kind: 'estimate', output: 0n },
            maximumSlippageBps: 33n,
        });

        expect(full).toMatchObject({
            kind: 'estimate',
            value: {
                maximumSlippageBps: 10_000n,
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
            'negative basis points',
            {
                maximumSlippageBps: -1n,
            },
        ],
        [
            'basis points above 10000',
            {
                maximumSlippageBps: 10_001n,
            },
        ],
        [
            'a numeric reference output',
            {
                reference: { kind: 'estimate', output: 100 },
            },
        ],
        [
            'numeric basis points',
            {
                maximumSlippageBps: 5,
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
                maximumSlippageBps: I128_MAX + 1n,
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_OVERFLOW',
        });
    });
});
