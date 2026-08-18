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
 * Reads through the token contract's own `balance` call, so it works for any
 * holder (`G...` or `C...`) and any token. This includes a Stellar Asset
 * Contract and a pure-Soroban fungible such as the vault's share token.
 *
 * @throws {Error} When the simulation fails. This includes the case where the
 *   token contract's state is archived and needs a restore first.
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
