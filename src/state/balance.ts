// =============================================================================
// Token balance reads — one path for every holder and every token.
//
// A balance is read by calling the TOKEN's own `balance(address)`, simulated.
// That is uniform in a way no ledger-entry read can be, because where a balance
// physically lives depends on the token AND the holder:
//
//   holder     SAC token                      pure-Soroban token
//   -------    ---------------------------    -----------------------------
//   C-address  contract data `Balance(C)`     contract data `Balance(C)`
//   G-address  the account's TRUSTLINE        contract data `Balance(G)`
//
// Verified on chain, all four cells: a classic account's SAC balance has NO
// contract-data entry, while its balance of the vault's share token (a
// pure-Soroban OZ fungible) does. Reading the `Balance` key therefore reports a
// confident zero for a funded account, and dispatching on holder type is also
// wrong because it depends on the token.
//
// `balance()` answers all four identically, needs no classic `Asset` (so it
// works for share tokens, which have no code/issuer at all), and is what the
// contract itself would compute. The cost is a simulation rather than a ledger
// key, which is why `Market.load` still reads `Balance(vault)` as an entry: the
// vault is always a contract, so that cell is unambiguous, and it has to be a
// key to ride along in the batch.
// =============================================================================

import { Address, Contract, scValToBigInt, xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import { simulateAndParse } from '../simulate.js';

/** Build the `balance(holder)` operation for a token contract. */
function balanceOperation(token: string, holder: string): string {
    return new Contract(token)
        .call('balance', Address.fromString(holder).toScVal())
        .toXDR('base64');
}

/**
 * Read a holder's balance of a token, atomic at the token's own decimals.
 *
 * Works for any holder (`G...` or `C...`) and any token (a Stellar Asset
 * Contract or a pure-Soroban fungible such as the vault's share token).
 *
 * @throws If the simulation fails — including when the token contract's state
 *   is archived and needs restoring.
 */
export async function loadTokenBalance(
    network: Network,
    token: string,
    holder: string,
): Promise<bigint> {
    const { result } = await simulateAndParse(
        network,
        balanceOperation(token, holder),
        (retval) => scValToBigInt(xdr.ScVal.fromXDR(retval, 'base64')),
    );
    return result;
}

/**
 * Read one holder's balance across several tokens, in request order.
 *
 * Each token is its own simulation, issued concurrently. To collapse them into
 * a single round trip, batch the `balance` calls through the router's
 * `multicall_try` instead.
 */
export async function loadTokenBalances(
    network: Network,
    tokens: readonly string[],
    holder: string,
): Promise<bigint[]> {
    return Promise.all(
        tokens.map((token) => loadTokenBalance(network, token, holder)),
    );
}
