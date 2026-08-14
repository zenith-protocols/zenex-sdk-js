import { describe, expect, it } from 'vitest';
import { I128_MAX } from '../../src/math/fixed.js';
import { Status } from '../../src/contracts/trading/trading_types.js';
import type { TradingConfig } from '../../src/contracts/trading/trading_types.js';
import {
    quoteVaultOrderCreation,
    type VaultOrderCreationQuoteInput,
} from '../../src/trading/quote/vault.js';

const U64_MAX = 2n ** 64n - 1n;

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 2_000_000n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
        execFee: 25n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000n,
        maxUtilOpen: 10n ** 18n,
        maxUtilWithdraw: 10n ** 18n,
        initMargin: 10n ** 17n,
        maintenanceMargin: 5n * 10n ** 16n,
        liqFee: 0n,
        notionalLock: 0n,
        targetUtil: 8n * 10n ** 17n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: 5n * 10n ** 17n,
        adlClearTarget: 4n * 10n ** 17n,
        maxPnlTrader: 9n * 10n ** 17n,
        maxPnlWithdraw: 15n * 10n ** 16n,
        redeemLock: 60n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 100n,
        maxVaultBalance: 10_000_000n,
        ...overrides,
    };
}

function creation(
    overrides: Partial<VaultOrderCreationQuoteInput> = {},
): VaultOrderCreationQuoteInput {
    return {
        ledger: 12_345,
        now: 50_000n,
        status: Status.Active,
        config: config(),
        action: 'deposit',
        amount: 1_000n,
        minOut: 900n,
        ...overrides,
    };
}

describe('quoteVaultOrderCreation', () => {
    it('quotes the exact price-free deposit escrow and later fill boundary', () => {
        const result = quoteVaultOrderCreation(creation());

        expect(result).toEqual({
            kind: 'exact',
            ledger: 12_345,
            value: {
                kind: 'resting',
                policy: 'restOnly',
                action: 'deposit',
                amount: 1_000n,
                minOut: 900n,
                executionFee: 25n,
                createdAt: 50_000n,
                fillAfter: 50_001n,
                redeemUnlockAt: null,
                escrowedAssets: 1_025n,
                escrowedShares: 0n,
            },
        });
    });

    it('quotes redeem share escrow, fee escrow, and cooldown separately', () => {
        const result = quoteVaultOrderCreation(
            creation({
                action: 'redeem',
                amount: 400n,
                minOut: 350n,
            }),
        );

        expect(result).toEqual({
            kind: 'exact',
            ledger: 12_345,
            value: {
                kind: 'resting',
                policy: 'restOnly',
                action: 'redeem',
                amount: 400n,
                minOut: 350n,
                executionFee: 25n,
                createdAt: 50_000n,
                fillAfter: 50_001n,
                redeemUnlockAt: 50_060n,
                escrowedAssets: 25n,
                escrowedShares: 400n,
            },
        });
    });

    it('keeps retired direct redeem distinct from every resting route', () => {
        const result = quoteVaultOrderCreation(
            creation({
                status: Status.Retired,
                action: 'redeem',
                amount: 250n,
                minOut: 999_999n,
                vault: {
                    totalAssets: 1_000n,
                    totalSupply: 1_000n,
                    decimalsOffset: 0,
                },
            }),
        );

        expect(result).toEqual({
            kind: 'exact',
            ledger: 12_345,
            value: {
                kind: 'retiredImmediateRedeem',
                policy: 'direct',
                action: 'redeem',
                shares: 250n,
                assets: 250n,
                minOutApplied: false,
                executionFee: 0n,
            },
        });
    });

    it.each([
        [
            'frozen market',
            creation({ status: Status.Frozen }),
            'CONTRACT_GATE',
            '#704',
        ],
        [
            'retired deposit',
            creation({ status: Status.Retired }),
            'CONTRACT_GATE',
            '#702',
        ],
        [
            'deposit below its creation floor',
            creation({ amount: 99n }),
            'CONTRACT_GATE',
            '#732',
        ],
        [
            'zero deposit with a malformed zero floor',
            creation({
                amount: 0n,
                config: config({ minDeposit: 0n }),
            }),
            'CONTRACT_GATE',
            '#732',
        ],
        [
            'nonpositive redeem',
            creation({ action: 'redeem', amount: 0n }),
            'CONTRACT_GATE',
            '#732',
        ],
        [
            'nonpositive retired direct redeem',
            creation({
                status: Status.Retired,
                action: 'redeem',
                amount: 0n,
                vault: {
                    totalAssets: 1_000n,
                    totalSupply: 1_000n,
                    decimalsOffset: 0,
                },
            }),
            'CONTRACT_GATE',
            '#732',
        ],
        [
            'negative retired direct redeem without vault state',
            creation({
                status: Status.Retired,
                action: 'redeem',
                amount: -1n,
            }),
            'CONTRACT_GATE',
            '#732',
        ],
        [
            'negative minimum output',
            creation({ minOut: -1n }),
            'CONTRACT_GATE',
            '#710',
        ],
    ] as const)(
        'rejects %s at the contract creation boundary',
        (_label, input, code, reason) => {
            expect(quoteVaultOrderCreation(input)).toEqual({
                kind: 'unavailable',
                code,
                reason: expect.stringContaining(reason),
            });
        },
    );

    it('reports settlement escrow overflow without approximating', () => {
        expect(
            quoteVaultOrderCreation(
                creation({
                    amount: I128_MAX,
                    config: config({ execFee: 1n, minDeposit: 1n }),
                }),
            ),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_OVERFLOW',
        });
    });

    it('represents an impossible later fill ledger time explicitly', () => {
        const result = quoteVaultOrderCreation(creation({ now: U64_MAX }));

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact' || result.value.kind !== 'resting') return;
        expect(result.value.fillAfter).toBeNull();
    });

    it('requires exact vault state for a retired direct redeem', () => {
        expect(
            quoteVaultOrderCreation(
                creation({
                    status: Status.Retired,
                    action: 'redeem',
                }),
            ),
        ).toEqual({
            kind: 'unavailable',
            code: 'MISSING_STATE',
            reason: expect.stringContaining('vault state'),
        });
    });
});
