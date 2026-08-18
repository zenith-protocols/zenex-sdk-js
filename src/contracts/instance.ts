// =============================================================================
// Contract-instance storage: the shared walk every per-contract loader uses.
//
// A contract's instance storage is ONE ledger entry holding a map of every
// `DataKey` variant it keeps there, plus whatever the OpenZeppelin modules add
// (`Owner` from `stellar_access::ownable`). One `getLedgerEntries` key returns
// all of it, so the walkers are exhaustive on purpose: every value is already
// fetched and paid for, and decoding fewer of them discards what the caller has
// already bought.
//
// Keys the SDK has no field for are IGNORED rather than rejected. A contract
// upgrade that adds a storage key must not break every client reading the
// instance. (Blend throws in this position; that trade is wrong for a protocol
// whose contracts are upgradeable.)
// =============================================================================

import { Address, xdr } from '@stellar/stellar-sdk';
import { decodeEntryKey } from '../ledger-keys.js';

/**
 * Index a contract-instance value by storage-key name.
 *
 * Handles both key shapes a contract produces: a `#[contracttype]` enum variant
 * (`ScVec[Symbol]`) and a bare `Symbol` (which the treasury and factory use).
 *
 * @param instanceVal - The `.val()` of a `ContractDataEntry` whose key is
 *   `scvLedgerKeyContractInstance`.
 * @param label - Contract name, for the error message.
 * @throws If the value is not a contract instance.
 */
export function instanceStorage(
    instanceVal: xdr.ScVal,
    label: string,
): Map<string, xdr.ScVal> {
    if (instanceVal.switch() !== xdr.ScValType.scvContractInstance()) {
        throw new Error(`expected a ${label} contract-instance value`);
    }
    const entries = new Map<string, xdr.ScVal>();
    for (const item of instanceVal.instance().storage() ?? []) {
        let name: string;
        try {
            name = decodeEntryKey(item.key());
        } catch {
            // Not a key shape this SDK understands; ignore rather than fail the
            // whole read.
            continue;
        }
        entries.set(name, item.val());
    }
    return entries;
}

/**
 * The `Owner` slot written by `stellar_access::ownable`.
 *
 * `undefined` means ownership has been renounced, or the contract never had an
 * owner (the strategy vault and the router do not).
 */
export function instanceOwner(
    storage: Map<string, xdr.ScVal>,
): string | undefined {
    const value = storage.get('Owner');
    return value ? Address.fromScVal(value).toString() : undefined;
}

/** Read a key that must be present, with a message naming what was missing. */
export function requireKey(
    storage: Map<string, xdr.ScVal>,
    name: string,
    label: string,
): xdr.ScVal {
    const value = storage.get(name);
    if (value === undefined) {
        throw new Error(`${label} instance is missing ${name}`);
    }
    return value;
}
