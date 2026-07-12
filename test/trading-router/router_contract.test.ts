import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey, Address } from '@stellar/stellar-sdk';
import { TradingRouterContract } from '../../src/trading-router/router_contract.js';
import { Call, createOrderCall, parseFillAttempt, parseCallOutcome } from '../../src/trading-router/router_types.js';
import { TradingContract } from '../../src/trading/trading_contract.js';
import { OrderKind } from '../../src/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 4));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
        rawArgs: invoke.args(),
    };
}

/** A `create_order`-shaped fill call for the first slot of a batch. */
function fillCall(): Call {
    return TradingRouterContract.createOrderCall({
        trading: TRADING, user: USER, isLong: true, kind: OrderKind.MarketIncrease,
        notional: 100n, collateral: 10n, triggerPrice: 0n, priceBound: 200n, expiration: 12345,
    });
}

describe('TradingRouterContract', () => {
    const contract = new TradingRouterContract(CONTRACT_ID);

    it('createAndFill builds create_and_fill with the (calls, user, keeper, price) order', () => {
        const price = Buffer.from([9, 9, 9]);
        const op = contract.createAndFill([fillCall()], USER, KEEPER, price);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_and_fill');
        expect(args).toHaveLength(4);
        const calls = args[0] as Record<string, unknown>[];
        expect(calls).toHaveLength(1);
        expect(calls[0].func).toBe('create_order');
        expect(calls[0].contract).toBe(TRADING);
        expect(args[1]).toBe(USER);
        expect(args[2]).toBe(KEEPER);
        expect(Buffer.from(args[3] as Uint8Array)).toEqual(price);
    });

    it('createAndTryFill builds create_and_try_fill with the same arg order', () => {
        const price = Buffer.from([1, 2]);
        const op = contract.createAndTryFill([fillCall()], USER, KEEPER, price);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_and_try_fill');
        expect(args).toHaveLength(4);
        expect((args[0] as unknown[])).toHaveLength(1);
        expect(args[1]).toBe(USER);
        expect(args[2]).toBe(KEEPER);
        expect(Buffer.from(args[3] as Uint8Array)).toEqual(price);
    });

    it('createAndFill carries a multi-call batch: fill first, trigger resting', () => {
        const trigger = TradingRouterContract.createOrderCall({
            trading: TRADING, user: USER, isLong: true, kind: OrderKind.LimitDecrease,
            notional: 50n, collateral: 0n, triggerPrice: 300n, priceBound: 0n, expiration: 12345,
        });
        const op = contract.createAndFill([fillCall(), trigger], USER, KEEPER, Buffer.from([0]));
        const { args } = decodeInvoke(op);
        const calls = args[0] as Record<string, unknown>[];
        expect(calls).toHaveLength(2);
        // calls[0].args = create_order tuple: (user, is_long, kind, notional, collateral, trigger_price, price_bound, expiration)
        expect(calls[0].args).toEqual([USER, true, 0, 100n, 10n, 0n, 200n, 12345]);
        expect(calls[1].args).toEqual([USER, true, 4, 50n, 0n, 300n, 0n, 12345]);
    });

    it('createAndFillWithFee builds the exact 8-arg order (calls, user, fee_token, max_fee, fee_amount, fee_recipient, keeper, price)', () => {
        const price = Buffer.from([4, 2]);
        const feeToken = StrKey.encodeContract(Buffer.alloc(32, 5));
        const feeRecipient = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
        const op = contract.createAndFillWithFee({
            calls: [fillCall()], user: USER, feeToken, maxFeeAmount: 3000n,
            feeAmount: 2500n, feeRecipient, keeper: KEEPER, price,
        });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_and_fill_with_fee');
        expect(args).toHaveLength(8);
        expect((args[0] as unknown[])).toHaveLength(1);
        expect(args.slice(1, 7)).toEqual([USER, feeToken, 3000n, 2500n, feeRecipient, KEEPER]);
        expect(Buffer.from(args[7] as Uint8Array)).toEqual(price);
    });

    it('createAndTryFillWithFee builds create_and_try_fill_with_fee with the same arg order', () => {
        const price = Buffer.from([8]);
        const feeToken = StrKey.encodeContract(Buffer.alloc(32, 5));
        const feeRecipient = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
        const op = contract.createAndTryFillWithFee({
            calls: [fillCall()], user: USER, feeToken, maxFeeAmount: 500n,
            feeAmount: 0n, feeRecipient, keeper: KEEPER, price,
        });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_and_try_fill_with_fee');
        expect(args).toHaveLength(8);
        expect(args.slice(1, 7)).toEqual([USER, feeToken, 500n, 0n, feeRecipient, KEEPER]);
        expect(Buffer.from(args[7] as Uint8Array)).toEqual(price);
    });

    it('createOrderCall mirrors TradingContract.createOrderCall byte-for-byte and crosses kind as u32', () => {
        const params = {
            trading: TRADING, user: USER, isLong: false, kind: OrderKind.StopDecrease,
            notional: 77n, collateral: 3n, triggerPrice: 250n, priceBound: 9n, expiration: 42,
        };
        const routerCall = TradingRouterContract.createOrderCall(params);
        const helperCall = createOrderCall(params);
        const direct = new TradingContract(TRADING).createOrderCall(
            USER, false, OrderKind.StopDecrease, 77n, 3n, 250n, 9n, 42,
        );
        expect(routerCall).toEqual(helperCall);
        expect(routerCall.contract).toBe(TRADING);
        expect(routerCall.func).toBe('create_order');
        expect(routerCall.args.map((a) => a.toXDR('base64')))
            .toEqual(direct.args.map((a) => a.toXDR('base64')));
        // kind rides as scvU32 (position 2 of the create_order tuple).
        expect(routerCall.args[2].switch().name).toBe('scvU32');
    });

    it('buildCall + multicall round-trip: decode op, assert nested call vec', () => {
        const inner: Call = {
            contract: TRADING,
            func: 'get_status',
            args: [],
        };
        const built = TradingRouterContract.buildCall(TRADING, 'get_status', []);
        expect(built).toEqual(inner);

        const op = contract.multicall([built]);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('multicall');
        const decodedCalls = args[0] as Record<string, unknown>[];
        expect(decodedCalls).toHaveLength(1);
        // scvMap keys decode in alphabetical order: args, contract, func
        expect(Object.keys(decodedCalls[0])).toEqual(['args', 'contract', 'func']);
        expect(decodedCalls[0]).toEqual({ args: [], contract: TRADING, func: 'get_status' });
    });

    it('multicall round-trips a nested Call whose own args carry a nested vec', () => {
        const nestedArg = xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2)]);
        const inner = TradingRouterContract.buildCall(TRADING, 'get_order', [
            Address.fromString(USER).toScVal(),
            nestedArg,
        ]);
        const op = contract.multicall([inner, TradingRouterContract.buildCall(TRADING, 'get_status', [])]);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('multicall');
        const decodedCalls = args[0] as Record<string, unknown>[];
        expect(decodedCalls).toHaveLength(2);
        expect(decodedCalls[0].func).toBe('get_order');
        expect(decodedCalls[0].contract).toBe(TRADING);
        expect(decodedCalls[0].args).toEqual([USER, [1, 2]]);
        expect(decodedCalls[1].func).toBe('get_status');
    });

    it('parseCallOutcome reads a raw success Val and a raw error Val', () => {
        expect(parseCallOutcome(nativeI128(42n))).toEqual({ ok: true, value: 42n, error: 0 });
        const err = xdr.ScVal.scvError(xdr.ScError.sceContract(730));
        expect(parseCallOutcome(err)).toEqual({ ok: false, value: undefined, error: 730 });
    });

    it('parseFillAttempt camelCases { id, filled, payout, error }', () => {
        const raw = { id: 7, filled: true, payout: 123n, error: 0 };
        expect(parseFillAttempt(raw)).toEqual({ id: 7, filled: true, payout: 123n, error: 0 });
    });

    it('parsers.multicall passes through raw scValToNative array', () => {
        const inner = xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2)]);
        const raw = inner.toXDR('base64');
        expect(TradingRouterContract.parsers.multicall(raw)).toEqual([1, 2]);
    });

    it('parsers.multicallTry splits a vec of raw Vals into CallOutcome[]', () => {
        const raw = xdr.ScVal.scvVec([nativeI128(5n)]).toXDR('base64');
        expect(TradingRouterContract.parsers.multicallTry(raw)).toEqual([{ ok: true, value: 5n, error: 0 }]);
    });

    it('parsers.createAndTryFill decodes a FillAttempt map', () => {
        const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
        const attempt = xdr.ScVal.scvMap([
            entry('error', xdr.ScVal.scvU32(0)),
            entry('filled', xdr.ScVal.scvBool(true)),
            entry('id', xdr.ScVal.scvU32(3)),
            entry('payout', nativeI128(10n)),
        ]);
        const raw = attempt.toXDR('base64');
        expect(TradingRouterContract.parsers.createAndTryFill(raw)).toEqual({
            id: 3, filled: true, payout: 10n, error: 0,
        });
    });
});

function nativeI128(v: bigint): xdr.ScVal {
    return xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: xdr.Int64.fromString('0'),
        lo: xdr.Uint64.fromString(v.toString()),
    }));
}
