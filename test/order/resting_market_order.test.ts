import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    buildRestingMarketOrderOperation,
    type ContractExecutionPolicy,
    type RestOnlyExecutionPolicy,
} from '../../src/trading/order/transactions.js';
import { OrderKind, Status } from '../../src/contracts/trading/trading_types.js';
import type { TradingConfig } from '../../src/contracts/trading/trading_types.js';
import type { OrderValidationContext } from '../../src/trading/order/validation.js';
import type { OrderParams } from '../../src/contracts/router/router_types.js';

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

// A price-bearing context proves the builder ignores the live mark: the
// keeper, not the browser, supplies the price at fill time.
const validation: OrderValidationContext = {
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
        priceBound: 105n,
        expiration: 10_100,
        ...overrides,
    };
}

const directPolicy: RestOnlyExecutionPolicy = {
    kind: 'restOnly',
    transport: 'direct',
};

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

describe('buildRestingMarketOrderOperation', () => {
    it('maps a direct resting market increase to a price-free trading create_order', () => {
        const result = buildRestingMarketOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order(),
            policy: directPolicy,
            validation,
        });

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.policy).toBe('restOnly');
        expect(result.value.transport).toBe('direct');
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(TRADING);
        expect(invoke.fn).toBe('create_order');
        // create_order(user, isLong, kind, notional, margin, trigger, bound, expiration)
        expect(invoke.args[0]).toBe(USER);
        expect(invoke.args[2]).toBe(OrderKind.MarketIncrease);
        expect(invoke.args[5]).toBe(0n);
        expect(invoke.args[6]).toBe(105n);
    });

    it('rests a market order even when the live mark would breach the bound', () => {
        // Long increase fills against ask (101); a 50 bound is out of the money
        // now, but a resting order is validated price-free and rests anyway.
        const result = buildRestingMarketOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order({ priceBound: 50n }),
            policy: directPolicy,
            validation,
        });

        expect(result.kind).toBe('exact');
    });

    it('rejects a non-market order kind', () => {
        const result = buildRestingMarketOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order({ kind: OrderKind.LimitIncrease, triggerPrice: 90n }),
            policy: directPolicy,
            validation,
        });

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
        if (result.kind !== 'unavailable') return;
        expect(result.reason).toContain('market increase or decrease');
    });

    it('rejects a market order with no slippage guard', () => {
        const result = buildRestingMarketOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order({ priceBound: 0n }),
            policy: directPolicy,
            validation,
        });

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
        if (result.kind !== 'unavailable') return;
        expect(result.reason).toContain('slippage guard');
    });

    it('rejects a market order that carries a trigger price', () => {
        const result = buildRestingMarketOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order({ triggerPrice: 100n }),
            policy: directPolicy,
            validation,
        });

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
        if (result.kind !== 'unavailable') return;
        expect(result.reason).toContain('trigger price');
    });

    it('rejects a fill-or-kill policy', () => {
        const fillOrKill: ContractExecutionPolicy = {
            kind: 'fillOrKill',
            transport: 'direct',
            keeper: KEEPER,
            price: new Uint8Array([1, 2, 3]),
        };
        const result = buildRestingMarketOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order(),
            policy: fillOrKill as unknown as RestOnlyExecutionPolicy,
            validation,
        });

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
        if (result.kind !== 'unavailable') return;
        expect(result.reason).toContain('rest-only');
    });

    it('rejects a no-op order through the create_order gates', () => {
        const result = buildRestingMarketOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            order: order({ notional: 0n, margin: 0n }),
            policy: directPolicy,
            validation,
        });

        expect(result.kind).toBe('unavailable');
    });
});
