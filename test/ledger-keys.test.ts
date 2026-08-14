import { describe, it, expect } from 'vitest';
import { Address, xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import {
    contractInstanceLedgerKey,
    decodeEntryKey,
    enumStorageKeyWithAddress,
    temporaryLedgerKey,
    tokenBalanceLedgerKey,
    tradingConfigKey,
    tradingFeedIdKey,
    tradingStatusKey,
    tradingVaultKey,
    tradingTokenKey,
    tradingOracleKey,
    tradingTreasuryKey,
    tradingDelistedAtKey,
    tradingTerminalPriceKey,
    tradingAdlKey,
    tradingMarketDataLedgerKey,
    tradingPriceCacheLedgerKey,
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

// soroban-sdk encodes a zero-field enum variant as a one-element Vec holding
// the variant's Symbol (verified in soroban-sdk-macros derive_enum.rs: the
// unit-variant into_xdr wraps the Symbol in a single-element tuple).
function unitVariantScVal(variantName: string): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variantName)]);
}

describe('ledger-keys: trading DataKey mirror (trading/src/storage.rs)', () => {
    it('instance-tier unit variants (Config/FeedId/Status/Vault/Token/Oracle/Treasury/DelistedAt/TerminalPrice/Adl) encode as [Symbol(name)]', () => {
        expect(decodeKeyVec(tradingConfigKey())).toEqual(['Config']);
        expect(decodeKeyVec(tradingFeedIdKey())).toEqual(['FeedId']);
        expect(decodeKeyVec(tradingStatusKey())).toEqual(['Status']);
        expect(decodeKeyVec(tradingVaultKey())).toEqual(['Vault']);
        expect(decodeKeyVec(tradingTokenKey())).toEqual(['Token']);
        expect(decodeKeyVec(tradingOracleKey())).toEqual(['Oracle']);
        expect(decodeKeyVec(tradingTreasuryKey())).toEqual(['Treasury']);
        expect(decodeKeyVec(tradingDelistedAtKey())).toEqual(['DelistedAt']);
        expect(decodeKeyVec(tradingTerminalPriceKey())).toEqual(['TerminalPrice']);
        expect(decodeKeyVec(tradingAdlKey())).toEqual(['Adl']);
    });

    it('MarketData (persistent, shared singleton) builds [Symbol("MarketData")]', () => {
        const marketDataKey = tradingMarketDataLedgerKey(CONTRACT_ID);
        expect(marketDataKey.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(marketDataKey.contractData().key())).toEqual(['MarketData']);
    });

    it('PriceCache (price cache) is the TEMPORARY tier and builds [Symbol("PriceCache")]', () => {
        const priceCacheKey = tradingPriceCacheLedgerKey(CONTRACT_ID);
        expect(priceCacheKey.contractData().durability().name).toBe('temporary');
        expect(decodeKeyVec(priceCacheKey.contractData().key())).toEqual(['PriceCache']);
        const contractAddress = Address.fromScAddress(priceCacheKey.contractData().contract()).toString();
        expect(contractAddress).toBe(CONTRACT_ID);
    });

    it('Position(user, is_long) builds [Symbol("Position"), user, bool] for both sides', () => {
        const longPositionKey = tradingPositionLedgerKey(CONTRACT_ID, USER, true);
        expect(longPositionKey.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(longPositionKey.contractData().key())).toEqual(['Position', USER, true]);

        const shortPositionKey = tradingPositionLedgerKey(CONTRACT_ID, USER, false);
        expect(decodeKeyVec(shortPositionKey.contractData().key())).toEqual(['Position', USER, false]);
    });

    it('VaultOrder(user, id) builds [Symbol("VaultOrder"), user, u32]', () => {
        const vaultOrderKey = tradingVaultOrderLedgerKey(CONTRACT_ID, USER, 3);
        expect(vaultOrderKey.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(vaultOrderKey.contractData().key())).toEqual(['VaultOrder', USER, 3]);
    });

    it('Order(user, id) is the PERSISTENT user tier (escrow-carrying keeper orders)', () => {
        const orderKey = tradingOrderLedgerKey(CONTRACT_ID, USER, 7);
        expect(orderKey.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(orderKey.contractData().key())).toEqual(['Order', USER, 7]);
    });

    it('OrderCounter(user) builds [Symbol("OrderCounter"), user]', () => {
        const orderCounterKey = tradingOrderCounterLedgerKey(CONTRACT_ID, USER);
        expect(orderCounterKey.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(orderCounterKey.contractData().key())).toEqual(['OrderCounter', USER]);
    });

    it('ClaimableFunding(user) builds [Symbol("ClaimableFunding"), user]', () => {
        const claimableFundingKey = tradingClaimableFundingLedgerKey(CONTRACT_ID, USER);
        expect(claimableFundingKey.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(claimableFundingKey.contractData().key())).toEqual(['ClaimableFunding', USER]);
    });

    it('persistent keys target the requested contract', () => {
        const orderKey = tradingOrderLedgerKey(CONTRACT_ID, USER, 1);
        const contractAddress = Address.fromScAddress(orderKey.contractData().contract()).toString();
        expect(contractAddress).toBe(CONTRACT_ID);
    });

    it('accepts an Address object as the user argument', () => {
        const positionKey = tradingPositionLedgerKey(CONTRACT_ID, Address.fromString(USER), true);
        expect(decodeKeyVec(positionKey.contractData().key())).toEqual(['Position', USER, true]);
    });
});

describe('ledger-keys: generic helpers', () => {
    it('temporaryLedgerKey builds a contractData key with temporary durability', () => {
        const key = temporaryLedgerKey(CONTRACT_ID, [xdr.ScVal.scvSymbol('Ephemeral')]);
        expect(key.contractData().durability().name).toBe('temporary');
        expect(decodeKeyVec(key.contractData().key())).toEqual(['Ephemeral']);
    });

    it('contractInstanceLedgerKey builds the persistent instance key', () => {
        const instanceKey = contractInstanceLedgerKey(CONTRACT_ID);
        expect(instanceKey.contractData().durability().name).toBe('persistent');
        expect(instanceKey.contractData().key().switch()).toBe(
            xdr.ScValType.scvLedgerKeyContractInstance()
        );
    });

    it('enumStorageKeyWithAddress builds [Symbol(variant), address]', () => {
        const balanceKey = enumStorageKeyWithAddress('Balance', USER);
        expect(decodeKeyVec(balanceKey)).toEqual(['Balance', USER]);
    });

    it('tokenBalanceLedgerKey matches OZ FungibleStorageKey::Balance(Address), persistent', () => {
        const balanceLedgerKey = tokenBalanceLedgerKey(CONTRACT_ID, USER);
        expect(balanceLedgerKey.contractData().durability().name).toBe('persistent');
        expect(decodeKeyVec(balanceLedgerKey.contractData().key())).toEqual(['Balance', USER]);
    });
});

describe('ledger-keys: vault instance keys (decodeEntryKey vs OZ storage enums)', () => {
    // The vault's instance storage carries four OZ unit-variant keys the
    // instance walker matches by name (vault_instance.ts), plus the vault's
    // own StrategyStorageKey::Strategy.
    it('decodes the OZ VaultStorageKey unit variants', () => {
        expect(decodeEntryKey(unitVariantScVal('AssetAddress'))).toBe('AssetAddress');
        expect(decodeEntryKey(unitVariantScVal('VirtualDecimalsOffset'))).toBe('VirtualDecimalsOffset');
    });

    it('decodes the OZ FungibleStorageKey unit variants', () => {
        expect(decodeEntryKey(unitVariantScVal('Meta'))).toBe('Meta');
        expect(decodeEntryKey(unitVariantScVal('TotalSupply'))).toBe('TotalSupply');
    });

    it('decodes StrategyStorageKey::Strategy', () => {
        expect(decodeEntryKey(unitVariantScVal('Strategy'))).toBe('Strategy');
    });

    it('decodes a data-carrying variant to its leading symbol', () => {
        const balanceKey = enumStorageKeyWithAddress('Balance', USER);
        expect(decodeEntryKey(balanceKey)).toBe('Balance');
    });

    it('decodes a bare symbol key', () => {
        expect(decodeEntryKey(xdr.ScVal.scvSymbol('Meta'))).toBe('Meta');
    });

    it('decodes the contract-instance key marker', () => {
        expect(decodeEntryKey(xdr.ScVal.scvLedgerKeyContractInstance())).toBe('ContractInstance');
    });

    it('throws on an empty vec and on non-key ScVal types', () => {
        expect(() => decodeEntryKey(xdr.ScVal.scvVec([]))).toThrow();
        expect(() => decodeEntryKey(xdr.ScVal.scvU32(7))).toThrow();
    });
});
