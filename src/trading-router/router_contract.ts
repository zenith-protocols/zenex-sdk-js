import { Address, Contract, contract, xdr, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { i128 } from '../index.js';
import {
    Call, CallOutcome, FillAttempt, OrderParams,
    callToScVal, createOrderCall, parseCallOutcome, parseFillAttempt,
} from './router_types.js';

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer` for `scvBytes`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
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
 * TradingRouterContract - Operation builder for the Zenex v2 stateless call
 * router (generic batching plus the dependent Zenex flows: atomic
 * create-and-fill, with or without a relayer fee).
 *
 * Mirrors `zenex-contracts/trading-router/src/lib.rs`. All methods return
 * base64-encoded XDR operations for transaction building.
 */
export class TradingRouterContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAAAAAAARxFeGVjdXRlIGBjYWxsc2AgaW4gb3JkZXIgYW5kIHJldHVybiBlYWNoIGNhbGwncyByYXcgcmV0dXJuIHZhbHVlLgoKQW55IGZhaWxpbmcgY2FsbCB0cmFwcyB0aGUgd2hvbGUgaW52b2NhdGlvbiwgc28gZWl0aGVyIGV2ZXJ5IGNhbGwKbGFuZHMgb3Igbm9uZSBkby4KCiMgQXJndW1lbnRzCi0gYGNhbGxzYDogdGhlIFtgQ2FsbGBdIHNlcXVlbmNlLCBleGVjdXRlZCBmcm9udCB0byBiYWNrLgoKIyBSZXR1cm5zCi0gVGhlIHJhdyByZXR1cm4gdmFsdWUgb2YgZWFjaCBjYWxsLCBpbiBjYWxsIG9yZGVyLgAAAAltdWx0aWNhbGwAAAAAAAABAAAAAAAAAAVjYWxscwAAAAAAA+oAAAfQAAAABENhbGwAAAABAAAD6gAAAAA=",
        "AAAAAAAAAlFFeGVjdXRlIGBjYWxsc2AgaW4gb3JkZXIsIGlzb2xhdGluZyBlYWNoIGNhbGwncyBmYWlsdXJlOyByZXR1cm5zIG9uZQpyYXcgb3V0Y29tZSBwZXIgY2FsbC4KCkEgZmFpbGluZyBjYWxsIHJvbGxzIGJhY2sgaXRzIG93biBlZmZlY3RzIGFuZCB0aGUgYmF0Y2ggY29udGludWVzCndpdGggdGhlIG5leHQgY2FsbC4KCiMgQXJndW1lbnRzCi0gYGNhbGxzYDogdGhlIFtgQ2FsbGBdIHNlcXVlbmNlLCBleGVjdXRlZCBmcm9udCB0byBiYWNrLgoKIyBSZXR1cm5zCi0gT25lIGBWYWxgIHBlciBjYWxsLCBpbiBjYWxsIG9yZGVyOiB0aGUgY2FsbCdzIHJhdyByZXR1cm4gdmFsdWUgd2hlbgppdCBsYW5kcywgb3IgdGhlIGZhaWx1cmUgYXMgYSBob3N0IGBFcnJvcmAgdmFsdWUgd2hlbiBpdCBkb2VzIG5vdC4KVGhlIHR3byBjYW5ub3QgY29sbGlkZSAodGhlIGhvc3QgdHVybnMgYW4gZXJyb3ItdGFnZ2VkIHJldHVybiBpbnRvIGEKZmFpbHVyZSksIHNvIHRoZSBjYWxsZXIgc3BsaXRzIG9uIGBUYWc6OkVycm9yYCBhbmQgZGVjb2RlcyBzdWNjZXNzZXMKYWdhaW5zdCB0aGUgdGFyZ2V0IGVudHJ5J3Mgc2lnbmF0dXJlLCBzYW1lIGFzIGBtdWx0aWNhbGxgLgAAAAAAAA1tdWx0aWNhbGxfdHJ5AAAAAAAAAQAAAAAAAAAFY2FsbHMAAAAAAAPqAAAH0AAAAARDYWxsAAAAAQAAA+oAAAAA",
        "AAAAAAAAArVDcmVhdGUgYW4gb3JkZXIgb24gYHRyYWRpbmdgIGFuZCBmaWxsIGl0IGluIHRoZSBzYW1lIGludm9jYXRpb247CnJldHVybnMgdGhlIGZpbGwgcGF5b3V0ICh0b2tlbi1kZWMpLgoKRmlsbC1vci1raWxsOiBhIGZhaWxpbmcgZmlsbCB1bndpbmRzIHRoZSBjcmVhdGlvbiAoYW5kIHRoZSBhcHByb3ZhbCksCnNvIG5vdGhpbmcgcmVzdHMuIFdpdGggYGtlZXBlciA9IHVzZXJgIHRoZSBmaWxsIHJld2FyZCByb3VuZC10cmlwcyB0bwp0aGUgdHJhZGVyLgoKIyBBcmd1bWVudHMKLSBgdHJhZGluZ2A6IHRoZSB0YXJnZXQgdHJhZGluZyBjb250cmFjdC4KLSBga2VlcGVyYDogdGhlIGZpbGwtcmV3YXJkIHJlY2lwaWVudC4KLSBga2luZGA6IG1pcnJvcnMgdGhlIHRyYWRpbmcgY29udHJhY3QncyBgT3JkZXJLaW5kYCBkaXNjcmltaW5hbnQuCi0gUmVtYWluaW5nIGFyZ3VtZW50cyBtaXJyb3IgdGhlIHRyYWRpbmcgY29udHJhY3QncyBgY3JlYXRlX29yZGVyYCwKd2l0aCBgcHJpY2VgICh0aGUgc2VyaWFsaXplZCBwcmljZSB1cGRhdGUgZm9yIHRoZSBmaWxsKSBsYXN0LgoKIyBSZXR1cm5zCi0gVGhlIGZpbGwgcGF5b3V0IHBhaWQgdG8gYGtlZXBlcmAgKHRva2VuLWRlYykuCgojIEVycm9ycwotIFByb3BhZ2F0ZXMgdGhlIHRyYWRpbmcgY29udHJhY3QncyBgY3JlYXRlX29yZGVyYCBhbmQKYGV4ZWN1dGVfb3JkZXJgIGVycm9ycy4AAAAAAAAPY3JlYXRlX2FuZF9maWxsAAAAAAsAAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAARraW5kAAAABAAAAAAAAAAIbm90aW9uYWwAAAALAAAAAAAAAApjb2xsYXRlcmFsAAAAAAALAAAAAAAAAA10cmlnZ2VyX3ByaWNlAAAAAAAACwAAAAAAAAALcHJpY2VfYm91bmQAAAAACwAAAAAAAAAKZXhwaXJhdGlvbgAAAAAABAAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAAAs=",
        "AAAAAAAAAe1DcmVhdGUgYW4gb3JkZXIgb24gYHRyYWRpbmdgIGFuZCBhdHRlbXB0IGFuIGltbWVkaWF0ZSBmaWxsOyByZXR1cm5zCnRoZSBbYEZpbGxBdHRlbXB0YF0uCgpUaGUgY3JlYXRpb24gaXMgc3RyaWN0OyB0aGUgZmlsbCBsZWcgaXMgaXNvbGF0ZWQuIEEgZmFpbGVkIGZpbGwKbGVhdmVzIHRoZSBvcmRlciByZXN0aW5nIGZvciBhIGxhdGVyIGtlZXBlciBmaWxsIGFuZCByZXBvcnRzIHdoeSB2aWEKdGhlIGF0dGVtcHQncyBlcnJvciBjb2RlLgoKIyBBcmd1bWVudHMKLSBSZWZlciB0byBbYFJvdXRlckNvbnRyYWN0OjpjcmVhdGVfYW5kX2ZpbGxgXS4KCiMgUmV0dXJucwotIFRoZSBbYEZpbGxBdHRlbXB0YF0gY2FycnlpbmcgdGhlIGNyZWF0ZWQgb3JkZXIgaWQuCgojIEVycm9ycwotIFByb3BhZ2F0ZXMgdGhlIHRyYWRpbmcgY29udHJhY3QncyBgY3JlYXRlX29yZGVyYCBlcnJvcnM7IGZpbGwKZmFpbHVyZXMgYXJlIHJlcG9ydGVkIGluIHRoZSBbYEZpbGxBdHRlbXB0YF0uAAAAAAAAE2NyZWF0ZV9hbmRfdHJ5X2ZpbGwAAAAACwAAAAAAAAAHdHJhZGluZwAAAAATAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAABGtpbmQAAAAEAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAALAAAAAAAAAAtwcmljZV9ib3VuZAAAAAALAAAAAAAAAApleHBpcmF0aW9uAAAAAAAEAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAH0AAAAAtGaWxsQXR0ZW1wdAA=",
        "AAAAAAAABABDb2xsZWN0IGEgcmVsYXllciBmZWUgZnJvbSBgdXNlcmAsIHRoZW4gY3JlYXRlIGFuIG9yZGVyIG9uIGB0cmFkaW5nYAphbmQgZmlsbCBpdCBpbiB0aGUgc2FtZSBpbnZvY2F0aW9uOyByZXR1cm5zIHRoZSBmaWxsIHBheW91dCAodG9rZW4tZGVjKS4KClRoZSB1c2VyJ3MgYXV0aG9yaXphdGlvbiBjb3ZlcnMgdGhlIHNpZ25lZCBwcmVmaXggKGB0cmFkaW5nYCB0aHJvdWdoCmBleHBpcmF0aW9uYCk7IGBmZWVfYW1vdW50YCwgYGZlZV9yZWNpcGllbnRgLCBga2VlcGVyYCwgYW5kIGBwcmljZWAKc2l0IG91dHNpZGUgaXQsIHNvIHRoZSBzdWJtaXR0ZXIgc2V0cyB0aGVtIGFmdGVyIHNpZ25pbmcuCkZpbGwtb3Ita2lsbDogYSBmYWlsaW5nIGZpbGwgdW53aW5kcyB0aGUgY3JlYXRpb24sIHRoZSBhcHByb3ZhbHMsIGFuZAp0aGUgZmVlLCBzbyBub3RoaW5nIHJlc3RzLgoKIyBBdXRob3JpemF0aW9uCi0gYHVzZXJgLCBvdmVyIGAodHJhZGluZywgZmVlX3Rva2VuLCBtYXhfZmVlX2Ftb3VudCwgaXNfbG9uZywga2luZCwKbm90aW9uYWwsIGNvbGxhdGVyYWwsIHRyaWdnZXJfcHJpY2UsIHByaWNlX2JvdW5kLCBleHBpcmF0aW9uKWAuCgojIEFyZ3VtZW50cwotIGB0cmFkaW5nYDogdGhlIHRhcmdldCB0cmFkaW5nIGNvbnRyYWN0LgotIGB1c2VyYDogdGhlIG9yZGVyIG93bmVyIGFuZCBmZWUgcGF5ZXIuCi0gYGZlZV90b2tlbmA6IHRoZSB0b2tlbiB0aGUgZmVlIGlzIGNvbGxlY3RlZCBpbi4KLSBgbWF4X2ZlZV9hbW91bnRgOiB0aGUgdXNlci1hdXRob3JpemVkIGZlZSBjZWlsaW5nICh0b2tlbi1kZWMpLgotIGBraW5kYDogbWlycm9ycyB0aGUgdHJhZGluZyBjb250cmFjdCdzIGBPcmRlcktpbmRgIGRpc2NyaW1pbmFudC4KLSBgZXhwaXJhdGlvbmA6IHRoZSBvcmRlcidzIGV4cGlyYXRpb24gbGVkZ2VyOyBhbHNvIHRoZSBmZWUKYWxsb3dhbmNlJ3MgbGl2ZS11bnRpbCBsZWRnZXIuCi0gYGZlZV9hbW91bnRgOiB0aGUgZmVlIGNvbGxlY3RlZCAodG9rZW4tZGVjKTsgMCBza2lwcyBjb2xsZWN0aW9uLgotIGBmAAAAGGNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZQAAAA8AAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAAAAAACWZlZV90b2tlbgAAAAAAABMAAAAAAAAADm1heF9mZWVfYW1vdW50AAAAAAALAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAABGtpbmQAAAAEAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAALAAAAAAAAAAtwcmljZV9ib3VuZAAAAAALAAAAAAAAAApleHBpcmF0aW9uAAAAAAAEAAAAAAAAAApmZWVfYW1vdW50AAAAAAALAAAAAAAAAA1mZWVfcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAACw==",
        "AAAAAAAAA49Db2xsZWN0IGEgcmVsYXllciBmZWUgZnJvbSBgdXNlcmAsIHRoZW4gY3JlYXRlIGFuIG9yZGVyIG9uIGB0cmFkaW5nYAphbmQgYXR0ZW1wdCBhbiBpbW1lZGlhdGUgZmlsbDsgcmV0dXJucyB0aGUgW2BGaWxsQXR0ZW1wdGBdLgoKU2hhcmVzIFtgUm91dGVyQ29udHJhY3Q6OmNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZWBdJ3MgZW52ZWxvcGUgYW5kCmF1dGhvcml6YXRpb24uIFRoZSBmZWUgYW5kIGNyZWF0aW9uIGxlZ3MgYXJlIHN0cmljdDsgdGhlIGZpbGwgbGVnIGlzCmlzb2xhdGVkLCBzbyBhIGZhaWxlZCBmaWxsIGxlYXZlcyB0aGUgb3JkZXIgcmVzdGluZyB3aXRoIHRoZSBmZWUKY29sbGVjdGVkIGFuZCByZXBvcnRzIHdoeSB2aWEgdGhlIGF0dGVtcHQncyBlcnJvciBjb2RlLgoKIyBBdXRob3JpemF0aW9uCi0gUmVmZXIgdG8gW2BSb3V0ZXJDb250cmFjdDo6Y3JlYXRlX2FuZF9maWxsX3dpdGhfZmVlYF0uCgojIEFyZ3VtZW50cwotIFJlZmVyIHRvIFtgUm91dGVyQ29udHJhY3Q6OmNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZWBdLgoKIyBSZXR1cm5zCi0gVGhlIFtgRmlsbEF0dGVtcHRgXSBjYXJyeWluZyB0aGUgY3JlYXRlZCBvcmRlciBpZC4KCiMgRXJyb3JzCi0gYHN0ZWxsYXJfZmVlX2Fic3RyYWN0aW9uOjpGZWVBYnN0cmFjdGlvbkVycm9yOjpJbnZhbGlkRmVlQm91bmRzYDoKYGZlZV9hbW91bnRgIGlzIG5lZ2F0aXZlIG9yIGV4Y2VlZHMgYG1heF9mZWVfYW1vdW50YC4KLSBQcm9wYWdhdGVzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYGNyZWF0ZV9vcmRlcmAgZXJyb3JzOyBmaWxsCmZhaWx1cmVzIGFyZSByZXBvcnRlZCBpbiB0aGUgW2BGaWxsQXR0ZW1wdGBdLgoKIyBFdmVudHMKLSBgZmVlX2NvbGxlY3RlZGA6IHRoZSBmZWUgbW92ZWQgZnJvbSBgdXNlcmAgdG8gYGZlZV9yZWNpcGllbnRgLgAAAAAcY3JlYXRlX2FuZF90cnlfZmlsbF93aXRoX2ZlZQAAAA8AAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAAAAAACWZlZV90b2tlbgAAAAAAABMAAAAAAAAADm1heF9mZWVfYW1vdW50AAAAAAALAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAABGtpbmQAAAAEAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAALAAAAAAAAAAtwcmljZV9ib3VuZAAAAAALAAAAAAAAAApleHBpcmF0aW9uAAAAAAAEAAAAAAAAAApmZWVfYW1vdW50AAAAAAALAAAAAAAAAA1mZWVfcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAH0AAAAAtGaWxsQXR0ZW1wdAA=",
        "AAAAAQAAACNPbmUgY29udHJhY3QgaW52b2NhdGlvbiBpbiBhIGJhdGNoLgAAAAAAAAAABENhbGwAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAEZnVuYwAAABE=",
        "AAAAAQAAAClUaGUgcmVzdWx0IG9mIGEgY3JlYXRlLWFuZC10cnktZmlsbCBmbG93LgAAAAAAAAAAAAALRmlsbEF0dGVtcHQAAAAABAAAAAAAAAAFZXJyb3IAAAAAAAAEAAAAAAAAAAZmaWxsZWQAAAAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAZwYXlvdXQAAAAAAAs=",
        "AAAABQAAADJFdmVudCBlbWl0dGVkIHdoZW4gYSBmZWUgaXMgY29sbGVjdGVkIGZyb20gYSB1c2VyLgAAAAAAAAAAAAxGZWVDb2xsZWN0ZWQAAAABAAAADWZlZV9jb2xsZWN0ZWQAAAAAAAAEAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
    ]);

    static readonly parsers = {
        // --- generic batching ---
        multicall: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        multicallTry: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(parseCallOutcome),
        // --- create-and-fill flows ---
        createAndFill: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        createAndTryFill: (result: string): FillAttempt =>
            parseFillAttempt(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        createAndFillWithFee: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        createAndTryFillWithFee: (result: string): FillAttempt =>
            parseFillAttempt(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
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
     * Run `calls` in order and fill the first one, all in a single
     * invocation; returns the fill payout (token-dec).
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
     * - The fill payout paid to `keeper` (token-dec).
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
     * returns the `FillAttempt`.
     *
     * The batch is strict; the fill leg is isolated. A failed fill leaves
     * every created order resting for a later keeper fill and reports why
     * via the attempt's error code.
     *
     * Arguments mirror `createAndFill`.
     *
     * # Returns
     * - The `FillAttempt` carrying the created order id.
     *
     * # Errors
     * - Propagates the trading contract's `create_order` errors; fill
     *   failures are reported in the `FillAttempt`.
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
     * one, all in a single invocation; returns the fill payout (token-dec).
     *
     * `calls[0]` must be a `create_order` (the order the fill targets); build
     * it with [`TradingRouterContract.createOrderCall`]. Calls after the
     * first simply rest.
     *
     * The user's authorization covers the signed prefix
     * `(calls, feeToken, maxFeeAmount)`; the replaceable tail
     * `(feeAmount, feeRecipient, keeper, price)` sits outside it, so the
     * relay sets those after signing. The whole batch is signed as one value,
     * so the inner `create_order` (and any further inner calls) ride the
     * signed auth tree as sub-invocation entries. Fill-or-kill: a failing
     * fill unwinds the batch, the approvals, and the fee, so nothing rests.
     * `feeAmount` must not exceed `maxFeeAmount`; `0n` skips collection.
     *
     * # Returns
     * - The fill payout paid to `keeper` (token-dec).
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
     * Collect a relayer fee from `user`, then create an order on `trading`
     * and attempt an immediate fill; returns the `FillAttempt`.
     *
     * Shares `createAndFillWithFee`'s envelope and authorization (signed
     * prefix `(calls, feeToken, maxFeeAmount)`). The fee and batch legs are
     * strict; the fill leg is isolated, so a failed fill leaves every created
     * order resting with the fee collected and reports why via the attempt's
     * error code.
     *
     * # Returns
     * - The `FillAttempt` carrying the created order id.
     *
     * # Errors
     * - `stellar_fee_abstraction::FeeAbstractionError::InvalidFeeBounds`
     *   (#5003): `feeAmount` is negative or exceeds `maxFeeAmount`.
     * - Propagates the trading contract's `create_order` errors; fill
     *   failures are reported in the `FillAttempt`.
     *
     * # Events
     * - `fee_collected`: the fee moved from `user` to `feeRecipient`.
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
 * Encode the 8-arg with-fee tuple in on-chain order:
 * `(calls, user, fee_token, max_fee_amount, fee_amount, fee_recipient,
 * keeper, price)`. The signed prefix is `(calls, fee_token, max_fee_amount)`;
 * the replaceable tail `(fee_amount, fee_recipient, keeper, price)` sits
 * outside the user's signature and the relay rewrites it before submission.
 */
function withFeeScVals(args: CreateAndFillWithFeeArgs): xdr.ScVal[] {
    return [
        xdr.ScVal.scvVec(args.calls.map(callToScVal)),
        Address.fromString(args.user).toScVal(),
        Address.fromString(args.feeToken).toScVal(),
        nativeToScVal(args.maxFeeAmount, { type: 'i128' }),
        nativeToScVal(args.feeAmount, { type: 'i128' }),
        Address.fromString(args.feeRecipient).toScVal(),
        Address.fromString(args.keeper).toScVal(),
        xdr.ScVal.scvBytes(priceBuffer(args.price)),
    ];
}
