import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { tokenBalanceLedgerKey } from './ledger-keys.js';

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
 * Re-exported here so a caller can get the key and the decoder from one
 * module. Reads the contract-data slot directly, so it works for a contract
 * holder. For a classic account's SAC balance, held in a trustline, call the
 * token's `balance()` instead.
 */
export { tokenBalanceLedgerKey };

/**
 * Decode a `Balance(holder)` entry that may be absent.
 *
 * Absent is `0n`, matching the token contract: a holder that has never been
 * credited has no slot at all.
 */
export function tokenBalanceOrZero(val: xdr.ScVal | undefined): bigint {
    return val ? parseTokenBalance(val) : 0n;
}
