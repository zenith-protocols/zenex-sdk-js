import { Address, Contract, contract, xdr, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { i128, u32 } from '../index.js';
import { OrderKind, VaultOrderKind, orderKindToScVal, vaultOrderKindToScVal } from '../trading/trading_types.js';
import {
    Call, CallOutcome, FillAttempt, AdlTarget,
    callToScVal, adlTargetToScVal, parseCallOutcome, parseFillAttempt,
} from './router_types.js';

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer` for `scvBytes`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/**
 * TradingRouterContract - Operation builder for the Zenex v2 stateless call
 * router (generic batching plus the dependent Zenex flows: atomic
 * create-and-fill, ADL sweeps).
 *
 * Mirrors `zenex-contracts/trading-router/src/lib.rs`. All methods return
 * base64-encoded XDR operations for transaction building.
 */
export class TradingRouterContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAAAAAAApREZWxldmVyYWdlIGB0YXJnZXRzYCBvbiBgdHJhZGluZ2AgYmFjayB0byBiYWNrOyByZXR1cm5zIG9uZQpbYENhbGxPdXRjb21lYF0gcGVyIGF0dGVtcHRlZCB0YXJnZXQuCgpFYWNoIGNsb3NlIHJ1bnMgaXNvbGF0ZWQsIGFuZCB0aGUgc3dlZXAgc3RvcHMgYWZ0ZXIgYSB0YXJnZXQgcmVwb3J0cwpgQWRsTm90VHJpZ2dlcmVkYCAodGhlIHBlbmRpbmctUG5MIHJhdGlvIHJlYWNoZWQgaXRzIGNsZWFyIHRhcmdldCksIHNvCnRoZSByZXR1cm5lZCB2ZWN0b3IgY292ZXJzIG9ubHkgdGhlIGF0dGVtcHRlZCBwcmVmaXguIEEgdGFyZ2V0IGFtb3VudApvZiBgaTEyODo6TUFYYCBsZXRzIHRoZSB0cmFkaW5nIGNvbnRyYWN0IHNpemUgZWFjaCBjbG9zZSBmcm9tIGxpdmUKc3RhdGUuCgojIEFyZ3VtZW50cwotIGB0cmFkaW5nYDogdGhlIHRhcmdldCB0cmFkaW5nIGNvbnRyYWN0LgotIGBrZWVwZXJgOiB0aGUgcmV3YXJkIHJlY2lwaWVudC4KLSBgdGFyZ2V0c2A6IHRoZSBwb3NpdGlvbnMgdG8gZGVsZXZlcmFnZSwgaW4gZXhlY3V0aW9uIG9yZGVyLgotIGBwcmljZWA6IHRoZSBzZXJpYWxpemVkIHByaWNlIHVwZGF0ZSBzaGFyZWQgYnkgZXZlcnkgY2xvc2UuCgojIFJldHVybnMKLSBPbmUgW2BDYWxsT3V0Y29tZWBdIHBlciBhdHRlbXB0ZWQgdGFyZ2V0LCBpbiBvcmRlci4AAAAJYWRsX3N3ZWVwAAAAAAAABAAAAAAAAAAHdHJhZGluZwAAAAATAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAAB3RhcmdldHMAAAAD6gAAB9AAAAAJQWRsVGFyZ2V0AAAAAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAD6gAAB9AAAAALQ2FsbE91dGNvbWUA",
        "AAAAAAAAARxFeGVjdXRlIGBjYWxsc2AgaW4gb3JkZXIgYW5kIHJldHVybiBlYWNoIGNhbGwncyByYXcgcmV0dXJuIHZhbHVlLgoKQW55IGZhaWxpbmcgY2FsbCB0cmFwcyB0aGUgd2hvbGUgaW52b2NhdGlvbiwgc28gZWl0aGVyIGV2ZXJ5IGNhbGwKbGFuZHMgb3Igbm9uZSBkby4KCiMgQXJndW1lbnRzCi0gYGNhbGxzYDogdGhlIFtgQ2FsbGBdIHNlcXVlbmNlLCBleGVjdXRlZCBmcm9udCB0byBiYWNrLgoKIyBSZXR1cm5zCi0gVGhlIHJhdyByZXR1cm4gdmFsdWUgb2YgZWFjaCBjYWxsLCBpbiBjYWxsIG9yZGVyLgAAAAltdWx0aWNhbGwAAAAAAAABAAAAAAAAAAVjYWxscwAAAAAAA+oAAAfQAAAABENhbGwAAAABAAAD6gAAAAA=",
        "AAAAAAAAATZFeGVjdXRlIGBjYWxsc2AgaW4gb3JkZXIsIGlzb2xhdGluZyBlYWNoIGNhbGwncyBmYWlsdXJlOyByZXR1cm5zIG9uZQpbYENhbGxPdXRjb21lYF0gcGVyIGNhbGwuCgpBIGZhaWxpbmcgY2FsbCByb2xscyBiYWNrIGl0cyBvd24gZWZmZWN0cyBhbmQgdGhlIGJhdGNoIGNvbnRpbnVlcwp3aXRoIHRoZSBuZXh0IGNhbGwuCgojIEFyZ3VtZW50cwotIGBjYWxsc2A6IHRoZSBbYENhbGxgXSBzZXF1ZW5jZSwgZXhlY3V0ZWQgZnJvbnQgdG8gYmFjay4KCiMgUmV0dXJucwotIE9uZSBbYENhbGxPdXRjb21lYF0gcGVyIGNhbGwsIGluIGNhbGwgb3JkZXIuAAAAAAANbXVsdGljYWxsX3RyeQAAAAAAAAEAAAAAAAAABWNhbGxzAAAAAAAD6gAAB9AAAAAEQ2FsbAAAAAEAAAPqAAAH0AAAAAtDYWxsT3V0Y29tZQA=",
        "AAAAAAAAAx5DcmVhdGUgYW4gb3JkZXIgb24gYHRyYWRpbmdgIGFuZCBmaWxsIGl0IGluIHRoZSBzYW1lIGludm9jYXRpb247CnJldHVybnMgdGhlIGZpbGwgcGF5b3V0ICh0b2tlbi1kZWMpLgoKRmlsbC1vci1raWxsOiBhIGZhaWxpbmcgZmlsbCB1bndpbmRzIHRoZSBjcmVhdGlvbiAoYW5kIHRoZSBhcHByb3ZhbCksCnNvIG5vdGhpbmcgcmVzdHMuIFdpdGggYGtlZXBlciA9IHVzZXJgIHRoZSBmaWxsIHJld2FyZCByb3VuZC10cmlwcyB0bwp0aGUgdHJhZGVyLgoKIyBBcmd1bWVudHMKLSBgdHJhZGluZ2A6IHRoZSB0YXJnZXQgdHJhZGluZyBjb250cmFjdC4KLSBga2VlcGVyYDogdGhlIGZpbGwtcmV3YXJkIHJlY2lwaWVudC4KLSBgYXBwcm92ZV9hbW91bnRgOiBjb2xsYXRlcmFsIGFsbG93YW5jZSBzZXQgZm9yIGB0cmFkaW5nYCBiZWZvcmUgdGhlCmNyZWF0aW9uICh0b2tlbi1kZWMpOyAwIHNraXBzIHRoZSBhcHByb3ZhbC4gU2V0cyB0aGUgYWJzb2x1dGUKYWxsb3dhbmNlIG9uIHRoZSB1c2VyLXRpZXIgVFRMIGhvcml6b24uCi0gUmVtYWluaW5nIGFyZ3VtZW50cyBtaXJyb3IgdGhlIHRyYWRpbmcgY29udHJhY3QncyBgY3JlYXRlX29yZGVyYCwKd2l0aCBgcHJpY2VgICh0aGUgc2VyaWFsaXplZCBwcmljZSB1cGRhdGUgZm9yIHRoZSBmaWxsKSBsYXN0LgoKIyBSZXR1cm5zCi0gVGhlIGZpbGwgcGF5b3V0IHBhaWQgdG8gYGtlZXBlcmAgKHRva2VuLWRlYykuCgojIEVycm9ycwotIFByb3BhZ2F0ZXMgdGhlIHRyYWRpbmcgY29udHJhY3QncyBgY3JlYXRlX29yZGVyYCBhbmQKYGV4ZWN1dGVfb3JkZXJgIGVycm9ycy4AAAAAAA9jcmVhdGVfYW5kX2ZpbGwAAAAADQAAAAAAAAAHdHJhZGluZwAAAAATAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAA5hcHByb3ZlX2Ftb3VudAAAAAAACwAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAARraW5kAAAH0AAAAAlPcmRlcktpbmQAAAAAAAAAAAAACG5vdGlvbmFsAAAACwAAAAAAAAAKY29sbGF0ZXJhbAAAAAAACwAAAAAAAAANdHJpZ2dlcl9wcmljZQAAAAAAAAsAAAAAAAAADXRyaWdnZXJfYWJvdmUAAAAAAAABAAAAAAAAAAtwcmljZV9ib3VuZAAAAAALAAAAAAAAAApleHBpcmF0aW9uAAAAAAAEAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAACw==",
        "AAAAAAAAAhhDcmVhdGUgYW4gb3JkZXIgb24gYHRyYWRpbmdgIGFuZCBhdHRlbXB0IGFuIGltbWVkaWF0ZSBmaWxsOyByZXR1cm5zCnRoZSBbYEZpbGxBdHRlbXB0YF0uCgpUaGUgYXBwcm92YWwgYW5kIGNyZWF0aW9uIGFyZSBzdHJpY3Q7IHRoZSBmaWxsIGxlZyBpcyBpc29sYXRlZC4gQQpmYWlsZWQgZmlsbCBsZWF2ZXMgdGhlIG9yZGVyIHJlc3Rpbmcgd2l0aCBpdHMgYWxsb3dhbmNlIGluIHBsYWNlIGZvcgphIGxhdGVyIGtlZXBlciBmaWxsLCBhbmQgcmVwb3J0cyB3aHkgdmlhIHRoZSBhdHRlbXB0J3MgZXJyb3IgY29kZS4KCiMgQXJndW1lbnRzCi0gUmVmZXIgdG8gW2BSb3V0ZXJDb250cmFjdDo6Y3JlYXRlX2FuZF9maWxsYF0uCgojIFJldHVybnMKLSBUaGUgW2BGaWxsQXR0ZW1wdGBdIGNhcnJ5aW5nIHRoZSBjcmVhdGVkIG9yZGVyIGlkLgoKIyBFcnJvcnMKLSBQcm9wYWdhdGVzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYGNyZWF0ZV9vcmRlcmAgZXJyb3JzOyBmaWxsCmZhaWx1cmVzIGFyZSByZXBvcnRlZCBpbiB0aGUgW2BGaWxsQXR0ZW1wdGBdLgAAABNjcmVhdGVfYW5kX3RyeV9maWxsAAAAAA0AAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAOYXBwcm92ZV9hbW91bnQAAAAAAAsAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAAAAAAEa2luZAAAB9AAAAAJT3JkZXJLaW5kAAAAAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAALAAAAAAAAAA10cmlnZ2VyX2Fib3ZlAAAAAAAAAQAAAAAAAAALcHJpY2VfYm91bmQAAAAACwAAAAAAAAAKZXhwaXJhdGlvbgAAAAAABAAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAB9AAAAALRmlsbEF0dGVtcHQA",
        "AAAAAAAAAyBDcmVhdGUgYSB2YXVsdCBvcmRlciBvbiBgdHJhZGluZ2AgYW5kIGF0dGVtcHQgYW4gaW1tZWRpYXRlIGZpbGw7CnJldHVybnMgdGhlIFtgRmlsbEF0dGVtcHRgXS4KClRoZSBjcmVhdGlvbiBpcyBzdHJpY3Q7IHRoZSBmaWxsIGxlZyBpcyBpc29sYXRlZCwgc28gYSBjb29saW5nLWRvd24Kb3JkZXIgc2ltcGx5IHJlc3RzIChhIGxvY2tlZCBkZXBvc2l0IG9yIHJlZGVlbSBpcyB0aGUgbm9ybWFsIGNhc2UsCnJlcG9ydGVkIGFzIFtgRmlsbEF0dGVtcHRgXSB3aXRoIHRoZSBsb2NrIGVycm9yKS4gQSBSZXRpcmVkLW1hcmtldApyZWRlZW0gcGF5cyBvdXQgYXQgY3JlYXRpb24gYW5kIHJldHVybnMgaWQgMCB3aXRoIGBmaWxsZWQgPSB0cnVlYC4KCiMgQXJndW1lbnRzCi0gYHRyYWRpbmdgOiB0aGUgdGFyZ2V0IHRyYWRpbmcgY29udHJhY3QuCi0gYGtlZXBlcmA6IHRoZSBmaWxsLWZlZSByZWNpcGllbnQuCi0gYGtpbmRgIC8gYGFtb3VudGAgLyBgbWF4X2FkdmVyc2VfcG5sYDogbWlycm9yIHRoZSB0cmFkaW5nCmNvbnRyYWN0J3MgYGNyZWF0ZV92YXVsdF9vcmRlcmAuCi0gYHByaWNlYDogdGhlIHNlcmlhbGl6ZWQgcHJpY2UgdXBkYXRlIGZvciB0aGUgZmlsbCBsZWcuCgojIFJldHVybnMKLSBUaGUgW2BGaWxsQXR0ZW1wdGBdIGNhcnJ5aW5nIHRoZSBjcmVhdGVkIHZhdWx0IG9yZGVyIGlkLgoKIyBFcnJvcnMKLSBQcm9wYWdhdGVzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYGNyZWF0ZV92YXVsdF9vcmRlcmAgZXJyb3JzOyBmaWxsCmZhaWx1cmVzIGFyZSByZXBvcnRlZCBpbiB0aGUgW2BGaWxsQXR0ZW1wdGBdLgAAAB9jcmVhdGVfYW5kX3RyeV9maWxsX3ZhdWx0X29yZGVyAAAAAAcAAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAEa2luZAAAB9AAAAAOVmF1bHRPcmRlcktpbmQAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAA9tYXhfYWR2ZXJzZV9wbmwAAAAACwAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAB9AAAAALRmlsbEF0dGVtcHQA",
        "AAAAAQAAACNPbmUgY29udHJhY3QgaW52b2NhdGlvbiBpbiBhIGJhdGNoLgAAAAAAAAAABENhbGwAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAEZnVuYwAAABE=",
        "AAAAAQAAAChPbmUgZGVsZXZlcmFnaW5nIHRhcmdldCBvZiBhbiBBREwgc3dlZXAuAAAAAAAAAAlBZGxUYXJnZXQAAAAAAAADAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAAAAAAEdXNlcgAAABM=",
        "AAAAAgAAAEdNaXJyb3JzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYE9yZGVyS2luZGAuIFNhbWUgWERSIGVuY29kaW5nIG9uLWNoYWluLgAAAAAAAAAACU9yZGVyS2luZAAAAAAAAAIAAAAAAAAAAAAAAAhJbmNyZWFzZQAAAAAAAAAAAAAACERlY3JlYXNl",
        "AAAAAQAAAB9UaGUgcmVzdWx0IG9mIG9uZSBiYXRjaGVkIGNhbGwuAAAAAAAAAAALQ2FsbE91dGNvbWUAAAAAAwAAAAAAAAAFZXJyb3IAAAAAAAAEAAAAAAAAAAJvawAAAAAAAQAAAAAAAAAFdmFsdWUAAAAAAAAL",
        "AAAAAQAAAClUaGUgcmVzdWx0IG9mIGEgY3JlYXRlLWFuZC10cnktZmlsbCBmbG93LgAAAAAAAAAAAAALRmlsbEF0dGVtcHQAAAAABAAAAAAAAAAFZXJyb3IAAAAAAAAEAAAAAAAAAAZmaWxsZWQAAAAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAZwYXlvdXQAAAAAAAs=",
        "AAAAAgAAAExNaXJyb3JzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYFZhdWx0T3JkZXJLaW5kYC4gU2FtZSBYRFIgZW5jb2Rpbmcgb24tY2hhaW4uAAAAAAAAAA5WYXVsdE9yZGVyS2luZAAAAAAAAgAAAAAAAAAAAAAAB0RlcG9zaXQAAAAAAAAAAAAAAAAGUmVkZWVtAAA="
    ]);

    static readonly parsers = {
        // --- generic batching ---
        multicall: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        multicallTry: (result: string): CallOutcome[] =>
            (scValToNative(xdr.ScVal.fromXDR(result, 'base64')) as Record<string, unknown>[])
                .map(parseCallOutcome),
        // --- create-and-fill flows ---
        createAndFill: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        createAndTryFill: (result: string): FillAttempt =>
            parseFillAttempt(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        createAndTryFillVaultOrder: (result: string): FillAttempt =>
            parseFillAttempt(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        // --- ADL sweep ---
        adlSweep: (result: string): CallOutcome[] =>
            (scValToNative(xdr.ScVal.fromXDR(result, 'base64')) as Record<string, unknown>[])
                .map(parseCallOutcome),
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
     * `CallOutcome` per call.
     *
     * A failing call rolls back its own effects and the batch continues
     * with the next call.
     *
     * # Returns
     * - One `CallOutcome` per call, in call order.
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
     * Fill-or-kill: a failing fill unwinds the creation (and the approval),
     * so nothing rests. With `keeper = user` the fill reward round-trips to
     * the trader.
     *
     * `approveAmount` is the collateral allowance set for `trading` before
     * the creation (token-dec); `0n` skips the approval. Sets the absolute
     * allowance on the user-tier TTL horizon. Remaining arguments mirror the
     * trading contract's `create_order`, with `price` (the serialized price
     * update for the fill) last.
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
        approveAmount: i128,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        collateral: i128,
        triggerPrice: i128,
        triggerAbove: boolean,
        priceBound: i128,
        expiration: u32,
        price: Buffer | Uint8Array,
    ): string {
        return this.call(
            'create_and_fill',
            Address.fromString(trading).toScVal(),
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            nativeToScVal(approveAmount, { type: 'i128' }),
            xdr.ScVal.scvBool(isLong),
            orderKindToScVal(kind),
            nativeToScVal(notional, { type: 'i128' }),
            nativeToScVal(collateral, { type: 'i128' }),
            nativeToScVal(triggerPrice, { type: 'i128' }),
            xdr.ScVal.scvBool(triggerAbove),
            nativeToScVal(priceBound, { type: 'i128' }),
            xdr.ScVal.scvU32(expiration),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Create an order on `trading` and attempt an immediate fill; returns
     * the `FillAttempt`.
     *
     * The approval and creation are strict; the fill leg is isolated. A
     * failed fill leaves the order resting with its allowance in place for
     * a later keeper fill, and reports why via the attempt's error code.
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
        approveAmount: i128,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        collateral: i128,
        triggerPrice: i128,
        triggerAbove: boolean,
        priceBound: i128,
        expiration: u32,
        price: Buffer | Uint8Array,
    ): string {
        return this.call(
            'create_and_try_fill',
            Address.fromString(trading).toScVal(),
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            nativeToScVal(approveAmount, { type: 'i128' }),
            xdr.ScVal.scvBool(isLong),
            orderKindToScVal(kind),
            nativeToScVal(notional, { type: 'i128' }),
            nativeToScVal(collateral, { type: 'i128' }),
            nativeToScVal(triggerPrice, { type: 'i128' }),
            xdr.ScVal.scvBool(triggerAbove),
            nativeToScVal(priceBound, { type: 'i128' }),
            xdr.ScVal.scvU32(expiration),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Create a vault order on `trading` and attempt an immediate fill;
     * returns the `FillAttempt`.
     *
     * The creation is strict; the fill leg is isolated, so a cooling-down
     * order simply rests (a locked deposit or redeem is the normal case,
     * reported as `FillAttempt` with the lock error). A Retired-market
     * redeem pays out at creation and returns id `0` with `filled = true`.
     *
     * `kind` / `amount` / `maxAdversePnl` mirror the trading contract's
     * `create_vault_order`; `price` is the serialized price update for the
     * fill leg.
     *
     * # Returns
     * - The `FillAttempt` carrying the created vault order id.
     *
     * # Errors
     * - Propagates the trading contract's `create_vault_order` errors; fill
     *   failures are reported in the `FillAttempt`.
     */
    createAndTryFillVaultOrder(
        trading: string,
        keeper: string,
        user: string,
        kind: VaultOrderKind,
        amount: i128,
        maxAdversePnl: i128,
        price: Buffer | Uint8Array,
    ): string {
        return this.call(
            'create_and_try_fill_vault_order',
            Address.fromString(trading).toScVal(),
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            vaultOrderKindToScVal(kind),
            nativeToScVal(amount, { type: 'i128' }),
            nativeToScVal(maxAdversePnl, { type: 'i128' }),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Deleverage `targets` on `trading` back to back; returns one
     * `CallOutcome` per attempted target.
     *
     * Each close runs isolated, and the sweep stops after a target reports
     * `AdlNotTriggered` (the pending-PnL ratio reached its clear target), so
     * the returned vector covers only the attempted prefix. A target
     * `amount` of `i128::MAX` lets the trading contract size each close
     * from live state.
     *
     * # Returns
     * - One `CallOutcome` per attempted target, in order.
     */
    adlSweep(trading: string, keeper: string, targets: AdlTarget[], price: Buffer | Uint8Array): string {
        return this.call(
            'adl_sweep',
            Address.fromString(trading).toScVal(),
            Address.fromString(keeper).toScVal(),
            xdr.ScVal.scvVec(targets.map(adlTargetToScVal)),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /** Build a `Call` descriptor for `multicall` / `multicallTry`. */
    static buildCall(contract: string, func: string, args: xdr.ScVal[]): Call {
        return { contract, func, args };
    }
}
