import { Address, xdr } from '@stellar/stellar-sdk';
import { decodeEntryKey } from './keys.js';

/**
 * A contract's instance storage, indexed by key name and bound to one
 * contract. A missing-key error names the contract it came from.
 */
export interface InstanceStorage {
    /** Key names present in the entry. Keys in an unrecognized shape are left out. */
    keys(): string[];
    /** Raw value for a key, or `undefined` when the contract has not set it. */
    get(name: string): xdr.ScVal | undefined;
    /** As {@link get}, but throws `Error("<contract> instance is missing <name>")` if absent. */
    require(name: string): xdr.ScVal;
    /** A required `Address` slot, as a strkey. Throws if `name` is absent, naming the contract. */
    address(name: string): string;
    /** An optional `Address` slot. Returns `undefined` if `name` is absent, such as a renounced `Owner`. */
    optionalAddress(name: string): string | undefined;
}

/**
 * Read a contract's instance storage into an {@link InstanceStorage}.
 *
 * @param instanceVal - The `.val()` of a `ContractDataEntry` whose key is
 *   `scvLedgerKeyContractInstance`.
 * @param label - Contract name. Named in every error this call raises.
 * @throws If `instanceVal` is not a contract-instance value.
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
            // Unrecognized key shape. Skipped instead of rejected.
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
