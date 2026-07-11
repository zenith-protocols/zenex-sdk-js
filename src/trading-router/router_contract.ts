import { Address, Contract, contract, xdr, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { i128, u32 } from '../index.js';
import type { OrderKind } from '../trading/trading_types.js';
import {
    Call, CallOutcome, FillAttempt,
    callToScVal, parseCallOutcome, parseFillAttempt,
} from './router_types.js';

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer` for `scvBytes`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/** Shared shape of the create-and-fill argument tuple (fee and fee-free forms). */
interface CreateAndFillArgs {
    trading: string;
    user: string;
    isLong: boolean;
    kind: OrderKind;
    notional: i128;
    collateral: i128;
    triggerPrice: i128;
    priceBound: i128;
    expiration: u32;
    keeper: string;
    price: Buffer | Uint8Array;
}

/** Arguments for the fee-abstracted create-and-fill flows. */
export interface CreateAndFillWithFeeArgs extends CreateAndFillArgs {
    /** Token the relayer fee is collected in. */
    feeToken: string;
    /** User-authorized fee ceiling (token-dec). */
    maxFeeAmount: i128;
    /** Fee collected (token-dec); `0n` skips collection. */
    feeAmount: i128;
    /** Fee payee. */
    feeRecipient: string;
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
     * Create an order on `trading` and fill it in the same invocation;
     * returns the fill payout (token-dec).
     *
     * Fill-or-kill: a failing fill unwinds the creation, so nothing rests.
     * With `keeper = user` the fill reward round-trips to the trader.
     *
     * `kind` is the trading contract's `OrderKind` discriminant (crosses
     * the ABI as a plain u32). Remaining arguments mirror the trading
     * contract's `create_order`, with `price` (the serialized price update
     * for the fill) last.
     *
     * # Returns
     * - The fill payout paid to `keeper` (token-dec).
     *
     * # Errors
     * - Propagates the trading contract's `create_order` and
     *   `execute_order` errors.
     */
    createAndFill(
        trading: string,
        keeper: string,
        user: string,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        collateral: i128,
        triggerPrice: i128,
        priceBound: i128,
        expiration: u32,
        price: Buffer | Uint8Array,
    ): string {
        return this.call(
            'create_and_fill',
            Address.fromString(trading).toScVal(),
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
            xdr.ScVal.scvU32(kind),
            nativeToScVal(notional, { type: 'i128' }),
            nativeToScVal(collateral, { type: 'i128' }),
            nativeToScVal(triggerPrice, { type: 'i128' }),
            nativeToScVal(priceBound, { type: 'i128' }),
            xdr.ScVal.scvU32(expiration),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Create an order on `trading` and attempt an immediate fill; returns
     * the `FillAttempt`.
     *
     * The creation is strict; the fill leg is isolated. A failed fill
     * leaves the order resting for a later keeper fill and reports why via
     * the attempt's error code.
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
        trading: string,
        keeper: string,
        user: string,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        collateral: i128,
        triggerPrice: i128,
        priceBound: i128,
        expiration: u32,
        price: Buffer | Uint8Array,
    ): string {
        return this.call(
            'create_and_try_fill',
            Address.fromString(trading).toScVal(),
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
            xdr.ScVal.scvU32(kind),
            nativeToScVal(notional, { type: 'i128' }),
            nativeToScVal(collateral, { type: 'i128' }),
            nativeToScVal(triggerPrice, { type: 'i128' }),
            nativeToScVal(priceBound, { type: 'i128' }),
            xdr.ScVal.scvU32(expiration),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Collect a relayer fee from `user`, then create an order on `trading`
     * and fill it in the same invocation; returns the fill payout
     * (token-dec).
     *
     * The user's authorization covers the signed prefix (`trading` through
     * `expiration`); `feeAmount`, `feeRecipient`, `keeper`, and `price` sit
     * outside it, so the submitter sets them after signing. Fill-or-kill: a
     * failing fill unwinds the creation, the approvals, and the fee, so
     * nothing rests. `feeAmount` must not exceed `maxFeeAmount`; `0n` skips
     * collection.
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
     * Shares `createAndFillWithFee`'s envelope and authorization. The fee
     * and creation legs are strict; the fill leg is isolated, so a failed
     * fill leaves the order resting with the fee collected and reports why
     * via the attempt's error code.
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
}

/**
 * Encode the 15-arg with-fee tuple in on-chain order. The last four slots
 * (`fee_amount`, `fee_recipient`, `keeper`, `price`) are the injected tail
 * outside the user's signature; the relay rewrites them before submission.
 */
function withFeeScVals(args: CreateAndFillWithFeeArgs): xdr.ScVal[] {
    return [
        Address.fromString(args.trading).toScVal(),
        Address.fromString(args.user).toScVal(),
        Address.fromString(args.feeToken).toScVal(),
        nativeToScVal(args.maxFeeAmount, { type: 'i128' }),
        xdr.ScVal.scvBool(args.isLong),
        xdr.ScVal.scvU32(args.kind),
        nativeToScVal(args.notional, { type: 'i128' }),
        nativeToScVal(args.collateral, { type: 'i128' }),
        nativeToScVal(args.triggerPrice, { type: 'i128' }),
        nativeToScVal(args.priceBound, { type: 'i128' }),
        xdr.ScVal.scvU32(args.expiration),
        nativeToScVal(args.feeAmount, { type: 'i128' }),
        Address.fromString(args.feeRecipient).toScVal(),
        Address.fromString(args.keeper).toScVal(),
        xdr.ScVal.scvBytes(priceBuffer(args.price)),
    ];
}
