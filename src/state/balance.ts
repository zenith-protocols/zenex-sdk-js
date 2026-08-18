// =============================================================================
// Token balance reads.
//
// A direct `Balance(holder)` ledger-entry read, not a `balance()` simulation.
// Cheaper, and — the reason it matters — batchable: the same key builder serves
// `Balance(vault)` inside `Market.load` and `Balance(user)` for a wallet
// balance, so a consumer can fold both into one round trip.
// =============================================================================

import type { Network } from '../index.js';
import {
    tokenBalanceLedgerKey,
    tokenBalanceOrZero,
} from '../contracts/token/index.js';
import { readEntries } from './entries.js';

/**
 * Read one holder's token balance, atomic at the token's decimals.
 *
 * An absent entry is `0n`, matching the token contract: a holder that has never
 * been credited has no `Balance` slot.
 */
export async function loadTokenBalance(
    network: Network,
    token: string,
    holder: string,
): Promise<bigint> {
    const key = tokenBalanceLedgerKey(token, holder);
    const batch = await readEntries(network, [key]);
    return tokenBalanceOrZero(batch.at(key, `balance of ${holder} in ${token}`));
}

/**
 * Read one holder's balance across several tokens in a single
 * `getLedgerEntries`, in request order.
 */
export async function loadTokenBalances(
    network: Network,
    tokens: readonly string[],
    holder: string,
): Promise<bigint[]> {
    if (tokens.length === 0) return [];
    const keys = tokens.map((token) => tokenBalanceLedgerKey(token, holder));
    const batch = await readEntries(network, keys);
    return keys.map((key, i) =>
        tokenBalanceOrZero(batch.at(key, `balance of ${holder} in ${tokens[i]}`)),
    );
}
