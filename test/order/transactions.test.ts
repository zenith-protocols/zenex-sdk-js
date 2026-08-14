import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    buildOrderOperation,
    type ContractExecutionPolicy,
} from '../../src/trading/order/transactions.js';
import { OrderKind, Status } from '../../src/contracts/trading/trading_types.js';
import type { TradingConfig } from '../../src/contracts/trading/trading_types.js';
import {
    createOrderCall,
    type OrderParams,
} from '../../src/contracts/router/router_types.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 10));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 11));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 12));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 13));

function config(): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 10n ** 24n,
        maxOpenInterest: 10n ** 25n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
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
        margin: 20n,
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

describe('buildOrderOperation', () => {
    it('maps direct fill-or-kill exactly to router create_and_fill', () => {
        const trailing = createOrderCall(
            order({
                kind: OrderKind.LimitDecrease,
                notional: 50n,
                margin: 0n,
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
        expect(result.value.transport).toBe('direct');
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('create_and_fill');
        expect(invoke.args).toHaveLength(4);
        expect(invoke.args[1]).toBe(USER);
        expect(invoke.args[2]).toBe(KEEPER);
        expect(invoke.args[0]).toHaveLength(2);
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

    it('rejects a trailing create_order that fails the fillability gates', () => {
        // Trailing create_order calls still run the 7xx gate mirror: a trigger
        // exit with a zero trigger price cannot rest on-chain.
        const badTrailing = createOrderCall(
            order({
                kind: OrderKind.LimitDecrease,
                notional: 50n,
                margin: 0n,
                triggerPrice: 0n,
                priceBound: 0n,
            }),
        );
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order(),
            calls: [badTrailing],
            policy: directPolicy,
            validation,
        });
        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
        });
        if (result.kind !== 'unavailable') return;
        expect(result.reason).toContain('trigger');
    });

    it('silently ignores a calls batch under rest-only execution', () => {
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order({
                kind: OrderKind.LimitIncrease,
                triggerPrice: 90n,
            }),
            calls: [
                createOrderCall(
                    order({
                        kind: OrderKind.LimitDecrease,
                        notional: 50n,
                        margin: 0n,
                        triggerPrice: 120n,
                        priceBound: 0n,
                    }),
                ),
            ],
            policy: { kind: 'restOnly', transport: 'direct' },
            validation,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(TRADING);
        expect(invoke.fn).toBe('create_order');
    });

    it('splices a direct keeper price decoupled from the snapshot placeholder', () => {
        // The keeper supplies its own signed price at fill; it no longer has to
        // equal the snapshot's placeholder update bytes. Pricing integrity is
        // enforced by the synthesized market price and the order price bound.
        const result = buildOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            order: order(),
            policy: { ...directPolicy, price: new Uint8Array([9, 9, 9]) },
            validation,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.fn).toBe('create_and_fill');
        expect(invoke.args[3]).toEqual(Buffer.from([9, 9, 9]));
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

});
