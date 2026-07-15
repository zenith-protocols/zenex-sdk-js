import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import {
    POSITION_DECREASE_MAX_VALIDITY_LEDGERS,
    quotePositionDecreaseIntent,
    type QuotePositionDecreaseIntentInput,
} from '../../src/position/decrease.js';
import type { TradingSnapshot } from '../../src/trading/trading_snapshot.js';
import {
    Status,
    type MarketData,
    type Position,
    type SidePair,
    type TradingConfig,
} from '../../src/trading/trading_types.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 1));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 2));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 3));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 10_000_000n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        execFee: 2n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000n,
        maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18,
        initMargin: SCALAR_18 / 10n,
        maintenanceMargin: SCALAR_18 / 20n,
        liqFee: 0n,
        notionalLock: 0n,
        targetUtil: (SCALAR_18 * 8n) / 10n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: SCALAR_18 / 2n,
        adlClearTarget: (SCALAR_18 * 4n) / 10n,
        maxPnlTrader: (SCALAR_18 * 9n) / 10n,
        maxPnlWithdraw: (SCALAR_18 * 15n) / 100n,
        redeemLock: 0n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 1n,
        maxVaultBalance: 10_000_000n,
        ...overrides,
    };
}

function position(overrides: Partial<Position> = {}): Position {
    return {
        collateral: 503n,
        notional: 1_001n,
        tokens: 100_100_000_000_000_000n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        pricedAt: 19_990n,
        decreaseOrders: [],
        ...overrides,
    };
}

function market(open: Position, isLong: boolean): MarketData {
    return {
        notional: isLong ? pair(open.notional, 0n) : pair(0n, open.notional),
        collateral: isLong
            ? pair(open.collateral, 0n)
            : pair(0n, open.collateral),
        tokens: isLong ? pair(open.tokens, 0n) : pair(0n, open.tokens),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        fundingUpdate: 20_000n,
        borrowingUpdate: 20_000n,
        fundingPool: 0n,
        fundingOwed: 0n,
        lastPriceTime: 19_999n,
    };
}

function snapshot(
    overrides: Partial<TradingSnapshot> = {},
    isLong = true,
): TradingSnapshot {
    const open = overrides.position ?? position();
    return {
        ledger: 10_000,
        ledgerTime: 20_000n,
        deployment: {
            trading: TRADING,
            router: ROUTER,
            vault: VAULT,
            priceVerifier: VERIFIER,
            treasury: TREASURY,
            feedId: 7,
            exponent: -4,
            vaultDecimalsOffset: 11,
            vaultShareDecimals: 18,
        },
        status: Status.Active,
        retirement: undefined,
        config: config(),
        market: market(open, isLong),
        position: open,
        price: {
            feedId: 7,
            exponent: -4,
            bid: 9_901n,
            ask: 10_099n,
            publishTime: 19_999n,
            source: 'pyth',
        },
        priceUpdate: new Uint8Array([1, 2, 3]),
        vault: {
            totalAssets: 1_000_000n,
            totalSupply: 1_000_000n,
            decimalsOffset: 11,
        },
        treasuryRate: 0n,
        ...overrides,
    };
}

function directInput(
    overrides: Partial<QuotePositionDecreaseIntentInput> = {},
): QuotePositionDecreaseIntentInput {
    return {
        snapshot: snapshot(),
        isLong: true,
        size: {
            kind: 'fraction',
            ratio: { numerator: 1n, denominator: 3n },
        },
        collateralReturn: { kind: 'proRata' },
        execution: { transport: 'direct', executionFee: 2n },
        maximumSlippage: { numerator: 1n, denominator: 100n },
        validForLedgers: 60,
        ...overrides,
    } as QuotePositionDecreaseIntentInput;
}

describe('quotePositionDecreaseIntent', () => {
    it('resolves fraction and pro-rata collateral from atomic notional', () => {
        const result = quotePositionDecreaseIntent(directInput());

        expect(result).toMatchObject({
            kind: 'exact',
            ledger: 10_000,
            priceTime: 19_999n,
            value: {
                action: {
                    kind: 'decrease',
                    notional: 333n,
                    collateral: 167n,
                },
                resolvedNotional: 333n,
                resolvedCollateralReturn: 167n,
                expiration: 10_060,
            },
        });
    });

    it('accepts an explicit zero collateral return for a partial decrease', () => {
        const result = quotePositionDecreaseIntent(
            directInput({
                size: { kind: 'notional', notional: 100n },
                collateralReturn: { kind: 'explicit', amount: 0n },
            }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                action: {
                    kind: 'decrease',
                    notional: 100n,
                    collateral: 0n,
                },
                resolvedCollateralReturn: 0n,
            },
        });
    });

    it('rejects explicit collateral above the snapshot position', () => {
        expect(
            quotePositionDecreaseIntent(
                directInput({
                    collateralReturn: {
                        kind: 'explicit',
                        amount: 504n,
                    },
                }),
            ),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'collateral return exceeds position collateral',
        });
    });

    it('rejects collateral intent on a full close instead of ignoring it', () => {
        const input = {
            ...directInput(),
            size: { kind: 'full' as const },
            collateralReturn: { kind: 'explicit' as const, amount: 0n },
        } as unknown as QuotePositionDecreaseIntentInput;

        expect(quotePositionDecreaseIntent(input)).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'full position decrease does not accept collateralReturn',
        });
    });

    it('requires collateral intent on every partial size form', () => {
        const input = { ...directInput() } as Record<string, unknown>;
        delete input.collateralReturn;

        expect(
            quotePositionDecreaseIntent(
                input as unknown as QuotePositionDecreaseIntentInput,
            ),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'partial position decrease requires collateralReturn',
        });
    });

    it.each([
        [
            'an explicit whole notional',
            { kind: 'notional' as const, notional: 1_001n },
        ],
        [
            'a whole fraction',
            {
                kind: 'fraction' as const,
                ratio: { numerator: 10n, denominator: 10n },
            },
        ],
    ])('canonicalizes %s to the close action', (_label, size) => {
        const result = quotePositionDecreaseIntent(
            directInput({ size, collateralReturn: { kind: 'proRata' } }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                action: { kind: 'close' },
                resolvedNotional: 1_001n,
                resolvedCollateralReturn: null,
                outcome: { action: { kind: 'close' } },
            },
        });
    });

    it('normalizes request ratios and preserves exact quote provenance', () => {
        const result = quotePositionDecreaseIntent(
            directInput({
                size: {
                    kind: 'fraction',
                    ratio: { numerator: 20n, denominator: 100n },
                },
                maximumSlippage: {
                    numerator: 50n,
                    denominator: 10_000n,
                },
            }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            ledger: 10_000,
            priceTime: 19_999n,
            value: {
                identity: {
                    trading: TRADING,
                    router: ROUTER,
                    isLong: true,
                },
                intent: {
                    size: {
                        kind: 'fraction',
                        ratio: { numerator: 1n, denominator: 5n },
                    },
                    maximumSlippage: {
                        numerator: 1n,
                        denominator: 200n,
                    },
                    validForLedgers: 60,
                },
            },
        });
    });

    it('rounds a long lower price bound up conservatively', () => {
        const result = quotePositionDecreaseIntent(directInput());

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                priceBound: 9_802n,
                outcome: { executionPrice: 9_901n },
            },
        });
    });

    it('rounds a short upper price bound down conservatively', () => {
        const shortSnapshot = snapshot({}, false);
        const result = quotePositionDecreaseIntent(
            directInput({ snapshot: shortSnapshot, isLong: false }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                identity: { isLong: false },
                priceBound: 10_199n,
                outcome: { executionPrice: 10_099n },
            },
        });
    });

    it('uses the exact execution price for zero slippage', () => {
        const result = quotePositionDecreaseIntent(
            directInput({
                maximumSlippage: { numerator: 0n, denominator: 10_000n },
            }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                intent: {
                    maximumSlippage: { numerator: 0n, denominator: 1n },
                },
                priceBound: 9_901n,
            },
        });
    });

    it('exports the fixed 60-ledger validity ceiling', () => {
        expect(POSITION_DECREASE_MAX_VALIDITY_LEDGERS).toBe(60);
    });

    it.each([0, 61, 1.5, Number.NaN])(
        'rejects invalid validity delta %s',
        (validForLedgers) => {
            expect(
                quotePositionDecreaseIntent(directInput({ validForLedgers })),
            ).toMatchObject({
                kind: 'unavailable',
                code: 'INVALID_INPUT',
            });
        },
    );

    it('rejects expiration beyond the u32 ledger ceiling', () => {
        expect(
            quotePositionDecreaseIntent(
                directInput({
                    snapshot: snapshot({ ledger: 4_294_967_295 }),
                    validForLedgers: 1,
                }),
            ),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'position decrease expiration exceeds the u32 ceiling',
        });
    });

    it.each([Status.Frozen, Status.Retired])(
        'rejects market status %s at the order-creation boundary',
        (status) => {
            expect(
                quotePositionDecreaseIntent(
                    directInput({ snapshot: snapshot({ status }) }),
                ),
            ).toMatchObject({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
            });
        },
    );

    it.each([
        [
            'trading identity',
            snapshot({
                deployment: {
                    ...snapshot().deployment,
                    trading: 'not-a-contract',
                },
            }),
        ],
        [
            'Router identity',
            snapshot({
                deployment: {
                    ...snapshot().deployment,
                    router: 'not-a-contract',
                },
            }),
        ],
        [
            'price feed identity',
            snapshot({
                price: { ...snapshot().price, feedId: 8 },
            }),
        ],
        [
            'price exponent identity',
            snapshot({
                price: { ...snapshot().price, exponent: -5 },
            }),
        ],
        [
            'future price time',
            snapshot({
                price: { ...snapshot().price, publishTime: 20_001n },
            }),
        ],
        ['price update bytes', snapshot({ priceUpdate: 'not-bytes' as never })],
    ])('fails closed on malformed snapshot %s', (_label, malformed) => {
        expect(
            quotePositionDecreaseIntent(directInput({ snapshot: malformed })),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });

    it('fails closed on an unknown snapshot status', () => {
        expect(
            quotePositionDecreaseIntent(
                directInput({
                    snapshot: snapshot({ status: 99 as Status }),
                }),
            ),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'snapshot market status is unknown',
        });
    });

    it('delegates surviving-position validity to quotePositionAction', () => {
        expect(
            quotePositionDecreaseIntent(
                directInput({
                    size: { kind: 'notional', notional: 100n },
                    collateralReturn: {
                        kind: 'explicit',
                        amount: 450n,
                    },
                }),
            ),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('contract error #713'),
        });
    });
});
