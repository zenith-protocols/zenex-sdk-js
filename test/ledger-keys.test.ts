import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import {
    temporaryLedgerKey,
    tradingConfigKey,
    tradingFeedIdKey,
    tradingExponentKey,
    tradingStatusKey,
    tradingVaultKey,
    tradingTokenKey,
    tradingPriceVerifierKey,
    tradingTreasuryKey,
    tradingDelistedAtKey,
    tradingTerminalPriceKey,
    tradingAdlKey,
    tradingMarketDataLedgerKey,
    tradingPositionLedgerKey,
    tradingVaultOrderLedgerKey,
    tradingOrderCounterLedgerKey,
    tradingClaimableFundingLedgerKey,
    tradingOrderLedgerKey,
} from '../src/ledger-keys.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));

function decodeKeyVec(scval: xdr.ScVal): unknown[] {
    return scValToNative(scval);
}

describe('ledger-keys: trading DataKey mirror (trading/src/storage.rs)', () => {
    it('temporaryLedgerKey builds a contractData key with temporary durability', () => {
        const key = temporaryLedgerKey(CONTRACT_ID, [xdr.ScVal.scvSymbol('Order')]);
        const cd = key.contractData();
        expect(cd.durability().name).toBe('temporary');
    });

    it('instance-tier unit variants (Config/FeedId/Exponent/Status/Vault/Token/PriceVerifier/Treasury/DelistedAt/TerminalPrice/Adl) encode as [Symbol(name)]', () => {
        expect(decodeKeyVec(tradingConfigKey())).toEqual(['Config']);
        expect(decodeKeyVec(tradingFeedIdKey())).toEqual(['FeedId']);
        expect(decodeKeyVec(tradingExponentKey())).toEqual(['Exponent']);
        expect(decodeKeyVec(tradingStatusKey())).toEqual(['Status']);
        expect(decodeKeyVec(tradingVaultKey())).toEqual(['Vault']);
        expect(decodeKeyVec(tradingTokenKey())).toEqual(['Token']);
        expect(decodeKeyVec(tradingPriceVerifierKey())).toEqual(['PriceVerifier']);
        expect(decodeKeyVec(tradingTreasuryKey())).toEqual(['Treasury']);
        expect(decodeKeyVec(tradingDelistedAtKey())).toEqual(['DelistedAt']);
        expect(decodeKeyVec(tradingTerminalPriceKey())).toEqual(['TerminalPrice']);
        expect(decodeKeyVec(tradingAdlKey())).toEqual(['Adl']);
    });

    it('MarketData (persistent, shared singleton) builds [Symbol("MarketData")]', () => {
        const key = tradingMarketDataLedgerKey(CONTRACT_ID);
        expect(key.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(key.contractData().key())).toEqual(['MarketData']);
    });

    it('Position(user, is_long) builds [Symbol("Position"), user, bool]', () => {
        const key = tradingPositionLedgerKey(CONTRACT_ID, USER, true);
        expect(key.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(key.contractData().key())).toEqual(['Position', USER, true]);
    });

    it('VaultOrder(user, id) builds [Symbol("VaultOrder"), user, u32]', () => {
        const key = tradingVaultOrderLedgerKey(CONTRACT_ID, USER, 3);
        expect(key.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(key.contractData().key())).toEqual(['VaultOrder', USER, 3]);
    });

    it('OrderCounter(user) builds [Symbol("OrderCounter"), user]', () => {
        const key = tradingOrderCounterLedgerKey(CONTRACT_ID, USER);
        expect(key.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(key.contractData().key())).toEqual(['OrderCounter', USER]);
    });

    it('ClaimableFunding(user) builds [Symbol("ClaimableFunding"), user]', () => {
        const key = tradingClaimableFundingLedgerKey(CONTRACT_ID, USER);
        expect(key.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(key.contractData().key())).toEqual(['ClaimableFunding', USER]);
    });

    it('Order(user, id) is TEMPORARY tier (auto-GC), not persistent', () => {
        const key = tradingOrderLedgerKey(CONTRACT_ID, USER, 7);
        expect(key.contractData().durability().name).toBe('temporary');
        expect(decodeKeyVec(key.contractData().key())).toEqual(['Order', USER, 7]);
    });
});
