import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { TradingRouterContract } from '../src/trading-router/router_contract.js';
import { FactoryContract } from '../src/factory/factory_contract.js';

const ROUTER_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 2));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return { fn: invoke.functionName().toString(), args: invoke.args() };
}

const entry = (k: string, v: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });

describe('TradingRouterContract extras', () => {
    const router = new TradingRouterContract(ROUTER_ID);

    it('multicallTry builds multicall_try with the call vec', () => {
        const call = TradingRouterContract.buildCall(TRADING, 'get_status', []);
        const { fn, args } = decodeInvoke(router.multicallTry([call]));
        expect(fn).toBe('multicall_try');
        expect(args[0].vec()!.length).toBe(1);
    });

    it('parses multicall, multicallTry, and the create-and-fill results', () => {
        const p = TradingRouterContract.parsers;

        const rawVec = xdr.ScVal.scvVec([nativeToScVal(1n, { type: 'i128' })]).toXDR('base64');
        expect(p.multicall(rawVec)).toEqual([1n]);

        const outcome = xdr.ScVal.scvMap([
            entry('error', xdr.ScVal.scvU32(0)),
            entry('ok', xdr.ScVal.scvBool(true)),
            entry('value', nativeToScVal(7n, { type: 'i128' })),
        ]);
        const outcomes = xdr.ScVal.scvVec([outcome]).toXDR('base64');
        expect(p.multicallTry(outcomes)).toEqual([{ ok: true, value: 7n, error: 0 }]);

        expect(p.createAndFill(nativeToScVal(9n, { type: 'i128' }).toXDR('base64'))).toBe(9n);
        expect(p.createAndFillWithFee(nativeToScVal(9n, { type: 'i128' }).toXDR('base64'))).toBe(9n);

        const attempt = xdr.ScVal.scvMap([
            entry('error', xdr.ScVal.scvU32(0)),
            entry('filled', xdr.ScVal.scvBool(true)),
            entry('id', xdr.ScVal.scvU32(3)),
            entry('payout', nativeToScVal(5n, { type: 'i128' })),
        ]).toXDR('base64');
        expect(p.createAndTryFill(attempt)).toEqual({ id: 3, filled: true, payout: 5n, error: 0 });
        expect(p.createAndTryFillWithFee(attempt)).toEqual({ id: 3, filled: true, payout: 5n, error: 0 });
    });
});

describe('FactoryContract extras', () => {
    it('parses deployMarket and isDeployed results', () => {
        const p = FactoryContract.parsers;
        const addr = new Address(TRADING).toScVal();
        expect(p.deployMarket(addr.toXDR('base64'))).toBe(TRADING);
        expect(p.isDeployed(xdr.ScVal.scvBool(true).toXDR('base64'))).toBe(true);
    });

    it('deploy accepts Uint8Array init hashes and string wasm hashes', () => {
        const admin = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
        const op = FactoryContract.deploy(admin, Buffer.alloc(32, 9).toString('hex'), {
            init_meta: {
                trading_hash: new Uint8Array(32),
                treasury: StrKey.encodeContract(Buffer.alloc(32, 4)),
                vault_hash: new Uint8Array(32),
            },
        });
        const create = xdr.Operation.fromXDR(op, 'base64').body()
            .invokeHostFunctionOp().hostFunction().createContractV2();
        const initMeta = scValToNative(create.constructorArgs()[0]);
        expect(Buffer.from(initMeta.trading_hash)).toEqual(Buffer.alloc(32));
    });
});
