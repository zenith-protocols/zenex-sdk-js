import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32, i32, u64 } from '../index.js';
import type { Call } from '../trading-router/router_types.js';
import {
    OrderKind, VaultOrderKind, TradingConfig,
    Order, VaultOrder, Position, MarketData, AdlState,
    tradingConfigToScVal,
    parseOrder, parseVaultOrder, parsePosition, parseMarketData, parseAdlState, parseTradingConfig,
    FULL_CLOSE,
} from './trading_types.js';

// =============================================================================
// Argument interfaces
// =============================================================================

/** Deploy-time constructor arguments (`__constructor`). */
export interface DeployArgs {
    owner: string;
    token: string;
    vault: string;
    priceVerifier: string;
    treasury: string;
    feedId: u32;
    exponent: i32;
    config: TradingConfig;
}

/** Open a position at market (no trigger). */
export interface OpenMarketArgs {
    user: string;
    isLong: boolean;
    notional: i128;
    collateral: i128;
    priceBound: i128;
    expiration: u32;
}

/** Open a position once the trigger price is crossed. */
export interface OpenLimitArgs {
    user: string;
    isLong: boolean;
    notional: i128;
    collateral: i128;
    triggerPrice: i128;
    priceBound: i128;
    expiration: u32;
}

/** Fully close a position at market. */
export interface ClosePositionArgs {
    user: string;
    isLong: boolean;
    priceBound: i128;
    expiration: u32;
}

/** Partially decrease a position, optionally withdrawing collateral. */
export interface DecreasePositionArgs {
    user: string;
    isLong: boolean;
    notional: i128;
    collateral: i128;
    priceBound: i128;
    expiration: u32;
}

/** Collateral-only order (notional 0): add or withdraw margin without changing size. */
export interface ModifyCollateralArgs {
    user: string;
    isLong: boolean;
    amount: i128;
    expiration: u32;
}

/** A take-profit or stop-loss trigger order. */
export interface TriggerOrderArgs {
    user: string;
    isLong: boolean;
    triggerPrice: i128;
    /** Size to close on trigger; defaults to `FULL_CLOSE`. */
    notional?: i128;
    priceBound: i128;
    expiration: u32;
}

/** Deposit assets into the vault. */
export interface VaultDepositArgs {
    user: string;
    amount: i128;
    /** Minimum shares received at fill, net of the deposit fee; 0 = unset. */
    minOut: i128;
}

/** Redeem vault shares for assets. */
export interface VaultRedeemArgs {
    user: string;
    shares: i128;
    /** Minimum assets received at fill, net of the redeem fee; 0 = unset. */
    minOut: i128;
}

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer` for `scvBytes`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/**
 * TradingContract - Operation builder for the Zenex v2 Trading contract
 * (order -> keeper-execute flow, single market per contract instance).
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class TradingContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "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",
        "AAAABQAAAEFBIGtlZXBlciBmaWxsIG9mIGFuIGluY3JlYXNlIG9yZGVyICh0aGUgdXNlcidzIGl0ZW1pemVkIHJlY2VpcHQpLgAAAAAAAAAAAAAMSW5jcmVhc2VGaWxsAAAAAQAAAA1pbmNyZWFzZV9maWxsAAAAAAAADAAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAJpZAAAAAAABAAAAAEAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAEAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAAAAAACG5vdGlvbmFsAAAACwAAAAAAAAAAAAAABnRva2VucwAAAAAACwAAAAAAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAAAAAAAAhiYXNlX2ZlZQAAAAsAAAAAAAAAAAAAAAppbXBhY3RfZmVlAAAAAAALAAAAAAAAAAAAAAAHZnVuZGluZwAAAAALAAAAAAAAAAAAAAAJYm9ycm93aW5nAAAAAAAACwAAAAAAAAAC",
        "AAAABQAAACxPcGVyYXRpb25hbCBzdGF0dXMgY2hhbmdlZCB2aWEgYHNldF9zdGF0dXNgLgAAAAAAAAAMU3RhdHVzVXBkYXRlAAAAAQAAAA1zdGF0dXNfdXBkYXRlAAAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAF5UaGUgbWFya2V0J3MgcG9zdC1hY2NydWFsIGZ1bmRpbmcgc3RhdGUsIGVtaXR0ZWQgYnkgdGhlIGBhY2NydWVgIGFuZApgYWNjcnVlX2Z1bmRpbmdgIGVudHJpZXMuAAAAAAAAAAAADkZ1bmRpbmdBY2NydWFsAAAAAAABAAAAD2Z1bmRpbmdfYWNjcnVhbAAAAAADAAAAAAAAAAxmdW5kaW5nX3JhdGUAAAALAAAAAAAAAAAAAAALZnVuZGluZ19pZHgAAAAH0AAAAAhTaWRlUGFpcgAAAAAAAAAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAAAAAAAAg==",
        "AAAABQAAAElUaGUgbWFya2V0J3MgcG9zdC1hY2NydWFsIGJvcnJvd2luZyBzdGF0ZSwgZW1pdHRlZCBieSB0aGUgYGFjY3J1ZWAgZW50cnkuAAAAAAAAAAAAABBCb3Jyb3dpbmdBY2NydWFsAAAAAQAAABFib3Jyb3dpbmdfYWNjcnVhbAAAAAAAAAIAAAAAAAAADWJvcnJvd2luZ19pZHgAAAAAAAfQAAAACFNpZGVQYWlyAAAAAAAAAAAAAAAJdGltZXN0YW1wAAAAAAAABgAAAAAAAAAC",
        "AAAABQAAAERQZW5kaW5nIHZhdWx0IG9yZGVyIGNhbmNlbGxlZCBieSBpdHMgb3duZXIgdmlhIGBjYW5jZWxfdmF1bHRfb3JkZXJgLgAAAAAAAAAQQ2FuY2VsVmF1bHRPcmRlcgAAAAEAAAASY2FuY2VsX3ZhdWx0X29yZGVyAAAAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAQAAAAI=",
        "AAAABQAAALBWYXVsdCBkZXBvc2l0IG9yIHJlZGVlbSBvcmRlciBjcmVhdGVkIHZpYSBgY3JlYXRlX3ZhdWx0X29yZGVyYC4gVGhlIHJvdyBpcwppbW11dGFibGUgd2hpbGUgcGVuZGluZywgc28gdGhlIHBheWxvYWQgc3RheXMgYXV0aG9yaXRhdGl2ZSB1bnRpbCB0aGUKb3JkZXIncyBmaWxsIG9yIGNhbmNlbCByZWNlaXB0LgAAAAAAAAAQQ3JlYXRlVmF1bHRPcmRlcgAAAAEAAAASY3JlYXRlX3ZhdWx0X29yZGVyAAAAAAADAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAQAAAAAAAAAFb3JkZXIAAAAAAAfQAAAAClZhdWx0T3JkZXIAAAAAAAAAAAAC",
        "AAAABQAAAEBGbGF0IHNldHRsZW1lbnQgcHJpY2Ugc2V0IG9yIHJlZnJlc2hlZCB2aWEgYHNldF90ZXJtaW5hbF9wcmljZWAuAAAAAAAAABNUZXJtaW5hbFByaWNlVXBkYXRlAAAAAAEAAAAVdGVybWluYWxfcHJpY2VfdXBkYXRlAAAAAAAAAQAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAI=",
        "AAAAAQAAAGZBIGxvbmcvc2hvcnQgcGFpciBvZiBgaTEyOGAgdmFsdWVzLCB1c2VkIGZvciBwZXItc2lkZSBvcGVuIGludGVyZXN0LCBwb3N0ZWQKY29sbGF0ZXJhbCwgYW5kIGJhc2Ugc2l6ZS4AAAAAAAAAAAAIU2lkZVBhaXIAAAACAAAAAAAAAARsb25nAAAACwAAAAAAAAAFc2hvcnQAAAAAAAAL",
        "AAAAAQAAAGFNYXJrZXQgc3RhdGUsIHN0b3JlZCBpbiBpdHMgb3duIHBlcnNpc3RlbnQgZW50cnkuCgpQb29sIHN1cnBsdXMgaXMgYGZ1bmRpbmdfcG9vbCAtIGZ1bmRpbmdfb3dlZGAuAAAAAAAAAAAAAApNYXJrZXREYXRhAAAAAAALAAAAAAAAAA1ib3Jyb3dpbmdfaWR4AAAAAAAH0AAAAAhTaWRlUGFpcgAAAAAAAAAQYm9ycm93aW5nX3VwZGF0ZQAAAAYAAAAAAAAACmNvbGxhdGVyYWwAAAAAB9AAAAAIU2lkZVBhaXIAAAAAAAAAC2Z1bmRpbmdfaWR4AAAAB9AAAAAIU2lkZVBhaXIAAAAAAAAADGZ1bmRpbmdfb3dlZAAAAAsAAAAAAAAADGZ1bmRpbmdfcG9vbAAAAAsAAAAAAAAADGZ1bmRpbmdfcmF0ZQAAAAsAAAAAAAAADmZ1bmRpbmdfdXBkYXRlAAAAAAAGAAAAAAAAAA9sYXN0X3ByaWNlX3RpbWUAAAAABgAAAAAAAAAIbm90aW9uYWwAAAfQAAAACFNpZGVQYWlyAAAAAAAAAAZ0b2tlbnMAAAAAB9AAAAAIU2lkZVBhaXI=",
        "AAAAAQAAAEtBIHBlbmRpbmcgdmF1bHQgZGVwb3NpdCBvciByZWRlZW0gKHBlcnNpc3RlbnQgc3RvcmFnZSwga2V5ZWQgYCh1c2VyLCBpZClgKS4AAAAAAAAAAApWYXVsdE9yZGVyAAAAAAAFAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAACGV4ZWNfZmVlAAAACwAAAAAAAAAEa2luZAAAAAQAAAAAAAAAB21pbl9vdXQAAAAACw==",
        "AAAAAQAAAFhBREwgc3RhdGUgKGluc3RhbmNlIHN0b3JhZ2Ugc2luZ2xldG9uKTogdGhlIHBlci1zaWRlIGVuYWJsZSBmbGFncyBkcml2aW5nCnRoZSBvcGVuLXN0b3AuAAAAAAAAAAhBZGxTdGF0ZQAAAAIAAAAAAAAABGxvbmcAAAABAAAAAAAAAAVzaG9ydAAAAAAAAAE=",
        "AAAAAQAAAR9BIGtlZXBlci1leGVjdXRlZCBvcmRlciAocGVyc2lzdGVudCB1c2VyLXRpZXIgc3RvcmFnZSwga2V5ZWQgYCh1c2VyLCBpZClgKS4KCmBraW5kYCBzZXRzIGJvdGggdGhlIHNpemUgZGlyZWN0aW9uIGFuZCB0aGUgZWxpZ2liaWxpdHkgcnVsZTsKYG5vdGlvbmFsYC9gY29sbGF0ZXJhbGAgYXJlIG5vbi1uZWdhdGl2ZSBtYWduaXR1ZGVzLiBUaGUgYGNvbGxhdGVyYWxgIChmb3IKYW4gaW5jcmVhc2UpIGFuZCB0aGUgYGV4ZWNfZmVlYCBhcmUgZXNjcm93ZWQgaW4gdGhlIGNvbnRyYWN0IGF0IGNyZWF0aW9uLgAAAAAAAAAABU9yZGVyAAAAAAAACQAAAAAAAAAKY29sbGF0ZXJhbAAAAAAACwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAAAAAAAIZXhlY19mZWUAAAALAAAAAAAAAApleHBpcmF0aW9uAAAAAAAEAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAABGtpbmQAAAAEAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAAC3ByaWNlX2JvdW5kAAAAAAsAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAAL",
        "AAAAAQAAAVJHbG9iYWwgdHJhZGluZyBwYXJhbWV0ZXJzIChpbnN0YW5jZSBzdG9yYWdlIHNpbmdsZXRvbiksIG11dGFibGUgdmlhIHRoZQpvd25lci1vbmx5IGBzZXRfY29uZmlnYC4KClJhdGVzIGFyZSBwZXItc2Vjb25kIChHTVggcGFyaXR5KS4gVXRpbGl6YXRpb24gKG9wZW4gaW50ZXJlc3QgLyB2YXVsdCkgaGFzIHR3bwpjYXBzOiBhIGxvd2VyIGBtYXhfdXRpbF9vcGVuYCBmb3Igb3BlbnMgdGhhdCBhbHNvIHNldHMgdGhlIGJvcnJvdyByZXNlcnZlLCBhbmQgYQpoaWdoZXIgYG1heF91dGlsX3dpdGhkcmF3YCBmb3Igd2l0aGRyYXdhbHMgdGhhdCByZXRhaW5zIG1pbmltdW0gdmF1bHQgbGlxdWlkaXR5LgAAAAAAAAAAAAZDb25maWcAAAAAACIAAAAAAAAAEGFkbF9jbGVhcl90YXJnZXQAAAALAAAAAAAAAAthZGxfbWF4X3BubAAAAAALAAAAAAAAAAtib3Jyb3dfcmF0ZQAAAAALAAAAAAAAAAtkZXBvc2l0X2ZlZQAAAAALAAAAAAAAAAhleGVjX2ZlZQAAAAsAAAAAAAAAB2ZlZV9kb20AAAAACwAAAAAAAAALZmVlX25vbl9kb20AAAAACwAAAAAAAAAQZnVuZGluZ19kZWNyZWFzZQAAAAsAAAAAAAAAEGZ1bmRpbmdfaW5jcmVhc2UAAAALAAAAAAAAAAtmdW5kaW5nX21heAAAAAALAAAAAAAAAAtmdW5kaW5nX21pbgAAAAALAAAAAAAAAA1pbXBhY3Rfc2NhbGFyAAAAAAAACwAAAAAAAAAVaW5jcmVhc2VkX2JvcnJvd19yYXRlAAAAAAAACwAAAAAAAAALaW5pdF9tYXJnaW4AAAAACwAAAAAAAAALa2VlcGVyX3JhdGUAAAAACwAAAAAAAAAHbGlxX2ZlZQAAAAALAAAAAAAAABJtYWludGVuYW5jZV9tYXJnaW4AAAAAAAsAAAAAAAAAEW1heF9vcGVuX2ludGVyZXN0AAAAAAAACwAAAAAAAAAObWF4X3BubF90cmFkZXIAAAAAAAsAAAAAAAAAEG1heF9wbmxfd2l0aGRyYXcAAAALAAAAAAAAABVtYXhfcG9zaXRpb25fbm90aW9uYWwAAAAAAAALAAAAAAAAAA1tYXhfdXRpbF9vcGVuAAAAAAAACwAAAAAAAAARbWF4X3V0aWxfd2l0aGRyYXcAAAAAAAALAAAAAAAAABFtYXhfdmF1bHRfYmFsYW5jZQAAAAAAAAsAAAAAAAAAC21pbl9kZXBvc2l0AAAAAAsAAAAAAAAAFG1pbl9vcmRlcl9jb2xsYXRlcmFsAAAACwAAAAAAAAASbWluX29yZGVyX25vdGlvbmFsAAAAAAALAAAAAAAAABVtaW5fcG9zaXRpb25fbm90aW9uYWwAAAAAAAALAAAAAAAAAA1ub3Rpb25hbF9sb2NrAAAAAAAABgAAAAAAAAAKcmVkZWVtX2ZlZQAAAAAACwAAAAAAAAALcmVkZWVtX2xvY2sAAAAABgAAAAAAAAALdGFyZ2V0X3V0aWwAAAAACwAAAAAAAAAadGhyZXNob2xkX2RlY3JlYXNlX2Z1bmRpbmcAAAAAAAsAAAAAAAAAGHRocmVzaG9sZF9zdGFibGVfZnVuZGluZwAAAAs=",
        "AAAAAQAAAbxBIG5ldHRlZCB0cmFkZXIgcG9zaXRpb24sIG9uZSBwZXIgYCh1c2VyLCBpc19sb25nKWAgKHRoZSBzdG9yYWdlIGtleSkuCgpQbkwgaXMgaW1wbGllZDogYHRva2VucyAqIHByaWNlIC0gbm90aW9uYWxgIChsb25nKSwgaW52ZXJzZSBmb3Igc2hvcnQuCmBmdW5kaW5nX2lkeGAvYGJvcnJvd2luZ19pZHhgIHNuYXBzaG90IHRoZSBtYXJrZXQgaW5kaWNlcyBhdCB0aGUgbGFzdCBjaGFuZ2UuClplcm8gYG5vdGlvbmFsYCBtZWFucyBubyBvcGVuIHBvc2l0aW9uOyB0aGUgemVyb2VkIHJvdyBpcyB0aGUgY2Fub25pY2FsCmNsb3NlZCBzdGF0ZSwgd2hldGhlciB0aGUgZW50cnkgZXhpc3RzIG9yIG5vdC4gVGhlIHNpZGUncyBwZW5kaW5nIGRlY3JlYXNlCm9yZGVycyByaWRlIG9uIGBkZWNyZWFzZV9vcmRlcnNgIGFuZCBhcmUgY2FuY2VsbGVkIHdoZW4gdGhlIHBvc2l0aW9uIGNsb3Nlcy4AAAAAAAAACFBvc2l0aW9uAAAACQAAAAAAAAANYm9ycm93aW5nX2lkeAAAAAAAAAsAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAAD2RlY3JlYXNlX29yZGVycwAAAAPqAAAABAAAAAAAAAALZnVuZGluZ19pZHgAAAAACwAAAAAAAAAPbG9ja2VkX25vdGlvbmFsAAAAAAsAAAAAAAAACG5vdGlvbmFsAAAACwAAAAAAAAAJcHJpY2VkX2F0AAAAAAAABgAAAAAAAAAGdG9rZW5zAAAAAAALAAAAAAAAAAp1bmxvY2tzX2F0AAAAAAAG",
        "AAAAAAAAAAAAAAAGYWNjcnVlAAAAAAABAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAAAAAAAAAAAHZ2V0X2FkbAAAAAAAAAAAAQAAB9AAAAAIQWRsU3RhdGU=",
        "AAAAAAAAAAAAAAAIZ2V0X2ZlZWQAAAAAAAAAAQAAA+0AAAACAAAABAAAAAU=",
        "AAAAAAAAAAAAAAAJZ2V0X29yZGVyAAAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAQAAA+gAAAfQAAAABU9yZGVyAAAA",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAJZ2V0X3Rva2VuAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJZ2V0X3ZhdWx0AAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAABkNvbmZpZwAA",
        "AAAAAAAAAAAAAAAKZ2V0X3N0YXR1cwAAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAABkNvbmZpZwAAAAAAAA==",
        "AAAAAAAAAAAAAAAKc2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAALZXhlY3V0ZV9hZGwAAAAABQAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAAL",
        "AAAAAAAAAAAAAAAMY2FuY2VsX29yZGVyAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMY3JlYXRlX29yZGVyAAAACAAAAAAAAAAEdXNlcgAAABMAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAAAAAAEa2luZAAAAAQAAAAAAAAACG5vdGlvbmFsAAAACwAAAAAAAAAKY29sbGF0ZXJhbAAAAAAACwAAAAAAAAANdHJpZ2dlcl9wcmljZQAAAAAAAAsAAAAAAAAAC3ByaWNlX2JvdW5kAAAAAAsAAAAAAAAACmV4cGlyYXRpb24AAAAAAAQAAAABAAAABA==",
        "AAAAAAAAAAAAAAAMZ2V0X3Bvc2l0aW9uAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAEAAAfQAAAACFBvc2l0aW9u",
        "AAAAAAAAAAAAAAAMZ2V0X3RyZWFzdXJ5AAAAAAAAAAEAAAAT",
        "AAAAAAAAA09Jbml0aWFsaXplIHRoZSB0cmFkaW5nIGNvbnRyYWN0LgoKW2BNYXJrZXREYXRhYF0gc3RhcnRzIHplcm9lZCB3aXRoIGl0cyBhY2NydWFsIHRpbWVzdGFtcHMgYXQgYG5vd2A7IHN0YXR1cwpzdGFydHMgW2BTdGF0dXM6OkFjdGl2ZWBdLgoKIyBBdXRob3JpemF0aW9uCi0gQ2FsbGVkIG9uY2UgYXQgZGVwbG95bWVudDsgc2V0cyBgb3duZXJgIGFzIHRoZSBjb250cmFjdCBvd25lci4KCiMgQXJndW1lbnRzCi0gYG93bmVyYDogdGhlIGNvbnRyYWN0IG93bmVyIGZvciB0aGUgYWRtaW4gZW50cmllcy4KLSBgdG9rZW5gOiB0aGUgc2V0dGxlbWVudCB0b2tlbi4KLSBgdmF1bHRgOiB0aGUgc3RyYXRlZ3ktdmF1bHQgY29udHJhY3QuCi0gYHByaWNlX3ZlcmlmaWVyYDogdGhlIHByaWNlLXZlcmlmaWVyIGNvbnRyYWN0LgotIGB0cmVhc3VyeWA6IHRoZSBwcm90b2NvbCBmZWUgc2luay4KLSBgZmVlZF9pZGA6IHRoZSBvcmFjbGUgcHJpY2UgZmVlZCBpZDsgaW1tdXRhYmxlLgotIGBleHBvbmVudGA6IHRoZSBvcmFjbGUgZXhwb25lbnQ7IGltbXV0YWJsZTsgYHByaWNlX3NjYWxhciA9IDEwXi1leHBvbmVudGAuCi0gYGNvbmZpZ2A6IHRoZSBpbml0aWFsIGdsb2JhbCB0cmFkaW5nIGNvbmZpZ3VyYXRpb24uCgojIEVycm9ycwotIFtgVHJhZGluZ0Vycm9yOjpJbnZhbGlkQ29uZmlnYF0gaWYgYGV4cG9uZW50YCBpcyBvdXRzaWRlIGBNSU5fRVhQT05FTlQuLj1NQVhfRVhQT05FTlRgLApvciBhIGNvbmZpZyBib3VuZCBvciByYW5nZSBjaGVjayBmYWlscy4KLSBbYFRyYWRpbmdFcnJvcjo6TmVnYXRpdmVWYWx1ZU5vdEFsbG93ZWRgXSBpZiBhbnkgcmF0ZSwgZmVlLCBvciBtYXJnaW4gaXMgbmVnYXRpdmUuAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAACAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABXZhdWx0AAAAAAAAEwAAAAAAAAAOcHJpY2VfdmVyaWZpZXIAAAAAABMAAAAAAAAACHRyZWFzdXJ5AAAAEwAAAAAAAAAHZmVlZF9pZAAAAAAEAAAAAAAAAAhleHBvbmVudAAAAAUAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAZDb25maWcAAAAAAAA=",
        "AAAAAAAAAAAAAAANY2xhaW1fZnVuZGluZwAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAANZXhlY3V0ZV9vcmRlcgAAAAAAAAQAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAACw==",
        "AAAAAAAAAAAAAAAOYWNjcnVlX2Z1bmRpbmcAAAAAAAAAAAABAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAAAAAAAAAAAOZ2V0X3JldGlyZW1lbnQAAAAAAAAAAAABAAAD6AAAA+0AAAACAAAACwAAAAY=",
        "AAAAAAAAAAAAAAAPZ2V0X21hcmtldF9kYXRhAAAAAAAAAAABAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAAAAAAAAAAAPZ2V0X3ZhdWx0X29yZGVyAAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAAJpZAAAAAAABAAAAAEAAAPoAAAH0AAAAApWYXVsdE9yZGVyAAA=",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAQdXBkYXRlX2FkbF9zdGF0ZQAAAAEAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAfQAAAACEFkbFN0YXRl",
        "AAAAAAAAAAAAAAARZ2V0X29yZGVyX2NvdW50ZXIAAAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAE",
        "AAAAAAAAAAAAAAASY2FuY2VsX3ZhdWx0X29yZGVyAAAAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAACaWQAAAAAAAQAAAABAAAACw==",
        "AAAAAAAAAAAAAAASY3JlYXRlX3ZhdWx0X29yZGVyAAAAAAAEAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAEa2luZAAAAAQAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAHbWluX291dAAAAAALAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAASZ2V0X3ByaWNlX3ZlcmlmaWVyAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAASc2V0X3Rlcm1pbmFsX3ByaWNlAAAAAAABAAAAAAAAAAVwcmljZQAAAAAAAAsAAAAA",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAATZXhlY3V0ZV9saXF1aWRhdGlvbgAAAAAEAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAAL",
        "AAAAAAAAAAAAAAATZXhlY3V0ZV92YXVsdF9vcmRlcgAAAAAEAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAAJpZAAAAAAABAAAAAAAAAAFcHJpY2UAAAAAAAAOAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAVZ2V0X2NsYWltYWJsZV9mdW5kaW5nAAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAACw==",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGluaXRpYXRlZC4AAAAAAAAAAAART3duZXJzaGlwVHJhbnNmZXIAAAAAAAABAAAAEm93bmVyc2hpcF90cmFuc2ZlcgAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNvbXBsZXRlZC4AAAAAAAAAAAAaT3duZXJzaGlwVHJhbnNmZXJDb21wbGV0ZWQAAAAAAAEAAAAcb3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAEAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg=="
    ]);

    static readonly parsers = {
        // --- admin (void) ---
        setConfig: () => {},
        setStatus: () => {},
        setTerminalPrice: () => {},
        // --- Ownable ---
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
        // --- trader / keeper (numeric) ---
        createOrder: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancelOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        createVaultOrder: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancelVaultOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        claimFunding: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeLiquidation: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeAdl: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeVaultOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getClaimableFunding: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // --- struct-decoding views ---
        updateAdlState: (result: string): AdlState =>
            parseAdlState(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getAdl: (result: string): AdlState =>
            parseAdlState(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        accrueFunding: (result: string): MarketData =>
            parseMarketData(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        accrue: (result: string): MarketData =>
            parseMarketData(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getMarketData: (result: string): MarketData =>
            parseMarketData(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getPosition: (result: string): Position =>
            parsePosition(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        // Option<Order>: None decodes to null.
        getOrder: (result: string): Order | undefined => {
            const native = scValToNative(xdr.ScVal.fromXDR(result, 'base64'));
            return native == null ? undefined : parseOrder(native);
        },
        // Option<VaultOrder>: None decodes to null.
        getVaultOrder: (result: string): VaultOrder | undefined => {
            const native = scValToNative(xdr.ScVal.fromXDR(result, 'base64'));
            return native == null ? undefined : parseVaultOrder(native);
        },
        getConfig: (result: string): TradingConfig =>
            parseTradingConfig(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        // --- plain scalar / address / tuple views (passthrough) ---
        getStatus: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getOrderCounter: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getToken: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getVault: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getTreasury: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getPriceVerifier: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getRetirement: (result: string): [i128, u64] | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        getFeed: (result: string): [u32, i32] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
    };

    /**
     * Deploy a new instance of the Trading contract.
     *
     * Constructor: `__constructor(owner, token, vault, price_verifier,
     * treasury, feed_id, exponent, config)`. `MarketData` starts zeroed with
     * its accrual timestamps at `now`; status starts `Status::Active`.
     *
     * # Errors
     * - InvalidConfig (700) if `exponent` is outside the valid range, or a
     *   config bound or range check fails.
     * - NegativeValueNotAllowed (710) if any rate, fee, or margin is negative.
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
                Address.fromString(args.priceVerifier).toScVal(),
                Address.fromString(args.treasury).toScVal(),
                xdr.ScVal.scvU32(args.feedId),
                xdr.ScVal.scvI32(args.exponent),
                tradingConfigToScVal(args.config),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Admin (owner only)
    // ============================================================

    /**
     * Replace the global trading configuration.
     *
     * A borrowing-param change requires a same-ledger `accrue`. Owner only.
     *
     * # Errors
     * - InvalidConfig (700) if a bound or range check fails.
     * - NegativeValueNotAllowed (710) if any rate, fee, or margin is negative.
     * - BorrowingNotAccrued (703) if a borrowing param changed without a
     *   same-ledger accrual.
     */
    setConfig(config: TradingConfig): string {
        return this.call(
            'set_config',
            tradingConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Set the contract operational status.
     *
     * Transition validity follows the `Status` lifecycle. Entering
     * `Status::Retired` sweeps the funding-pool surplus to the vault. Owner only.
     *
     * # Errors
     * - InvalidStatus (702) on an unknown status value or an invalid transition.
     * - MarketNotCleared (706) on `Status::Retired` while any position remains open.
     */
    setStatus(status: u32): string {
        return this.call(
            'set_status',
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Set or refresh the flat settlement price of a delisted market.
     *
     * Settable only once the delist grace window has expired. Owner only.
     *
     * # Errors
     * - InvalidStatus (702) unless the status is `Status::Delisted` and the
     *   grace window has expired.
     * - InvalidPrice (701) if `price` <= 0.
     */
    setTerminalPrice(price: i128): string {
        return this.call(
            'set_terminal_price',
            nativeToScVal(price, { type: 'i128' }),
        ).toXDR('base64');
    }

    // ============================================================
    // Trader (auth = user, price-free)
    // ============================================================

    /**
     * Create an `Order` for the keeper to fill.
     *
     * The escrow moves by direct `token.transfer` inside this user-authorized
     * call: an increase kind escrows `collateral + execFee`, a decrease kind
     * escrows the `execFee` alone. The `execFee` (read from config) pays the
     * keeper on execution and refunds on cancel or on the position closing.
     * A decrease's `notional` above the position size clamps to a full close
     * at fill (`FULL_CLOSE` signals a full close).
     *
     * # Returns
     * - The allocated order id.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - UnknownKind (734) if `kind` is not a known discriminant.
     * - NegativeValueNotAllowed (710) if a magnitude, `triggerPrice`, or
     *   `priceBound` is negative.
     * - InvalidOrder (732) if the shape is a no-op, a moved value is below a
     *   dust floor, or a limit/stop kind carries a non-positive `triggerPrice`.
     * - TooManyOrders (733) if the side already holds the maximum pending
     *   decrease orders.
     * - NotionalAboveMaximum (712) if an increase's `notional` exceeds `maxPositionNotional`.
     * - OrderExpired (731) if `expiration` is already behind the current ledger.
     */
    createOrder(
        user: string,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        collateral: i128,
        triggerPrice: i128,
        priceBound: i128,
        expiration: u32,
    ): string {
        const call = this.createOrderCall(
            user, isLong, kind, notional, collateral, triggerPrice, priceBound, expiration,
        );
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `create_order` invocation as a `Call` (contract, func, args),
     * for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `createOrder`, so a bundled order is
     * byte-identical to a direct one; the only difference is the router
     * executes it (and the user's auth entry nests under the router call).
     */
    createOrderCall(
        user: string,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        collateral: i128,
        triggerPrice: i128,
        priceBound: i128,
        expiration: u32,
    ): Call {
        return {
            contract: this.contractId(),
            func: 'create_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvBool(isLong),
                xdr.ScVal.scvU32(kind),
                nativeToScVal(notional, { type: 'i128' }),
                nativeToScVal(collateral, { type: 'i128' }),
                nativeToScVal(triggerPrice, { type: 'i128' }),
                nativeToScVal(priceBound, { type: 'i128' }),
                xdr.ScVal.scvU32(expiration),
            ],
        };
    }

    /**
     * Cancel a pending `Order` the caller owns and refund its escrow.
     *
     * # Returns
     * - The refunded escrow: an increase's collateral plus its `execFee`, a
     *   decrease's `execFee` (token-dec).
     *
     * # Errors
     * - OrderNotFound (730) if no order `(user, id)` exists.
     */
    cancelOrder(user: string, id: u32): string {
        const call = this.cancelOrderCall(user, id);
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `cancel_order` invocation as a `Call` (contract, func, args),
     * for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `cancelOrder`, so a bundled cancel is
     * byte-identical to a direct one; the only difference is the router
     * executes it (and the user's auth entry nests under the router call).
     */
    cancelOrderCall(user: string, id: u32): Call {
        return {
            contract: this.contractId(),
            func: 'cancel_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvU32(id),
            ],
        };
    }

    /**
     * Create a `VaultOrder` for the keeper to fill; the deposit assets or
     * redeem shares (plus the `execFee` in the settlement token) are escrowed
     * in the trading contract at creation.
     *
     * On a `Status::Retired` market a redeem skips the order and executes
     * immediately: the vault burns the shares and pays the assets straight
     * out; `minOut` is not applied on this path.
     *
     * # Returns
     * - The allocated vault order id, or `0` for a Retired-market instant redeem.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - InvalidStatus (702) if a deposit is created on a `Retired` market.
     * - UnknownKind (734) if `kind` is not a known discriminant.
     * - NegativeValueNotAllowed (710) if `minOut` is negative.
     * - InvalidOrder (732) if the deposited assets fall under `minDeposit`,
     *   or a redeem's share `amount` is not positive.
     */
    createVaultOrder(user: string, kind: VaultOrderKind, amount: i128, minOut: i128): string {
        const call = this.createVaultOrderCall(user, kind, amount, minOut);
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `create_vault_order` invocation as a `Call` (contract, func,
     * args), for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `createVaultOrder`, so a bundled
     * deposit or redeem is byte-identical to a direct one.
     */
    createVaultOrderCall(user: string, kind: VaultOrderKind, amount: i128, minOut: i128): Call {
        return {
            contract: this.contractId(),
            func: 'create_vault_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvU32(kind),
                nativeToScVal(amount, { type: 'i128' }),
                nativeToScVal(minOut, { type: 'i128' }),
            ],
        };
    }

    /**
     * Cancel a pending `VaultOrder` the caller owns and pay back the escrowed
     * assets or shares.
     *
     * # Returns
     * - The escrowed principal paid back: assets for a deposit (token-dec) or
     *   shares for a redeem (share decimals).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - VaultOrderNotFound (750) if no vault order `(user, id)` exists.
     */
    cancelVaultOrder(user: string, id: u32): string {
        const call = this.cancelVaultOrderCall(user, id);
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `cancel_vault_order` invocation as a `Call` (contract, func,
     * args), for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `cancelVaultOrder`, so a bundled
     * cancel is byte-identical to a direct one.
     */
    cancelVaultOrderCall(user: string, id: u32): Call {
        return {
            contract: this.contractId(),
            func: 'cancel_vault_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvU32(id),
            ],
        };
    }

    /**
     * Pay out `user`'s accrued claimable funding balance from the pool.
     *
     * # Returns
     * - The amount paid out (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - NothingToClaim (760) if `user` has no claimable balance.
     */
    claimFunding(user: string): string {
        return this.call(
            'claim_funding',
            Address.fromString(user).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Keeper (permissionless, price-bearing)
    // ============================================================

    /**
     * Fill a pending `Order` at a verified price and settle it.
     *
     * # Returns
     * - The keeper's payout (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - OrderNotFound (730) if no order `(user, id)` exists.
     * - IncreaseHalted (705) if a size-growing increase runs while the status
     *   does not accept opens or the target side has ADL enabled.
     * - OrderExpired (731) if the order expired before the fill.
     * - StalePrice (740) if the verified price predates the order.
     * - TriggerNotMet (742) if the order's trigger has not been crossed.
     * - PriceBoundExceeded (741) if the fill price is worse than `priceBound`.
     * - PositionNotFound (720) if a decrease targets an absent position.
     * - NotionalBelowMinimum (711) if the resulting position falls under the size floor.
     * - NotionalAboveMaximum (712) if the resulting position exceeds the size ceiling.
     * - OpenInterestExceeded (715) if the side's open interest would exceed `maxOpenInterest`.
     * - UtilizationExceeded (714) if the reserved value would exceed the utilization cap.
     * - InsufficientMargin (713) if collateral falls below the initial-margin
     *   requirement or equity below the maintenance requirement.
     * - NotionalLocked (721) if the close exceeds the position's unlocked notional.
     */
    executeOrder(keeper: string, user: string, id: u32, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_order',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Force-close the `Position` `(user, isLong)` at a verified price and
     * settle it.
     *
     * Eligible when equity has fallen below the maintenance margin, or
     * regardless of margin health once a `Delisted` market's 7-day delist
     * deadline has passed.
     *
     * # Returns
     * - The keeper's payout (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - StalePrice (740) if the verified price is older than the price the
     *   position was last marked against.
     * - NotLiquidatable (722) if equity still covers the maintenance margin
     *   and the wind-down waiver does not apply.
     */
    executeLiquidation(keeper: string, user: string, isLong: boolean, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_liquidation',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Recompute both sides' pending PnL at a keeper-verified price and set or
     * clear the `AdlState` flags.
     *
     * A flagged side blocks its increases and is eligible for `executeAdl`.
     *
     * # Returns
     * - The resulting `AdlState`.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - StalePrice (740) if the verified price is older than the newest price
     *   the market has consumed.
     */
    updateAdlState(price: Buffer | Uint8Array): string {
        return this.call(
            'update_adl_state',
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Deleverage the winning `Position` `(user, isLong)` at a keeper-verified
     * price, reducing its side's pending PnL toward `adlClearTarget` of half
     * the vault balance.
     *
     * Fires only on a side flagged by `updateAdlState`.
     *
     * # Returns
     * - The keeper's payout: the `keeperRate` cut of the trade fee (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - AdlNotTriggered (770) if the side is not flagged for deleveraging, or
     *   its pending PnL is already at or below `adlClearTarget`.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - StalePrice (740) if the verified price is older than the newest price
     *   the market has consumed, or than the price the position was last
     *   marked against.
     * - AdlNotEligible (772) if the close does not reduce the side's pending PnL.
     * - AdlOvershoot (771) if the close lands the side under the clear
     *   allowance re-measured on the settled vault balance.
     * - InvalidOrder (732) if `amount` is not positive.
     * - NotionalLocked (721) or NotionalBelowMinimum (711) from the
     *   underlying decrease.
     */
    executeAdl(keeper: string, user: string, isLong: boolean, amount: i128, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_adl',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
            nativeToScVal(amount, { type: 'i128' }),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Fill the `VaultOrder` `(user, id)` at a keeper-verified price.
     *
     * The whole order fills at once and is removed. The fill deducts the
     * vault fill fee (the `depositFee` or `redeemFee` cut of the moved assets
     * by kind), split between the keeper, the treasury, and the vault.
     *
     * # Returns
     * - The keeper's payout: the `keeperRate` cut of the vault fill fee (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - VaultOrderNotFound (750) if no vault order `(user, id)` exists.
     * - StalePrice (740) if the verified price does not strictly postdate the
     *   order's `createdAt`.
     * - VaultOrderLocked (751) if a redeem's `redeemLock` cooldown from
     *   `createdAt` has not elapsed.
     * - MinOutNotMet (752) if the fill returns less than the order's `minOut`.
     * - VaultBalanceExceeded (753) if a deposit would push the vault above `maxVaultBalance`.
     * - UtilizationExceeded (714) if a redeem would leave the vault under-reserved.
     * - PendingPnlExceeded (754) if a redeem would leave a side's pending PnL
     *   above `maxPnlWithdraw` of half the remaining balance.
     */
    executeVaultOrder(keeper: string, user: string, id: u32, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_vault_order',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    // ============================================================
    // Maintenance (permissionless)
    // ============================================================

    /**
     * Advance the market's funding accrual to the current timestamp.
     *
     * # Returns
     * - The accrued market data.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     */
    accrueFunding(): string {
        return this.call('accrue_funding').toXDR('base64');
    }

    /**
     * Advance both of the market's accrual indices (borrowing and funding)
     * to the current timestamp at a keeper-verified price.
     *
     * # Returns
     * - The accrued market data.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     */
    accrue(price: Buffer | Uint8Array): string {
        return this.call(
            'accrue',
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    // ============================================================
    // Views
    // ============================================================

    /** Read the trading configuration. */
    getConfig(): string {
        return this.call('get_config').toXDR('base64');
    }

    /** Read the market state, as of its last accrual. */
    getMarketData(): string {
        return this.call('get_market_data').toXDR('base64');
    }

    /**
     * Look up the netted position for `(user, isLong)`.
     *
     * # Returns
     * - The stored `Position`, or a zeroed one if none is open on that side.
     */
    getPosition(user: string, isLong: boolean): string {
        return this.call(
            'get_position',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
        ).toXDR('base64');
    }

    /**
     * Look up the pending keeper order `(user, id)`.
     *
     * # Returns
     * - The stored `Order`, or `undefined` if none exists.
     */
    getOrder(user: string, id: u32): string {
        return this.call(
            'get_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
    }

    /** Read the contract operational status, as its `Status` `u32` discriminant. */
    getStatus(): string {
        return this.call('get_status').toXDR('base64');
    }

    /**
     * Look up the pending vault order `(user, id)`.
     *
     * # Returns
     * - The stored `VaultOrder`, or `undefined` if none exists.
     */
    getVaultOrder(user: string, id: u32): string {
        return this.call(
            'get_vault_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
    }

    /**
     * Read `user`'s order counter.
     *
     * # Returns
     * - The next order id; ids `1..counter` have been allocated, shared by
     *   trade and vault orders (`1` = none yet).
     */
    getOrderCounter(user: string): string {
        return this.call(
            'get_order_counter',
            Address.fromString(user).toScVal(),
        ).toXDR('base64');
    }

    /** Read the ADL state, zeroed until the first recompute. */
    getAdl(): string {
        return this.call('get_adl').toXDR('base64');
    }

    /**
     * Read `user`'s claimable funding balance.
     *
     * # Returns
     * - The funding owed to `user`, `0` if none (token-dec).
     */
    getClaimableFunding(user: string): string {
        return this.call(
            'get_claimable_funding',
            Address.fromString(user).toScVal(),
        ).toXDR('base64');
    }

    /** Read the settlement token address. */
    getToken(): string {
        return this.call('get_token').toXDR('base64');
    }

    /** Read the strategy-vault address backing this market. */
    getVault(): string {
        return this.call('get_vault').toXDR('base64');
    }

    /** Read the treasury address (the protocol fee sink). */
    getTreasury(): string {
        return this.call('get_treasury').toXDR('base64');
    }

    /** Read the price-verifier contract address. */
    getPriceVerifier(): string {
        return this.call('get_price_verifier').toXDR('base64');
    }

    /**
     * Read the wind-down anchors.
     *
     * # Returns
     * - `undefined` while the market has never been delisted; otherwise
     *   `[terminalPrice, delistedAt]`, with `terminalPrice` `0` until a flat
     *   settlement price is set (price_scalar units, seconds).
     */
    getRetirement(): string {
        return this.call('get_retirement').toXDR('base64');
    }

    /**
     * Read the oracle feed anchors.
     *
     * # Returns
     * - The constructor-set `[feedId, exponent]` pair; `price_scalar = 10^-exponent`.
     */
    getFeed(): string {
        return this.call('get_feed').toXDR('base64');
    }

    // ============================================================
    // Ownable
    // ============================================================

    /**
     * Returns the current owner, or `undefined` if ownership has been
     * renounced.
     */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Initiates a 2-step ownership transfer to a new address.
     *
     * Requires authorization from the current owner. The new owner must
     * later call `acceptOwnership()` to complete the transfer.
     *
     * `liveUntilLedger`: ledger number until which the new owner can accept.
     * `0` cancels any pending transfer.
     */
    transferOwnership(newOwner: string, liveUntilLedger: u32): string {
        return this.call(
            'transfer_ownership',
            Address.fromString(newOwner).toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /** Accepts a pending ownership transfer. */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Renounces ownership of the contract.
     *
     * Permanently removes the owner, disabling all owner-only functions.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    // ============================================================
    // Semantic helpers
    // ============================================================

    /** Open a position at market (`MarketIncrease`; `triggerPrice` unused). */
    openMarket(args: OpenMarketArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.MarketIncrease, args.notional, args.collateral,
            0n, args.priceBound, args.expiration,
        );
    }

    /**
     * Open a position once the trigger price is crossed favorably
     * (`LimitIncrease`): a long buys at-or-below the trigger, a short sells
     * at-or-above it.
     */
    openLimit(args: OpenLimitArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.LimitIncrease, args.notional, args.collateral,
            args.triggerPrice, args.priceBound, args.expiration,
        );
    }

    /** Fully close a position at market (`MarketDecrease`, `FULL_CLOSE` notional, no collateral withdrawal). */
    closePosition(args: ClosePositionArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.MarketDecrease, FULL_CLOSE, 0n,
            0n, args.priceBound, args.expiration,
        );
    }

    /** Partially decrease a position at market, optionally withdrawing collateral. */
    decreasePosition(args: DecreasePositionArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.MarketDecrease, args.notional, args.collateral,
            0n, args.priceBound, args.expiration,
        );
    }

    /** Add collateral to a position without changing its size. */
    addCollateral(args: ModifyCollateralArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.MarketIncrease, 0n, args.amount,
            0n, 0n, args.expiration,
        );
    }

    /** Withdraw collateral from a position without changing its size. */
    withdrawCollateral(args: ModifyCollateralArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.MarketDecrease, 0n, args.amount,
            0n, 0n, args.expiration,
        );
    }

    /**
     * Place a take-profit trigger (`LimitDecrease`): a decrease that fires
     * when the price crosses the trigger favorably (upside for a long,
     * downside for a short). Defaults to a full close.
     */
    placeTakeProfit(args: TriggerOrderArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.LimitDecrease, args.notional ?? FULL_CLOSE, 0n,
            args.triggerPrice, args.priceBound, args.expiration,
        );
    }

    /**
     * Place a stop-loss trigger (`StopDecrease`): a decrease that fires when
     * the price crosses the trigger adversely (downside for a long, upside
     * for a short). Defaults to a full close.
     */
    placeStopLoss(args: TriggerOrderArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.StopDecrease, args.notional ?? FULL_CLOSE, 0n,
            args.triggerPrice, args.priceBound, args.expiration,
        );
    }

    /** Deposit assets into the vault for the keeper to fill. */
    depositVault(args: VaultDepositArgs): string {
        return this.createVaultOrder(args.user, VaultOrderKind.Deposit, args.amount, args.minOut);
    }

    /** Redeem vault shares for assets, for the keeper to fill. */
    redeemVault(args: VaultRedeemArgs): string {
        return this.createVaultOrder(args.user, VaultOrderKind.Redeem, args.shares, args.minOut);
    }
}
