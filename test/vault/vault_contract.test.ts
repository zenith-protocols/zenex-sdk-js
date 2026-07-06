import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import { VaultContract, VaultConstructorArgs } from '../../src/vault/vault_contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const RECEIVER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const OPERATOR = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const ASSET = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const STRATEGY = StrKey.encodeContract(Buffer.alloc(32, 6));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

describe('VaultContract', () => {
    const contract = new VaultContract(CONTRACT_ID);

    it('deposit includes the operator arg', () => {
        const op = contract.deposit(1000n, RECEIVER, USER, OPERATOR);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('deposit');
        expect(args).toEqual([1000n, RECEIVER, USER, OPERATOR]);
    });

    it('mint includes the operator arg', () => {
        const op = contract.mint(1000n, RECEIVER, USER, OPERATOR);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('mint');
        expect(args).toEqual([1000n, RECEIVER, USER, OPERATOR]);
    });

    it('withdraw includes the operator arg', () => {
        const op = contract.withdraw(400n, RECEIVER, USER, OPERATOR);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('withdraw');
        expect(args).toEqual([400n, RECEIVER, USER, OPERATOR]);
    });

    it('redeem includes the operator arg', () => {
        const op = contract.redeem(400n, RECEIVER, USER, OPERATOR);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('redeem');
        expect(args).toEqual([400n, RECEIVER, USER, OPERATOR]);
    });

    it('strategyWithdraw calls fn strategy_withdraw with strategy + amount', () => {
        const op = contract.strategyWithdraw(STRATEGY, 2000n);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('strategy_withdraw');
        expect(args).toEqual([STRATEGY, 2000n]);
    });

    it('static deploy builds __constructor with 5 args, no lock_time or min_deposit', () => {
        const args: VaultConstructorArgs = {
            name: 'Vault Shares',
            symbol: 'vTKN',
            asset: ASSET,
            decimals_offset: 0,
            strategy: STRATEGY,
        };
        const op = VaultContract.deploy(USER, Buffer.alloc(32, 9), args, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const ctorArgs = createContract.constructorArgs();
        expect(ctorArgs).toHaveLength(5);
        const native = ctorArgs.map((a) => scValToNative(a));
        expect(native).toEqual(['Vault Shares', 'vTKN', ASSET, 0, STRATEGY]);
    });

    it('has no lockTime or availableShares methods (removed; locking now lives on trading Config)', () => {
        expect((contract as unknown as Record<string, unknown>).lockTime).toBeUndefined();
        expect((contract as unknown as Record<string, unknown>).availableShares).toBeUndefined();
    });
});
