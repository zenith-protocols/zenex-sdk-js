import { Address, xdr } from '@stellar/stellar-sdk';

export function decodeEntryKey(entryKey: xdr.ScVal): string {
    let key: string | undefined;
    switch (entryKey.switch()) {
        // Key is a ScVec[ScvSym, ScVal]
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