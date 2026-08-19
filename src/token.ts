import { Address, Contract, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import type { Network } from './index.js';
import { enumStorageKeyWithAddress } from './contracts/keys.js';
import { simulateAndParse } from './simulate.js';

/**
 * Extract the integer balance, in the token's own decimals (token-dec), from
 * a token `Balance(holder)` storage value. Handles both the SAC map shape and
 * a plain Soroban fungible token's `i128` shape. A map with no `amount` field
 * decodes as `0n`.
 * @param val - The `ScVal` from the token's `Balance(holder)` ledger entry.
 * @returns The balance as a bigint, in the token's own decimals.
 */
export function parseTokenBalance(val: xdr.ScVal): bigint {
    if (val.switch() === xdr.ScValType.scvMap()) {
        const map = val.map();
        if (map) {
            for (const item of map) {
                const key = item.key();
                if (
                    key.switch() === xdr.ScValType.scvSymbol() &&
                    key.sym().toString() === 'amount'
                ) {
                    return scValToBigInt(item.val());
                }
            }
        }
        return 0n;
    }
    return scValToBigInt(val);
}

/**
 * The ledger key for a holder's `Balance` entry on a token contract.
 * Uses the `StorageKey::Balance(Address)` shape from stellar_tokens. Reads the
 * contract-data slot directly, so it works for a contract holder. For a
 * classic account's SAC balance, held in a trustline, call the token's
 * `balance()` instead.
 * @param tokenContractId - The token contract address
 * @param accountAddress - The account to get balance for
 * @returns Ledger key for the balance entry
 */
export function tokenBalanceLedgerKey(tokenContractId: string, accountAddress: string): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(tokenContractId).toScAddress(),
            key: enumStorageKeyWithAddress('Balance', accountAddress),
            durability: xdr.ContractDataDurability.persistent(),
        })
    );
}

/**
 * Decode a `Balance(holder)` entry that may be absent.
 *
 * Absent is `0n`, matching the token contract: a holder that has never been
 * credited has no slot at all.
 */
export function tokenBalanceOrZero(val: xdr.ScVal | undefined): bigint {
    return val ? parseTokenBalance(val) : 0n;
}

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
