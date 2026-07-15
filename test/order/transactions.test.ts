import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    buildMarginAdjustmentExecution,
    buildOrderOperation,
    buildPositionActionExecution,
    type ContractExecutionPolicy,
    type ExactRelayFeeToken,
} from '../../src/order/transactions.js';
import type { MarginAdjustmentQuote } from '../../src/position/margin.js';
import type { PositionActionOutcome } from '../../src/position/quote.js';
import { OrderKind, Status } from '../../src/trading/trading_types.js';
import type { TradingConfig } from '../../src/trading/trading_types.js';
import {
    createOrderCall,
    type OrderParams,
} from '../../src/trading-router/router_types.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 10));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 11));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 12));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 13));
const RECIPIENT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 14));
const FEE_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 15));

function config(): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 10n ** 24n,
        maxOpenInterest: 10n ** 25n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        execFee: 2n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 10n ** 24n,
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
        redeemLock: 0n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 1n,
        maxVaultBalance: 10n ** 25n,
    };
}

const validation = {
    ledger: 10_000,
    now: 20_000n,
    status: Status.Active,
    config: config(),
    price: {
        feedId: 1,
        exponent: -8,
        bid: 99n,
        ask: 101n,
        publishTime: 19_999n,
        source: 'pyth' as const,
    },
    priceUpdate: new Uint8Array([1, 2, 3]),
};

function order(overrides: Partial<OrderParams> = {}): OrderParams {
    return {
        trading: TRADING,
        user: USER,
        isLong: true,
        kind: OrderKind.MarketIncrease,
        notional: 100n,
        collateral: 20n,
        triggerPrice: 0n,
        priceBound: 101n,
        expiration: 10_100,
        ...overrides,
    };
}

function decodeInvoke(operationXdr: string) {
    const body = xdr.Operation.fromXDR(operationXdr, 'base64')
        .body()
        .invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        contract: Address.fromScAddress(invoke.contractAddress()).toString(),
        fn: invoke.functionName().toString(),
        args: invoke.args().map((arg) => scValToNative(arg)),
        rawArgs: invoke.args(),
    };
}

const directPolicy: ContractExecutionPolicy = {
    kind: 'fillOrKill',
    transport: 'direct',
    keeper: KEEPER,
    price: new Uint8Array([1, 2, 3]),
};

const feeToken: ExactRelayFeeToken = {
    collateralAssetId: 'usdc',
    contractId: FEE_TOKEN,
    decimals: 7,
    pricing: { kind: 'usdPeg', numerator: '1', denominator: '1' },
    minForwardChargeAtomic: 100n,
    maxSignedFeeAtomic: 10n ** 20n,
};

const relayPolicy: ContractExecutionPolicy = {
    kind: 'fillOrKill',
    transport: 'relay',
    feeToken,
    maxFeeAmount: 9_007_199_254_740_999n,
    feeExpiration: 10_010,
    feeAmount: 123_456_789_012_345n,
    feeRecipient: RECIPIENT,
    keeper: KEEPER,
    price: new Uint8Array([4, 5, 6]),
};

const restRelayPolicy = {
    kind: 'restOnly' as const,
    transport: 'relay' as const,
    feeToken,
    maxFeeAmount: 9_007_199_254_740_999n,
    feeExpiration: 10_010,
    feeAmount: 123_456_789_012_345n,
    feeRecipient: RECIPIENT,
};

describe('buildOrderOperation', () => {
    it('maps direct fill-or-kill exactly to router create_and_fill', () => {
        const trailing = createOrderCall(
            order({
                kind: OrderKind.LimitDecrease,
                notional: 50n,
                collateral: 0n,
                triggerPrice: 120n,
                priceBound: 0n,
            }),
        );
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order(),
            calls: [trailing],
            policy: directPolicy,
            validation,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('create_and_fill');
        expect(invoke.args).toHaveLength(4);
        expect(invoke.args[1]).toBe(USER);
        expect(invoke.args[2]).toBe(KEEPER);
        expect(invoke.args[0]).toHaveLength(2);
    });

    it('maps relay fill-or-kill exactly to the generated nine-argument router binding', () => {
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order(),
            policy: relayPolicy,
            validation: {
                ...validation,
                priceUpdate: new Uint8Array([4, 5, 6]),
            },
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.fn).toBe('create_and_fill_with_fee');
        expect(invoke.args).toHaveLength(9);
        expect(invoke.args.slice(1, 8)).toEqual([
            USER,
            FEE_TOKEN,
            9_007_199_254_740_999n,
            10_010,
            123_456_789_012_345n,
            RECIPIENT,
            KEEPER,
        ]);
    });

    it('maps explicit rest-only directly to trading create_order', () => {
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order({
                kind: OrderKind.LimitIncrease,
                triggerPrice: 90n,
                priceBound: 101n,
            }),
            policy: { kind: 'restOnly', transport: 'direct' },
            validation,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(TRADING);
        expect(invoke.fn).toBe('create_order');
    });

    it('maps relayed rest-only to Router multicall_with_fee', () => {
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order({
                kind: OrderKind.LimitIncrease,
                triggerPrice: 90n,
                priceBound: 101n,
            }),
            policy: restRelayPolicy as ContractExecutionPolicy,
            validation,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('multicall_with_fee');
        expect(invoke.args).toHaveLength(7);
        expect(invoke.args[0]).toHaveLength(1);
        expect(invoke.args.slice(1)).toEqual([
            USER,
            FEE_TOKEN,
            9_007_199_254_740_999n,
            10_010,
            123_456_789_012_345n,
            RECIPIENT,
        ]);
    });

    it('does not downgrade malformed fill-or-kill or ignore rest-only batches', () => {
        const invalidPrimary = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order({ kind: OrderKind.LimitIncrease, triggerPrice: 90n }),
            policy: directPolicy,
            validation,
        });
        expect(invalidPrimary).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });

        const ignoredBatch = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order(),
            calls: [createOrderCall(order())],
            policy: { kind: 'restOnly', transport: 'direct' },
            validation,
        });
        expect(ignoredBatch).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });

    it('binds the serialized Router price payload to the verified snapshot', () => {
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order(),
            policy: { ...directPolicy, price: new Uint8Array([9, 9, 9]) },
            validation,
        });
        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });

    it('does not require an unused Router identity for direct rest-only execution', () => {
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order({
                kind: OrderKind.LimitIncrease,
                triggerPrice: 90n,
            }),
            policy: { kind: 'restOnly', transport: 'direct' },
            validation,
        });
        expect(result.kind).toBe('exact');
    });

    it('rejects relay ceilings outside the configured exact token policy', () => {
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order(),
            policy: {
                ...relayPolicy,
                maxFeeAmount: feeToken.maxSignedFeeAtomic + 1n,
            },
            validation,
        });
        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });
});

function outcome(
    action: PositionActionOutcome['action'],
    executionPrice = 101n,
): PositionActionOutcome {
    return { action, executionPrice } as PositionActionOutcome;
}

describe('exact action builders', () => {
    it.each([
        [
            { kind: 'increase', notional: 100n, collateral: 20n } as const,
            OrderKind.MarketIncrease,
            100n,
            20n,
        ],
        [
            { kind: 'decrease', notional: 40n, collateral: 5n } as const,
            OrderKind.MarketDecrease,
            40n,
            5n,
        ],
    ])(
        'encodes %s as a market action with zero trigger',
        (action, kind, notional, collateral) => {
            const executionPrice =
                kind === OrderKind.MarketIncrease ? 101n : 99n;
            const result = buildPositionActionExecution({
                tradingAddress: TRADING,
                routerAddress: ROUTER,
                user: USER,
                isLong: true,
                outcome: outcome(action, executionPrice),
                expiration: 10_100,
                policy: directPolicy,
                validation,
            });
            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            const calls = decodeInvoke(result.value.operationXdr)
                .args[0] as Record<string, unknown>[];
            expect(calls[0].args).toEqual([
                USER,
                true,
                kind,
                notional,
                collateral,
                0n,
                executionPrice,
                10_100,
            ]);
        },
    );

    it('preserves the requested max-margin atomic delta above Number.MAX_SAFE_INTEGER', () => {
        const requestedAtomicDelta = 9_007_199_254_740_993n;
        const quote = {
            direction: 'withdraw',
            requestedAtomicDelta,
            maximumAtomicDelta: requestedAtomicDelta,
        } as MarginAdjustmentQuote;
        const result = buildMarginAdjustmentExecution({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            isLong: true,
            quote,
            expiration: 10_100,
            policy: directPolicy,
            validation,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const calls = decodeInvoke(result.value.operationXdr).args[0] as Record<
            string,
            unknown
        >[];
        expect(calls[0].args).toEqual([
            USER,
            true,
            OrderKind.MarketDecrease,
            0n,
            requestedAtomicDelta,
            0n,
            99n,
            10_100,
        ]);
    });

    it('rejects a quoted execution price from a different snapshot', () => {
        const result = buildPositionActionExecution({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            isLong: true,
            outcome: outcome(
                { kind: 'increase', notional: 100n, collateral: 20n },
                102n,
            ),
            expiration: 10_100,
            policy: directPolicy,
            validation,
        });
        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });

    it('encodes added margin as a zero-notional market increase', () => {
        const quote = {
            direction: 'add',
            requestedAtomicDelta: 777n,
            maximumAtomicDelta: 777n,
        } as MarginAdjustmentQuote;
        const result = buildMarginAdjustmentExecution({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            isLong: false,
            quote,
            expiration: 10_100,
            policy: directPolicy,
            validation,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const calls = decodeInvoke(result.value.operationXdr).args[0] as Record<
            string,
            unknown
        >[];
        expect(calls[0].args).toEqual([
            USER,
            false,
            OrderKind.MarketIncrease,
            0n,
            777n,
            0n,
            99n,
            10_100,
        ]);
    });
});
