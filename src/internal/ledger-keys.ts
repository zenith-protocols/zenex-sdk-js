import { Address, xdr } from '@stellar/stellar-sdk';
import { Asset } from '../types/asset.js';

/**
 * Create a storage key for an enum variant without associated data.
 * E.g., StorageKey::TotalSupply or VaultStorageKey::AssetAddress
 * @param variant - The enum variant name
 * @returns ScVal representing the enum key
 */
export function enumStorageKey(variant: string): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
}

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
    let key: string | undefined;
    switch (entryKey.switch()) {
        case xdr.ScValType.scvVec():
            const vec = entryKey.vec();
            if (!vec || !vec.at(0)) {
                throw Error('Invalid ledger entry key: vec or its first element is null or undefined');
            }
            key = vec.at(0)!.sym().toString();
            break;
        case xdr.ScValType.scvSymbol():
            key = entryKey.sym().toString();
            break;
        case xdr.ScValType.scvLedgerKeyContractInstance():
            key = 'ContractInstance';
            break;
        default:
            throw Error(`Invalid ledger entry key type: should not contain type ${entryKey.switch()}`);
    }
    return key;
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

/**
 * Convert an Asset type to ScVal for use in ledger keys.
 * @param asset - The asset to convert.
 * @returns The ScVal representation of the asset.
 */
export function assetToScVal(asset: Asset): xdr.ScVal {
    if (asset.tag === 'Stellar') {
        const address = asset.values[0] instanceof Address
            ? asset.values[0]
            : Address.fromString(asset.values[0]);

        return xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Stellar'),
            address.toScVal()
        ]);
    } else if (asset.tag === 'Other') {
        return xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Other'),
            xdr.ScVal.scvSymbol(asset.values[0])
        ]);
    }

    throw new Error('Invalid asset type');
}
