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
    approveAmount: i128;
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
        "AAAAAAAAATZFeGVjdXRlIGBjYWxsc2AgaW4gb3JkZXIsIGlzb2xhdGluZyBlYWNoIGNhbGwncyBmYWlsdXJlOyByZXR1cm5zIG9uZQpbYENhbGxPdXRjb21lYF0gcGVyIGNhbGwuCgpBIGZhaWxpbmcgY2FsbCByb2xscyBiYWNrIGl0cyBvd24gZWZmZWN0cyBhbmQgdGhlIGJhdGNoIGNvbnRpbnVlcwp3aXRoIHRoZSBuZXh0IGNhbGwuCgojIEFyZ3VtZW50cwotIGBjYWxsc2A6IHRoZSBbYENhbGxgXSBzZXF1ZW5jZSwgZXhlY3V0ZWQgZnJvbnQgdG8gYmFjay4KCiMgUmV0dXJucwotIE9uZSBbYENhbGxPdXRjb21lYF0gcGVyIGNhbGwsIGluIGNhbGwgb3JkZXIuAAAAAAANbXVsdGljYWxsX3RyeQAAAAAAAAEAAAAAAAAABWNhbGxzAAAAAAAD6gAAB9AAAAAEQ2FsbAAAAAEAAAPqAAAH0AAAAAtDYWxsT3V0Y29tZQA=",
        "AAAAAAAAA2FDcmVhdGUgYW4gb3JkZXIgb24gYHRyYWRpbmdgIGFuZCBmaWxsIGl0IGluIHRoZSBzYW1lIGludm9jYXRpb247CnJldHVybnMgdGhlIGZpbGwgcGF5b3V0ICh0b2tlbi1kZWMpLgoKRmlsbC1vci1raWxsOiBhIGZhaWxpbmcgZmlsbCB1bndpbmRzIHRoZSBjcmVhdGlvbiAoYW5kIHRoZSBhcHByb3ZhbCksCnNvIG5vdGhpbmcgcmVzdHMuIFdpdGggYGtlZXBlciA9IHVzZXJgIHRoZSBmaWxsIHJld2FyZCByb3VuZC10cmlwcyB0bwp0aGUgdHJhZGVyLgoKIyBBcmd1bWVudHMKLSBgdHJhZGluZ2A6IHRoZSB0YXJnZXQgdHJhZGluZyBjb250cmFjdC4KLSBga2VlcGVyYDogdGhlIGZpbGwtcmV3YXJkIHJlY2lwaWVudC4KLSBgYXBwcm92ZV9hbW91bnRgOiBjb2xsYXRlcmFsIGFsbG93YW5jZSBzZXQgZm9yIGB0cmFkaW5nYCBiZWZvcmUgdGhlCmNyZWF0aW9uICh0b2tlbi1kZWMpOyAwIHNraXBzIHRoZSBhcHByb3ZhbC4gU2V0cyB0aGUgYWJzb2x1dGUKYWxsb3dhbmNlIG9uIHRoZSB1c2VyLXRpZXIgVFRMIGhvcml6b24uCi0gYGtpbmRgOiBtaXJyb3JzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYE9yZGVyS2luZGAgZGlzY3JpbWluYW50LgotIFJlbWFpbmluZyBhcmd1bWVudHMgbWlycm9yIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYGNyZWF0ZV9vcmRlcmAsCndpdGggYHByaWNlYCAodGhlIHNlcmlhbGl6ZWQgcHJpY2UgdXBkYXRlIGZvciB0aGUgZmlsbCkgbGFzdC4KCiMgUmV0dXJucwotIFRoZSBmaWxsIHBheW91dCBwYWlkIHRvIGBrZWVwZXJgICh0b2tlbi1kZWMpLgoKIyBFcnJvcnMKLSBQcm9wYWdhdGVzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYGNyZWF0ZV9vcmRlcmAgYW5kCmBleGVjdXRlX29yZGVyYCBlcnJvcnMuAAAAAAAAD2NyZWF0ZV9hbmRfZmlsbAAAAAAMAAAAAAAAAAd0cmFkaW5nAAAAABMAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAAAAAADmFwcHJvdmVfYW1vdW50AAAAAAALAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAABGtpbmQAAAAEAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAALAAAAAAAAAAtwcmljZV9ib3VuZAAAAAALAAAAAAAAAApleHBpcmF0aW9uAAAAAAAEAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAACw==",
        "AAAAAAAAAhhDcmVhdGUgYW4gb3JkZXIgb24gYHRyYWRpbmdgIGFuZCBhdHRlbXB0IGFuIGltbWVkaWF0ZSBmaWxsOyByZXR1cm5zCnRoZSBbYEZpbGxBdHRlbXB0YF0uCgpUaGUgYXBwcm92YWwgYW5kIGNyZWF0aW9uIGFyZSBzdHJpY3Q7IHRoZSBmaWxsIGxlZyBpcyBpc29sYXRlZC4gQQpmYWlsZWQgZmlsbCBsZWF2ZXMgdGhlIG9yZGVyIHJlc3Rpbmcgd2l0aCBpdHMgYWxsb3dhbmNlIGluIHBsYWNlIGZvcgphIGxhdGVyIGtlZXBlciBmaWxsLCBhbmQgcmVwb3J0cyB3aHkgdmlhIHRoZSBhdHRlbXB0J3MgZXJyb3IgY29kZS4KCiMgQXJndW1lbnRzCi0gUmVmZXIgdG8gW2BSb3V0ZXJDb250cmFjdDo6Y3JlYXRlX2FuZF9maWxsYF0uCgojIFJldHVybnMKLSBUaGUgW2BGaWxsQXR0ZW1wdGBdIGNhcnJ5aW5nIHRoZSBjcmVhdGVkIG9yZGVyIGlkLgoKIyBFcnJvcnMKLSBQcm9wYWdhdGVzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYGNyZWF0ZV9vcmRlcmAgZXJyb3JzOyBmaWxsCmZhaWx1cmVzIGFyZSByZXBvcnRlZCBpbiB0aGUgW2BGaWxsQXR0ZW1wdGBdLgAAABNjcmVhdGVfYW5kX3RyeV9maWxsAAAAAAwAAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAOYXBwcm92ZV9hbW91bnQAAAAAAAsAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAAAAAAEa2luZAAAAAQAAAAAAAAACG5vdGlvbmFsAAAACwAAAAAAAAAKY29sbGF0ZXJhbAAAAAAACwAAAAAAAAANdHJpZ2dlcl9wcmljZQAAAAAAAAsAAAAAAAAAC3ByaWNlX2JvdW5kAAAAAAsAAAAAAAAACmV4cGlyYXRpb24AAAAAAAQAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAfQAAAAC0ZpbGxBdHRlbXB0AA==",
        "AAAAAAAABABDb2xsZWN0IGEgcmVsYXllciBmZWUgZnJvbSBgdXNlcmAsIHRoZW4gY3JlYXRlIGFuIG9yZGVyIG9uIGB0cmFkaW5nYAphbmQgZmlsbCBpdCBpbiB0aGUgc2FtZSBpbnZvY2F0aW9uOyByZXR1cm5zIHRoZSBmaWxsIHBheW91dCAodG9rZW4tZGVjKS4KClRoZSB1c2VyJ3MgYXV0aG9yaXphdGlvbiBjb3ZlcnMgdGhlIHNpZ25lZCBwcmVmaXggKGB0cmFkaW5nYCB0aHJvdWdoCmBleHBpcmF0aW9uYCk7IGBmZWVfYW1vdW50YCwgYGZlZV9yZWNpcGllbnRgLCBga2VlcGVyYCwgYW5kIGBwcmljZWAKc2l0IG91dHNpZGUgaXQsIHNvIHRoZSBzdWJtaXR0ZXIgc2V0cyB0aGVtIGFmdGVyIHNpZ25pbmcuCkZpbGwtb3Ita2lsbDogYSBmYWlsaW5nIGZpbGwgdW53aW5kcyB0aGUgY3JlYXRpb24sIHRoZSBhcHByb3ZhbHMsIGFuZAp0aGUgZmVlLCBzbyBub3RoaW5nIHJlc3RzLgoKIyBBdXRob3JpemF0aW9uCi0gYHVzZXJgLCBvdmVyIGAodHJhZGluZywgZmVlX3Rva2VuLCBtYXhfZmVlX2Ftb3VudCwgYXBwcm92ZV9hbW91bnQsCmlzX2xvbmcsIGtpbmQsIG5vdGlvbmFsLCBjb2xsYXRlcmFsLCB0cmlnZ2VyX3ByaWNlLCBwcmljZV9ib3VuZCwKZXhwaXJhdGlvbilgLgoKIyBBcmd1bWVudHMKLSBgdHJhZGluZ2A6IHRoZSB0YXJnZXQgdHJhZGluZyBjb250cmFjdC4KLSBgdXNlcmA6IHRoZSBvcmRlciBvd25lciBhbmQgZmVlIHBheWVyLgotIGBmZWVfdG9rZW5gOiB0aGUgdG9rZW4gdGhlIGZlZSBpcyBjb2xsZWN0ZWQgaW4uCi0gYG1heF9mZWVfYW1vdW50YDogdGhlIHVzZXItYXV0aG9yaXplZCBmZWUgY2VpbGluZyAodG9rZW4tZGVjKS4KLSBgYXBwcm92ZV9hbW91bnRgOiBjb2xsYXRlcmFsIGFsbG93YW5jZSBzZXQgZm9yIGB0cmFkaW5nYCBiZWZvcmUgdGhlCmNyZWF0aW9uICh0b2tlbi1kZWMpOyAwIHNraXBzIHRoZSBhcHByb3ZhbC4gU2V0cyB0aGUgYWJzb2x1dGUKYWxsb3dhbmNlIG9uIHRoZSB1c2VyLXRpZXIgVFRMIGhvcml6b24uCi0gYGtpbmRgOiBtaXJyb3JzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgAAAAGGNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZQAAABAAAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAAAAAACWZlZV90b2tlbgAAAAAAABMAAAAAAAAADm1heF9mZWVfYW1vdW50AAAAAAALAAAAAAAAAA5hcHByb3ZlX2Ftb3VudAAAAAAACwAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAARraW5kAAAABAAAAAAAAAAIbm90aW9uYWwAAAALAAAAAAAAAApjb2xsYXRlcmFsAAAAAAALAAAAAAAAAA10cmlnZ2VyX3ByaWNlAAAAAAAACwAAAAAAAAALcHJpY2VfYm91bmQAAAAACwAAAAAAAAAKZXhwaXJhdGlvbgAAAAAABAAAAAAAAAAKZmVlX2Ftb3VudAAAAAAACwAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAAAs=",
        "AAAAAAAAA2pDb2xsZWN0IGEgcmVsYXllciBmZWUgZnJvbSBgdXNlcmAsIHRoZW4gY3JlYXRlIGFuIG9yZGVyIG9uIGB0cmFkaW5nYAphbmQgYXR0ZW1wdCBhbiBpbW1lZGlhdGUgZmlsbDsgcmV0dXJucyB0aGUgW2BGaWxsQXR0ZW1wdGBdLgoKU2hhcmVzIFtgUm91dGVyQ29udHJhY3Q6OmNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZWBdJ3MgZW52ZWxvcGUgYW5kCmF1dGhvcml6YXRpb24uIFRoZSBmZWUgYW5kIGNyZWF0aW9uIGxlZ3MgYXJlIHN0cmljdDsgdGhlIGZpbGwgbGVnIGlzCmlzb2xhdGVkLCBzbyBhIGZhaWxlZCBmaWxsIGxlYXZlcyB0aGUgb3JkZXIgcmVzdGluZyB3aXRoIHRoZSBmZWUKY29sbGVjdGVkIGFuZCByZXBvcnRzIHdoeSB2aWEgdGhlIGF0dGVtcHQncyBlcnJvciBjb2RlLgoKIyBBdXRob3JpemF0aW9uCi0gUmVmZXIgdG8gW2BSb3V0ZXJDb250cmFjdDo6Y3JlYXRlX2FuZF9maWxsX3dpdGhfZmVlYF0uCgojIEFyZ3VtZW50cwotIFJlZmVyIHRvIFtgUm91dGVyQ29udHJhY3Q6OmNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZWBdLgoKIyBSZXR1cm5zCi0gVGhlIFtgRmlsbEF0dGVtcHRgXSBjYXJyeWluZyB0aGUgY3JlYXRlZCBvcmRlciBpZC4KCiMgRXJyb3JzCi0gW2BSb3V0ZXJFcnJvcjo6SW52YWxpZEZlZWBdOiBgZmVlX2Ftb3VudGAgaXMgbmVnYXRpdmUgb3IgZXhjZWVkcwpgbWF4X2ZlZV9hbW91bnRgLgotIFByb3BhZ2F0ZXMgdGhlIHRyYWRpbmcgY29udHJhY3QncyBgY3JlYXRlX29yZGVyYCBlcnJvcnM7IGZpbGwKZmFpbHVyZXMgYXJlIHJlcG9ydGVkIGluIHRoZSBbYEZpbGxBdHRlbXB0YF0uCgojIEV2ZW50cwotIGBmZWVfY29sbGVjdGVkYDogdGhlIGZlZSBtb3ZlZCBmcm9tIGB1c2VyYCB0byBgZmVlX3JlY2lwaWVudGAuAAAAAAAcY3JlYXRlX2FuZF90cnlfZmlsbF93aXRoX2ZlZQAAABAAAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAAAAAACWZlZV90b2tlbgAAAAAAABMAAAAAAAAADm1heF9mZWVfYW1vdW50AAAAAAALAAAAAAAAAA5hcHByb3ZlX2Ftb3VudAAAAAAACwAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAARraW5kAAAABAAAAAAAAAAIbm90aW9uYWwAAAALAAAAAAAAAApjb2xsYXRlcmFsAAAAAAALAAAAAAAAAA10cmlnZ2VyX3ByaWNlAAAAAAAACwAAAAAAAAALcHJpY2VfYm91bmQAAAAACwAAAAAAAAAKZXhwaXJhdGlvbgAAAAAABAAAAAAAAAAKZmVlX2Ftb3VudAAAAAAACwAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAB9AAAAALRmlsbEF0dGVtcHQA",
        "AAAAAQAAACNPbmUgY29udHJhY3QgaW52b2NhdGlvbiBpbiBhIGJhdGNoLgAAAAAAAAAABENhbGwAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAEZnVuYwAAABE=",
        "AAAAAQAAAB9UaGUgcmVzdWx0IG9mIG9uZSBiYXRjaGVkIGNhbGwuAAAAAAAAAAALQ2FsbE91dGNvbWUAAAAAAwAAAAAAAAAFZXJyb3IAAAAAAAAEAAAAAAAAAAJvawAAAAAAAQAAAAAAAAAFdmFsdWUAAAAAAAAL",
        "AAAAAQAAAClUaGUgcmVzdWx0IG9mIGEgY3JlYXRlLWFuZC10cnktZmlsbCBmbG93LgAAAAAAAAAAAAALRmlsbEF0dGVtcHQAAAAABAAAAAAAAAAFZXJyb3IAAAAAAAAEAAAAAAAAAAZmaWxsZWQAAAAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAZwYXlvdXQAAAAAAAs=",
        "AAAABAAAAClFcnJvcnMgcmFpc2VkIGJ5IHRoZSByb3V0ZXIncyBvd24gZ3VhcmRzLgAAAAAAAAAAAAALUm91dGVyRXJyb3IAAAAAAQAAADVgZmVlX2Ftb3VudGAgaXMgbmVnYXRpdmUgb3IgZXhjZWVkcyBgbWF4X2ZlZV9hbW91bnRgLgAAAAAAAApJbnZhbGlkRmVlAAAAAAAB",
        "AAAABQAAAFlSZWxheWVyIGZlZSBtb3ZlZCBmcm9tIHRoZSB1c2VyIHRvIHRoZSBmZWUgcmVjaXBpZW50IGR1cmluZyBhCmZlZS1hYnN0cmFjdGVkIG1hcmtldCBmaWxsLgAAAAAAAAAAAAAMRmVlQ29sbGVjdGVkAAAAAQAAAA1mZWVfY29sbGVjdGVkAAAAAAAABAAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
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
     * allowance on the user-tier TTL horizon. `kind` is the trading
     * contract's `OrderKind` discriminant (crosses the ABI as a plain u32).
     * Remaining arguments mirror the trading contract's `create_order`,
     * with `price` (the serialized price update for the fill) last.
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
     * - `RouterError::InvalidFee` (#1): `feeAmount` is negative or exceeds
     *   `maxFeeAmount`.
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
     * - `RouterError::InvalidFee` (#1): `feeAmount` is negative or exceeds
     *   `maxFeeAmount`.
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

/** Encode the 16-arg with-fee tuple in on-chain order. */
function withFeeScVals(args: CreateAndFillWithFeeArgs): xdr.ScVal[] {
    return [
        Address.fromString(args.trading).toScVal(),
        Address.fromString(args.user).toScVal(),
        Address.fromString(args.feeToken).toScVal(),
        nativeToScVal(args.maxFeeAmount, { type: 'i128' }),
        nativeToScVal(args.approveAmount, { type: 'i128' }),
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
