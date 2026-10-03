import { marketRouterSpec } from '../contract_specs.js';
import {
    Address,
    Contract,
    contract,
    xdr,
    scValToNative,
} from '@stellar/stellar-sdk';
import {
    Call,
    CallOutcome,
    OrderParams,
    callToScVal,
    createOrderCall,
    parseCallOutcome,
} from './types.js';

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/**
 * Operation builder for the Zenex market router (zenex-util-contracts
 * `market-router`): generic batching plus the create-and-fill flows. The
 * router collects no fee and needs no authorization. Every method returns a
 * base64-encoded XDR operation.
 *
 * A batched call that needs a user's authorization carries the user's own
 * auth entry. With the router as the transaction's root call, that entry is
 * not rooted at the root invocation. Simulate the batch with
 * `simulateAndParse(network, op, parser, { authMode: 'record_allow_nonroot' })`,
 * because `prepareTransaction` simulates in the default mode and fails. To
 * pay a relayer in a token, relay the call through `FeeForwarderContract`
 * instead. The user's entries then nest under the forwarder's root.
 */
export class MarketRouterContract extends Contract {
    /** Parsed spec for the router contract; used to encode and decode invocations. */
    static spec: contract.Spec = new contract.Spec(marketRouterSpec);

    /** Result decoders for each entrypoint, keyed to the method of the same name. */
    static readonly parsers = {
        // --- generic batching ---
        multicall: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        multicallTry: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(
                parseCallOutcome,
            ),
        // --- create-and-fill flows ---
        createAndFill: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        /** @deprecated Low-level ABI compatibility only. */
        createAndTryFill: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(
                parseCallOutcome,
            ),
    };

    /**
     * Run `calls` in order. Strict: any failing call traps the whole batch,
     * so either every call lands or none do.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.multicall` to get the raw return value of each call, in call
     * order.
     */
    multicall(calls: Call[]): string {
        return this.call(
            'multicall',
            xdr.ScVal.scvVec(calls.map(callToScVal)),
        ).toXDR('base64');
    }

    /**
     * Run `calls` in order, isolating each call's failure. A failing call
     * rolls back its own effects and the batch continues with the next call.
     * A budget or footprint limit still aborts the whole transaction.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.multicallTry` to get one [`CallOutcome`] per call, in call
     * order: `ok: true` with the call's return value, or `ok: false` with the
     * contract error code. A non-contract failure reads `UNTYPED_FAILURE`.
     */
    multicallTry(calls: Call[]): string {
        return this.call(
            'multicall_try',
            xdr.ScVal.scvVec(calls.map(callToScVal)),
        ).toXDR('base64');
    }

    /**
     * Run `calls` and fill `calls[0]`, all in one invocation.
     *
     * Strict: any failing call, including the fill, traps the whole batch,
     * so either everything lands or nothing rests. `calls[0]` must be a
     * `create_order`-shaped call; build it with
     * [`MarketRouterContract.createOrderCall`]. Its `u32` return value is
     * the id of the order the fill targets, and `user` is that order's
     * owner. Calls
     * after the first are never filled and simply rest. With
     * `keeper = user` the fill reward round-trips to the trader.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.createAndFill` to get the `N` call results with the fill
     * payout (token-dec) appended last; `results[0]` is the created order id.
     *
     * # Errors
     * - Traps if `calls` is empty or `calls[0]` does not return a `u32`
     *   order id.
     * - Propagates the market contract's `create_order` and `execute_order`
     *   errors.
     */
    createAndFill(
        calls: Call[],
        user: string,
        keeper: string,
        price: Buffer | Uint8Array,
    ): string {
        return this.call(
            'create_and_fill',
            xdr.ScVal.scvVec(calls.map(callToScVal)),
            Address.fromString(user).toScVal(),
            Address.fromString(keeper).toScVal(),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Run `calls` and attempt an immediate fill of `calls[0]`, all in one
     * invocation.
     *
     * The batch is strict; the fill is isolated. A failed fill leaves every
     * created order resting for a later keeper fill, and its error code
     * comes back in the appended outcome instead of trapping. A budget or
     * footprint limit still aborts the whole transaction. Arguments match
     * `createAndFill`.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.createAndTryFill` to get the `N` call results with the
     * isolated fill outcome appended last; `results[0]` is the created order
     * id. The last [`CallOutcome`] is `ok: true` with the payout when the
     * fill lands, or `ok: false` when the order rests. A non-contract fill
     * failure reads `UNTYPED_FAILURE`.
     *
     * # Errors
     * - Traps if `calls` is empty or `calls[0]` does not return a `u32`
     *   order id.
     * - Propagates the market contract's `create_order` errors. A failed
     *   fill is reported in the appended outcome, not thrown.
     *
     * @deprecated Low-level ABI compatibility only. User-facing instant
     * execution should use `createAndFill`, the strict fill-or-kill path.
     */
    createAndTryFill(
        calls: Call[],
        user: string,
        keeper: string,
        price: Buffer | Uint8Array,
    ): string {
        return this.call(
            'create_and_try_fill',
            xdr.ScVal.scvVec(calls.map(callToScVal)),
            Address.fromString(user).toScVal(),
            Address.fromString(keeper).toScVal(),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /** Build a `Call` descriptor for `multicall` or `multicallTry`. */
    static buildCall(contract: string, func: string, args: xdr.ScVal[]): Call {
        return { contract, func, args };
    }

    /** Build a `create_order`-shaped `Call` from `OrderParams`. Same as the exported `createOrderCall`. */
    static createOrderCall(params: OrderParams): Call {
        return createOrderCall(params);
    }
}
