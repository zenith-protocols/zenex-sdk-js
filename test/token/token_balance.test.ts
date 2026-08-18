import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, StrKey } from '@stellar/stellar-sdk';
import {
    parseTokenBalance,
    tokenBalanceOrZero,
    tokenBalanceLedgerKey,
} from '../../src/contracts/token/index.js';
import { balanceMapScVal } from '../helpers/trading_state.js';

describe('parseTokenBalance', () => {
    it('reads the SAC map amount', () => {
        expect(parseTokenBalance(balanceMapScVal(500_000n))).toBe(500_000n);
    });

    it('reads a direct i128 balance', () => {
        expect(
            parseTokenBalance(nativeToScVal(3_000_000_000n, { type: 'i128' })),
        ).toBe(3_000_000_000n);
    });

    it('reads a SAC map without an amount field as 0', () => {
        const noAmount = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('authorized'), val: xdr.ScVal.scvBool(true) }),
        ]);
        expect(parseTokenBalance(noAmount)).toBe(0n);
    });
});

describe('tokenBalanceOrZero', () => {
    it('reads an uncredited holder as zero rather than throwing', () => {
        expect(tokenBalanceOrZero(undefined)).toBe(0n);
        expect(tokenBalanceOrZero(balanceMapScVal(7n))).toBe(7n);
    });
});

describe('tokenBalanceLedgerKey', () => {
    it('is holder-agnostic: a vault and a wallet key differ only by holder', () => {
        const token = StrKey.encodeContract(Buffer.alloc(32, 3));
        const vault = StrKey.encodeContract(Buffer.alloc(32, 2));
        const wallet = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
        const forVault = tokenBalanceLedgerKey(token, vault).toXDR('base64');
        const forWallet = tokenBalanceLedgerKey(token, wallet).toXDR('base64');
        expect(forVault).not.toBe(forWallet);
        // Same token contract on both.
        expect(tokenBalanceLedgerKey(token, vault).contractData().contract().toXDR('base64'))
            .toBe(tokenBalanceLedgerKey(token, wallet).contractData().contract().toXDR('base64'));
    });
});
