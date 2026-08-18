import { describe, it, expect } from 'vitest';
import { StrKey, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { parseVaultInstance } from '../../src/contracts/vault/vault_instance.js';
import {
    vaultInstanceScVal,
    balanceMapScVal,
    contractInstance,
    unitKey,
} from '../helpers/trading_state.js';

const ASSET = StrKey.encodeContract(Buffer.alloc(32, 3));
const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));

describe('parseVaultInstance', () => {
    it('walks asset, atomic supply, offset, share/asset decimals, and Strategy', () => {
        const instance = parseVaultInstance(
            vaultInstanceScVal({
                asset: ASSET,
                strategy: MARKET,
                totalSupply: 10_000_000_00n,
                decimalsOffset: 1,
                shareDecimals: 8,
            }),
        );
        expect(instance.asset).toBe(ASSET);
        expect(instance.strategy).toBe(MARKET);
        // EXACT atomic supply is retained (no lossy float downcast).
        expect(instance.totalSharesAtomic).toBe(10_000_000_00n);
        expect(instance.decimalsOffset).toBe(1);
        expect(instance.shareDecimals).toBe(8);
        // assetDecimals = shareDecimals - offset
        expect(instance.assetDecimals).toBe(7);
    });

    it('leaves strategy undefined when the Strategy key is absent', () => {
        const instance = parseVaultInstance(vaultInstanceScVal({ asset: ASSET }));
        expect(instance.strategy).toBeUndefined();
    });

    it('throws when asset address or share metadata is missing', () => {
        const noAsset = contractInstance([
            new xdr.ScMapEntry({ key: unitKey('TotalSupply'), val: nativeToScVal(1n, { type: 'i128' }) }),
        ]);
        expect(() => parseVaultInstance(noAsset)).toThrow(/missing AssetAddress|asset address/);
    });

    it('rejects a non-instance value', () => {
        expect(() => parseVaultInstance(xdr.ScVal.scvU32(1))).toThrow(
            /contract-instance/,
        );
    });
});
