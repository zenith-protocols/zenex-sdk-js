import { i128, u32 } from '../index.js';
import type { Call } from '../trading-router/router_types.js';
import { TradingRouterContract } from '../trading-router/router_contract.js';
import { approveCall } from './sep41.js';

// =============================================================================
// Atomic approve + order bundle.
//
// A collateral-adding order (open, increase, add-collateral, vault deposit)
// needs a SEP-41 approve so the trading contract can draw collateral at fill.
// Rather than submit that approve as a separate transaction, bundle it and the
// order into one `router.multicall`, which runs both atomically (any failure
// traps all). The result is a single operation XDR the caller submits once.
// =============================================================================

/** Inputs for `approveAndOrder`. */
export interface ApproveAndOrderParams {
    /** Router binding whose `multicall` batches the calls. */
    router: TradingRouterContract;
    /** SEP-41 collateral token the approve is set on. */
    token: string;
    /** Trading contract that draws collateral at fill; the approve's spender. */
    trading: string;
    /** Trader granting the allowance and owning the order. */
    user: string;
    /** Allowance to set (token-dec), typically the order's collateral; `<= 0` skips the approve. */
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
 * The bundle is `[approve(token, user, trading, approveAmount, expirationLedger),
 * order]`. When `approveAmount <= 0` the approve leg is dropped and the bundle
 * is just `[order]`, so callers can skip a redundant approve when the existing
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
