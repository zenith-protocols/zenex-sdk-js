import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Create a storage key for an enum variant with an Address.
 * E.g., StorageKey::Balance(Address) or StrategyStorageKey::LastDepositTime(Address)
 * @param variant - The enum variant name
 * @param address - The address value
 * @returns ScVal representing the enum key with address
 */
export function enumStorageKeyWithAddress(variant: string, address: string | Address): xdr.ScVal {
    const addr = typeof address === 'string' ? Address.fromString(address) : address;
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), addr.toScVal()]);
}

/**
 * Create a ledger key for reading a token balance from persistent storage.
 * Uses StorageKey::Balance(Address) format from stellar_tokens.
 * @param tokenContractId - The token contract address
 * @param accountAddress - The account to get balance for
 * @returns Ledger key for the balance entry
 */
export function tokenBalanceLedgerKey(tokenContractId: string, accountAddress: string): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(tokenContractId).toScAddress(),
            key: enumStorageKeyWithAddress('Balance', accountAddress),
            durability: xdr.ContractDataDurability.persistent(),
        })
    );
}

/**
 * Decode entry key from ScVal
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
 * Create a ledger key for a contract instance.
 * This is used to access the contract's instance storage.
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
 * Create a ledger key for persistent contract storage.
 * This is used for data that persists beyond the contract instance.
 * @param contractId - The contract address.
 * @param keyVec - Array of ScVal items that make up the storage key.
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

