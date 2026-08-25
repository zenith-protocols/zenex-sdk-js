import { describe, it, expect } from 'vitest';
import { Address, StrKey, contract, xdr } from '@stellar/stellar-sdk';
import { contractInstanceLedgerKey } from '../../src/contracts/keys.js';
import {
    marketDataLedgerKey,
    marketPriceCacheLedgerKey,
    marketPositionLedgerKey,
    marketVaultOrderLedgerKey,
    marketOrderCounterLedgerKey,
    marketClaimableCreditLedgerKey,
    marketOrderLedgerKey,
} from '../../src/contracts/market/keys.js';
import { tokenBalanceLedgerKey } from '../../src/token.js';

// =============================================================================
// Golden ledger-key encoding tests.
//
// `getLedgerEntries` silently omits missing keys, so a wrong key byte silently
// reads as "no position" / "no balance" on the money path. These tests lock
// every hand-built ledger key to an INDEPENDENT encoder: `@stellar/stellar-sdk`'s
// own spec-driven `contract.Spec.nativeToScVal`, driven by a reconstructed
// `DataKey` / token `Balance` union spec that mirrors the contract's
// `#[contracttype]` storage enums (market/src/storage.rs::DataKey and the OZ
// `Balance(Address)` slot).
//
// This is the JS analogue of zenex-sdk-rs entries.rs
// `key_builders_byte_match_the_soroban_datakey_encoding`, which byte-compares
// against soroban-sdk's own `IntoVal` encoder. Here the spec encoder walks a
// different code path from `ledger-keys.ts`'s hand-rolled `scvVec([scvSymbol,
// ...])`, so a match is a genuine cross-check rather than a tautology.
// =============================================================================

const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const ASSET = StrKey.encodeContract(Buffer.alloc(32, 3));
const ACCOUNT_USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const CONTRACT_USER = StrKey.encodeContract(Buffer.alloc(32, 9));

const ADDRESS = xdr.ScSpecTypeDef.scSpecTypeAddress();
const BOOL = xdr.ScSpecTypeDef.scSpecTypeBool();
const U32 = xdr.ScSpecTypeDef.scSpecTypeU32();

function voidCase(name: string): xdr.ScSpecUdtUnionCaseV0 {
    return xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
        new xdr.ScSpecUdtUnionCaseVoidV0({ doc: '', name }),
    );
}

function tupleCase(
    name: string,
    type: xdr.ScSpecTypeDef[],
): xdr.ScSpecUdtUnionCaseV0 {
    return xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseTupleV0(
        new xdr.ScSpecUdtUnionCaseTupleV0({ doc: '', name, type }),
    );
}

function unionSpec(
    name: string,
    cases: xdr.ScSpecUdtUnionCaseV0[],
): { spec: contract.Spec; ty: xdr.ScSpecTypeDef } {
    const entry = xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
        new xdr.ScSpecUdtUnionV0({ doc: '', lib: '', name, cases }),
    );
    return {
        spec: new contract.Spec([entry]),
        ty: xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name })),
    };
}

// Mirror of market/src/storage.rs::DataKey (only the variants ledger-keys.ts
// builds; the exact variant set and field types are what the encoding depends
// on, not the struct/enum names).
const dataKey = unionSpec('DataKey', [
    voidCase('Config'),
    voidCase('FeedId'),
    voidCase('Status'),
    voidCase('Vault'),
    voidCase('Token'),
    voidCase('Oracle'),
    voidCase('Treasury'),
    voidCase('DelistedAt'),
    voidCase('TerminalPrice'),
    voidCase('Adl'),
    voidCase('MarketData'),
    voidCase('PriceCache'),
    tupleCase('Position', [ADDRESS, BOOL]),
    tupleCase('VaultOrder', [ADDRESS, U32]),
    tupleCase('Order', [ADDRESS, U32]),
    tupleCase('OrderCounter', [ADDRESS]),
    tupleCase('ClaimableCredit', [ADDRESS]),
]);

// The OZ fungible-token `Balance(Address)` persistent slot.
const tokenKey = unionSpec('TokenStorageKey', [tupleCase('Balance', [ADDRESS])]);

function specScVal(
    built: { spec: contract.Spec; ty: xdr.ScSpecTypeDef },
    tag: string,
    values?: unknown[],
): xdr.ScVal {
    return built.spec.nativeToScVal({ tag, values }, built.ty);
}

function expectedContractDataKey(
    contractId: string,
    keyScVal: xdr.ScVal,
): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: keyScVal,
            durability: xdr.ContractDataDurability.persistent(),
        }),
    );
}

const b64 = (v: { toXDR(f: 'base64'): string }): string => v.toXDR('base64');

describe('golden ledger-key encoding vs @stellar/stellar-sdk spec encoder', () => {
    it('MarketData persistent key matches the spec encoder', () => {
        expect(b64(marketDataLedgerKey(MARKET))).toBe(
            b64(expectedContractDataKey(MARKET, specScVal(dataKey, 'MarketData'))),
        );
    });

    it('PriceCache temporary key matches the spec encoder', () => {
        const expected = xdr.LedgerKey.contractData(
            new xdr.LedgerKeyContractData({
                contract: Address.fromString(MARKET).toScAddress(),
                key: specScVal(dataKey, 'PriceCache'),
                durability: xdr.ContractDataDurability.temporary(),
            }),
        );
        expect(b64(marketPriceCacheLedgerKey(MARKET))).toBe(b64(expected));
    });

    it('Position key matches for both sides and account/contract users', () => {
        const cases: [string, boolean, xdr.LedgerKey][] = [
            [ACCOUNT_USER, true, marketPositionLedgerKey(MARKET, ACCOUNT_USER, true)],
            [ACCOUNT_USER, false, marketPositionLedgerKey(MARKET, ACCOUNT_USER, false)],
            [CONTRACT_USER, true, marketPositionLedgerKey(MARKET, CONTRACT_USER, true)],
            [CONTRACT_USER, false, marketPositionLedgerKey(MARKET, CONTRACT_USER, false)],
        ];
        for (const [user, isLong, built] of cases) {
            expect(b64(built), `Position(${user}, ${isLong})`).toBe(
                b64(
                    expectedContractDataKey(
                        MARKET,
                        specScVal(dataKey, 'Position', [user, isLong]),
                    ),
                ),
            );
        }
    });

    it('Order / VaultOrder (user, id) keys match the spec encoder', () => {
        expect(b64(marketOrderLedgerKey(MARKET, ACCOUNT_USER, 7))).toBe(
            b64(
                expectedContractDataKey(
                    MARKET,
                    specScVal(dataKey, 'Order', [ACCOUNT_USER, 7]),
                ),
            ),
        );
        expect(b64(marketVaultOrderLedgerKey(MARKET, ACCOUNT_USER, 9))).toBe(
            b64(
                expectedContractDataKey(
                    MARKET,
                    specScVal(dataKey, 'VaultOrder', [ACCOUNT_USER, 9]),
                ),
            ),
        );
    });

    it('OrderCounter / ClaimableCredit (user) keys match the spec encoder', () => {
        expect(b64(marketOrderCounterLedgerKey(MARKET, ACCOUNT_USER))).toBe(
            b64(
                expectedContractDataKey(
                    MARKET,
                    specScVal(dataKey, 'OrderCounter', [ACCOUNT_USER]),
                ),
            ),
        );
        expect(b64(marketClaimableCreditLedgerKey(MARKET, ACCOUNT_USER))).toBe(
            b64(
                expectedContractDataKey(
                    MARKET,
                    specScVal(dataKey, 'ClaimableCredit', [ACCOUNT_USER]),
                ),
            ),
        );
    });

    it('token Balance(vault) persistent key matches the spec encoder', () => {
        expect(b64(tokenBalanceLedgerKey(ASSET, VAULT))).toBe(
            b64(
                expectedContractDataKey(
                    ASSET,
                    specScVal(tokenKey, 'Balance', [VAULT]),
                ),
            ),
        );
    });

    it('contract-instance keys carry the LedgerKeyContractInstance marker', () => {
        for (const id of [MARKET, VAULT, ASSET]) {
            const key = contractInstanceLedgerKey(id);
            expect(key.contractData().durability().name).toBe('persistent');
            expect(key.contractData().key().switch()).toBe(
                xdr.ScValType.scvLedgerKeyContractInstance(),
            );
            expect(
                Address.fromScAddress(key.contractData().contract()).toString(),
            ).toBe(id);
        }
    });
});
