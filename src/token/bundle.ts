import { i128, u32 } from '../index.js';
import type { Call } from '../trading-router/router_types.js';
import { TradingRouterContract } from '../trading-router/router_contract.js';
import { approveCall } from './sep41.js';

// =============================================================================
// Atomic approve + order bundle.
//
// v2 escrows an order's collateral and exec_fee by direct `token.transfer`
// inside the user-authorized `create_order`; the approve leg here mirrors the
// trading-router's pre-approve (`approve_amount` on its create-and-fill
// flows) and pre-authorizes the settlement `transfer_from` that covers a
// losing fill's shortfall beyond the escrowed collateral. Rather than submit
// that approve as a separate transaction, bundle it and the order into one
// `router.multicall`, which runs both atomically (any failure traps all).
// The result is a single operation XDR the caller submits once.
// =============================================================================

/** Inputs for `approveAndOrder`. */
export interface ApproveAndOrderParams {
    /** Router binding whose `multicall` batches the calls. */
    router: TradingRouterContract;
    /** SEP-41 collateral token the approve is set on. */
    token: string;
    /** Trading contract named as the approve's spender; it settles a trader-owed shortfall via the allowance. */
    trading: string;
    /** Trader granting the allowance and owning the order. */
    user: string;
    /** Allowance to set (token-dec); `<= 0` skips the approve. */
    approveAmount: i128;
    /** Ledger at which the allowance lapses. */
    expirationLedger: u32;
    /** The order invocation, e.g. from `TradingContract.createOrderCall`. */
    order: Call;
}

/**
 * Bundle a SEP-41 approve and a trading order into one `router.multicall`
 * operation XDR, executed atomically.
 *
 * The order's collateral and exec_fee are escrowed by the order creation
 * itself; the approve leg only pre-authorizes settlement of a trader-owed
 * shortfall at fill time. The bundle is
 * `[approve(token, user, trading, approveAmount, expirationLedger), order]`.
 * When `approveAmount <= 0` the approve leg is dropped and the bundle is just
 * `[order]`, so callers can skip a redundant approve when the existing
 * allowance already suffices.
 *
 * Note: the order is now invoked BY the router, so the trader's authorization
 * entry for the order nests under the `router.multicall` invocation rather than
 * being a top-level call.
 */
export function approveAndOrder(params: ApproveAndOrderParams): string {
    const { router, token, trading, user, approveAmount, expirationLedger, order } = params;
    const calls: Call[] = approveAmount > 0n
        ? [approveCall(token, user, trading, approveAmount, expirationLedger), order]
        : [order];
    return router.multicall(calls);
}
