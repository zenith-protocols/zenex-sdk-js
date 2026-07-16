import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import type { ExactRelayFeeToken } from '../../src/order/transactions.js';
import {
    POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
    quoteMaximumPositionIncreaseIntent,
    quotePositionIncreaseIntent,
} from '../../src/position/increase.js';
import type {
    SubjectBoundTradingSnapshot,
    TradingSnapshot,
} from '../../src/trading/trading_snapshot.js';
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
const COLLATERAL = StrKey.encodeContract(Buffer.alloc(32, 6));
const OTHER_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 7));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 100n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 10_000_000n,
        minOrderNotional: 10n,
        minOrderCollateral: 1n,
        execFee: 2n,
        feeDom: SCALAR_18 / 100n,
        feeNonDom: 0n,
        impactScalar: 10n ** 30n,
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

function zeroPosition(overrides: Partial<Position> = {}): Position {
    return {
        collateral: 0n,
        notional: 0n,
        tokens: 0n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        pricedAt: 0n,
        decreaseOrders: [],
        ...overrides,
    };
}

function market(
    open: Position,
    isLong: boolean,
    overrides: Partial<MarketData> = {},
): MarketData {
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
        ...overrides,
    };
}

function snapshot(
    overrides: Partial<TradingSnapshot> = {},
    isLong = true,
): SubjectBoundTradingSnapshot {
    const open = overrides.position ?? zeroPosition();
    return {
        subject: { user: USER, isLong },
        adl: { long: false, short: false },
        collateralToken: COLLATERAL,
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
            bid: 10_000n,
            ask: 10_100n,
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

const feeToken: ExactRelayFeeToken = {
    collateralAssetId: 'usdc',
    contractId: COLLATERAL,
    decimals: 7,
    pricing: { kind: 'usdPeg', numerator: '1', denominator: '1' },
    minForwardChargeAtomic: 1n,
    maxSignedFeeAtomic: 100n,
};

describe('quoteMaximumPositionIncreaseIntent', () => {
    it('rounds an exact 10.006 cap down to the requested 0.01 quantum', () => {
        const exactCap = 10_006n;
        const quantum = 10n;
        const maxSnapshot = snapshot({
            config: config({
                feeDom: 0n,
                feeNonDom: 0n,
                impactScalar: 10n ** 30n,
                minPositionNotional: 1n,
                maxPositionNotional: exactCap,
                maxOpenInterest: exactCap,
                minOrderNotional: 1n,
                minOrderCollateral: 1n,
                execFee: 0n,
            }),
            price: {
                feedId: 7,
                exponent: -4,
                bid: 10_000n,
                ask: 10_000n,
                publishTime: 19_999n,
                source: 'pyth',
            },
        });

        const result = quoteMaximumPositionIncreaseIntent({
            snapshot: maxSnapshot,
            desiredPostFeeMarginDelta: exactCap,
            execution: { transport: 'direct', executionFee: 0n },
            maximumSlippage: { numerator: 1n, denominator: 100n },
            validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
            maximumWalletDebit: 1_000_000n,
            quantum,
        });

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                intent: { notional: 10_000n },
            },
        });
    });

    it('returns the highest quantum whose exact fee quote fits the wallet ceiling', () => {
        const open = zeroPosition({
            collateral: 1_000n,
            notional: 1_000n,
            tokens: (1_000n * SCALAR_18) / 10_000n,
        });
        const maxSnapshot = snapshot({
            config: config({
                feeDom: SCALAR_18 / 10n,
                feeNonDom: SCALAR_18 / 10n,
                impactScalar: 10n ** 30n,
                minPositionNotional: 1n,
                maxPositionNotional: 10_000n,
                maxOpenInterest: 10_000n,
                minOrderNotional: 1n,
                minOrderCollateral: 1n,
                execFee: 0n,
            }),
            market: market(open, true),
            position: open,
            price: {
                feedId: 7,
                exponent: -4,
                bid: 10_000n,
                ask: 10_000n,
                publishTime: 19_999n,
                source: 'pyth',
            },
        });

        const result = quoteMaximumPositionIncreaseIntent({
            snapshot: maxSnapshot,
            desiredPostFeeMarginDelta: 0n,
            execution: { transport: 'direct', executionFee: 0n },
            maximumSlippage: { numerator: 1n, denominator: 100n },
            validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
            maximumWalletDebit: 50n,
            quantum: 10n,
        });

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                intent: { notional: 490n },
                walletMaximumDebit: 50n,
            },
        });
    });

    it('stops at the highest quantum allowed by exact maintenance economics', () => {
        const open = zeroPosition({
            collateral: 2_000n,
            notional: 10_000n,
            tokens: SCALAR_18,
        });
        const maxSnapshot = snapshot({
            config: config({
                feeDom: 0n,
                feeNonDom: 0n,
                impactScalar: 10n ** 30n,
                minPositionNotional: 1n,
                maxPositionNotional: 20_000n,
                maxOpenInterest: 20_000n,
                minOrderNotional: 1n,
                minOrderCollateral: 1n,
                execFee: 0n,
            }),
            market: market(open, true),
            position: open,
            price: {
                feedId: 7,
                exponent: -4,
                bid: 9_000n,
                ask: 10_000n,
                publishTime: 19_999n,
                source: 'pyth',
            },
        });

        const result = quoteMaximumPositionIncreaseIntent({
            snapshot: maxSnapshot,
            desiredPostFeeMarginDelta: 0n,
            execution: { transport: 'direct', executionFee: 0n },
            maximumSlippage: { numerator: 1n, denominator: 100n },
            validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
            maximumWalletDebit: 10n,
            quantum: 10n,
        });

        expect(result).toMatchObject({
            kind: 'exact',
            value: { intent: { notional: 3_330n } },
        });
        const next = quotePositionIncreaseIntent({
            snapshot: maxSnapshot,
            notional: 3_340n,
            desiredPostFeeMarginDelta: 0n,
            execution: { transport: 'direct', executionFee: 0n },
            maximumSlippage: { numerator: 1n, denominator: 100n },
            validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
        });
        expect(next).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
        });
    });

    it('returns no capacity when current exposure already exceeds a configured cap', () => {
        const open = zeroPosition({
            collateral: 2_000n,
            notional: 10_001n,
            tokens: SCALAR_18,
        });
        const maxSnapshot = snapshot({
            config: config({
                maxPositionNotional: 10_000n,
                maxOpenInterest: 20_000n,
            }),
            market: market(open, true),
            position: open,
        });

        expect(
            quoteMaximumPositionIncreaseIntent({
                snapshot: maxSnapshot,
                desiredPostFeeMarginDelta: 0n,
                execution: { transport: 'direct', executionFee: 2n },
                maximumSlippage: { numerator: 1n, denominator: 100n },
                validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
                maximumWalletDebit: 1_000n,
                quantum: 10n,
            }),
        ).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: 'no position increase fits the requested quantum',
        });
    });

    it.each([
        { user: USER },
        { isLong: true },
    ])('rejects caller-owned subject fields on Max input', (subjectOverride) => {
        const result = quoteMaximumPositionIncreaseIntent({
            snapshot: snapshot(),
            desiredPostFeeMarginDelta: 0n,
            execution: { transport: 'direct', executionFee: 2n },
            maximumSlippage: { numerator: 1n, denominator: 100n },
            validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
            maximumWalletDebit: 1_000n,
            quantum: 10n,
            ...subjectOverride,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'position increase user and side come from snapshot subject provenance',
        });
    });

    it('preserves the delegated market-status reason when no Max candidate is exact', () => {
        expect(
            quoteMaximumPositionIncreaseIntent({
                snapshot: snapshot({ status: Status.OnIce }),
                desiredPostFeeMarginDelta: 0n,
                execution: { transport: 'direct', executionFee: 2n },
                maximumSlippage: { numerator: 1n, denominator: 100n },
                validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
                maximumWalletDebit: 1_000n,
                quantum: 10n,
            }),
        ).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('contract error #705'),
        });
    });
});

function directInput(overrides: Record<string, unknown> = {}) {
    return {
        snapshot: snapshot(),
        notional: 1_000n,
        desiredPostFeeMarginDelta: 200n,
        execution: { transport: 'direct', executionFee: 2n },
        maximumSlippage: { numerator: 1n, denominator: 100n },
        validForLedgers: POSITION_INCREASE_MAX_VALIDITY_LEDGERS,
        ...overrides,
    };
}

describe('quotePositionIncreaseIntent', () => {
    it('derives gross collateral so the requested post-fee margin delta is exact', () => {
        const result = quotePositionIncreaseIntent(directInput());

        expect(result).toMatchObject({
            kind: 'exact',
            ledger: 10_000,
            priceTime: 19_999n,
            value: {
                kind: 'positionIncrease',
                identity: {
                    trading: TRADING,
                    router: ROUTER,
                    collateralToken: COLLATERAL,
                    user: USER,
                    isLong: true,
                },
                intent: {
                    notional: 1_000n,
                    desiredPostFeeMarginDelta: 200n,
                    execution: { transport: 'direct', executionFee: 2n },
                    maximumSlippage: { numerator: 1n, denominator: 100n },
                    validForLedgers: 60,
                },
                grossOrderCollateral: 211n,
                walletMaximumDebit: 213n,
                priceBound: 10_201n,
                expiration: 10_060,
                outcome: {
                    action: {
                        kind: 'increase',
                        notional: 1_000n,
                        collateral: 211n,
                    },
                    fees: {
                        base: 10n,
                        impact: 1n,
                        marginDebit: 11n,
                        execution: 2n,
                        relay: 0n,
                    },
                    postPosition: { collateral: 200n, notional: 1_000n },
                },
            },
        });
    });

    it('applies the desired margin delta exactly to an existing position', () => {
        const open = zeroPosition({
            collateral: 100n,
            notional: 500n,
            tokens: 50_000_000_000_000_000n,
            pricedAt: 19_990n,
        });
        const source = snapshot({
            position: open,
            market: market(open, true),
        });

        const result = quotePositionIncreaseIntent(
            directInput({ snapshot: source }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                grossOrderCollateral: 211n,
                outcome: {
                    postPosition: { collateral: 300n, notional: 1_500n },
                },
            },
        });
    });

    it('rejects a backwards borrowing index before sub-atomic rounding', () => {
        const open = zeroPosition({
            collateral: 100n,
            notional: 500n,
            tokens: 50_000_000_000_000_000n,
            borrowingIdx: 1n,
            pricedAt: 19_990n,
        });
        const source = snapshot({
            position: open,
            market: market(open, true, { borrowingIdx: pair(0n, 0n) }),
        });

        expect(
            quotePositionIncreaseIntent(directInput({ snapshot: source })),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('borrowing index moved backwards'),
        });
    });

    it('derives the relay reserve from the full exact fee-token configuration', () => {
        const result = quotePositionIncreaseIntent(
            directInput({
                execution: {
                    transport: 'relay',
                    executionFee: 2n,
                    feeToken,
                },
            }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                intent: {
                    execution: {
                        transport: 'relay',
                        executionFee: 2n,
                        feeToken,
                    },
                },
                grossOrderCollateral: 211n,
                walletMaximumDebit: 313n,
                outcome: { fees: { relay: 100n } },
            },
        });
    });

    it('uses the subject side and computes the short sell-side lower bound', () => {
        const result = quotePositionIncreaseIntent(
            directInput({ snapshot: snapshot({}, false) }),
        );

        expect(result).toMatchObject({
            kind: 'exact',
            value: {
                identity: { user: USER, isLong: false },
                priceBound: 9_900n,
                outcome: { executionPrice: 10_000n },
            },
        });
    });

    it.each([
        ['OnIce status', { status: Status.OnIce }],
        ['Delisted status', { status: Status.Delisted }],
        ['long ADL', { adl: { long: true, short: false } }],
    ])('rejects a size-growing increase during %s', (_label, override) => {
        expect(
            quotePositionIncreaseIntent(
                directInput({ snapshot: snapshot(override) }),
            ),
        ).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('contract error #705'),
        });
    });

    it.each([Status.Frozen, Status.Retired])(
        'reports the create-order gate for status %s',
        (status) => {
            expect(
                quotePositionIncreaseIntent(
                    directInput({ snapshot: snapshot({ status }) }),
                ),
            ).toEqual({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
                reason: expect.stringContaining('contract error #704'),
            });
        },
    );

    it.each([
        ['missing ADL', { adl: undefined }],
        ['missing collateral token', { collateralToken: undefined }],
        ['invalid collateral token', { collateralToken: 'not-a-contract' }],
    ])('fails closed on %s provenance', (_label, override) => {
        expect(
            quotePositionIncreaseIntent(
                directInput({ snapshot: snapshot(override) }),
            ),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it.each([
        [
            'different collateral contract',
            { ...feeToken, contractId: OTHER_TOKEN },
        ],
        ['wrong decimals', { ...feeToken, decimals: 6 }],
        [
            'non-unit pricing',
            {
                ...feeToken,
                pricing: {
                    kind: 'usdPeg',
                    numerator: '99',
                    denominator: '100',
                },
            },
        ],
        ['invalid configured bounds', { ...feeToken, maxSignedFeeAtomic: 0n }],
    ])('rejects a relay fee token with %s', (_label, configuredFeeToken) => {
        expect(
            quotePositionIncreaseIntent(
                directInput({
                    execution: {
                        transport: 'relay',
                        executionFee: 2n,
                        feeToken: configuredFeeToken,
                    },
                }),
            ),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it.each([0, 61, 1.5])('rejects validity %s', (validForLedgers) => {
        expect(
            quotePositionIncreaseIntent(directInput({ validForLedgers })),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it.each([
        ['zero notional', { notional: 0n }],
        ['notional dust', { notional: 9n }],
        ['negative desired margin', { desiredPostFeeMarginDelta: -1n }],
        [
            'wrong execution fee',
            { execution: { transport: 'direct', executionFee: 1n } },
        ],
    ])('rejects %s', (_label, override) => {
        expect(
            quotePositionIncreaseIntent(directInput(override)),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });
});
