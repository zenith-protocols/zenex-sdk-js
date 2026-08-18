import { tradingRouterSpec } from '../contract_specs.js';
import {
    Address,
    Contract,
    contract,
    xdr,
    nativeToScVal,
    scValToNative,
} from '@stellar/stellar-sdk';
import { i128, u32 } from '../../index.js';
import {
    Call,
    CallOutcome,
    OrderParams,
    callToScVal,
    createOrderCall,
    parseCallOutcome,
} from './router_types.js';

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer` for `scvBytes`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/**
 * Arguments for the fee-abstracted pure batch (`multicallWithFee`).
 *
 * Signed prefix: `(calls, feeToken, maxFeeAmount, feeExpiration)`. Replaceable
 * tail set by the relay after signing: `(feeAmount, feeRecipient)`.
 */
export interface MulticallWithFeeArgs {
    /** The batch to run strictly, front to back. No fill convention applies. */
    calls: Call[];
    /** The fee payer. */
    user: string;
    /** Token the relayer fee is collected in. */
    feeToken: string;
    /** User-authorized fee ceiling (token-dec). */
    maxFeeAmount: i128;
    /**
     * Fee allowance live-until ledger (a signed argument; at or after the
     * execution ledger). Use the current ledger plus a short margin.
     */
    feeExpiration: u32;
    /** Fee collected (token-dec); `0n` skips collection. */
    feeAmount: i128;
    /** Fee payee. */
    feeRecipient: string;
}

/** Arguments for the fee-abstracted create-and-fill flows. */
export interface CreateAndFillWithFeeArgs {
    /**
     * The batch to run, front to back. `calls[0]` must be a `create_order`
     * (build it with [`TradingRouterContract.createOrderCall`]); it is the
     * order the fill leg targets. Calls after the first simply rest.
     */
    calls: Call[];
    /** The order owner and fee payer; the fill's order owner. */
    user: string;
    /** Token the relayer fee is collected in. */
    feeToken: string;
    /** User-authorized fee ceiling (token-dec). */
    maxFeeAmount: i128;
    /**
     * Fee allowance live-until ledger (a signed argument; at or after the
     * execution ledger). Use the current ledger plus a short margin.
     */
    feeExpiration: u32;
    /** Fee collected (token-dec); `0n` skips collection. */
    feeAmount: i128;
    /** Fee payee. */
    feeRecipient: string;
    /** Fill-reward recipient. */
    keeper: string;
    /** Serialized price update for the fill leg. */
    price: Buffer | Uint8Array;
}

/**
 * TradingRouterContract - Operation builder for the Zenex stateless call
 * router (generic batching plus the dependent Zenex flows: atomic
 * create-and-fill, with or without a relayer fee).
 *
 * Mirrors the router contract's entrypoints. All methods return
 * base64-encoded XDR operations for transaction building.
 */
export class TradingRouterContract extends Contract {
    static spec: contract.Spec = new contract.Spec(tradingRouterSpec);

    static readonly parsers = {
        // --- generic batching ---
        multicall: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        multicallTry: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(
                parseCallOutcome,
            ),
        multicallWithFee: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // --- create-and-fill flows ---
        // Every create-and-fill entry returns a `Vec<Val>`, multicall-style:
        // the N call results with the fill outcome appended as the last
        // element. `results[0]` is the created order id (`calls[0]`'s return).
        //
        // Strict variants mirror `multicall` (raw passthrough): the batch
        // traps on any failure, so all elements decode cleanly and the last
        // element is the fill payout (i128, as a bigint).
        createAndFill: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        createAndFillWithFee: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Try variants mirror `multicallTry`: each element is a `CallOutcome`.
        // The last element is the isolated fill outcome, `ok: true` (payout in
        // `value`) when filled or `ok: false` (rested; `error` carries the
        // contract code) when the fill did not land. Every earlier element is
        // a strict success (`ok: true`).
        /** @deprecated Low-level ABI compatibility only. */
        createAndTryFill: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(
                parseCallOutcome,
            ),
        /** @deprecated Low-level ABI compatibility only. */
        createAndTryFillWithFee: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(
                parseCallOutcome,
            ),
    };

    /**
     * Execute `calls` in order and return each call's raw return value.
     *
     * Any failing call traps the whole invocation, so either every call
     * lands or none do.
     *
     * # Returns
     * - The raw return value of each call, in call order.
     */
    multicall(calls: Call[]): string {
        return this.call(
            'multicall',
            xdr.ScVal.scvVec(calls.map(callToScVal)),
        ).toXDR('base64');
    }

    /**
     * Execute `calls` in order, isolating each call's failure; returns one
     * raw outcome per call.
     *
     * A failing call rolls back its own effects and the batch continues
     * with the next call.
     *
     * # Returns
     * - One raw value per call, in call order: the call's return value when
     *   it lands, or the failure as a host `Error` value when it does not.
     *   `parsers.multicallTry` splits the two into `CallOutcome`s.
     */
    multicallTry(calls: Call[]): string {
        return this.call(
            'multicall_try',
            xdr.ScVal.scvVec(calls.map(callToScVal)),
        ).toXDR('base64');
    }

    /**
     * Collect a relayer fee from `user`, then run `calls` in order; returns
     * each call's raw return value (same shape as `multicall`).
     *
     * A pure fee-wrapped batch with no fill convention, no keeper, and no
     * price: the fee leg runs first (strict), then the calls run strictly
     * front to back, so either every call lands or none do. This is the
     * gasless envelope for policy-checked resting orders or cancels-only
     * batches, which the fill-bearing create-and-* entries cannot carry.
     *
     * The user's authorization covers the signed prefix
     * `(calls, feeToken, maxFeeAmount, feeExpiration)`; the replaceable tail
     * `(feeAmount, feeRecipient)` sits outside it, so the relay sets those
     * after signing. `feeAmount` must not exceed `maxFeeAmount`; `0n` skips
     * collection.
     *
     * # Returns
     * - The raw return value of each call, in call order. Decode with
     *   `parsers.multicallWithFee`, which passes the `Vec<Val>` through
     *   `scValToNative` untouched (results are left raw, exactly like
     *   `parsers.multicall`).
     */
    multicallWithFee(args: MulticallWithFeeArgs): string {
        return this.call(
            'multicall_with_fee',
            xdr.ScVal.scvVec(args.calls.map(callToScVal)),
            Address.fromString(args.user).toScVal(),
            Address.fromString(args.feeToken).toScVal(),
            nativeToScVal(args.maxFeeAmount, { type: 'i128' }),
            xdr.ScVal.scvU32(args.feeExpiration),
            nativeToScVal(args.feeAmount, { type: 'i128' }),
            Address.fromString(args.feeRecipient).toScVal(),
        ).toXDR('base64');
    }

    /**
     * Run `calls` in order and fill the first one, all in a single
     * invocation; returns the batch results with the fill payout appended.
     *
     * `calls` runs front to back with `multicall` semantics (strict: any
     * failing call traps the whole batch). By convention `calls[0]` is a
     * `create_order` on the trading contract and is the order the fill
     * targets; build it with [`TradingRouterContract.createOrderCall`].
     * Calls after the first are never filled: a resting TP/SL create in
     * positions `1..n` simply rests. Empty `calls` traps.
     *
     * Fill-or-kill: a failing fill unwinds the whole batch, so nothing
     * rests. `user` is the fill's order owner; with `keeper = user` the fill
     * reward round-trips to the trader.
     *
     * # Returns
     * - A `Vec<Val>`: the N call results with the fill payout appended as the
     *   last element (length N+1). `results[0]` is the created order id; the
     *   last element is the payout paid to `keeper` (token-dec). Decode with
     *   `parsers.createAndFill` (raw passthrough, like `parsers.multicall`).
     *
     * # Errors
     * - Propagates the trading contract's `create_order` and
     *   `execute_order` errors.
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
     * Run `calls` in order and attempt an immediate fill of the first one;
     * returns the batch results with the fill outcome appended.
     *
     * The batch is strict; the fill leg is isolated. A failed fill leaves
     * every created order resting for a later keeper fill and reports why
     * via the appended fill outcome's error code.
     *
     * Arguments mirror `createAndFill`.
     *
     * # Returns
     * - A `Vec<Val>`: the N call results with the fill outcome appended as the
     *   last element (length N+1), `multicall_try`-style. `results[0]` is the
     *   created order id. The last element is the isolated fill outcome: the
     *   payout `Val` when the fill lands, or a host `Error` value when it does
     *   not (the order rests). Decode with `parsers.createAndTryFill` (a
     *   `CallOutcome[]`, like `parsers.multicallTry`): the last outcome's
     *   `ok` tells filled from rested.
     *
     * # Errors
     * - Propagates the trading contract's `create_order` errors; fill
     *   failures are reported in the appended outcome, not thrown.
     *
     * @deprecated Low-level ABI compatibility only. User-facing instant
     * execution should use `buildOrderOperation` with `fillOrKill`, which
     * selects the strict `create_and_fill` path.
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

    /**
     * Collect a relayer fee from `user`, then run `calls` and fill the first
     * one, all in a single invocation; returns the batch results with the
     * fill payout appended.
     *
     * `calls[0]` must be a `create_order` (the order the fill targets); build
     * it with [`TradingRouterContract.createOrderCall`]. Calls after the
     * first simply rest.
     *
     * The user's authorization covers the signed prefix
     * `(calls, feeToken, maxFeeAmount, feeExpiration)`; the replaceable tail
     * `(feeAmount, feeRecipient, keeper, price)` sits outside it, so the
     * relay sets those after signing. The whole batch is signed as one value,
     * so the inner `create_order` (and any further inner calls) ride the
     * signed auth tree as sub-invocation entries. Fill-or-kill: a failing
     * fill unwinds the batch, the approvals, and the fee, so nothing rests.
     * `feeAmount` must not exceed `maxFeeAmount`; `0n` skips collection.
     *
     * # Returns
     * - A `Vec<Val>`: the N call results with the fill payout appended as the
     *   last element (length N+1). `results[0]` is the created order id; the
     *   last element is the payout paid to `keeper` (token-dec). Decode with
     *   `parsers.createAndFillWithFee` (raw passthrough, like
     *   `parsers.multicall`).
     *
     * # Errors
     * - `stellar_fee_abstraction::FeeAbstractionError::InvalidFeeBounds`
     *   (#5003): `feeAmount` is negative or exceeds `maxFeeAmount`.
     * - Propagates the trading contract's `create_order` and
     *   `execute_order` errors.
     *
     * # Events
     * - `fee_collected`: the fee moved from `user` to `feeRecipient`.
     */
    createAndFillWithFee(args: CreateAndFillWithFeeArgs): string {
        return this.call(
            'create_and_fill_with_fee',
            ...withFeeScVals(args),
        ).toXDR('base64');
    }

    /**
     * Collect a relayer fee from `user`, then run `calls` and attempt an
     * immediate fill of the first one; returns the batch results with the
     * fill outcome appended.
     *
     * Shares `createAndFillWithFee`'s envelope and authorization (signed
     * prefix `(calls, feeToken, maxFeeAmount, feeExpiration)`). The fee and batch legs are
     * strict; the fill leg is isolated, so a failed fill leaves every created
     * order resting with the fee collected and reports why via the appended
     * fill outcome's error code.
     *
     * # Returns
     * - A `Vec<Val>`: the N call results with the fill outcome appended as the
     *   last element (length N+1), `multicall_try`-style. `results[0]` is the
     *   created order id; the last element is the isolated fill outcome
     *   (payout `Val` when filled, host `Error` value when rested). Decode
     *   with `parsers.createAndTryFillWithFee` (a `CallOutcome[]`, like
     *   `parsers.multicallTry`).
     *
     * # Errors
     * - `stellar_fee_abstraction::FeeAbstractionError::InvalidFeeBounds`
     *   (#5003): `feeAmount` is negative or exceeds `maxFeeAmount`.
     * - Propagates the trading contract's `create_order` errors; fill
     *   failures are reported in the appended outcome, not thrown.
     *
     * # Events
     * - `fee_collected`: the fee moved from `user` to `feeRecipient`.
     *
     * @deprecated Low-level ABI compatibility only. Relayed instant
     * execution should use `buildOrderOperation` with `fillOrKill`, which
     * selects the strict `create_and_fill_with_fee` path.
     */
    createAndTryFillWithFee(args: CreateAndFillWithFeeArgs): string {
        return this.call(
            'create_and_try_fill_with_fee',
            ...withFeeScVals(args),
        ).toXDR('base64');
    }

    /** Build a `Call` descriptor for `multicall` / `multicallTry`. */
    static buildCall(contract: string, func: string, args: xdr.ScVal[]): Call {
        return { contract, func, args };
    }

    /**
     * Build a `create_order`-shaped `Call` from `OrderParams`, ready to sit at
     * `calls[0]` of a create-and-fill batch (or anywhere in a `multicall`).
     *
     * Re-exports the `createOrderCall` helper as a static so batch composition
     * needs only the router binding. The encoding mirrors
     * `TradingContract.createOrderCall`, so a bundled order is byte-identical
     * to a direct one.
     */
    static createOrderCall(params: OrderParams): Call {
        return createOrderCall(params);
    }
}

/**
 * Encode the 9-arg with-fee tuple in on-chain order:
 * `(calls, user, fee_token, max_fee_amount, fee_expiration, fee_amount,
 * fee_recipient, keeper, price)`. The signed prefix is
 * `(calls, fee_token, max_fee_amount, fee_expiration)`; the replaceable tail
 * `(fee_amount, fee_recipient, keeper, price)` sits outside the user's
 * signature and the relay rewrites it before submission.
 */
function withFeeScVals(args: CreateAndFillWithFeeArgs): xdr.ScVal[] {
    return [
        xdr.ScVal.scvVec(args.calls.map(callToScVal)),
        Address.fromString(args.user).toScVal(),
        Address.fromString(args.feeToken).toScVal(),
        nativeToScVal(args.maxFeeAmount, { type: 'i128' }),
        xdr.ScVal.scvU32(args.feeExpiration),
        nativeToScVal(args.feeAmount, { type: 'i128' }),
        Address.fromString(args.feeRecipient).toScVal(),
        Address.fromString(args.keeper).toScVal(),
        xdr.ScVal.scvBytes(priceBuffer(args.price)),
    ];
}
