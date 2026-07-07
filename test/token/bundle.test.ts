import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import { TradingContract } from '../../src/trading/trading_contract.js';
import { OrderKind, VaultOrderKind } from '../../src/trading/trading_types.js';
import { approveCall } from '../../src/token/sep41.js';
import { approveAndOrder } from '../../src/token/bundle.js';
import { TradingRouterContract } from '../../src/trading-router/router_contract.js';
import { Call } from '../../src/trading-router/router_types.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 1));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 4));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 5));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));

/** Decode an invokeContract op into function name + raw/native args. */
function decodeInvoke(op: string) {
    const invoke = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp()
        .hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
        rawArgs: invoke.args(),
    };
}

describe('createOrderCall / createVaultOrderCall no-drift', () => {
    const trading = new TradingContract(TRADING);

    it('createOrderCall args are byte-identical to the direct createOrder op args', () => {
        const params: [string, boolean, OrderKind, bigint, bigint, bigint, boolean, bigint, number] =
            [USER, true, OrderKind.Increase, 100n, 10n, 5n, false, 200n, 12345];

        const direct = decodeInvoke(trading.createOrder(...params));
        const call = trading.createOrderCall(...params);

        expect(call.contract).toBe(TRADING);
        expect(call.func).toBe('create_order');
        expect(direct.fn).toBe('create_order');
        expect(call.args).toHaveLength(direct.rawArgs.length);
        call.args.forEach((arg, i) => {
            expect(arg.toXDR('base64')).toBe(direct.rawArgs[i].toXDR('base64'));
        });
    });

    it('createVaultOrderCall args are byte-identical to the direct createVaultOrder op args', () => {
        const params: [string, VaultOrderKind, bigint, bigint] = [USER, VaultOrderKind.Deposit, 500n, 0n];

        const direct = decodeInvoke(trading.createVaultOrder(...params));
        const call = trading.createVaultOrderCall(...params);

        expect(call.contract).toBe(TRADING);
        expect(call.func).toBe('create_vault_order');
        expect(call.args).toHaveLength(direct.rawArgs.length);
        call.args.forEach((arg, i) => {
            expect(arg.toXDR('base64')).toBe(direct.rawArgs[i].toXDR('base64'));
        });
    });
});

describe('approveCall (SEP-41)', () => {
    it('encodes (from, spender, amount, expiration_ledger) with the right types and order', () => {
        const call = approveCall(TOKEN, USER, TRADING, 1000n, 99999);

        expect(call.contract).toBe(TOKEN);
        expect(call.func).toBe('approve');
        expect(call.args).toHaveLength(4);

        expect(call.args.map((a) => scValToNative(a))).toEqual([USER, TRADING, 1000n, 99999]);
        // amount is an i128, expiration_ledger a u32.
        expect(call.args[2].switch().name).toBe('scvI128');
        expect(call.args[3].switch().name).toBe('scvU32');
    });
});

describe('approveAndOrder', () => {
    const router = new TradingRouterContract(ROUTER);
    const trading = new TradingContract(TRADING);
    const order: Call = trading.createOrderCall(USER, true, OrderKind.Increase, 100n, 10n, 0n, false, 200n, 12345);

    /** Decode a multicall op into its nested call list (native). */
    function decodeCalls(op: string): Record<string, unknown>[] {
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('multicall');
        return args[0] as Record<string, unknown>[];
    }

    it('bundles [approve(token, user, trading, amount), order] in that order', () => {
        const op = approveAndOrder({
            router, token: TOKEN, trading: TRADING, user: USER,
            approveAmount: 10n, expirationLedger: 99999, order,
        });
        const calls = decodeCalls(op);

        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({ args: [USER, TRADING, 10n, 99999], contract: TOKEN, func: 'approve' });
        expect(calls[1].func).toBe('create_order');
        expect(calls[1].contract).toBe(TRADING);
    });

    it('drops the approve leg when approveAmount is 0', () => {
        const op = approveAndOrder({
            router, token: TOKEN, trading: TRADING, user: USER,
            approveAmount: 0n, expirationLedger: 99999, order,
        });
        const calls = decodeCalls(op);

        expect(calls).toHaveLength(1);
        expect(calls[0].func).toBe('create_order');
    });

    it('drops the approve leg when approveAmount is negative', () => {
        const op = approveAndOrder({
            router, token: TOKEN, trading: TRADING, user: USER,
            approveAmount: -5n, expirationLedger: 99999, order,
        });
        expect(decodeCalls(op)).toHaveLength(1);
    });

    it('the bundled order leg is byte-identical to the standalone order Call', () => {
        const op = approveAndOrder({
            router, token: TOKEN, trading: TRADING, user: USER,
            approveAmount: 10n, expirationLedger: 99999, order,
        });
        const nestedCalls = decodeInvoke(op).rawArgs[0].vec()!;
        // nested Call is an scvMap ordered (args, contract, func); args is the first entry's vec.
        const orderArgsVec = nestedCalls[1].map()!.find(
            (e) => e.key().sym().toString() === 'args',
        )!.val().vec()!;
        order.args.forEach((arg, i) => {
            expect(orderArgsVec[i].toXDR('base64')).toBe(arg.toXDR('base64'));
        });
    });
});
