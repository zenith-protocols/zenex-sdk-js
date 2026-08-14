import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { decodeEntryKey } from '../../ledger-keys.js';

// =============================================================================
// Treasury instance-storage `Rate` reader for `getLedgerEntries` reads.
//
// The treasury keeps its protocol fee rate in instance storage under a BARE
// `Symbol("Rate")` key (treasury/src/storage.rs: `set::<Symbol, i128>`), NOT a
// `#[contracttype]` enum variant, so the key is a plain `ScVal::Symbol`, not a
// `Vec[Symbol(name)]`. The contract reads it with `.unwrap_or(0)`, so an absent
// key (constructor invariant notwithstanding) is the SCALAR_18 rate `0`.
// =============================================================================

/**
 * Read the protocol fee rate (SCALAR_18 fraction, token-dec i128) from a
 * treasury contract-instance value. Returns `0n` when the `Rate` key is absent,
 * matching the contract's `get_rate` default.
 *
 * @param instanceVal - The `.val()` of the treasury instance `ContractDataEntry`
 *   (an `scvContractInstance`).
 * @throws If the value is not a contract instance.
 */
export function parseTreasuryRate(instanceVal: xdr.ScVal): bigint {
    if (instanceVal.switch() !== xdr.ScValType.scvContractInstance()) {
        throw new Error('expected a treasury contract-instance value');
    }
    const storage = instanceVal.instance().storage();
    if (!storage) return 0n;

    let rate: bigint | undefined;
    storage.forEach((item) => {
        let name: string | undefined;
        try {
            name = decodeEntryKey(item.key());
        } catch {
            return;
        }
        if (name === 'Rate') {
            rate = scValToBigInt(item.val());
        }
    });
    return rate ?? 0n;
}
