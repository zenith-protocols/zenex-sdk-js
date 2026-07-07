import { Address, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { i128, u32 } from '../index.js';
import type { Call } from '../trading-router/router_types.js';

// =============================================================================
// SEP-41 token Call builders.
//
// The trading contract draws a trader's collateral at fill via the token's
// SEP-41 allowance, so a collateral-adding order must be preceded by an
// `approve`. This builds that `approve` as a `Call` so it can ride in the same
// atomic `router.multicall` as the order (see `approveAndOrder`).
// =============================================================================

/**
 * Build a SEP-41 `approve(from, spender, amount, expiration_ledger)`
 * invocation as a `Call` (contract, func, args), for batching under the
 * trading-router's `multicall`.
 *
 * `spender` is the account allowed to draw `amount` (token-dec) from `from`;
 * for a Zenex order this is the trading contract, which pulls collateral at
 * fill. `expirationLedger` is the ledger at which the allowance lapses.
 */
export function approveCall(
    token: string,
    from: string,
    spender: string,
    amount: i128,
    expirationLedger: u32,
): Call {
    return {
        contract: token,
        func: 'approve',
        args: [
            Address.fromString(from).toScVal(),
            Address.fromString(spender).toScVal(),
            nativeToScVal(amount, { type: 'i128' }),
            xdr.ScVal.scvU32(expirationLedger),
        ],
    };
}
