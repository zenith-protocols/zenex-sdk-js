import { Address, Contract, contract, xdr, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { i128, u32 } from '../index.js';
import {
    Call, CallOutcome, OrderParams,
    callToScVal, createOrderCall, parseCallOutcome,
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
        "AAAAAAAABABSdW4gYSBjcmVhdGUtYW5kLWZpbGwgYmF0Y2ggc3RyaWN0bHkgYW5kIGZpbGwgYGNhbGxzWzBdYDsgcmV0dXJucyB0aGUKYE5gIGJhdGNoIHJlc3VsdHMgd2l0aCB0aGUgZmlsbCBwYXlvdXQgYXBwZW5kZWQgKGxlbmd0aCBgTiArIDFgKS4KCmBjYWxsc2AgaXMgYSBtdWx0aWNhbGwgKHNlZSBbYFJvdXRlckNvbnRyYWN0OjptdWx0aWNhbGxgXSk6IGV2ZXJ5IGNhbGwKcnVucyBmcm9udCB0byBiYWNrIGFuZCBhbnkgZmFpbHVyZSB0cmFwcyB0aGUgd2hvbGUgaW52b2NhdGlvbiwgc28KZWl0aGVyIHRoZSBiYXRjaCBsYW5kcyB3aG9sZSBvciBub3RoaW5nIGRvZXMuCgojIEZpcnN0LWNhbGwgY29udmVudGlvbgpgY2FsbHNbMF1gIGlzLCBieSBjb252ZW50aW9uLCB0aGUgb3JkZXIgdG8gZmlsbDogaXQgdGFyZ2V0cyB0aGUgdHJhZGluZwpjb250cmFjdCAoYGNhbGxzWzBdLmNvbnRyYWN0YCksIG11c3QgYmUgYSBgY3JlYXRlX29yZGVyYC1zaGFwZWQgY2FsbCwKYW5kIGl0cyBgdTMyYCByZXR1cm4gdmFsdWUgaXMgdGhlIG9yZGVyIGlkIGhhbmRlZCB0byB0aGUgZmlsbC4gYHVzZXJgCihhbiBleHBsaWNpdCBhcmd1bWVudCwgbm90IGRlY29kZWQgZnJvbSBgY2FsbHNbMF1gKSBpcyB0aGUgb3JkZXIgb3duZXIKcGFzc2VkIHRvIGBleGVjdXRlX29yZGVyYC4gRXZlcnkgbGF0ZXIgY2FsbCBpcyBhIHBsYWluIGJhdGNoIG1lbWJlciwKbmV2ZXIgZmlsbGVkOiBhIHJlc3RpbmcgVFAvU0wgY3JlYXRlIHNpbXBseSByZXN0cy4KCkZpbGwtb3Ita2lsbDogYSBmYWlsaW5nIGZpbGwgdW53aW5kcyB0aGUgd2hvbGUgYmF0Y2gsIHNvIG5vdGhpbmcgcmVzdHMuCldpdGggYGtlZXBlciA9IHVzZXJgIHRoZSBmaWxsIHJld2FyZCByb3VuZC10cmlwcyB0byB0aGUgdHJhZGVyLgoKIyBBcmd1bWVudHMKLSBgY2FsbHNgOiB0aGUgY3JlYXRlLWFuZC1maWxsIGJhdGNoOyBgY2FsbHNbMF1gIGlzIHRoZSBvcmRlciB0byBmaWxsLgotIGB1c2VyYDogdGhlIG9yZGVyIG93bmVyIHBhc3NlZCB0byB0aGUgZmlsbC4KLSBga2VlcGVyAAAAD2NyZWF0ZV9hbmRfZmlsbAAAAAAEAAAAAAAAAAVjYWxscwAAAAAAA+oAAAfQAAAABENhbGwAAAAAAAAABHVzZXIAAAATAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAPqAAAAAA==",
        "AAAAAAAABABDb2xsZWN0IGEgcmVsYXllciBmZWUgZnJvbSBgdXNlcmAsIHRoZW4gZXhlY3V0ZSBgY2FsbHNgIGluIG9yZGVyIGFuZApyZXR1cm4gZWFjaCBjYWxsJ3MgcmF3IHJldHVybiB2YWx1ZS4KClRoZSBmZWUgbGVnIHJ1bnMgZmlyc3QgYW5kIGlzIHN0cmljdDsgdGhlIGJhdGNoIHRoZW4gcnVucyBleGFjdGx5IGxpa2UKW2BSb3V0ZXJDb250cmFjdDo6bXVsdGljYWxsYF0gKGFueSBmYWlsaW5nIGNhbGwgdHJhcHMgdGhlIHdob2xlCmludm9jYXRpb24sIHVud2luZGluZyB0aGUgZmVlIHRvbykuIFRoZXJlIGlzIG5vIGZpbGwgY29udmVudGlvbjogdGhpcyBpcwphIHB1cmUgYmF0Y2gsIHNvIGl0IGNvdmVycyBmbG93cyB3aXRoIG5vIG9yZGVyIHRvIGZpbGwsIHN1Y2ggYXMgYQpjYW5jZWxzLW9ubHkgYmF0Y2ggKHRoZSBleGl0IGNyZWF0b3IgZGVsZXRpbmcgZXZlcnkgbGV2ZWwpLiBFbXB0eQpgY2FsbHNgIGNvbGxlY3RzIHRoZSBmZWUgYW5kIHJldHVybnMgYW4gZW1wdHkgcmVzdWx0LgoKIyBBdXRob3JpemF0aW9uCi0gYHVzZXJgLCBvdmVyIHRoZSBzaWduZWQgcHJlZml4IGAoY2FsbHMsIGZlZV90b2tlbiwgbWF4X2ZlZV9hbW91bnQsCmZlZV9leHBpcmF0aW9uKWAuIFRoZSByZXBsYWNlYWJsZSB0YWlsIGAoZmVlX2Ftb3VudCwgZmVlX3JlY2lwaWVudClgCnNpdHMgb3V0c2lkZSB0aGUgc2lnbmF0dXJlLCBzbyB0aGUgc3VibWl0dGVyIHNldHMgaXQgYWZ0ZXIgc2lnbmluZy4KSW5uZXIgY2FsbCBhdXRocyByaWRlIHRoZSBzaWduZWQgdHJlZSBhcyBzdWItaW52b2NhdGlvbiBhdXRoIGVudHJpZXMuCgojIEFyZ3VtZW50cwotIGBjYWxsc2A6IHRoZSBbYENhbGxgXSBzZXF1ZW5jZSwgZXhlY3V0ZWQgZnJvbnQgdG8gYmFjay4KLSBgdXNlcmA6IHRoZSBmZWUgcGF5ZXIuCi0gYGZlZV90b2tlbmA6IHRoZSB0b2tlbiB0aGUgZmVlIGlzIGNvbGxlY3RlZCBpbi4KLSBgbWF4X2ZlZV9hbW91bnRgOiB0aGUgdXNlci1hdXRob3JpemVkIGZlZSBjZWlsaW5nICh0b2tlbi1kZWMpLgotIGBmZWVfZXhwaXJhdGlvbmA6AAAAEm11bHRpY2FsbF93aXRoX2ZlZQAAAAAABwAAAAAAAAAFY2FsbHMAAAAAAAPqAAAH0AAAAARDYWxsAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAJZmVlX3Rva2VuAAAAAAAAEwAAAAAAAAAObWF4X2ZlZV9hbW91bnQAAAAAAAsAAAAAAAAADmZlZV9leHBpcmF0aW9uAAAAAAAEAAAAAAAAAApmZWVfYW1vdW50AAAAAAALAAAAAAAAAA1mZWVfcmVjaXBpZW50AAAAAAAAEwAAAAEAAAPqAAAAAA==",
        "AAAAAAAABABSdW4gYSBjcmVhdGUtYW5kLWZpbGwgYmF0Y2ggc3RyaWN0bHksIHRoZW4gYXR0ZW1wdCBhbiBpbW1lZGlhdGUgZmlsbDsKcmV0dXJucyB0aGUgYE5gIGJhdGNoIHJlc3VsdHMgd2l0aCB0aGUgaXNvbGF0ZWQgZmlsbCBvdXRjb21lIGFwcGVuZGVkCihsZW5ndGggYE4gKyAxYCkuCgpUaGUgYmF0Y2ggaXMgc3RyaWN0IChzZWUgW2BSb3V0ZXJDb250cmFjdDo6Y3JlYXRlX2FuZF9maWxsYF0gZm9yIHRoZQpmaXJzdC1jYWxsIGNvbnZlbnRpb24pOyB0aGUgZmlsbCBsZWcgaXMgaXNvbGF0ZWQuIEEgZmFpbGVkIGZpbGwgbGVhdmVzCmV2ZXJ5IGNyZWF0ZWQgb3JkZXIgcmVzdGluZyBmb3IgYSBsYXRlciBrZWVwZXIgZmlsbDsgdGhlIGFwcGVuZGVkCm91dGNvbWUgY2FycmllcyB0aGUgZmFpbHVyZSBhcyBhIGhvc3QgYEVycm9yYCB2YWx1ZS4KCiMgQXJndW1lbnRzCi0gUmVmZXIgdG8gW2BSb3V0ZXJDb250cmFjdDo6Y3JlYXRlX2FuZF9maWxsYF0uCgojIFJldHVybnMKLSBPbmUgYFZhbGAgcGVyIGNhbGwgKHRoZSByYXcgYmF0Y2ggcmVzdWx0cywgYHJlc3VsdHNbMF1gIHRoZSBvcmRlciBpZCksCnRoZW4gdGhlIGZpbGwgb3V0Y29tZSBhcHBlbmRlZCBhcyB0aGUgbGFzdCBlbGVtZW50LCBlbmNvZGVkIGxpa2UKW2BSb3V0ZXJDb250cmFjdDo6bXVsdGljYWxsX3RyeWBdOiB0aGUgcGF5b3V0IChgaTEyOGApIG9uIGEgbGFuZGVkCmZpbGwsIG9yIHRoZSBmYWlsdXJlIGFzIGEgaG9zdCBgRXJyb3JgIHZhbHVlIHdoZW4gaXQgcmVzdHMuICJGaWxsZWQiCm1lYW5zIHRoZSBsYXN0IGVsZW1lbnQgaXMgbm90IGFuIGBFcnJvcmAuCgojIEVycm9ycwotIFRyYXBzIG9uIGVtcHR5IGBjYWxsc2AgKG5vIGZpcnN0IGNhbGwgdG8gZmlsbCkuCi0gVHJhcHMgd2hlbiBgY2FsbHNbMF1gIHJldHVybnMgYW55dGhpbmcgYnV0IGEgYHUzMmAgb3JkZXIgaWQuCi0gUHJvcGFnYXRlcyBhbnkgYmF0Y2ggY2FsbCdzIGVycm9yOyBhIGZhaWxlZCBmaWxsIGlzIHJlcG9ydGVkIGluIHRoZQphcHBlbmRlZCBvdXRjb21lLCBub3QgYnkgAAAAE2NyZWF0ZV9hbmRfdHJ5X2ZpbGwAAAAABAAAAAAAAAAFY2FsbHMAAAAAAAPqAAAH0AAAAARDYWxsAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAD6gAAAAA=",
        "AAAAAAAABABDb2xsZWN0IGEgcmVsYXllciBmZWUgZnJvbSBgdXNlcmAsIHJ1biBhIGNyZWF0ZS1hbmQtZmlsbCBiYXRjaApzdHJpY3RseSwgYW5kIGZpbGwgYGNhbGxzWzBdYDsgcmV0dXJucyB0aGUgYE5gIGJhdGNoIHJlc3VsdHMgd2l0aCB0aGUKZmlsbCBwYXlvdXQgYXBwZW5kZWQgKGxlbmd0aCBgTiArIDFgKS4KClRoZSBiYXRjaCBmb2xsb3dzIFtgUm91dGVyQ29udHJhY3Q6OmNyZWF0ZV9hbmRfZmlsbGBdJ3MgZmlyc3QtY2FsbApjb252ZW50aW9uLiBGaWxsLW9yLWtpbGw6IGEgZmFpbGluZyBmaWxsIHVud2luZHMgdGhlIGJhdGNoLCB0aGUKYXBwcm92YWxzLCBhbmQgdGhlIGZlZSwgc28gbm90aGluZyByZXN0cy4KCiMgQXV0aG9yaXphdGlvbgotIGB1c2VyYCwgb3ZlciB0aGUgc2lnbmVkIHByZWZpeCBgKGNhbGxzLCBmZWVfdG9rZW4sIG1heF9mZWVfYW1vdW50LApmZWVfZXhwaXJhdGlvbilgLiBUaGUgcmVwbGFjZWFibGUgdGFpbCBgKGZlZV9hbW91bnQsIGZlZV9yZWNpcGllbnQsCmtlZXBlciwgcHJpY2UpYCBzaXRzIG91dHNpZGUgdGhlIHNpZ25hdHVyZSwgc28gdGhlIHN1Ym1pdHRlciBzZXRzIGl0CmFmdGVyIHNpZ25pbmcgKHRoZSBwcmljZS1zd2FwIHBhdHRlcm4pLiBUaGUgaW5uZXIgYGNyZWF0ZV9vcmRlcmAgLwpgY2FuY2VsX29yZGVyYCBhdXRocyByaWRlIHRoZSBzaWduZWQgdHJlZSBhcyBzdWItaW52b2NhdGlvbiBhdXRoCmVudHJpZXMuCgojIEFyZ3VtZW50cwotIGBjYWxsc2A6IHRoZSBjcmVhdGUtYW5kLWZpbGwgYmF0Y2g7IGBjYWxsc1swXWAgaXMgdGhlIG9yZGVyIHRvIGZpbGwuCi0gYHVzZXJgOiB0aGUgb3JkZXIgb3duZXIgYW5kIGZlZSBwYXllci4KLSBgZmVlX3Rva2VuYDogdGhlIHRva2VuIHRoZSBmZWUgaXMgY29sbGVjdGVkIGluLgotIGBtYXhfZmVlX2Ftb3VudGA6IHRoZSB1c2VyLWF1dGhvcml6ZWQgZmVlIGNlaWxpbmcgKHRva2VuLWRlYykuCi0gYGZlZV9leHBpcmF0aW9uYDogdGhlIGFsbG93YW5jZSBsaXZlLXVudGlsIGxlZGdlciAoYSBzaWduZWQgYXJndW1lbnQ7CmF0AAAAGGNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZQAAAAkAAAAAAAAABWNhbGxzAAAAAAAD6gAAB9AAAAAEQ2FsbAAAAAAAAAAEdXNlcgAAABMAAAAAAAAACWZlZV90b2tlbgAAAAAAABMAAAAAAAAADm1heF9mZWVfYW1vdW50AAAAAAALAAAAAAAAAA5mZWVfZXhwaXJhdGlvbgAAAAAABAAAAAAAAAAKZmVlX2Ftb3VudAAAAAAACwAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAABMAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAA+oAAAAA",
        "AAAAAAAABABDb2xsZWN0IGEgcmVsYXllciBmZWUgZnJvbSBgdXNlcmAsIHJ1biBhIGNyZWF0ZS1hbmQtZmlsbCBiYXRjaApzdHJpY3RseSwgYW5kIGF0dGVtcHQgYW4gaW1tZWRpYXRlIGZpbGw7IHJldHVybnMgdGhlIGBOYCBiYXRjaCByZXN1bHRzCndpdGggdGhlIGlzb2xhdGVkIGZpbGwgb3V0Y29tZSBhcHBlbmRlZCAobGVuZ3RoIGBOICsgMWApLgoKU2hhcmVzIFtgUm91dGVyQ29udHJhY3Q6OmNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZWBdJ3MgZW52ZWxvcGUgYW5kCmF1dGhvcml6YXRpb24uIFRoZSBmZWUgYW5kIGJhdGNoIGxlZ3MgYXJlIHN0cmljdDsgdGhlIGZpbGwgbGVnIGlzCmlzb2xhdGVkLCBzbyBhIGZhaWxlZCBmaWxsIGxlYXZlcyBldmVyeSBjcmVhdGVkIG9yZGVyIHJlc3Rpbmcgd2l0aCB0aGUKZmVlIGNvbGxlY3RlZCBhbmQgY2FycmllcyB0aGUgZmFpbHVyZSBhcyBhIGhvc3QgYEVycm9yYCB2YWx1ZSBpbiB0aGUKYXBwZW5kZWQgb3V0Y29tZS4KCiMgQXV0aG9yaXphdGlvbgotIFJlZmVyIHRvIFtgUm91dGVyQ29udHJhY3Q6OmNyZWF0ZV9hbmRfZmlsbF93aXRoX2ZlZWBdLgoKIyBBcmd1bWVudHMKLSBSZWZlciB0byBbYFJvdXRlckNvbnRyYWN0OjpjcmVhdGVfYW5kX2ZpbGxfd2l0aF9mZWVgXS4KCiMgUmV0dXJucwotIE9uZSBgVmFsYCBwZXIgY2FsbCAodGhlIHJhdyBiYXRjaCByZXN1bHRzLCBgcmVzdWx0c1swXWAgdGhlIG9yZGVyIGlkKSwKdGhlbiB0aGUgZmlsbCBvdXRjb21lIGFwcGVuZGVkIGFzIHRoZSBsYXN0IGVsZW1lbnQsIGVuY29kZWQgbGlrZQpbYFJvdXRlckNvbnRyYWN0OjptdWx0aWNhbGxfdHJ5YF06IHRoZSBwYXlvdXQgKGBpMTI4YCkgb24gYSBsYW5kZWQKZmlsbCwgb3IgdGhlIGZhaWx1cmUgYXMgYSBob3N0IGBFcnJvcmAgdmFsdWUgd2hlbiBpdCByZXN0cy4KCiMgRXJyb3JzCi0gVHJhcHMgb24gZW1wdHkgYGNhbGxzYCAobm8gZmlyc3QgY2FsbCB0byBmaWxsKS4KLSBUcmFwcyB3aGVuIGBjYWxsc1swXWAgcmV0dXJucyBhbnl0aGluZyBidXQgYSBgdTMyYCBvcmRlciBpAAAAHGNyZWF0ZV9hbmRfdHJ5X2ZpbGxfd2l0aF9mZWUAAAAJAAAAAAAAAAVjYWxscwAAAAAAA+oAAAfQAAAABENhbGwAAAAAAAAABHVzZXIAAAATAAAAAAAAAAlmZWVfdG9rZW4AAAAAAAATAAAAAAAAAA5tYXhfZmVlX2Ftb3VudAAAAAAACwAAAAAAAAAOZmVlX2V4cGlyYXRpb24AAAAAAAQAAAAAAAAACmZlZV9hbW91bnQAAAAAAAsAAAAAAAAADWZlZV9yZWNpcGllbnQAAAAAAAATAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAPqAAAAAA==",
        "AAAAAQAAACNPbmUgY29udHJhY3QgaW52b2NhdGlvbiBpbiBhIGJhdGNoLgAAAAAAAAAABENhbGwAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAEZnVuYwAAABE=",
        "AAAABQAAADJFdmVudCBlbWl0dGVkIHdoZW4gYSBmZWUgaXMgY29sbGVjdGVkIGZyb20gYSB1c2VyLgAAAAAAAAAAAAxGZWVDb2xsZWN0ZWQAAAABAAAADWZlZV9jb2xsZWN0ZWQAAAAAAAAEAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
    ]);

    static readonly parsers = {
        // --- generic batching ---
        multicall: (result: string): unknown[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        multicallTry: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(parseCallOutcome),
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
        createAndTryFill: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(parseCallOutcome),
        createAndTryFillWithFee: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(parseCallOutcome),
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
     * gasless envelope for cancels-only batches (for example the exit creator
     * deleting every level), which the fill-bearing create-and-* entries
     * cannot carry.
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
