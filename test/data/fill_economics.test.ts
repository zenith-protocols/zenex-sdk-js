import { describe, expect, it } from 'vitest';
import { I128_MAX, I128_MIN } from '../../src/math/fixed.js';
import { deriveAccountFillNetPnl } from '../../src/data/fill_economics.js';
import type { AccountFillNetPnlInput } from '../../src/data/fill_economics.js';

function completeFill(
    overrides: Partial<AccountFillNetPnlInput> = {},
): AccountFillNetPnlInput {
    return {
        economicsCompleteness: 'complete' as const,
        pnlAtomic: 50n,
        fees: {
            baseAtomic: 5n,
            impactAtomic: 2n,
            fundingAtomic: -3n,
            borrowingAtomic: 1n,
            liquidationAtomic: 0n,
            forfeitAtomic: 0n,
            keeperExecutionAtomic: 11n,
            relayAtomic: 13n,
        },
        ...overrides,
    };
}

describe('deriveAccountFillNetPnl', () => {
    it('matches the complete user-close lifecycle vector and treats pnlAtomic as gross', () => {
        expect(deriveAccountFillNetPnl(completeFill())).toEqual({
            kind: 'exact',
            grossPnlAtomic: 50n,
            netPnlAtomic: 21n,
        });
    });

    it('matches the full Rust receipt lifecycle vector across every exact debit', () => {
        const fill = completeFill({
            pnlAtomic: 1_000_000_000n,
            fees: {
                baseAtomic: 10_500_000n,
                impactAtomic: 2_000_000n,
                fundingAtomic: -3_000_000n,
                borrowingAtomic: 1_000_000n,
                liquidationAtomic: 0n,
                forfeitAtomic: 0n,
                keeperExecutionAtomic: 2_000_000n,
                relayAtomic: 0n,
            },
        });

        expect(deriveAccountFillNetPnl(fill)).toEqual({
            kind: 'exact',
            grossPnlAtomic: 1_000_000_000n,
            netPnlAtomic: 987_500_000n,
        });
    });

    it('subtracts signed funding so negative funding is a trader credit', () => {
        const fill = completeFill({
            pnlAtomic: 100n,
            fees: {
                baseAtomic: 0n,
                impactAtomic: 0n,
                fundingAtomic: -15n,
                borrowingAtomic: 0n,
                liquidationAtomic: 0n,
                forfeitAtomic: 0n,
                keeperExecutionAtomic: 2n,
                relayAtomic: 0n,
            },
        });

        expect(deriveAccountFillNetPnl(fill)).toMatchObject({
            kind: 'exact',
            netPnlAtomic: 113n,
        });
    });

    it('returns every missing component without manufacturing partial net PnL', () => {
        const fill = completeFill({
            economicsCompleteness: 'degraded' as const,
            pnlAtomic: null,
            fees: {
                ...completeFill().fees,
                impactAtomic: null,
                keeperExecutionAtomic: null,
            },
        });

        expect(deriveAccountFillNetPnl(fill)).toEqual({
            kind: 'unavailable',
            economicsCompleteness: 'degraded',
            missingComponents: ['grossPnl', 'impactFee', 'keeperExecutionFee'],
        });
    });

    it('stays unavailable when completeness is not complete even if all atomics exist', () => {
        expect(
            deriveAccountFillNetPnl(
                completeFill({ economicsCompleteness: 'backfilling' as const }),
            ),
        ).toEqual({
            kind: 'unavailable',
            economicsCompleteness: 'backfilling',
            missingComponents: [],
        });
    });

    it('stays unavailable when a complete-labelled response omits a component', () => {
        const fill = completeFill({
            fees: { ...completeFill().fees, relayAtomic: null },
        });

        expect(deriveAccountFillNetPnl(fill)).toEqual({
            kind: 'unavailable',
            economicsCompleteness: 'complete',
            missingComponents: ['relayFee'],
        });
    });

    it.each([
        ['baseAtomic', 'base fee'],
        ['borrowingAtomic', 'borrowing fee'],
        ['liquidationAtomic', 'liquidation fee'],
        ['forfeitAtomic', 'forfeit'],
        ['keeperExecutionAtomic', 'keeper execution fee'],
        ['relayAtomic', 'relay fee'],
    ] as const)('rejects a negative %s invariant', (field, label) => {
        const fill = completeFill({
            fees: { ...completeFill().fees, [field]: -1n },
        });

        expect(() => deriveAccountFillNetPnl(fill)).toThrow(
            `${label} must be nonnegative`,
        );
    });

    it('accepts both inclusive i128 result boundaries', () => {
        const zeroFees = {
            baseAtomic: 0n,
            impactAtomic: 0n,
            fundingAtomic: 0n,
            borrowingAtomic: 0n,
            liquidationAtomic: 0n,
            forfeitAtomic: 0n,
            keeperExecutionAtomic: 0n,
            relayAtomic: 0n,
        };

        expect(
            deriveAccountFillNetPnl(
                completeFill({ pnlAtomic: I128_MAX, fees: zeroFees }),
            ),
        ).toMatchObject({ kind: 'exact', netPnlAtomic: I128_MAX });
        expect(
            deriveAccountFillNetPnl(
                completeFill({ pnlAtomic: I128_MIN, fees: zeroFees }),
            ),
        ).toMatchObject({ kind: 'exact', netPnlAtomic: I128_MIN });
    });

    it('rejects i128 input and result overflow instead of returning an unbounded bigint', () => {
        expect(() =>
            deriveAccountFillNetPnl(completeFill({ pnlAtomic: I128_MAX + 1n })),
        ).toThrow('value is outside the i128 range');
        expect(() =>
            deriveAccountFillNetPnl(
                completeFill({
                    pnlAtomic: I128_MAX,
                    fees: {
                        baseAtomic: 0n,
                        impactAtomic: 0n,
                        fundingAtomic: -1n,
                        borrowingAtomic: 0n,
                        liquidationAtomic: 0n,
                        forfeitAtomic: 0n,
                        keeperExecutionAtomic: 0n,
                        relayAtomic: 0n,
                    },
                }),
            ),
        ).toThrow('value is outside the i128 range');
        expect(() =>
            deriveAccountFillNetPnl(
                completeFill({
                    pnlAtomic: I128_MIN,
                    fees: {
                        ...completeFill().fees,
                        baseAtomic: 1n,
                        impactAtomic: 0n,
                        fundingAtomic: 0n,
                        borrowingAtomic: 0n,
                        keeperExecutionAtomic: 0n,
                        relayAtomic: 0n,
                    },
                }),
            ),
        ).toThrow('value is outside the i128 range');
    });
});
