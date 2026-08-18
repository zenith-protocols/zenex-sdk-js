// =============================================================================
// Treasury protocol fee rate.
//
// Deliberately NOT part of `Market`. The rate only ever divides a fee that has
// already been charged — `feeVaultLeg` and the vault's `feeSplit` apportion it
// between keeper, treasury and vault. No user-facing number depends on it: a
// trader pays `base + impact + execFee`, a depositor's shares come from
// `assets - vaultFee` and a redeemer's payout from `grossAssets - vaultFee`,
// all computed before the split. It feeds only the projected vault post-state,
// which an indexer and a fill projection want and no trader ever sees.
//
// So it loads once at boot (it changes only by governance action) and is passed
// to the two quote paths that project vault post-state, instead of riding along
// on every market refresh.
// =============================================================================

import type { Network } from '../index.js';
import { contractInstanceLedgerKey } from '../ledger-keys.js';
import {
    parseTreasuryInstance,
    parseTreasuryRate,
} from '../contracts/treasury/treasury_instance.js';
import type { TreasuryInstanceState } from '../contracts/treasury/treasury_instance.js';
import { readEntries } from './entries.js';

/**
 * Read the protocol fee rate (a SCALAR_18 fraction) from a treasury contract.
 *
 * An absent `Rate` key reads as `0n`, matching the contract's `get_rate`
 * default of `unwrap_or(0)`.
 *
 * @throws {MarketStateError} `MISSING_STATE` when the treasury instance is
 *   absent or TTL-expired.
 */
export async function loadTreasuryRate(
    network: Network,
    treasury: string,
): Promise<bigint> {
    const key = contractInstanceLedgerKey(treasury);
    const batch = await readEntries(network, [key]);
    return parseTreasuryRate(batch.require(key, `treasury instance ${treasury}`));
}

/**
 * Read the whole treasury instance: fee rate plus owner.
 *
 * Same single key as {@link loadTreasuryRate} — the owner is already in the
 * entry, so a client verifying the treasury is governance-owned pays nothing
 * extra for it.
 */
export async function loadTreasuryInstance(
    network: Network,
    treasury: string,
): Promise<TreasuryInstanceState> {
    const key = contractInstanceLedgerKey(treasury);
    const batch = await readEntries(network, [key]);
    return parseTreasuryInstance(
        batch.require(key, `treasury instance ${treasury}`),
    );
}
