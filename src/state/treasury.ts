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
 * One `getLedgerEntries`, one key.
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
 * One `getLedgerEntries`, one key. Same key as {@link loadTreasuryRate}.
 *
 * @throws {MarketStateError} `MISSING_STATE` when the treasury instance is
 *   absent or TTL-expired.
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
