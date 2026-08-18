// =============================================================================
// Token balance reads.
//
// A direct `Balance(holder)` ledger-entry read, not a `balance()` simulation:
// cheaper, and — the reason it matters — batchable, so `Market.load` folds
// `Balance(vault)` into the same round trip as the rest of its state.
//
// It does NOT cover every balance. A classic account's balance of a SAC lives
// in that account's trustline, not in contract data, so the `Balance` key comes
// back absent and is indistinguishable from a real zero (see `src/token.ts` for
// the full table). `loadAssetBalance` handles that case; this one refuses it
// rather than reporting a confident zero.
// =============================================================================

import { StrKey, rpc, type Asset, type xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import { tokenBalanceLedgerKey, tokenBalanceOrZero } from '../token.js';
import { MarketStateError, readEntries } from './entries.js';

/**
 * Guard the ambiguous case: a classic holder with no contract-data `Balance`.
 *
 * A pure-Soroban token really does keep a G-address balance in contract data,
 * so an absent entry there is a genuine zero. For a SAC it means the balance is
 * in a trustline we did not read — reporting `0n` would be wrong, and silently
 * so.
 */
function classicMiss(token: string, holder: string): MarketStateError {
    return new MarketStateError(
        'MISSING_STATE',
        `no contract-data Balance for classic account ${holder} in ${token}. ` +
            'For a Stellar Asset Contract a classic account holds its balance in a ' +
            'trustline, not in contract data — read it with loadAssetBalance(network, ' +
            'holder, asset). If this really is a pure-Soroban token, the holder has ' +
            'simply never been credited.',
    );
}

function balanceOf(
    value: xdr.ScVal | undefined,
    token: string,
    holder: string,
): bigint {
    if (value !== undefined) return tokenBalanceOrZero(value);
    if (StrKey.isValidEd25519PublicKey(holder)) throw classicMiss(token, holder);
    return 0n;
}

/**
 * Read one holder's token balance from contract data, atomic at the token's
 * decimals.
 *
 * An absent entry is `0n` for a contract holder — a contract that has never
 * been credited has no `Balance` slot.
 *
 * @throws {MarketStateError} `MISSING_STATE` when the holder is a classic
 *   (`G...`) account and no contract-data balance exists, because that cannot
 *   be told apart from a SAC balance living in a trustline. Use
 *   {@link loadAssetBalance} for SAC balances of classic accounts.
 */
export async function loadTokenBalance(
    network: Network,
    token: string,
    holder: string,
): Promise<bigint> {
    const key = tokenBalanceLedgerKey(token, holder);
    const batch = await readEntries(network, [key]);
    return balanceOf(batch.at(key, `balance of ${holder} in ${token}`), token, holder);
}

/**
 * Read one holder's balance across several tokens in a single
 * `getLedgerEntries`, in request order. Same classic-account rule as
 * {@link loadTokenBalance}.
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
        balanceOf(
            batch.at(key, `balance of ${holder} in ${tokens[i]}`),
            tokens[i],
            holder,
        ),
    );
}

/**
 * Read a Stellar Asset Contract balance for any holder, classic or contract.
 *
 * Delegates to `rpc.Server.getAssetBalance`, which reads a trustline for a
 * `G...` holder and the contract-data `Balance` slot for a `C...` one. Needs
 * the classic `Asset` (code + issuer), which a SAC contract id alone cannot
 * supply — so a deployment carries it in config.
 *
 * This owns its own round trip and cannot be folded into a batch; use
 * {@link loadTokenBalance} for the batched contract-data path.
 *
 * @returns The balance in the asset's own decimals, or `0n` when the holder has
 *   no trustline or balance entry.
 */
export async function loadAssetBalance(
    network: Network,
    holder: string,
    asset: Asset,
): Promise<bigint> {
    const server = new rpc.Server(network.rpc, network.opts);
    const result = await server.getAssetBalance(holder, asset, network.passphrase);
    return result.balanceEntry ? BigInt(result.balanceEntry.amount) : 0n;
}
