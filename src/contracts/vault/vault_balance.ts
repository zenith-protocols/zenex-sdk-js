import { xdr, scValToBigInt } from '@stellar/stellar-sdk';

// =============================================================================
// Token `Balance` ledger-entry value decode.
//
// A holder's balance slot
// on a token contract is either the SAC `BalanceValue` map
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
export function parseTokenBalanceValue(val: xdr.ScVal): bigint {
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
