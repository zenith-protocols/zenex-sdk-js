import { Address, xdr } from '@stellar/stellar-sdk';
import { decodeEntryKey } from '../ledger-keys.js';

/**
 * A contract's instance storage, addressed by key name and bound to the
 * contract it came from — so a missing key names itself without every call site
 * repeating which contract it is reading.
 *
 * Backed by the single ledger entry a contract instance lives in: a map of
 * every `DataKey` variant the contract keeps there, plus whatever the
 * OpenZeppelin modules add (`Owner` from `stellar_access::ownable`).
 */
export interface InstanceStorage {
    /** Key names present in the entry (only keys in a shape this SDK recognizes). */
    keys(): string[];
    /** Raw value for a key, or `undefined` when the contract has not set it. */
    get(name: string): xdr.ScVal | undefined;
    /** As {@link get}, but throws `Error("<contract> instance is missing <name>")` if absent. */
    require(name: string): xdr.ScVal;
    /** A required `Address` slot, as a strkey. Throws (naming the contract) if `name` is absent. */
    address(name: string): string;
    /**
     * An optional `Address` slot. `Owner` is the common case: absent means
     * ownership was renounced, or the contract never had an owner (the strategy
     * vault and the router do not).
     */
    optionalAddress(name: string): string | undefined;
}

/**
 * Index a contract-instance value by storage-key name.
 *
 * Walks the whole storage map exhaustively rather than lazily: the single
 * `getLedgerEntries` call that produced `instanceVal` already fetched and
 * paid for every entry, so decoding fewer of them would discard what the
 * caller bought.
 *
 * Handles both key shapes a contract produces: a `#[contracttype]` enum
 * variant (`ScVec[Symbol]`) and a bare `Symbol` (which the treasury and
 * factory use). Keys in a shape this SDK doesn't recognize are ignored
 * rather than rejected — a contract upgrade that adds a storage key must not
 * break every client reading the instance (Blend throws in this position;
 * that trade is wrong for a protocol whose contracts are upgradeable).
 *
 * @param instanceVal - The `.val()` of a `ContractDataEntry` whose key is
 *   `scvLedgerKeyContractInstance`.
 * @param label - Contract name, folded into every error this storage raises
 *   so a failure names the contract it came from.
 * @throws If the value is not a contract instance.
 */
export function instanceStorage(
    instanceVal: xdr.ScVal,
    label: string,
): InstanceStorage {
    if (instanceVal.switch() !== xdr.ScValType.scvContractInstance()) {
        throw new Error(`expected a ${label} contract-instance value`);
    }

    const entries = new Map<string, xdr.ScVal>();
    for (const item of instanceVal.instance().storage() ?? []) {
        let name: string;
        try {
            name = decodeEntryKey(item.key());
        } catch {
            // Unrecognized key shape — ignored, not rejected (see doc above).
            continue;
        }
        entries.set(name, item.val());
    }

    const require = (name: string): xdr.ScVal => {
        const value = entries.get(name);
        if (value === undefined) {
            throw new Error(`${label} instance is missing ${name}`);
        }
        return value;
    };

    return {
        keys: () => [...entries.keys()],
        get: (name) => entries.get(name),
        require,
        address: (name) => Address.fromScVal(require(name)).toString(),
        optionalAddress: (name) => {
            const value = entries.get(name);
            return value ? Address.fromScVal(value).toString() : undefined;
        },
    };
}
