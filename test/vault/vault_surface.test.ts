import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { VaultContract } from '../../src/contracts/vault/vault_contract.js';
import { decodeVaultEvent, VaultEventType } from '../../src/contracts/vault/vault_events.js';
import { NormalizedEvent } from '../../src/base_event.js';
import { contractInstanceLedgerKey, tokenBalanceLedgerKey } from '../../src/ledger-keys.js';
import {
    vaultInstanceScVal,
    balanceMapScVal,
    ledgerEntryFor,
} from '../helpers/trading_state.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const SPENDER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const RECEIVER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const ASSET = StrKey.encodeContract(Buffer.alloc(32, 5));
const STRATEGY = StrKey.encodeContract(Buffer.alloc(32, 6));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

const i128Res = (v: bigint) => nativeToScVal(v, { type: 'i128' }).toXDR('base64');

describe('VaultContract surface', () => {
    const vault = new VaultContract(CONTRACT_ID);

    it('deploy builds the constructor op', () => {
        const op = VaultContract.deploy(OWNER, Buffer.alloc(32, 9), {
            name: 'Zenex Vault', symbol: 'zXLM', asset: ASSET, decimals_offset: 2, strategy: STRATEGY,
        });
        const create = xdr.Operation.fromXDR(op, 'base64').body()
            .invokeHostFunctionOp().hostFunction().createContractV2();
        expect(create.constructorArgs().length).toBe(5);
        expect(scValToNative(create.constructorArgs()[0])).toBe('Zenex Vault');
        expect(scValToNative(create.constructorArgs()[2])).toBe(ASSET);
        expect(scValToNative(create.constructorArgs()[4])).toBe(STRATEGY);
    });

    it('builds share-token ops (string and Address arg forms)', () => {
        expect(decodeInvoke(vault.totalSupply()).fn).toBe('total_supply');
        expect(decodeInvoke(vault.balance(OWNER)).args).toEqual([OWNER]);
        expect(decodeInvoke(vault.balance(Address.fromString(OWNER))).args).toEqual([OWNER]);
        expect(decodeInvoke(vault.allowance(OWNER, SPENDER)).args).toEqual([OWNER, SPENDER]);
        expect(decodeInvoke(vault.transfer(OWNER, RECEIVER, 5n)).args).toEqual([OWNER, RECEIVER, 5n]);
        expect(decodeInvoke(vault.transferFrom(SPENDER, OWNER, RECEIVER, 6n)).args)
            .toEqual([SPENDER, OWNER, RECEIVER, 6n]);
        expect(decodeInvoke(vault.approve(OWNER, SPENDER, 7n, 100)).args)
            .toEqual([OWNER, SPENDER, 7n, 100]);
        expect(decodeInvoke(vault.decimals()).fn).toBe('decimals');
        expect(decodeInvoke(vault.name()).fn).toBe('name');
        expect(decodeInvoke(vault.symbol()).fn).toBe('symbol');
    });

    it('builds the vault view and strategy ops (string and Address arg forms)', () => {
        expect(decodeInvoke(vault.queryAsset()).fn).toBe('query_asset');
        expect(decodeInvoke(vault.getStrategy()).fn).toBe('get_strategy');
        expect(decodeInvoke(vault.totalAssets()).fn).toBe('total_assets');
        expect(decodeInvoke(vault.previewDeposit(3n, -1n)).args).toEqual([3n, -1n]);
        expect(decodeInvoke(vault.previewRedeem(9n, 2n)).args).toEqual([9n, 2n]);
        expect(decodeInvoke(vault.strategyDeposit(4n, RECEIVER, OWNER, 1n)).args)
            .toEqual([4n, RECEIVER, OWNER, 1n]);
        expect(decodeInvoke(vault.strategyDeposit(4n, Address.fromString(RECEIVER), Address.fromString(OWNER), 1n)).args)
            .toEqual([4n, RECEIVER, OWNER, 1n]);
        expect(decodeInvoke(vault.strategyRedeem(10n, RECEIVER, OWNER, -2n)).args)
            .toEqual([10n, RECEIVER, OWNER, -2n]);
        expect(decodeInvoke(vault.strategyWithdraw(11n)).args).toEqual([11n]);
    });

    it('parses results through the WASM spec', () => {
        const parsers = VaultContract.parsers;
        expect(parsers.totalSupply(i128Res(100n))).toBe(100n);
        expect(parsers.balance(i128Res(1n))).toBe(1n);
        expect(parsers.allowance(i128Res(2n))).toBe(2n);
        expect(parsers.decimals(xdr.ScVal.scvU32(7).toXDR('base64'))).toBe(7);
        expect(parsers.name(xdr.ScVal.scvString('Zenex Vault').toXDR('base64'))).toBe('Zenex Vault');
        expect(parsers.symbol(xdr.ScVal.scvString('zXLM').toXDR('base64'))).toBe('zXLM');
        expect(String(parsers.queryAsset(Address.fromString(ASSET).toScVal().toXDR('base64')))).toBe(ASSET);
        expect(String(parsers.getStrategy(Address.fromString(STRATEGY).toScVal().toXDR('base64')))).toBe(STRATEGY);
        expect(parsers.totalAssets(i128Res(3n))).toBe(3n);
        expect(parsers.previewDeposit(i128Res(7n))).toBe(7n);
        expect(parsers.previewRedeem(i128Res(16n))).toBe(16n);
        expect(parsers.strategyDeposit(i128Res(8n))).toBe(8n);
        expect(parsers.strategyRedeem(i128Res(17n))).toBe(17n);
        expect(parsers.strategyWithdraw()).toBeUndefined();
    });
});
