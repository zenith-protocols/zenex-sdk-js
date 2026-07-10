import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey, Address } from '@stellar/stellar-sdk';
import { TradingRouterContract } from '../../src/trading-router/router_contract.js';
import { Call, parseFillAttempt, parseCallOutcome } from '../../src/trading-router/router_types.js';
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

describe('TradingRouterContract', () => {
    const contract = new TradingRouterContract(CONTRACT_ID);

    it('createAndFill builds create_and_fill with the exact 12-arg order and a u32 kind', () => {
        const price = Buffer.from([9, 9, 9]);
        const op = contract.createAndFill(
            TRADING, KEEPER, USER, 1000n, true, OrderKind.MarketIncrease, 100n, 10n,
            5n, 200n, 12345, price,
        );
        const { fn, args, rawArgs } = decodeInvoke(op);
        expect(fn).toBe('create_and_fill');
        expect(args).toHaveLength(12);
        // (trading, keeper, user, approve_amount, is_long, kind, notional,
        //  collateral, trigger_price, price_bound, expiration, price)
        expect(args.slice(0, 11)).toEqual([
            TRADING, KEEPER, USER, 1000n, true, 0, 100n, 10n,
            5n, 200n, 12345,
        ]);
        expect(rawArgs[5].switch().name).toBe('scvU32');
        expect(Buffer.from(args[11] as Uint8Array)).toEqual(price);
    });

    it('createAndTryFill builds create_and_try_fill with the same arg order', () => {
        const price = Buffer.from([1, 2]);
        const op = contract.createAndTryFill(
            TRADING, KEEPER, USER, 0n, false, OrderKind.MarketDecrease, 50n, 5n,
            0n, 0n, 999, price,
        );
        const { fn, args, rawArgs } = decodeInvoke(op);
        expect(fn).toBe('create_and_try_fill');
        expect(args).toHaveLength(12);
        expect(args[5]).toBe(3);
        expect(rawArgs[5].switch().name).toBe('scvU32');
        expect(Buffer.from(args[11] as Uint8Array)).toEqual(price);
    });

    it('createAndFillWithFee builds create_and_fill_with_fee with the exact 16-arg order', () => {
        const price = Buffer.from([4, 2]);
        const feeToken = StrKey.encodeContract(Buffer.alloc(32, 5));
        const feeRecipient = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
        const op = contract.createAndFillWithFee({
            trading: TRADING, user: USER, feeToken, maxFeeAmount: 3000n,
            approveAmount: 1000n, isLong: true, kind: OrderKind.MarketIncrease,
            notional: 100n, collateral: 10n, triggerPrice: 0n, priceBound: 200n,
            expiration: 12345, feeAmount: 2500n, feeRecipient, keeper: KEEPER, price,
        });
        const { fn, args, rawArgs } = decodeInvoke(op);
        expect(fn).toBe('create_and_fill_with_fee');
        expect(args).toHaveLength(16);
        // (trading, user, fee_token, max_fee_amount, approve_amount, is_long,
        //  kind, notional, collateral, trigger_price, price_bound, expiration,
        //  fee_amount, fee_recipient, keeper, price)
        expect(args.slice(0, 15)).toEqual([
            TRADING, USER, feeToken, 3000n, 1000n, true, 0, 100n, 10n,
            0n, 200n, 12345, 2500n, feeRecipient, KEEPER,
        ]);
        expect(rawArgs[6].switch().name).toBe('scvU32');
        expect(Buffer.from(args[15] as Uint8Array)).toEqual(price);
    });

    it('createAndTryFillWithFee builds create_and_try_fill_with_fee with the same arg order', () => {
        const price = Buffer.from([8]);
        const feeToken = StrKey.encodeContract(Buffer.alloc(32, 5));
        const feeRecipient = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
        const op = contract.createAndTryFillWithFee({
            trading: TRADING, user: USER, feeToken, maxFeeAmount: 500n,
            approveAmount: 0n, isLong: false, kind: OrderKind.MarketDecrease,
            notional: 50n, collateral: 0n, triggerPrice: 0n, priceBound: 0n,
            expiration: 999, feeAmount: 0n, feeRecipient, keeper: KEEPER, price,
        });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_and_try_fill_with_fee');
        expect(args).toHaveLength(16);
        expect(args[6]).toBe(3);
        expect(Buffer.from(args[15] as Uint8Array)).toEqual(price);
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

    it('multicallTry decodes into CallOutcome[] via parseCallOutcome', () => {
        const raw = { ok: true, value: 42n, error: 0 };
        expect(parseCallOutcome(raw)).toEqual({ ok: true, value: 42n, error: 0 });
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

    it('parsers.multicallTry maps a vec of CallOutcome maps', () => {
        const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
        const outcome = xdr.ScVal.scvMap([
            entry('error', xdr.ScVal.scvU32(0)),
            entry('ok', xdr.ScVal.scvBool(true)),
            entry('value', nativeI128(5n)),
        ]);
        const raw = xdr.ScVal.scvVec([outcome]).toXDR('base64');
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
