import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import { VaultContract, VaultConstructorArgs } from '../../src/contracts/vault/contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const DEPLOYER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const RECEIVER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const DEPOSITOR = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
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

describe('VaultContract strategy surface', () => {
    const contract = new VaultContract(CONTRACT_ID);

    it('strategyDeposit builds strategy_deposit(assets, receiver, from, net_pnl)', () => {
        const op = contract.strategyDeposit(1000n, RECEIVER, DEPOSITOR, -25n);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('strategy_deposit');
        expect(args).toEqual([1000n, RECEIVER, DEPOSITOR, -25n]);
    });

    it('strategyRedeem builds strategy_redeem(shares, receiver, owner, net_pnl)', () => {
        const op = contract.strategyRedeem(400n, RECEIVER, OWNER, 75n);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('strategy_redeem');
        expect(args).toEqual([400n, RECEIVER, OWNER, 75n]);
    });

    it('strategyWithdraw builds strategy_withdraw with the amount alone', () => {
        const op = contract.strategyWithdraw(2000n);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('strategy_withdraw');
        expect(args).toEqual([2000n]);
    });

    it('previewDeposit builds preview_deposit(assets, net_pnl)', () => {
        const op = contract.previewDeposit(500n, 40n);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('preview_deposit');
        expect(args).toEqual([500n, 40n]);
    });

    it('previewRedeem builds preview_redeem(shares, net_pnl)', () => {
        const op = contract.previewRedeem(300n, -10n);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('preview_redeem');
        expect(args).toEqual([300n, -10n]);
    });

    it('getStrategy builds get_strategy with no args', () => {
        const { fn, args } = decodeInvoke(contract.getStrategy());
        expect(fn).toBe('get_strategy');
        expect(args).toEqual([]);
    });

    it('static deploy builds __constructor with 5 args', () => {
        const args: VaultConstructorArgs = {
            name: 'Vault Shares',
            symbol: 'vTKN',
            asset: ASSET,
            decimals_offset: 0,
            strategy: STRATEGY,
        };
        const op = VaultContract.deploy(DEPLOYER, Buffer.alloc(32, 9), args, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const ctorArgs = createContract.constructorArgs();
        expect(ctorArgs).toHaveLength(5);
        const native = ctorArgs.map((a) => scValToNative(a));
        expect(native).toEqual(['Vault Shares', 'vTKN', ASSET, 0, STRATEGY]);
    });

    it('has none of the removed ERC-4626 methods; LP flows route through trading vault orders', () => {
        const surface = contract as unknown as Record<string, unknown>;
        const removedMethods = [
            'deposit', 'mint', 'withdraw', 'redeem',
            'maxDeposit', 'maxMint', 'maxWithdraw', 'maxRedeem',
            'previewMint', 'previewWithdraw',
            'convertToShares', 'convertToAssets',
            'lockTime', 'availableShares',
        ];
        for (const method of removedMethods) {
            expect(surface[method], `method ${method} should be removed`).toBeUndefined();
        }
        const removedParsers = [
            'deposit', 'mint', 'withdraw', 'redeem',
            'maxDeposit', 'maxMint', 'maxWithdraw', 'maxRedeem',
            'previewMint', 'previewWithdraw',
            'convertToShares', 'convertToAssets',
        ];
        const parsers = VaultContract.parsers as unknown as Record<string, unknown>;
        for (const parser of removedParsers) {
            expect(parsers[parser], `parser ${parser} should be removed`).toBeUndefined();
        }
    });
});
