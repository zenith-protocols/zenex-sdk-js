import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../index.js';

// Contract status enum (matches Rust contract)
export enum ContractStatus {
    Active = 0,     // Full operation - all trading actions allowed
    OnIce = 1,      // Permissionless circuit breaker (PnL threshold)
    AdminOnIce = 2, // Admin-set on ice (only admin can lift)
    Frozen = 3,     // Emergency lockdown - no trading actions allowed
}


// Place limit order arguments
export interface PlaceLimitArgs {
    user: string;
    market_id: u32;
    collateral: i128;
    notional_size: i128;
    is_long: boolean;
    entry_price: i128;
    take_profit: i128;
    stop_loss: i128;
}

// Open market order arguments
export interface OpenMarketArgs {
    user: string;
    market_id: u32;
    collateral: i128;
    notional_size: i128;
    is_long: boolean;
    take_profit: i128;
    stop_loss: i128;
    /**
     * Slippage bound on the fill price. For longs this is a ceiling
     * (revert if fill > bound). For shorts this is a floor
     * (revert if fill < bound). `0` disables the check.
     */
    price_bound: i128;
    /**
     * Absolute Stellar ledger sequence after which the call reverts
     * with `Expired` (760). `0` disables the check.
     */
    expiration_ledger: u32;
    price: Buffer | Uint8Array;
}

// Close position arguments
export interface ClosePositionArgs {
    user: string;
    id: u32;
    /**
     * Slippage bound on the fill price. For longs this is a floor
     * (revert if fill < bound). For shorts this is a ceiling
     * (revert if fill > bound). `0` disables the check.
     */
    price_bound: i128;
    /**
     * Absolute Stellar ledger sequence after which the call reverts
     * with `Expired` (760). `0` disables the check.
     */
    expiration_ledger: u32;
    price: Buffer | Uint8Array;
}

// Set triggers arguments
export interface SetTriggersArgs {
    user: string;
    id: u32;
    take_profit: i128;
    stop_loss: i128;
}

// Modify collateral arguments
export interface ModifyCollateralArgs {
    user: string;
    id: u32;
    new_collateral: i128;
    price: Buffer | Uint8Array;
}

// Execute arguments
export interface ExecuteArgs {
    caller: string;
    market_id: u32;
    users: string[];
    ids: u32[];
    price: Buffer | Uint8Array;
}

// Deploy arguments (passed to __constructor)
export interface DeployArgs {
    owner: string;
    token: string;
    vault: string;
    price_verifier: string;
    treasury: string;
    config: TradingConfigArgs;
}

// Trading config arguments (raw i128 values for contract calls)
export interface TradingConfigArgs {
    caller_rate: i128;
    min_notional: i128;
    max_notional: i128;
    fee_dom: i128;
    fee_non_dom: i128;
    max_util: i128;
    r_funding: i128;
    r_base: i128;
    r_var: i128;
}

// Market config arguments (raw i128 values for contract calls)
export interface MarketConfigArgs {
    feed_id: u32;
    enabled: boolean;
    max_util: i128;
    r_var_market: i128;
    margin: i128;
    liq_fee: i128;
    impact: i128;
}

/**
 * TradingContract - Operation builder for the Zenex Trading contract
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class TradingContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAAAQAAAe9BIHNpbmdsZSB0cmFkZXIgcG9zaXRpb24uIENyZWF0ZWQgaW4gYFBlbmRpbmdgIHN0YXRlIGJ5IGBwbGFjZV9saW1pdGAgYW5kCmBGaWxsZWRgIGltbWVkaWF0ZWx5IGJ5IGBvcGVuX21hcmtldGAgKG9yIGJ5IGEga2VlcGVyIGV4ZWN1dGluZyBhIGxpbWl0KS4KCkluZGV4IHNuYXBzaG90cyAoYGZ1bmRfaWR4YCwgYGJvcnJfaWR4YCwgYGFkbF9pZHhgKSBhcmUgdGFrZW4gYXQgZmlsbCB0aW1lLgpUaGV5IGFyZSBpbW11dGFibGUgZm9yIHRoZSBwb3NpdGlvbidzIGxpZmV0aW1lOiBzZXR0bGVtZW50IGFsd2F5cyByZWFkcwp0aGUgZGlmZmVyZW5jZSBhZ2FpbnN0IHRoZSBjdXJyZW50IGBNYXJrZXREYXRhYCBpbmRpY2VzLCBzbyBmdW5kaW5nIGFuZApib3Jyb3dpbmcgYWNjcnVlIHdpdGhvdXQgbW9kaWZ5aW5nIHRoZSBwb3NpdGlvbiByZWNvcmQuIEFETCByZWR1Y3Rpb25zCnNjYWxlIGBub3Rpb25hbGAgZG93biB2aWEgdGhlIGBhZGxfaWR4YCByYXRpbyBhdCBjbG9zZS4AAAAAAAAAAAhQb3NpdGlvbgAAAAwAAAAAAAAAB2FkbF9pZHgAAAAACwAAAAAAAAAIYm9ycl9pZHgAAAALAAAAAAAAAANjb2wAAAAACwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAAAAAAALZW50cnlfcHJpY2UAAAAACwAAAAAAAAAGZmlsbGVkAAAAAAABAAAAAAAAAAhmdW5kX2lkeAAAAAsAAAAAAAAABGxvbmcAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAAAnNsAAAAAAALAAAAAAAAAAJ0cAAAAAAACw==",
        "AAAAAQAAAVpNdXRhYmxlIHBlci1tYXJrZXQgc3RhdGUuIEhvbGRzIG9wZW4gaW50ZXJlc3QsIGN1bXVsYXRpdmUgZnVuZGluZy9ib3Jyb3dpbmcKaW5kaWNlcywgQURMIHJlZHVjdGlvbiBpbmRpY2VzLCBhbmQgdGhlIHRpbWVzdGFtcCBvZiB0aGUgbGFzdCBhY2NydWFsLgoKRnVuZGluZyBhbmQgYm9ycm93aW5nIGZlZXMgYXJlIG5vdCBzdG9yZWQgb24gcG9zaXRpb25zOyB0aGV5IGFjY3J1ZSBpbnRvCnRoZSBnbG9iYWwgaW5kaWNlcyBoZXJlIGFuZCBhcmUgc2V0dGxlZCBhdCBjbG9zZSBhcyBgKGN1cnJlbnRfaWR4IC0KcG9zaXRpb25faWR4KSAqIG5vdGlvbmFsYC4gSW5kaWNlcyBhZHZhbmNlIG1vbm90b25pY2FsbHkuAAAAAAAAAAAACk1hcmtldERhdGEAAAAAAAwAAAAAAAAACWZ1bmRfcmF0ZQAAAAAAAAsAAAAAAAAACWxfYWRsX2lkeAAAAAAAAAsAAAAAAAAACmxfYm9ycl9pZHgAAAAAAAsAAAAAAAAACmxfZW50cnlfd3QAAAAAAAsAAAAAAAAACmxfZnVuZF9pZHgAAAAAAAsAAAAAAAAACmxfbm90aW9uYWwAAAAAAAsAAAAAAAAAC2xhc3RfdXBkYXRlAAAAAAYAAAAAAAAACXNfYWRsX2lkeAAAAAAAAAsAAAAAAAAACnNfYm9ycl9pZHgAAAAAAAsAAAAAAAAACnNfZW50cnlfd3QAAAAAAAsAAAAAAAAACnNfZnVuZF9pZHgAAAAAAAsAAAAAAAAACnNfbm90aW9uYWwAAAAAAAs=",
        "AAAAAQAAAMZQZXItbWFya2V0IHBhcmFtZXRlcnMuIE9uZSBpbnN0YW5jZSBwZXIgcmVnaXN0ZXJlZCBgbWFya2V0X2lkYC4KCmBmZWVkX2lkYCBpcyBzZXQgb24gZmlyc3QgcmVnaXN0cmF0aW9uIGFuZCBpcyBpbW11dGFibGUgYWZ0ZXJ3YXJkczogYW4KdXBkYXRlIHdpdGggYSBkaWZmZXJlbnQgYGZlZWRfaWRgIHBhbmljcyB3aXRoIGBJbnZhbGlkQ29uZmlnYC4AAAAAAAAAAAAMTWFya2V0Q29uZmlnAAAABwAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAAAAAAdmZWVkX2lkAAAAAAQAAAAAAAAABmltcGFjdAAAAAAACwAAAAAAAAAHbGlxX2ZlZQAAAAALAAAAAAAAAAZtYXJnaW4AAAAAAAsAAAAAAAAACG1heF91dGlsAAAACwAAAAAAAAAMcl92YXJfbWFya2V0AAAACw==",
        "AAAAAQAAALxHbG9iYWwgdHJhZGluZyBwYXJhbWV0ZXJzIGFwcGxpZWQgdG8gZXZlcnkgbWFya2V0LgoKU2V0IGF0IGNvbnN0cnVjdGlvbiBhbmQgdXBkYXRlYWJsZSB2aWEgdGhlIG93bmVyLW9ubHkgYHNldF9jb25maWdgCmVudHJ5IHBvaW50ICh2YWxpZGF0ZWQgYnkgYGNyYXRlOjp2YWxpZGF0aW9uOjpyZXF1aXJlX3ZhbGlkX2NvbmZpZ2ApLgAAAAAAAAANVHJhZGluZ0NvbmZpZwAAAAAAAAkAAAAAAAAAC2NhbGxlcl9yYXRlAAAAAAsAAAAAAAAAB2ZlZV9kb20AAAAACwAAAAAAAAALZmVlX25vbl9kb20AAAAACwAAAAAAAAAMbWF4X25vdGlvbmFsAAAACwAAAAAAAAAIbWF4X3V0aWwAAAALAAAAAAAAAAxtaW5fbm90aW9uYWwAAAALAAAAAAAAAAZyX2Jhc2UAAAAAAAsAAAAAAAAACXJfZnVuZGluZwAAAAAAAAsAAAAAAAAABXJfdmFyAAAAAAAACw==",
        "AAAABQAAAF1TdG9wLWxvc3MgdHJpZ2dlciBleGVjdXRlZCBieSBhIGtlZXBlci4KYG5vdGlvbmFsYCBpcyB0aGUgcG9zdC1BREwgbm90aW9uYWwgYWN0dWFsbHkgc2V0dGxlZC4AAAAAAAAAAAAACFN0b3BMb3NzAAAAAQAAAAlzdG9wX2xvc3MAAAAAAAAKAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAQAAAAAAAAAIbm90aW9uYWwAAAALAAAAAAAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAAAAAADcG5sAAAAAAsAAAAAAAAAAAAAAAhiYXNlX2ZlZQAAAAsAAAAAAAAAAAAAAAppbXBhY3RfZmVlAAAAAAALAAAAAAAAAAAAAAAHZnVuZGluZwAAAAALAAAAAAAAAAAAAAANYm9ycm93aW5nX2ZlZQAAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAACBNYXJrZXQgcmVtb3ZlZCB2aWEgYGRlbF9tYXJrZXRgLgAAAAAAAAAJRGVsTWFya2V0AAAAAAAAAQAAAApkZWxfbWFya2V0AAAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAQAAAAI=",
        "AAAABQAAAJRQZW5kaW5nIGxpbWl0IG9yZGVyIGZpbGxlZCB2aWEgYGV4ZWN1dGVgLiBFbWl0cyBvbmx5IGZpbGwtdGltZQpzdGF0ZTsgbG9uZyAvIGNvbCAvIG5vdGlvbmFsIC8gc2wgLyB0cCBhcmUgaW5oZXJpdGVkIGZyb20gdGhlCnByaW9yIGBQbGFjZUxpbWl0YCByb3cuAAAAAAAAAAlGaWxsTGltaXQAAAAAAAABAAAACmZpbGxfbGltaXQAAAAAAAoAAAAAAAAACW1hcmtldF9pZAAAAAAAAAQAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAC3Bvc2l0aW9uX2lkAAAAAAQAAAABAAAAAAAAAAtlbnRyeV9wcmljZQAAAAALAAAAAAAAAAAAAAAIZnVuZF9pZHgAAAALAAAAAAAAAAAAAAAIYm9ycl9pZHgAAAALAAAAAAAAAAAAAAAHYWRsX2lkeAAAAAALAAAAAAAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAAAAAAAAAAAACGJhc2VfZmVlAAAACwAAAAAAAAAAAAAACmltcGFjdF9mZWUAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAJZHbG9iYWwgdHJhZGluZyBjb25maWd1cmF0aW9uIHVwZGF0ZWQgdmlhIGBzZXRfY29uZmlnYC4gSW5kZXhlcgphdWRpdHMgdmlhIChjb250cmFjdF9pZCwgdHhfaGFzaCwgZXZlbnRfdHlwZSk7IGZ1bGwgY29uZmlnIHJlYWQKZnJvbSBzdG9yYWdlIG9uIGRlbWFuZC4AAAAAAAAAAAAJU2V0Q29uZmlnAAAAAAAAAQAAAApzZXRfY29uZmlnAAAAAAAAAAAAAg==",
        "AAAABQAAAClNYXJrZXQgYWRkZWQgb3IgdXBkYXRlZCB2aWEgYHNldF9tYXJrZXRgLgAAAAAAAAAAAAAJU2V0TWFya2V0AAAAAAAAAQAAAApzZXRfbWFya2V0AAAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAQAAAAI=",
        "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",
        "AAAABQAAAJJBdXRvLWRlbGV2ZXJhZ2UgdHJpZ2dlcmVkIOKAlCB3aW5uaW5nLXNpZGUgbm90aW9uYWxzIGFuZCBhZGxfaWR4CnNjYWxlZCBkb3duLiBTaW5nbGUgZXZlbnQgcGVyIEFETCBhY3Rpb247IGluZGV4ZXIgcmVmZXRjaGVzIHRoZQphZmZlY3RlZCBtYXJrZXRzLgAAAAAAAAAAAAxBRExUcmlnZ2VyZWQAAAABAAAADWFkbF90cmlnZ2VyZWQAAAAAAAACAAAAOlJlZHVjdGlvbiBwZXJjZW50YWdlIGFwcGxpZWQgdG8gd2lubmluZyBzaWRlcyAoU0NBTEFSXzE4KS4AAAAAAA1yZWR1Y3Rpb25fcGN0AAAAAAAACwAAAAAAAAA5RGVmaWNpdCBhbW91bnQ6IG5ldF9wbmwgLSB2YXVsdF9iYWxhbmNlICh0b2tlbl9kZWNpbWFscykuAAAAAAAAB2RlZmljaXQAAAAACwAAAAAAAAAC",
        "AAAABQAAAHlGdW5kaW5nIHJhdGVzIHJlY2FsY3VsYXRlZCB2aWEgYGFwcGx5X2Z1bmRpbmdgLiBFbWl0dGVkIG9uY2UgcGVyCnRpY2suIEluZGV4ZXIgcmVhZHMgcG9zdC1yZWNhbGMgbWFya2V0IHN0YXRlIHNlcGFyYXRlbHkuAAAAAAAAAAAAAAxBcHBseUZ1bmRpbmcAAAABAAAADWFwcGx5X2Z1bmRpbmcAAAAAAAAAAAAAAg==",
        "AAAABQAAAHdDbG9zZWQgYnkgdGhlIHVzZXIgdmlhIGBjbG9zZV9wb3NpdGlvbmAuCmBub3Rpb25hbGAgaXMgdGhlIHBvc3QtQURMIG5vdGlvbmFsIGFjdHVhbGx5IHNldHRsZWQgKOKJpCBwbGFjZW1lbnQgbm90aW9uYWwpLgAAAAAAAAAADUNsb3NlUG9zaXRpb24AAAAAAAABAAAADmNsb3NlX3Bvc2l0aW9uAAAAAAAKAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAQAAAAAAAAAIbm90aW9uYWwAAAALAAAAAAAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAAAAAADcG5sAAAAAAsAAAAAAAAAAAAAAAhiYXNlX2ZlZQAAAAsAAAAAAAAAAAAAAAppbXBhY3RfZmVlAAAAAAALAAAAAAAAAAAAAAAHZnVuZGluZwAAAAALAAAAAAAAAAAAAAANYm9ycm93aW5nX2ZlZQAAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAC9Qb3NpdGlvbiByZWZ1bmRlZCAobWFya2V0IGRpc2FibGVkIG9yIGRlbGV0ZWQpLgAAAAAAAAAADlJlZnVuZFBvc2l0aW9uAAAAAAABAAAAD3JlZnVuZF9wb3NpdGlvbgAAAAADAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAQAAAAI=",
        "AAAABQAAAKJDb2xsYXRlcmFsIGFkZGVkIG9yIHdpdGhkcmF3biB2aWEgYG1vZGlmeV9jb2xsYXRlcmFsYC4gT25seSBgY29sYApjaGFuZ2VzIG9uIHRoZSBwb3NpdGlvbjsgaW5kaWNlcyByZW1haW4gYXQgdGhlaXIgZmlsbC10aW1lIHNuYXBzaG90LgpEZWx0YSBpcyBgY29sIC0gcHJpb3JfY29sYC4AAAAAAAAAAAAQTW9kaWZ5Q29sbGF0ZXJhbAAAAAEAAAARbW9kaWZ5X2NvbGxhdGVyYWwAAAAAAAAEAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAtwb3NpdGlvbl9pZAAAAAAEAAAAAQAAAAAAAAADY29sAAAAAAsAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAHZXhlY3V0ZQAAAAAFAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAQAAAAAAAAABXVzZXJzAAAAAAAD6gAAABMAAAAAAAAAA2lkcwAAAAPqAAAABAAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAA==",
        "AAAAAAAAARxSZXBsYWNlIHRoZSBjb250cmFjdCdzIFdBU00gYnl0ZWNvZGUgd2l0aCBvbmUgbWF0Y2hpbmcgYG5ld193YXNtX2hhc2hgLgoKQXV0aG9yaXphdGlvbiBpcyB0d28tZm9sZDogYG9wZXJhdG9yYCBtdXN0IGByZXF1aXJlX2F1dGgoKWAgQU5EIG11c3QgYmUKdGhlIGN1cnJlbnQgb3duZXIuIEFueSBvdGhlciBjYWxsZXIgcGFuaWNzIHdpdGggYFVuYXV0aG9yaXplZGAuCgojIFBhbmljcwotIGBUcmFkaW5nRXJyb3I6OlVuYXV0aG9yaXplZGAgKDEpIGlmIGBvcGVyYXRvcmAgaXMgbm90IHRoZSBvd25lcgAAAAd1cGdyYWRlAAAAAAIAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAA==",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAJZ2V0X3Rva2VuAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJZ2V0X3ZhdWx0AAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAKZGVsX21hcmtldAAAAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABAAAAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAADVRyYWRpbmdDb25maWcAAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X3N0YXR1cwAAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAADVRyYWRpbmdDb25maWcAAAAAAAAA",
        "AAAAAAAAAAAAAAAKc2V0X21hcmtldAAAAAAAAgAAAAAAAAAJbWFya2V0X2lkAAAAAAAABAAAAAAAAAAGY29uZmlnAAAAAAfQAAAADE1hcmtldENvbmZpZwAAAAA=",
        "AAAAAAAAAAAAAAAKc2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAALZ2V0X21hcmtldHMAAAAAAAAAAAEAAAPqAAAABA==",
        "AAAAAAAAAAAAAAALb3Blbl9tYXJrZXQAAAAACgAAAAAAAAAEdXNlcgAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAQAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADW5vdGlvbmFsX3NpemUAAAAAAAALAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAAC3Rha2VfcHJvZml0AAAAAAsAAAAAAAAACXN0b3BfbG9zcwAAAAAAAAsAAAAAAAAAC3ByaWNlX2JvdW5kAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABAAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAALcGxhY2VfbGltaXQAAAAACAAAAAAAAAAEdXNlcgAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAQAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADW5vdGlvbmFsX3NpemUAAAAAAAALAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAAC2VudHJ5X3ByaWNlAAAAAAsAAAAAAAAAC3Rha2VfcHJvZml0AAAAAAsAAAAAAAAACXN0b3BfbG9zcwAAAAAAAAsAAAABAAAABA==",
        "AAAAAAAAAAAAAAAMZ2V0X3Bvc2l0aW9uAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAQAAB9AAAAAIUG9zaXRpb24=",
        "AAAAAAAAAAAAAAAMZ2V0X3RyZWFzdXJ5AAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAMc2V0X3RyaWdnZXJzAAAABAAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAt0YWtlX3Byb2ZpdAAAAAALAAAAAAAAAAlzdG9wX2xvc3MAAAAAAAALAAAAAA==",
        "AAAAAAAAAmFJbml0aWFsaXplIHRoZSB0cmFkaW5nIGNvbnRyYWN0IHdpdGggYWxsIGV4dGVybmFsIGRlcGVuZGVuY2llcyBhbmQgY29uZmlndXJhdGlvbi4KCiMgUGFyYW1ldGVycwotIGBvd25lcmAgLSBBZG1pbiBhZGRyZXNzIChncmFudGVkIG93bmVyLW9ubHkgcHJpdmlsZWdlcyB2aWEgYCNbb25seV9vd25lcl1gKQotIGB0b2tlbmAgLSBDb2xsYXRlcmFsIHRva2VuIGFkZHJlc3MKLSBgdmF1bHRgIC0gU3RyYXRlZ3ktdmF1bHQgYWRkcmVzcyAoaG9sZHMgY29sbGF0ZXJhbCwgRVJDLTQ2MjYpCi0gYHByaWNlX3ZlcmlmaWVyYCAtIHByaWNlLXZlcmlmaWVyIGNvbnRyYWN0IGFkZHJlc3MKLSBgdHJlYXN1cnlgIC0gVHJlYXN1cnkgY29udHJhY3QgZm9yIHByb3RvY29sIGZlZSBjb2xsZWN0aW9uCi0gYGNvbmZpZ2AgLSBHbG9iYWwgdHJhZGluZyBwYXJhbWV0ZXJzIChzZWUgW2BUcmFkaW5nQ29uZmlnYF0pCgojIFBhbmljcwotIGBUcmFkaW5nRXJyb3I6OkludmFsaWRDb25maWdgICg3MDApIGlmIGNvbmZpZyBmYWlscyB2YWxpZGF0aW9uIGJvdW5kcwotIGBUcmFkaW5nRXJyb3I6Ok5lZ2F0aXZlVmFsdWVOb3RBbGxvd2VkYCAoNzIzKSBpZiBhbnkgcmF0ZS9mZWUgaXMgbmVnYXRpdmUAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAYAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAV2YXVsdAAAAAAAABMAAAAAAAAADnByaWNlX3ZlcmlmaWVyAAAAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA1UcmFkaW5nQ29uZmlnAAAAAAAAAA==",
        "AAAAAAAAAAAAAAANYXBwbHlfZnVuZGluZwAAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAANdXBkYXRlX3N0YXR1cwAAAAAAAAEAAAAAAAAABXByaWNlAAAAAAAADgAAAAA=",
        "AAAAAAAAAAAAAAAOY2xvc2VfcG9zaXRpb24AAAAAAAUAAAAAAAAABHVzZXIAAAATAAAAAAAAAAJpZAAAAAAABAAAAAAAAAALcHJpY2VfYm91bmQAAAAACwAAAAAAAAARZXhwaXJhdGlvbl9sZWRnZXIAAAAAAAAEAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAACw==",
        "AAAAAAAAAAAAAAAPY2FuY2VsX3Bvc2l0aW9uAAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAAJpZAAAAAAABAAAAAEAAAAL",
        "AAAAAAAAAAAAAAAPZ2V0X21hcmtldF9kYXRhAAAAAAEAAAAAAAAACW1hcmtldF9pZAAAAAAAAAQAAAABAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAQZ2V0X3VzZXJfY291bnRlcgAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAARZ2V0X21hcmtldF9jb25maWcAAAAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAEAAAAAQAAB9AAAAAMTWFya2V0Q29uZmln",
        "AAAAAAAAAAAAAAARbW9kaWZ5X2NvbGxhdGVyYWwAAAAAAAAEAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAACaWQAAAAAAAQAAAAAAAAADm5ld19jb2xsYXRlcmFsAAAAAAALAAAAAAAAAAVwcmljZQAAAAAAAA4AAAAA",
        "AAAAAAAAAAAAAAASZ2V0X3ByaWNlX3ZlcmlmaWVyAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGluaXRpYXRlZC4AAAAAAAAAAAART3duZXJzaGlwVHJhbnNmZXIAAAAAAAABAAAAEm93bmVyc2hpcF90cmFuc2ZlcgAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNvbXBsZXRlZC4AAAAAAAAAAAAaT3duZXJzaGlwVHJhbnNmZXJDb21wbGV0ZWQAAAAAAAEAAAAcb3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAEAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg=="
    ]);

    static readonly parsers = {
        // Admin methods (void)
        setConfig: () => {},
        setMarket: () => {},
        delMarket: () => {},
        setStatus: () => {},
        updateStatus: () => {},
        upgrade: () => {},
        applyFunding: () => {},
        // Ownable methods
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
        // Trading methods
        placeLimit: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        openMarket: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancelPosition: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        closePosition: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        modifyCollateral: () => {},
        setTriggers: () => {},
        execute: () => {},
        // View / Getter methods
        getPosition: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getUserCounter: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getMarketConfig: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getMarketData: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getMarkets: (result: string): u32[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getConfig: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getStatus: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getVault: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getPriceVerifier: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getToken: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getTreasury: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
    };

    /**
     * Deploy a new instance of the Trading contract
     * Constructor: __constructor(owner, token, vault, price_verifier, treasury, config)
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: DeployArgs,
        salt?: Buffer,
        format: 'hex' | 'base64' = 'hex'
    ): string {
        return Operation.createCustomContract({
            address: Address.fromString(deployer),
            wasmHash: typeof wasmHash === 'string'
                ? Buffer.from(wasmHash, format)
                : wasmHash,
            salt,
            constructorArgs: [
                Address.fromString(args.owner).toScVal(),
                Address.fromString(args.token).toScVal(),
                Address.fromString(args.vault).toScVal(),
                Address.fromString(args.price_verifier).toScVal(),
                Address.fromString(args.treasury).toScVal(),
                TradingContract.tradingConfigToScVal(args.config),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Owner-only Admin Methods
    // ============================================================

    /**
     * Set the trading configuration (owner only)
     */
    setConfig(config: TradingConfigArgs): string {
        return this.call(
            'set_config',
            TradingContract.tradingConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Add or update a market (owner only)
     * @param marketId - Market identifier
     * @param config - Market configuration (includes feed_id for Pyth price feed)
     */
    setMarket(marketId: u32, config: MarketConfigArgs): string {
        return this.call(
            'set_market',
            xdr.ScVal.scvU32(marketId),
            TradingContract.marketConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Remove a market (owner only)
     * Subtracts remaining OI from total_notional. Existing positions
     * are refunded via closePosition or execute.
     * @param marketId - Market identifier
     */
    delMarket(marketId: u32): string {
        return this.call(
            'del_market',
            xdr.ScVal.scvU32(marketId),
        ).toXDR('base64');
    }

    /**
     * Set the contract status (owner only)
     * Active(0), AdminOnIce(2), Frozen(3). Use updateStatus() for OnIce.
     */
    setStatus(status: u32): string {
        return this.call(
            'set_status',
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Upgrade contract WASM (owner only)
     */
    upgrade(wasmHash: Buffer | Uint8Array, operator: string): string {
        const hashBuffer = wasmHash instanceof Buffer ? wasmHash : Buffer.from(wasmHash);
        return this.call(
            'upgrade',
            xdr.ScVal.scvBytes(hashBuffer),
            Address.fromString(operator).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Ownable Methods
    // ============================================================

    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    transferOwnership(newOwner: Address | string, liveUntilLedger: u32): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    // ============================================================
    // Trading Methods
    // ============================================================

    /**
     * Place a pending limit order
     * Returns position_id
     */
    placeLimit(args: PlaceLimitArgs): string {
        return this.call(
            'place_limit',
            Address.fromString(args.user).toScVal(),
            xdr.ScVal.scvU32(args.market_id),
            nativeToScVal(args.collateral, { type: 'i128' }),
            nativeToScVal(args.notional_size, { type: 'i128' }),
            xdr.ScVal.scvBool(args.is_long),
            nativeToScVal(args.entry_price, { type: 'i128' }),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Open a market order (filled immediately at oracle price)
     *
     * `price_bound` enforces direction-aware slippage at the contract layer
     * (revert `PriceSlippage` / 712). `expiration_ledger` makes the call revert
     * with `Expired` (760) once the current ledger passes it. Pass `0` on either
     * to opt out.
     *
     * Returns position_id
     */
    openMarket(args: OpenMarketArgs): string {
        const priceBuffer = args.price instanceof Buffer ? args.price : Buffer.from(args.price);
        return this.call(
            'open_market',
            Address.fromString(args.user).toScVal(),
            xdr.ScVal.scvU32(args.market_id),
            nativeToScVal(args.collateral, { type: 'i128' }),
            nativeToScVal(args.notional_size, { type: 'i128' }),
            xdr.ScVal.scvBool(args.is_long),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
            nativeToScVal(args.price_bound, { type: 'i128' }),
            xdr.ScVal.scvU32(args.expiration_ledger),
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Cancel a position and refund collateral.
     * Pending: requires user auth. Filled: only if market deleted (permissionless).
     */
    cancelPosition(user: string, id: u32): string {
        return this.call(
            'cancel_position',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
    }

    /**
     * Close a filled position
     *
     * `price_bound` enforces direction-aware slippage at the contract layer
     * (revert `PriceSlippage` / 712). `expiration_ledger` makes the call revert
     * with `Expired` (760) once the current ledger passes it. Pass `0` on either
     * to opt out.
     *
     * Returns user payout (i128)
     */
    closePosition(args: ClosePositionArgs): string {
        const priceBuffer = args.price instanceof Buffer ? args.price : Buffer.from(args.price);
        return this.call(
            'close_position',
            Address.fromString(args.user).toScVal(),
            xdr.ScVal.scvU32(args.id),
            nativeToScVal(args.price_bound, { type: 'i128' }),
            xdr.ScVal.scvU32(args.expiration_ledger),
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Modify collateral on a position.
     *
     * `new_collateral` is the absolute target collateral, not a delta. The call
     * carries no `expiration_ledger`: a delayed submission within the Soroban
     * auth window cannot degrade the outcome (the position lands at the target
     * value either way), and the Soroban auth entry's own
     * `signatureExpirationLedger` already bounds the submission window.
     */
    modifyCollateral(args: ModifyCollateralArgs): string {
        const priceBuffer = args.price instanceof Buffer ? args.price : Buffer.from(args.price);
        return this.call(
            'modify_collateral',
            Address.fromString(args.user).toScVal(),
            xdr.ScVal.scvU32(args.id),
            nativeToScVal(args.new_collateral, { type: 'i128' }),
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Set take profit and stop loss triggers
     */
    setTriggers(args: SetTriggersArgs): string {
        return this.call(
            'set_triggers',
            Address.fromString(args.user).toScVal(),
            xdr.ScVal.scvU32(args.id),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Execute keeper triggers (auto-detects: fill, liquidation, SL, TP)
     * @param users - Position owner addresses (parallel with ids)
     * @param ids - Per-user position IDs (parallel with users)
     */
    execute(caller: Address | string, marketId: u32, users: string[], ids: u32[], price: Buffer | Uint8Array): string {
        const callerAddress = typeof caller === 'string'
            ? Address.fromString(caller)
            : caller;

        const usersScVal = xdr.ScVal.scvVec(
            users.map(u => Address.fromString(u).toScVal())
        );
        const idsScVal = xdr.ScVal.scvVec(
            ids.map(id => xdr.ScVal.scvU32(id))
        );

        const priceBuffer = price instanceof Buffer ? price : Buffer.from(price);

        return this.call(
            'execute',
            callerAddress.toScVal(),
            xdr.ScVal.scvU32(marketId),
            usersScVal,
            idsScVal,
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    // ============================================================
    // Permissionless Methods
    // ============================================================

    /**
     * Permissionless status update based on price data (circuit breaker / ADL)
     */
    updateStatus(price: Buffer | Uint8Array): string {
        const priceBuffer = price instanceof Buffer ? price : Buffer.from(price);
        return this.call(
            'update_status',
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Apply funding across all markets (permissionless, once per hour)
     */
    applyFunding(): string {
        return this.call('apply_funding').toXDR('base64');
    }

    // ============================================================
    // View / Getter Methods
    // ============================================================

    getPosition(user: string, id: u32): string {
        return this.call(
            'get_position',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
    }

    getUserCounter(user: Address | string): string {
        const addr = typeof user === 'string' ? Address.fromString(user) : user;
        return this.call(
            'get_user_counter',
            addr.toScVal(),
        ).toXDR('base64');
    }

    getMarketConfig(marketId: u32): string {
        return this.call(
            'get_market_config',
            xdr.ScVal.scvU32(marketId),
        ).toXDR('base64');
    }

    getMarketData(marketId: u32): string {
        return this.call(
            'get_market_data',
            xdr.ScVal.scvU32(marketId),
        ).toXDR('base64');
    }

    getMarkets(): string {
        return this.call('get_markets').toXDR('base64');
    }

    getConfig(): string {
        return this.call('get_config').toXDR('base64');
    }

    getStatus(): string {
        return this.call('get_status').toXDR('base64');
    }

    getVault(): string {
        return this.call('get_vault').toXDR('base64');
    }

    getPriceVerifier(): string {
        return this.call('get_price_verifier').toXDR('base64');
    }

    getToken(): string {
        return this.call('get_token').toXDR('base64');
    }

    getTreasury(): string {
        return this.call('get_treasury').toXDR('base64');
    }

    // ============================================================
    // Internal Helpers
    // ============================================================

    /** @internal */
    static tradingConfigToScVal(config: TradingConfigArgs): xdr.ScVal {
        // Fields must be in alphabetical order for Soroban struct serialization
        return xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('caller_rate'),
                val: nativeToScVal(config.caller_rate, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('fee_dom'),
                val: nativeToScVal(config.fee_dom, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('fee_non_dom'),
                val: nativeToScVal(config.fee_non_dom, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_notional'),
                val: nativeToScVal(config.max_notional, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_util'),
                val: nativeToScVal(config.max_util, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('min_notional'),
                val: nativeToScVal(config.min_notional, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_base'),
                val: nativeToScVal(config.r_base, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_funding'),
                val: nativeToScVal(config.r_funding, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_var'),
                val: nativeToScVal(config.r_var, { type: 'i128' }),
            }),
        ]);
    }

    /** @internal */
    static marketConfigToScVal(config: MarketConfigArgs): xdr.ScVal {
        // Fields must be in alphabetical order for Soroban struct serialization
        return xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('enabled'),
                val: xdr.ScVal.scvBool(config.enabled),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('feed_id'),
                val: xdr.ScVal.scvU32(config.feed_id),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('impact'),
                val: nativeToScVal(config.impact, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('liq_fee'),
                val: nativeToScVal(config.liq_fee, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('margin'),
                val: nativeToScVal(config.margin, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_util'),
                val: nativeToScVal(config.max_util, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_var_market'),
                val: nativeToScVal(config.r_var_market, { type: 'i128' }),
            }),
        ]);
    }

}
