import { Address, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { i128, u32 } from '../index.js';
import type { Call } from '../trading-router/router_types.js';

// =============================================================================
// SEP-41 token Call builders.
//
// v2 escrows an order's collateral and exec_fee by direct `token.transfer`
// inside the user-authorized `create_order`, so order creation needs no
// allowance. A SEP-41 `approve` still has two uses: it mirrors the
// trading-router's pre-approve leg (`approve_amount` on the create-and-fill
// flows), and it lets the trading contract settle a losing decrease fill
// whose trader leg exceeds the escrowed collateral (settlement pulls that
// shortfall via `transfer_from`). This builds the `approve` as a `Call` so
// it can ride in the same atomic `router.multicall` as another invocation
// (see `approveAndOrder`).
// =============================================================================

/**
 * Build a SEP-41 `approve(from, spender, amount, expiration_ledger)`
 * invocation as a `Call` (contract, func, args), for batching under the
 * trading-router's `multicall`.
 *
 * `spender` is the account allowed to draw `amount` (token-dec) from `from`;
 * for a Zenex flow this is the trading contract, which uses the allowance to
 * settle a trader-owed shortfall at fill time. `expirationLedger` is the
 * ledger at which the allowance lapses.
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
