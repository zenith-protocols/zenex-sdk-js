import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Create a storage key for an enum variant with an Address.
 * E.g., StorageKey::Balance(Address) or DataKey::ClaimableFunding(Address)
 * @param variant - The enum variant name
 * @param address - The address value
 * @returns ScVal representing the enum key with address
 */
export function enumStorageKeyWithAddress(variant: string, address: string | Address): xdr.ScVal {
    const addr = typeof address === 'string' ? Address.fromString(address) : address;
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), addr.toScVal()]);
}

/**
 * Decode a ledger entry key ScVal into its `DataKey` variant name, or
 * `'ContractInstance'` for the contract-instance key. Throws if `entryKey` is
 * not a symbol, a vec led by a symbol, or the contract-instance key.
 * @param entryKey - The `key` ScVal from a `LedgerKeyContractData`.
 * @returns The variant name.
 */
export function decodeEntryKey(entryKey: xdr.ScVal): string {
    switch (entryKey.switch()) {
        case xdr.ScValType.scvVec():
            const vec = entryKey.vec();
            if (!vec || !vec.at(0)) {
                throw Error('Invalid ledger entry key: vec or its first element is null or undefined');
            }
            return vec.at(0)!.sym().toString();
        case xdr.ScValType.scvSymbol():
            return entryKey.sym().toString();
        case xdr.ScValType.scvLedgerKeyContractInstance():
            return 'ContractInstance';
        default:
            throw Error(`Invalid ledger entry key type: should not contain type ${entryKey.switch()}`);
    }
}

/**
 * Build the ledger key for a contract's instance storage: its shared config
 * and small singleton state. Instance entries use persistent durability, so
 * they can be archived past their TTL. Restore the entry before you read it
 * again.
 * @param contractId - The contract address.
 * @returns The ledger key for the contract instance.
 */
export function contractInstanceLedgerKey(contractId: string): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent(),
        })
    );
}

/**
 * Build the ledger key for an entry in a contract's persistent storage: data
 * that outlives the contract instance, keyed by `keyVec`. A persistent entry
 * can be archived once its TTL lapses. Restore it before you read it again.
 * @param contractId - The contract address.
 * @param keyVec - The ScVal items that make up the storage key.
 * @returns The ledger key for the persistent storage entry.
 */
export function persistentLedgerKey(contractId: string, keyVec: xdr.ScVal[]): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: xdr.ScVal.scvVec(keyVec),
            durability: xdr.ContractDataDurability.persistent(),
        })
    );
}

/**
 * Build the ledger key for an entry in a contract's temporary storage, keyed
 * by `keyVec`. A temporary entry is deleted once its TTL lapses and cannot be
 * restored. The contract must write it again.
 * @param contractId - The contract address.
 * @param keyVec - The ScVal items that make up the storage key.
 * @returns The ledger key for the temporary storage entry.
 */
export function temporaryLedgerKey(contractId: string, keyVec: xdr.ScVal[]): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: xdr.ScVal.scvVec(keyVec),
            durability: xdr.ContractDataDurability.temporary(),
        })
    );
}
