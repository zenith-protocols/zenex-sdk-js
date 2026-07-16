import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import {
    buildPositionIncreaseIntentExecution,
    type ContractExecutionPolicy,
    type ExactRelayFeeToken,
} from '../../src/order/transactions.js';
import {
    quotePositionIncreaseIntent,
    type ExactPositionIncreaseIntentQuote,
    type QuotePositionIncreaseIntentInput,
} from '../../src/position/increase.js';
import type {
    SubjectBoundTradingSnapshot,
    TradingSnapshot,
} from '../../src/trading/trading_snapshot.js';
import {
    OrderKind,
    Status,
    type MarketData,
    type Position,
    type SidePair,
    type TradingConfig,
} from '../../src/trading/trading_types.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 10));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 11));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 12));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 13));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 14));
const COLLATERAL = StrKey.encodeContract(Buffer.alloc(32, 15));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 16));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 17));
const OTHER_KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 18));

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function config(): TradingConfig {
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
    };
}

function zeroPosition(): Position {
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
    };
}

function market(): MarketData {
    return {
        notional: pair(),
        collateral: pair(),
        tokens: pair(),
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
): SubjectBoundTradingSnapshot {
    return {
        subject: { user: USER, isLong: true },
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
        market: market(),
        position: zeroPosition(),
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

function exactQuote(
    source: SubjectBoundTradingSnapshot,
    execution: QuotePositionIncreaseIntentInput['execution'] = {
        transport: 'direct',
        executionFee: 2n,
    },
): ExactPositionIncreaseIntentQuote {
    const result = quotePositionIncreaseIntent({
        snapshot: source,
        notional: 1_000n,
        desiredPostFeeMarginDelta: 200n,
        execution,
        maximumSlippage: { numerator: 1n, denominator: 100n },
        validForLedgers: 60,
    });
    if (result.kind !== 'exact') {
        throw new Error(`fixture quote failed: ${result.kind}`);
    }
    return result;
}

function decodeInvoke(operationXdr: string) {
    const invoke = xdr.Operation.fromXDR(operationXdr, 'base64')
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract();
    return {
        contract: Address.fromScAddress(invoke.contractAddress()).toString(),
        fn: invoke.functionName().toString(),
        args: invoke.args().map((arg) => scValToNative(arg)),
    };
}

const directPolicy: ContractExecutionPolicy = {
    kind: 'fillOrKill',
    transport: 'direct',
    keeper: KEEPER,
    price: new Uint8Array([1, 2, 3]),
};

describe('buildPositionIncreaseIntentExecution', () => {
    it('encodes direct create_and_fill from snapshot subject provenance', () => {
        const source = snapshot();
        const quote = exactQuote(source);

        const result = buildPositionIncreaseIntentExecution({
            snapshot: source,
            quote,
            policy: directPolicy,
        });

        expect(result).toMatchObject({
            kind: 'exact',
            ledger: 10_000,
            priceTime: 19_999n,
            value: { policy: 'fillOrKill', transport: 'direct' },
        });
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('create_and_fill');
        const calls = invoke.args[0] as Record<string, unknown>[];
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            contract: TRADING,
            func: 'create_order',
            args: [
                USER,
                true,
                OrderKind.MarketIncrease,
                1_000n,
                211n,
                0n,
                10_201n,
                10_060,
            ],
        });
        expect(invoke.args.slice(1)).toEqual([
            USER,
            KEEPER,
            Buffer.from([1, 2, 3]),
        ]);
    });

    it('encodes relay create_and_fill_with_fee with the quoted exact token maximum', () => {
        const source = snapshot();
        const quote = exactQuote(source, {
            transport: 'relay',
            executionFee: 2n,
            feeToken,
        });
        const policy: ContractExecutionPolicy = {
            kind: 'fillOrKill',
            transport: 'relay',
            feeToken,
            maxFeeAmount: 100n,
            feeExpiration: quote.value.expiration,
        };

        const result = buildPositionIncreaseIntentExecution({
            snapshot: source,
            quote,
            policy,
        });

        expect(result).toMatchObject({
            kind: 'exact',
            value: { policy: 'fillOrKill', transport: 'relay' },
        });
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.fn).toBe('create_and_fill_with_fee');
        expect(invoke.args.slice(1)).toEqual([
            USER,
            COLLATERAL,
            100n,
            10_060,
            1n,
            USER,
            USER,
            Buffer.from([1, 2, 3]),
        ]);
    });

    it('rejects any caller-supplied call batch, user, or side', () => {
        const source = snapshot();
        const quote = exactQuote(source);

        for (const extra of [{ calls: [] }, { user: USER }, { isLong: true }]) {
            expect(
                buildPositionIncreaseIntentExecution({
                    snapshot: source,
                    quote,
                    policy: directPolicy,
                    ...extra,
                } as never),
            ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        }
    });

    it('rejects a direct price payload not bound to the snapshot', () => {
        const source = snapshot();
        const quote = exactQuote(source);

        expect(
            buildPositionIncreaseIntentExecution({
                snapshot: source,
                quote,
                policy: {
                    ...directPolicy,
                    price: new Uint8Array([9, 9, 9]),
                },
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('does not match'),
        });
    });

    it.each([
        ['transport', { transport: 'direct' }],
        ['maximum', { maxFeeAmount: 99n }],
        ['expiration', { feeExpiration: 10_059 }],
        [
            'fee token',
            {
                feeToken: {
                    ...feeToken,
                    collateralAssetId: 'forged',
                },
            },
        ],
    ])('rejects mismatched relay %s', (_label, override) => {
        const source = snapshot();
        const quote = exactQuote(source, {
            transport: 'relay',
            executionFee: 2n,
            feeToken,
        });
        const policy = {
            kind: 'fillOrKill',
            transport: 'relay',
            feeToken,
            maxFeeAmount: 100n,
            feeExpiration: 10_060,
            ...override,
        } as ContractExecutionPolicy;

        expect(
            buildPositionIncreaseIntentExecution({
                snapshot: source,
                quote,
                policy,
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it('rejects a quote changed after it was produced', () => {
        const source = snapshot();
        const quote = exactQuote(source);
        const forged = {
            ...quote,
            value: {
                ...quote.value,
                grossOrderCollateral: quote.value.grossOrderCollateral + 1n,
            },
        };

        expect(
            buildPositionIncreaseIntentExecution({
                snapshot: source,
                quote: forged,
                policy: directPolicy,
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('does not match'),
        });
    });

    it('rejects a snapshot changed after the quote was produced', () => {
        const source = snapshot();
        const quote = exactQuote(source);
        const changed = snapshot({
            priceUpdate: new Uint8Array([1, 2, 4]),
        });

        expect(
            buildPositionIncreaseIntentExecution({
                snapshot: changed,
                quote,
                policy: {
                    ...directPolicy,
                    keeper: OTHER_KEEPER,
                    price: changed.priceUpdate,
                },
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('does not match'),
        });
    });

    it('rejects rest-only execution at runtime', () => {
        const source = snapshot();
        const quote = exactQuote(source);

        expect(
            buildPositionIncreaseIntentExecution({
                snapshot: source,
                quote,
                policy: { kind: 'restOnly', transport: 'direct' },
            } as never),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });
});
