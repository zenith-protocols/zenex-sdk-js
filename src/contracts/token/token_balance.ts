import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { tokenBalanceLedgerKey } from '../../ledger-keys.js';

// =============================================================================
// Token `Balance(holder)` ledger entries — key and decode.
//
// Nothing here is vault-specific. A `Balance` slot has the same shape for any
// holder of any token, so the same pair serves the vault's margin balance
// (`Balance(vault)`, which is exactly `Vault::total_assets`) and a wallet
// balance for the connected user. `Market.load` and `loadTokenBalance` both go
// through it rather than each rolling their own.
//
// The slot is either the SAC `BalanceValue` map
// (`{ amount: i128, authorized: bool, clawback: bool }`) or a pure-Soroban
// fungible token's plain `i128`. Both collapse to the integer balance in the
// token's own decimals (token-dec).
// =============================================================================

/**
 * Extract the integer balance (token-dec) from a token `Balance(holder)`
 * storage value. Handles both the SAC map shape and the direct `i128` shape.
 * A map without an `amount` field reads as `0`.
 * @param val - The `ScVal` from the token's `Balance(holder)` ledger entry.
 * @returns The balance as a bigint.
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
 * The ledger key of a holder's balance on a token contract.
 *
 * Re-exported here so a caller building a batch reaches for the key and the
 * decode in one place; it is the same builder `src/ledger-keys.ts` defines
 * alongside the rest of the storage mirror.
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
