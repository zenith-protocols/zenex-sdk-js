import { marketRouterSpec } from '../contract_specs.js';
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
} from './types.js';

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/** Arguments for the fee-abstracted pure batch (`multicallWithFee`). */
export interface MulticallWithFeeArgs {
    /** The batch to run. Strict: any failing call traps the whole batch. */
    calls: Call[];
    /**
     * The fee payer. Signs `calls`, `feeToken`, `maxFeeAmount` and
     * `feeExpiration`.
     */
    user: string;
    /** Token the relayer fee is collected in (signed). */
    feeToken: string;
    /** User-authorized fee ceiling (token-dec, signed). */
    maxFeeAmount: i128;
    /**
     * Fee allowance live-until ledger (signed). Use the current ledger plus
     * a short margin.
     */
    feeExpiration: u32;
    /**
     * Fee collected (token-dec). Set by the relay after signing. `0n` skips
     * collection.
     */
    feeAmount: i128;
    /** Fee payee. Set by the relay after signing. */
    feeRecipient: string;
}

/** Arguments for the fee-abstracted create-and-fill flows. */
export interface CreateAndFillWithFeeArgs {
    /**
     * The batch to run. `calls[0]` must be a `create_order` call; build it
     * with [`TradingRouterContract.createOrderCall`]. It is the order the
     * fill targets. Calls after the first simply rest.
     */
    calls: Call[];
    /**
     * The order owner and fee payer. Signs `calls`, `feeToken`,
     * `maxFeeAmount` and `feeExpiration`.
     */
    user: string;
    /** Token the relayer fee is collected in (signed). */
    feeToken: string;
    /** User-authorized fee ceiling (token-dec, signed). */
    maxFeeAmount: i128;
    /**
     * Fee allowance live-until ledger (signed). Use the current ledger plus
     * a short margin.
     */
    feeExpiration: u32;
    /**
     * Fee collected (token-dec). Set by the relay after signing. `0n` skips
     * collection.
     */
    feeAmount: i128;
    /** Fee payee. Set by the relay after signing. */
    feeRecipient: string;
    /** Fill-reward recipient. Set by the relay after signing. */
    keeper: string;
    /** Serialized price update for the fill. Set by the relay after signing. */
    price: Buffer | Uint8Array;
}

/**
 * Operation builder for the Zenex call router: generic batching plus the
 * create-and-fill flows, with or without a relayer fee.
 *
 * Every method returns a base64-encoded XDR operation for transaction
 * building.
 */
export class TradingRouterContract extends Contract {
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
        multicallWithFee: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // --- create-and-fill flows ---
        createAndFill: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        createAndFillWithFee: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
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
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.multicallTry` to get one [`CallOutcome`] per call, in call
     * order: `ok: true` with the call's return value, or `ok: false` with the
     * contract error code.
     */
    multicallTry(calls: Call[]): string {
        return this.call(
            'multicall_try',
            xdr.ScVal.scvVec(calls.map(callToScVal)),
        ).toXDR('base64');
    }

    /**
     * Collect a relayer fee from `args.user`, then run `args.calls` in
     * order. Strict: the fee leg and every call must land, or the whole
     * batch traps. There is no fill convention; use this for a gasless batch
     * with no order to fill, such as a cancels-only batch.
     *
     * See [`MulticallWithFeeArgs`] for which fields `user` signs and which
     * the relay fills in after signing.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.multicallWithFee` to get the raw return value of each call, in
     * call order (the fee leg is not included).
     *
     * # Errors
     * - InvalidFeeBounds (5003) if `feeAmount` is negative or exceeds
     *   `maxFeeAmount`.
     *
     * # Events
     * - `fee_collected`: the fee moved from `user` to `feeRecipient`.
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
     * Run `calls` and fill `calls[0]`, all in one invocation.
     *
     * Strict: any failing call, including the fill, traps the whole batch,
     * so either everything lands or nothing rests. `calls[0]` must be a
     * `create_order`-shaped call; build it with
     * [`TradingRouterContract.createOrderCall`]. Its `u32` return value is
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
     * - Propagates the trading contract's `create_order` and `execute_order`
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
     * comes back in the appended outcome instead of trapping. Arguments
     * match `createAndFill`.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.createAndTryFill` to get the `N` call results with the
     * isolated fill outcome appended last; `results[0]` is the created order
     * id. The last [`CallOutcome`] is `ok: true` with the payout when the
     * fill lands, or `ok: false` when the order rests.
     *
     * # Errors
     * - Traps if `calls` is empty or `calls[0]` does not return a `u32`
     *   order id.
     * - Propagates the trading contract's `create_order` errors. A failed
     *   fill is reported in the appended outcome, not thrown.
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
     * Collect a relayer fee from `args.user`, then run `args.calls` and fill
     * `calls[0]`, all in one invocation.
     *
     * Strict and fill-or-kill: a failing call anywhere, including the fill,
     * unwinds the whole batch, the fee, and any approvals, so nothing rests.
     * `feeAmount` must not exceed `maxFeeAmount`; `0n` skips collection.
     *
     * See [`CreateAndFillWithFeeArgs`] for which fields `user` signs and
     * which the relay fills in after signing.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.createAndFillWithFee` to get the `N` call results with the
     * fill payout (token-dec) appended last; `results[0]` is the created
     * order id.
     *
     * # Errors
     * - Traps if `calls` is empty or `calls[0]` does not return a `u32`
     *   order id.
     * - InvalidFeeBounds (5003) if `feeAmount` is negative or exceeds
     *   `maxFeeAmount`.
     * - Propagates the trading contract's `create_order` and `execute_order`
     *   errors.
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
     * Collect a relayer fee from `args.user`, then run `args.calls` and
     * attempt an immediate fill of `calls[0]`, all in one invocation.
     *
     * Shares `createAndFillWithFee`'s envelope and signed/relay-set field
     * split. The fee and batch legs are strict; the fill is isolated, so a
     * failed fill leaves every created order resting with the fee already
     * collected, and its error code comes back in the appended outcome
     * instead of trapping.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.createAndTryFillWithFee` to get the `N` call results with the
     * isolated fill outcome appended last; `results[0]` is the created order
     * id. The last [`CallOutcome`] is `ok: true` with the payout when the
     * fill lands, or `ok: false` when the order rests.
     *
     * # Errors
     * - Traps if `calls` is empty or `calls[0]` does not return a `u32`
     *   order id.
     * - InvalidFeeBounds (5003) if `feeAmount` is negative or exceeds
     *   `maxFeeAmount`.
     * - Propagates the trading contract's `create_order` errors. A failed
     *   fill is reported in the appended outcome, not thrown.
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

    /** Build a `Call` descriptor for `multicall` or `multicallTry`. */
    static buildCall(contract: string, func: string, args: xdr.ScVal[]): Call {
        return { contract, func, args };
    }

    /** Build a `create_order`-shaped `Call` from `OrderParams`. Same as the exported `createOrderCall`. */
    static createOrderCall(params: OrderParams): Call {
        return createOrderCall(params);
    }
}

/** Encode `args` as the 9-arg with-fee tuple, in on-chain order. */
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
