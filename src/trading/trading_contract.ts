import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32, i32, u64 } from '../index.js';
import {
    OrderKind, VaultOrderKind, TradingConfig,
    Order, VaultOrder, Position, MarketData, AdlState,
    orderKindToScVal, vaultOrderKindToScVal, tradingConfigToScVal,
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
    maxAdversePnl: i128;
}

/** Redeem vault shares for assets. */
export interface VaultRedeemArgs {
    user: string;
    shares: i128;
    maxAdversePnl: i128;
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
        "AAAABQAAANJBIGtlZXBlciBmaWxsIG9mIGFuIGluY3JlYXNlIG9yZGVyICh0aGUgdXNlcidzIGl0ZW1pemVkIHJlY2VpcHQpLgoKVGhlIGZpbGwgcHJpY2UgaXMgaW1wbGllZCwgYG5vdGlvbmFsICogU0NBTEFSXzE4IC8gdG9rZW5zYCAocHJpY2Vfc2NhbGFyCnVuaXRzKS4gVGhlIHJlc3VsdGluZyBwb3NpdGlvbiBzdGF0ZSBpcyBjYXJyaWVkIGJ5IFtgUG9zaXRpb25VcGRhdGVgXS4AAAAAAAAAAAAMSW5jcmVhc2VGaWxsAAAAAQAAAA1pbmNyZWFzZV9maWxsAAAAAAAACgAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAJpZAAAAAAABAAAAAEAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAEAAAAAAAAACG5vdGlvbmFsAAAACwAAAAAAAAAAAAAABnRva2VucwAAAAAACwAAAAAAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAAAAAAAAhiYXNlX2ZlZQAAAAsAAAAAAAAAAAAAAAppbXBhY3RfZmVlAAAAAAALAAAAAAAAAAAAAAAHZnVuZGluZwAAAAALAAAAAAAAAAAAAAAJYm9ycm93aW5nAAAAAAAACwAAAAAAAAAC",
        "AAAABQAAACxPcGVyYXRpb25hbCBzdGF0dXMgY2hhbmdlZCB2aWEgYHNldF9zdGF0dXNgLgAAAAAAAAAMU3RhdHVzVXBkYXRlAAAAAQAAAA1zdGF0dXNfdXBkYXRlAAAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAKhUaGUgcmVzdWx0aW5nIG5ldHRlZCBwb3NpdGlvbiBhZnRlciBhbnkgY2hhbmdlIChmaWxsIG9yIGxpcXVpZGF0aW9uKS4KVGhlIGNhdXNlIGFuZCBpdHMgZmVlcyBsaXZlIG9uIHRoZSBlbWl0dGluZyBbYEluY3JlYXNlRmlsbGBdIC8KW2BEZWNyZWFzZUZpbGxgXSAvIFtgTGlxdWlkYXRpb25gXS4AAAAAAAAADlBvc2l0aW9uVXBkYXRlAAAAAAABAAAAD3Bvc2l0aW9uX3VwZGF0ZQAAAAADAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAEAAAAAAAAACHBvc2l0aW9uAAAH0AAAAAhQb3NpdGlvbgAAAAAAAAAC",
        "AAAABQAAADVQZW5kaW5nIHZhdWx0IG9yZGVyIHJlbW92ZWQgdmlhIGBjYW5jZWxfdmF1bHRfb3JkZXJgLgAAAAAAAAAAAAAQQ2FuY2VsVmF1bHRPcmRlcgAAAAEAAAASY2FuY2VsX3ZhdWx0X29yZGVyAAAAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAAAAAAAmlkAAAAAAAEAAAAAQAAAAI=",
        "AAAABQAAAD9WYXVsdCBkZXBvc2l0IG9yIHJlZGVlbSBvcmRlciBjcmVhdGVkIHZpYSBgY3JlYXRlX3ZhdWx0X29yZGVyYC4AAAAAAAAAABBDcmVhdGVWYXVsdE9yZGVyAAAAAQAAABJjcmVhdGVfdmF1bHRfb3JkZXIAAAAAAAMAAAAAAAAABHVzZXIAAAATAAAAAQAAAAAAAAACaWQAAAAAAAQAAAABAAAAAAAAAAVvcmRlcgAAAAAAB9AAAAAKVmF1bHRPcmRlcgAAAAAAAAAAAAI=",
        "AAAABQAAAE9WYXVsdCBvcmRlciBmaWxsZWQgYnkgdGhlIGtlZXBlciB2aWEgYGV4ZWN1dGVfdmF1bHRfb3JkZXJgIChwYW5pY3Mgb24gZmFpbHVyZSkuAAAAAAAAAAARRXhlY3V0ZVZhdWx0T3JkZXIAAAAAAAABAAAAE2V4ZWN1dGVfdmF1bHRfb3JkZXIAAAAABAAAAAAAAAAEdXNlcgAAABMAAAABAAAAAAAAAAJpZAAAAAAABAAAAAEAAAAAAAAABmZpbGxlZAAAAAAACwAAAAAAAAAAAAAACXJlbWFpbmluZwAAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAEBGbGF0IHNldHRsZW1lbnQgcHJpY2Ugc2V0IG9yIHJlZnJlc2hlZCB2aWEgYHNldF90ZXJtaW5hbF9wcmljZWAuAAAAAAAAABNUZXJtaW5hbFByaWNlVXBkYXRlAAAAAAEAAAAVdGVybWluYWxfcHJpY2VfdXBkYXRlAAAAAAAAAQAAAAAAAAAFcHJpY2UAAAAAAAALAAAAAAAAAAI=",
        "AAAAAQAAAGZBIGxvbmcvc2hvcnQgcGFpciBvZiBgaTEyOGAgdmFsdWVzLCB1c2VkIGZvciBwZXItc2lkZSBvcGVuIGludGVyZXN0LCBwb3N0ZWQKY29sbGF0ZXJhbCwgYW5kIGJhc2Ugc2l6ZS4AAAAAAAAAAAAIU2lkZVBhaXIAAAACAAAAAAAAAARsb25nAAAACwAAAAAAAAAFc2hvcnQAAAAAAAAL",
        "AAAAAQAAAGFNYXJrZXQgc3RhdGUsIHN0b3JlZCBpbiBpdHMgb3duIHBlcnNpc3RlbnQgZW50cnkuCgpQb29sIHN1cnBsdXMgaXMgYGZ1bmRpbmdfcG9vbCAtIGZ1bmRpbmdfb3dlZGAuAAAAAAAAAAAAAApNYXJrZXREYXRhAAAAAAAKAAAAAAAAAA1ib3Jyb3dpbmdfaWR4AAAAAAAH0AAAAAhTaWRlUGFpcgAAAAAAAAAQYm9ycm93aW5nX3VwZGF0ZQAAAAYAAAAAAAAACmNvbGxhdGVyYWwAAAAAB9AAAAAIU2lkZVBhaXIAAAAAAAAAC2Z1bmRpbmdfaWR4AAAAB9AAAAAIU2lkZVBhaXIAAAAAAAAADGZ1bmRpbmdfb3dlZAAAAAsAAAAAAAAADGZ1bmRpbmdfcG9vbAAAAAsAAAAAAAAADGZ1bmRpbmdfcmF0ZQAAAAsAAAAAAAAADmZ1bmRpbmdfdXBkYXRlAAAAAAAGAAAAAAAAAAhub3Rpb25hbAAAB9AAAAAIU2lkZVBhaXIAAAAAAAAABnRva2VucwAAAAAH0AAAAAhTaWRlUGFpcg==",
        "AAAAAQAAAEtBIHBlbmRpbmcgdmF1bHQgZGVwb3NpdCBvciByZWRlZW0gKHBlcnNpc3RlbnQgc3RvcmFnZSwga2V5ZWQgYCh1c2VyLCBpZClgKS4AAAAAAAAAAApWYXVsdE9yZGVyAAAAAAAFAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAABGtpbmQAAAfQAAAADlZhdWx0T3JkZXJLaW5kAAAAAAAAAAAAD21heF9hZHZlcnNlX3BubAAAAAALAAAAAAAAAAp1bmxvY2tzX2F0AAAAAAAG",
        "AAAAAgAAAC1WYXVsdCBsaXF1aWRpdHkgYWN0aW9uIHJlcXVlc3RlZCBieSB0aGUgdXNlci4AAAAAAAAAAAAADlZhdWx0T3JkZXJLaW5kAAAAAAACAAAAAAAAADhFc2Nyb3cgYGFtb3VudGAgYXNzZXRzIGF0IGNyZWF0aW9uOyBtaW50IHNoYXJlcyBhdCBmaWxsLgAAAAdEZXBvc2l0AAAAAAAAAABARXNjcm93IGBhbW91bnRgIHNoYXJlcyBhdCBjcmVhdGlvbjsgYnVybiBhbmQgcGF5IGFzc2V0cyBhdCBmaWxsLgAAAAZSZWRlZW0AAA==",
        "AAAAAQAAAFhBREwgc3RhdGUgKGluc3RhbmNlIHN0b3JhZ2Ugc2luZ2xldG9uKTogdGhlIHBlci1zaWRlIGVuYWJsZSBmbGFncyBkcml2aW5nCnRoZSBvcGVuLXN0b3AuAAAAAAAAAAhBZGxTdGF0ZQAAAAIAAAAAAAAABGxvbmcAAAABAAAAAAAAAAVzaG9ydAAAAAAAAAE=",
        "AAAAAQAAAR5BIGtlZXBlci1leGVjdXRlZCBvcmRlciAodGVtcG9yYXJ5IHN0b3JhZ2UsIGtleWVkIGAodXNlciwgaWQpYCkuCgpga2luZGAgc2V0cyBkaXJlY3Rpb247IGBub3Rpb25hbGAvYGNvbGxhdGVyYWxgIGFyZSBub24tbmVnYXRpdmUKbWFnbml0dWRlcy4gVFAvU0wgYXJlIGBEZWNyZWFzZWAgb3JkZXJzIGNhcnJ5aW5nIGEgYHRyaWdnZXJfcHJpY2VgLCB3aXRoCmB0cmlnZ2VyX2Fib3ZlYCBzZWxlY3RpbmcgdGhlIGNyb3NzIGRpcmVjdGlvbi4gQ29sbGF0ZXJhbCBpcyBzb3VyY2VkIHZpYSBhbGxvd2FuY2UuAAAAAAAAAAAABU9yZGVyAAAAAAAACQAAAAAAAAAKY29sbGF0ZXJhbAAAAAAACwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAAAAAAAKZXhwaXJhdGlvbgAAAAAABAAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAARraW5kAAAH0AAAAAlPcmRlcktpbmQAAAAAAAAAAAAACG5vdGlvbmFsAAAACwAAAAAAAAALcHJpY2VfYm91bmQAAAAACwAAAAAAAAANdHJpZ2dlcl9hYm92ZQAAAAAAAAEAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAAL",
        "AAAAAgAAAHRXaGV0aGVyIGFuIG9yZGVyIGdyb3dzIG9yIHNocmlua3MgdGhlIHBvc2l0aW9uOyBzZXRzIHRoZSBkaXJlY3Rpb24gb2YgYW4Kb3JkZXIncyBgbm90aW9uYWxgL2Bjb2xsYXRlcmFsYCBtYWduaXR1ZGVzLgAAAAAAAAAJT3JkZXJLaW5kAAAAAAAAAgAAAAAAAAAaU2l6ZSB1cDsgY29sbGF0ZXJhbCBhZGRlZC4AAAAAAAhJbmNyZWFzZQAAAAAAAAAmU2l6ZSBkb3duIGFuZC9vciBjb2xsYXRlcmFsIHdpdGhkcmF3bi4AAAAAAAhEZWNyZWFzZQ==",
        "AAAAAQAAAVJHbG9iYWwgdHJhZGluZyBwYXJhbWV0ZXJzIChpbnN0YW5jZSBzdG9yYWdlIHNpbmdsZXRvbiksIG11dGFibGUgdmlhIHRoZQpvd25lci1vbmx5IGBzZXRfY29uZmlnYC4KClJhdGVzIGFyZSBwZXItc2Vjb25kIChHTVggcGFyaXR5KS4gVXRpbGl6YXRpb24gKG9wZW4gaW50ZXJlc3QgLyB2YXVsdCkgaGFzIHR3bwpjYXBzOiBhIGxvd2VyIGBtYXhfdXRpbF9vcGVuYCBmb3Igb3BlbnMgdGhhdCBhbHNvIHNldHMgdGhlIGJvcnJvdyByZXNlcnZlLCBhbmQgYQpoaWdoZXIgYG1heF91dGlsX3dpdGhkcmF3YCBmb3Igd2l0aGRyYXdhbHMgdGhhdCByZXRhaW5zIG1pbmltdW0gdmF1bHQgbGlxdWlkaXR5LgAAAAAAAAAAAAZDb25maWcAAAAAACMAAAAAAAAAEGFkbF9jbGVhcl90YXJnZXQAAAALAAAAAAAAAAthZGxfbWF4X3BubAAAAAALAAAAAAAAAAtib3Jyb3dfcmF0ZQAAAAALAAAAAAAAAAxkZXBvc2l0X2xvY2sAAAAGAAAAAAAAAAdmZWVfZG9tAAAAAAsAAAAAAAAAC2ZlZV9ub25fZG9tAAAAAAsAAAAAAAAAEGZ1bmRpbmdfZGVjcmVhc2UAAAALAAAAAAAAABBmdW5kaW5nX2luY3JlYXNlAAAACwAAAAAAAAALZnVuZGluZ19tYXgAAAAACwAAAAAAAAALZnVuZGluZ19taW4AAAAACwAAAAAAAAAOaW1wYWN0X2Rpdmlzb3IAAAAAAAsAAAAAAAAAFWluY3JlYXNlZF9ib3Jyb3dfcmF0ZQAAAAAAAAsAAAAAAAAAC2luaXRfbWFyZ2luAAAAAAsAAAAAAAAAE2luc3RhbnRfZGVwb3NpdF9wbmwAAAAACwAAAAAAAAALa2VlcGVyX3JhdGUAAAAACwAAAAAAAAAHbGlxX2ZlZQAAAAALAAAAAAAAABJtYWludGVuYW5jZV9tYXJnaW4AAAAAAAsAAAAAAAAAEW1heF9vcGVuX2ludGVyZXN0AAAAAAAACwAAAAAAAAAPbWF4X3BubF9kZXBvc2l0AAAAAAsAAAAAAAAADm1heF9wbmxfdHJhZGVyAAAAAAALAAAAAAAAABBtYXhfcG5sX3dpdGhkcmF3AAAACwAAAAAAAAAVbWF4X3Bvc2l0aW9uX25vdGlvbmFsAAAAAAAACwAAAAAAAAANbWF4X3V0aWxfb3BlbgAAAAAAAAsAAAAAAAAAEW1heF91dGlsX3dpdGhkcmF3AAAAAAAACwAAAAAAAAARbWF4X3ZhdWx0X2JhbGFuY2UAAAAAAAALAAAAAAAAAAttaW5fZGVwb3NpdAAAAAALAAAAAAAAABRtaW5fb3JkZXJfY29sbGF0ZXJhbAAAAAsAAAAAAAAAEm1pbl9vcmRlcl9ub3Rpb25hbAAAAAAACwAAAAAAAAAVbWluX3Bvc2l0aW9uX25vdGlvbmFsAAAAAAAACwAAAAAAAAANbm90aW9uYWxfbG9jawAAAAAAAAYAAAAAAAAAC3JlZGVlbV9sb2NrAAAAAAYAAAAAAAAAC3RhcmdldF91dGlsAAAAAAsAAAAAAAAAGnRocmVzaG9sZF9kZWNyZWFzZV9mdW5kaW5nAAAAAAALAAAAAAAAABh0aHJlc2hvbGRfc3RhYmxlX2Z1bmRpbmcAAAALAAAAAAAAAAl2YXVsdF9mZWUAAAAAAAAL",
        "AAAAAQAAAVNBIG5ldHRlZCB0cmFkZXIgcG9zaXRpb24sIG9uZSBwZXIgYCh1c2VyLCBpc19sb25nKWAgKHRoZSBzdG9yYWdlIGtleSkuCgpQbkwgaXMgaW1wbGllZDogYHRva2VucyAqIHByaWNlIC0gbm90aW9uYWxgIChsb25nKSwgaW52ZXJzZSBmb3Igc2hvcnQuCmBmdW5kaW5nX2lkeGAvYGJvcnJvd2luZ19pZHhgIHNuYXBzaG90IHRoZSBtYXJrZXQgaW5kaWNlcyBhdCB0aGUgbGFzdCBjaGFuZ2UuClplcm8gYG5vdGlvbmFsYCBtZWFucyBubyBvcGVuIHBvc2l0aW9uOyB0aGUgemVyb2VkIHJvdyBpcyB0aGUgY2Fub25pY2FsCmNsb3NlZCBzdGF0ZSwgd2hldGhlciB0aGUgZW50cnkgZXhpc3RzIG9yIG5vdC4AAAAAAAAAAAhQb3NpdGlvbgAAAAgAAAAAAAAADWJvcnJvd2luZ19pZHgAAAAAAAALAAAAAAAAAApjb2xsYXRlcmFsAAAAAAALAAAAAAAAAAtmdW5kaW5nX2lkeAAAAAALAAAAAAAAAA9sb2NrZWRfbm90aW9uYWwAAAAACwAAAAAAAAAIbm90aW9uYWwAAAALAAAAAAAAAAZ0b2tlbnMAAAAAAAsAAAAAAAAACnVubG9ja3NfYXQAAAAAAAYAAAAAAAAACnVwZGF0ZWRfYXQAAAAAAAY=",
        "AAAAAAAAAAAAAAAGYWNjcnVlAAAAAAABAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAAAAAAAAAAAHZ2V0X2FkbAAAAAAAAAAAAQAAB9AAAAAIQWRsU3RhdGU=",
        "AAAAAAAAAAAAAAAIZ2V0X2ZlZWQAAAAAAAAAAQAAA+0AAAACAAAABAAAAAU=",
        "AAAAAAAAAAAAAAAJZ2V0X29yZGVyAAAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAQAAB9AAAAAFT3JkZXIAAAA=",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAJZ2V0X3Rva2VuAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJZ2V0X3ZhdWx0AAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAABkNvbmZpZwAA",
        "AAAAAAAAAAAAAAAKZ2V0X3N0YXR1cwAAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAABkNvbmZpZwAAAAAAAA==",
        "AAAAAAAAAAAAAAAKc2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAALZXhlY3V0ZV9hZGwAAAAABQAAAAAAAAAGa2VlcGVyAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAAL",
        "AAAAAAAAAAAAAAAMY2FuY2VsX29yZGVyAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAMY3JlYXRlX29yZGVyAAAACQAAAAAAAAAEdXNlcgAAABMAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAAAAAAEa2luZAAAB9AAAAAJT3JkZXJLaW5kAAAAAAAAAAAAAAhub3Rpb25hbAAAAAsAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAADXRyaWdnZXJfcHJpY2UAAAAAAAALAAAAAAAAAA10cmlnZ2VyX2Fib3ZlAAAAAAAAAQAAAAAAAAALcHJpY2VfYm91bmQAAAAACwAAAAAAAAAKZXhwaXJhdGlvbgAAAAAABAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAMZ2V0X3Bvc2l0aW9uAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAAB2lzX2xvbmcAAAAAAQAAAAEAAAfQAAAACFBvc2l0aW9u",
        "AAAAAAAAAAAAAAAMZ2V0X3RyZWFzdXJ5AAAAAAAAAAEAAAAT",
        "AAAAAAAAA09Jbml0aWFsaXplIHRoZSB0cmFkaW5nIGNvbnRyYWN0LgoKW2BNYXJrZXREYXRhYF0gc3RhcnRzIHplcm9lZCB3aXRoIGl0cyBhY2NydWFsIHRpbWVzdGFtcHMgYXQgYG5vd2A7IHN0YXR1cwpzdGFydHMgW2BTdGF0dXM6OkFjdGl2ZWBdLgoKIyBBdXRob3JpemF0aW9uCi0gQ2FsbGVkIG9uY2UgYXQgZGVwbG95bWVudDsgc2V0cyBgb3duZXJgIGFzIHRoZSBjb250cmFjdCBvd25lci4KCiMgQXJndW1lbnRzCi0gYG93bmVyYDogdGhlIGNvbnRyYWN0IG93bmVyIGZvciB0aGUgYWRtaW4gZW50cmllcy4KLSBgdG9rZW5gOiB0aGUgc2V0dGxlbWVudCB0b2tlbi4KLSBgdmF1bHRgOiB0aGUgc3RyYXRlZ3ktdmF1bHQgY29udHJhY3QuCi0gYHByaWNlX3ZlcmlmaWVyYDogdGhlIHByaWNlLXZlcmlmaWVyIGNvbnRyYWN0LgotIGB0cmVhc3VyeWA6IHRoZSBwcm90b2NvbCBmZWUgc2luay4KLSBgZmVlZF9pZGA6IHRoZSBvcmFjbGUgcHJpY2UgZmVlZCBpZDsgaW1tdXRhYmxlLgotIGBleHBvbmVudGA6IHRoZSBvcmFjbGUgZXhwb25lbnQ7IGltbXV0YWJsZTsgYHByaWNlX3NjYWxhciA9IDEwXi1leHBvbmVudGAuCi0gYGNvbmZpZ2A6IHRoZSBpbml0aWFsIGdsb2JhbCB0cmFkaW5nIGNvbmZpZ3VyYXRpb24uCgojIEVycm9ycwotIFtgVHJhZGluZ0Vycm9yOjpJbnZhbGlkQ29uZmlnYF0gaWYgYGV4cG9uZW50YCBpcyBvdXRzaWRlIGBNSU5fRVhQT05FTlQuLj1NQVhfRVhQT05FTlRgLApvciBhIGNvbmZpZyBib3VuZCBvciByYW5nZSBjaGVjayBmYWlscy4KLSBbYFRyYWRpbmdFcnJvcjo6TmVnYXRpdmVWYWx1ZU5vdEFsbG93ZWRgXSBpZiBhbnkgcmF0ZSwgZmVlLCBvciBtYXJnaW4gaXMgbmVnYXRpdmUuAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAACAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABXZhdWx0AAAAAAAAEwAAAAAAAAAOcHJpY2VfdmVyaWZpZXIAAAAAABMAAAAAAAAACHRyZWFzdXJ5AAAAEwAAAAAAAAAHZmVlZF9pZAAAAAAEAAAAAAAAAAhleHBvbmVudAAAAAUAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAZDb25maWcAAAAAAAA=",
        "AAAAAAAAAAAAAAANY2xhaW1fZnVuZGluZwAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAANZXhlY3V0ZV9vcmRlcgAAAAAAAAQAAAAAAAAABmtlZXBlcgAAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAACw==",
        "AAAAAAAAAAAAAAAOYWNjcnVlX2Z1bmRpbmcAAAAAAAAAAAABAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAAAAAAAAAAAOZ2V0X3JldGlyZW1lbnQAAAAAAAAAAAABAAAD6AAAA+0AAAACAAAACwAAAAY=",
        "AAAAAAAAAAAAAAAPZ2V0X21hcmtldF9kYXRhAAAAAAAAAAABAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAAAAAAAAAAAPZ2V0X3ZhdWx0X29yZGVyAAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAAJpZAAAAAAABAAAAAEAAAfQAAAAClZhdWx0T3JkZXIAAA==",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAQdXBkYXRlX2FkbF9zdGF0ZQAAAAEAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAfQAAAACEFkbFN0YXRl",
        "AAAAAAAAAAAAAAASY2FuY2VsX3ZhdWx0X29yZGVyAAAAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAACaWQAAAAAAAQAAAABAAAACw==",
        "AAAAAAAAAAAAAAASY3JlYXRlX3ZhdWx0X29yZGVyAAAAAAAEAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAEa2luZAAAB9AAAAAOVmF1bHRPcmRlcktpbmQAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAA9tYXhfYWR2ZXJzZV9wbmwAAAAACwAAAAEAAAAE",
        "AAAAAAAAAAAAAAASZ2V0X3ByaWNlX3ZlcmlmaWVyAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAASc2V0X3Rlcm1pbmFsX3ByaWNlAAAAAAABAAAAAAAAAAVwcmljZQAAAAAAAAsAAAAA",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAATZXhlY3V0ZV9saXF1aWRhdGlvbgAAAAAEAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAAdpc19sb25nAAAAAAEAAAAAAAAABXByaWNlAAAAAAAADgAAAAEAAAAL",
        "AAAAAAAAAAAAAAATZXhlY3V0ZV92YXVsdF9vcmRlcgAAAAAFAAAAAAAAAAZrZWVwZXIAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAAJpZAAAAAAABAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAVwcmljZQAAAAAAAA4AAAABAAAACw==",
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
        cancelOrder: () => {},
        // --- Ownable ---
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
        // --- trader / keeper (numeric) ---
        createOrder: (result: string): u32 =>
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
        getOrder: (result: string): Order =>
            parseOrder(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getVaultOrder: (result: string): VaultOrder =>
            parseVaultOrder(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getConfig: (result: string): TradingConfig =>
            parseTradingConfig(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        // --- plain scalar / address / tuple views (passthrough) ---
        getStatus: (result: string): u32 =>
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
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
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
     * An `OrderKind::Increase` draws `collateral` from the trader's token
     * allowance; an `OrderKind::Decrease` withdraws `collateral` from the
     * position's margin. `notional` above the position size on a Decrease
     * clamps to a full close at fill (`FULL_CLOSE` signals a full close).
     *
     * # Returns
     * - The allocated order id.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - NegativeValueNotAllowed (710) if a magnitude, `triggerPrice`, or
     *   `priceBound` is negative.
     * - InvalidOrder (732) if the shape is a no-op, a moved value is below a
     *   dust floor, or `expiration` lies beyond the network's max entry TTL.
     * - NotionalAboveMaximum (712) if an Increase's `notional` exceeds `maxPositionNotional`.
     * - OrderExpired (731) if `expiration` is already behind the current ledger.
     */
    createOrder(
        user: string,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        collateral: i128,
        triggerPrice: i128,
        triggerAbove: boolean,
        priceBound: i128,
        expiration: u32,
    ): string {
        return this.call(
            'create_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
            orderKindToScVal(kind),
            nativeToScVal(notional, { type: 'i128' }),
            nativeToScVal(collateral, { type: 'i128' }),
            nativeToScVal(triggerPrice, { type: 'i128' }),
            xdr.ScVal.scvBool(triggerAbove),
            nativeToScVal(priceBound, { type: 'i128' }),
            xdr.ScVal.scvU32(expiration),
        ).toXDR('base64');
    }

    /**
     * Cancel a pending `Order` the caller owns.
     *
     * # Errors
     * - OrderNotFound (730) if no order `(user, id)` exists.
     */
    cancelOrder(user: string, id: u32): string {
        return this.call(
            'cancel_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
    }

    /**
     * Create a `VaultOrder` for the keeper to fill; the deposit assets or
     * redeem shares are escrowed in the trading contract at creation.
     *
     * On a `Status::Retired` market a redeem skips the order and executes
     * immediately.
     *
     * # Returns
     * - The allocated vault order id, or `0` for a Retired-market direct redeem.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - InvalidStatus (702) if a deposit is created on a `Retired` market.
     * - NegativeValueNotAllowed (710) if any amount is negative.
     * - InvalidOrder (732) if the deposited assets net of the vault fill fee,
     *   or a redeem's previewed assets, fall under `minDeposit`.
     */
    createVaultOrder(user: string, kind: VaultOrderKind, amount: i128, maxAdversePnl: i128): string {
        return this.call(
            'create_vault_order',
            Address.fromString(user).toScVal(),
            vaultOrderKindToScVal(kind),
            nativeToScVal(amount, { type: 'i128' }),
            nativeToScVal(maxAdversePnl, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Cancel a pending `VaultOrder` the caller owns and pay back the escrowed
     * assets or shares.
     *
     * # Returns
     * - The escrowed amount paid back (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - VaultOrderNotFound (750) if no vault order `(user, id)` exists.
     */
    cancelVaultOrder(user: string, id: u32): string {
        return this.call(
            'cancel_vault_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
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
     * - IncreaseHalted (705) if a size-growing Increase runs while the status
     *   does not accept opens or the target side has ADL enabled.
     * - OrderExpired (731) if the order expired before the fill.
     * - StalePrice (740) if the verified price predates the order.
     * - TriggerNotMet (742) if the order's trigger has not been crossed.
     * - PriceBoundExceeded (741) if the fill price is worse than `priceBound`.
     * - PositionNotFound (720) if a Decrease targets an absent position.
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
     * - NegativeValueNotAllowed (710) if `amount` is not positive.
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - AdlNotTriggered (770) if the side is not flagged for deleveraging, or
     *   its pending PnL is already at or below `adlClearTarget`.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - StalePrice (740) if the verified price predates the position's last entry change.
     * - AdlNotEligible (772) if the position is not a winner.
     * - InvalidOrder (732) if the sized partial close falls under the
     *   `minOrderNotional` dust floor.
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
     * Fill up to `amount` of the `VaultOrder` `(user, id)` at a
     * keeper-verified price.
     *
     * The fill is clamped to the order's remainder; a partial fill keeps the
     * remainder pending under the same id. Every fill deducts the vault fill
     * fee, split between the keeper, the treasury, and the vault.
     *
     * # Returns
     * - The keeper's payout: the `keeperRate` cut of the vault fill fee (token-dec).
     *
     * # Errors
     * - NegativeValueNotAllowed (710) if `amount` is not positive.
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - VaultOrderNotFound (750) if no vault order `(user, id)` exists.
     * - StalePrice (740) if the verified price predates the order.
     * - VaultOrderLocked (751) if a redeem's `redeemLock` cooldown has not
     *   elapsed, or a deposit's `depositLock` has not while the share
     *   underpricing exceeds the `instantDepositPnl` waiver.
     * - PendingPnlExceeded (752) if a deposit fills while the share
     *   underpricing exceeds `maxPnlDeposit`, a redeem would leave the share
     *   overpricing above `maxPnlWithdraw`, or the adverse mispricing
     *   exceeds the order's own `maxAdversePnl` bound.
     * - VaultBalanceExceeded (753) if a deposit would push the vault above `maxVaultBalance`.
     * - UtilizationExceeded (714) if a redeem would leave the vault under-reserved.
     * - InvalidOrder (732) if the filled assets or the surviving remainder no
     *   longer clear the `minDeposit` floor.
     */
    executeVaultOrder(keeper: string, user: string, id: u32, amount: i128, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_vault_order',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
            nativeToScVal(amount, { type: 'i128' }),
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
     * # Errors
     * - OrderNotFound (730) if no such order exists.
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
     * # Errors
     * - VaultOrderNotFound (750) if no such vault order exists.
     */
    getVaultOrder(user: string, id: u32): string {
        return this.call(
            'get_vault_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
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

    /** Open a position at market (no trigger; `triggerPrice` 0, `triggerAbove` false). */
    openMarket(args: OpenMarketArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Increase, args.notional, args.collateral,
            0n, false, args.priceBound, args.expiration,
        );
    }

    /**
     * Open a position once the trigger price is crossed.
     *
     * Longs buy at-or-below the trigger; shorts sell at-or-above it, so
     * `triggerAbove = !isLong`.
     */
    openLimit(args: OpenLimitArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Increase, args.notional, args.collateral,
            args.triggerPrice, !args.isLong, args.priceBound, args.expiration,
        );
    }

    /** Fully close a position at market (`FULL_CLOSE` notional, no collateral withdrawal). */
    closePosition(args: ClosePositionArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Decrease, FULL_CLOSE, 0n,
            0n, false, args.priceBound, args.expiration,
        );
    }

    /** Partially decrease a position at market, optionally withdrawing collateral. */
    decreasePosition(args: DecreasePositionArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Decrease, args.notional, args.collateral,
            0n, false, args.priceBound, args.expiration,
        );
    }

    /** Add collateral to a position without changing its size. */
    addCollateral(args: ModifyCollateralArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Increase, 0n, args.amount,
            0n, false, 0n, args.expiration,
        );
    }

    /** Withdraw collateral from a position without changing its size. */
    withdrawCollateral(args: ModifyCollateralArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Decrease, 0n, args.amount,
            0n, false, 0n, args.expiration,
        );
    }

    /**
     * Place a take-profit trigger: a full-close Decrease that fires as the
     * position's profits grow. A long profits as price rises, so
     * `triggerAbove = isLong`.
     */
    placeTakeProfit(args: TriggerOrderArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Decrease, args.notional ?? FULL_CLOSE, 0n,
            args.triggerPrice, args.isLong, args.priceBound, args.expiration,
        );
    }

    /**
     * Place a stop-loss trigger: a full-close Decrease that fires on the
     * losing side of the position, so `triggerAbove = !isLong`.
     */
    placeStopLoss(args: TriggerOrderArgs): string {
        return this.createOrder(
            args.user, args.isLong, OrderKind.Decrease, args.notional ?? FULL_CLOSE, 0n,
            args.triggerPrice, !args.isLong, args.priceBound, args.expiration,
        );
    }

    /** Deposit assets into the vault for the keeper to fill. */
    depositVault(args: VaultDepositArgs): string {
        return this.createVaultOrder(args.user, VaultOrderKind.Deposit, args.amount, args.maxAdversePnl);
    }

    /** Redeem vault shares for assets, for the keeper to fill. */
    redeemVault(args: VaultRedeemArgs): string {
        return this.createVaultOrder(args.user, VaultOrderKind.Redeem, args.shares, args.maxAdversePnl);
    }
}
