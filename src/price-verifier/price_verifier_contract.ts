import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i32, u32, u64, i128 } from '../index.js';

// Verified price data returned by the oracle. Carries the bid/ask pair in
// the feed's native precision; the trading contract fills the adverse side.
export interface PriceVerifierPriceData {
    feed_id: u32;
    exponent: i32;
    bid: i128;
    ask: i128;
    publish_time: u64;
}

// Constructor arguments
export interface PriceVerifierConstructorArgs {
    owner: string;
    lazer: string;
    max_confidence_bps: u32;
    max_staleness: u64;
}

/**
 * PriceVerifierContract - Operation builder for the Zenex Price Verifier contract
 *
 * Verifies Pyth Lazer price updates on-chain. Used by the trading contract
 * to determine entry/exit prices and compute PnL.
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class PriceVerifierContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAAAQAAALtWZXJpZmllZCBwcmljZSBkYXRhIHJldHVybmVkIGJ5IHRoZSBvcmFjbGUuCgpUaGUgdHJhZGluZyBjb250cmFjdCB1c2VzIHRoaXMgdG8gZGV0ZXJtaW5lIGVudHJ5L2V4aXQgcHJpY2VzIGFuZCBjb21wdXRlIFBuTC4KYHByaWNlX3NjYWxhcmAgaXMgZGVyaXZlZCBhdCB0aGUgY2FsbCBzaXRlIGFzIGAxMF4oLWV4cG9uZW50KWAuAAAAAAAAAAAJUHJpY2VEYXRhAAAAAAAABQAAAGdCZXN0IGFzayBmcm9tIFB5dGggTGF6ZXIgKHNhbWUgcHJlY2lzaW9uIGFzIGBiaWRgKTsgcmVxdWlyZWQuIFRyYWRpbmcgZmlsbHMKdGhlIGFkdmVyc2Ugb3BlbiBzaWRlIGhlcmUuAAAAAANhc2sAAAAACwAAAJtCZXN0IGJpZCBmcm9tIFB5dGggTGF6ZXIgaW4gdGhlIGZlZWQncyBuYXRpdmUgcHJlY2lzaW9uIChmb3IgZXhwb25lbnQgLTgsCjEwXzAwMF8wMDBfMDAwXzAwMCA9ICQxMDBrKTsgcmVxdWlyZWQuIFRyYWRpbmcgZmlsbHMgdGhlIGFkdmVyc2UgY2xvc2Ugc2lkZSBoZXJlLgAAAAADYmlkAAAAAAsAAABMTmVnYXRpdmUgZXhwb25lbnQgZGVmaW5pbmcgcHJpY2UgcHJlY2lzaW9uIChlLmcuIC04IG1lYW5zIDggZGVjaW1hbCBwbGFjZXMpLgAAAAhleHBvbmVudAAAAAUAAABCUHl0aCBmZWVkIGlkZW50aWZpZXIgKHUzMiBtYXBwaW5nIHRvIGFuIGFzc2V0IHBhaXIsIGUuZy4gQlRDL1VTRCkuAAAAAAAHZmVlZF9pZAAAAAAEAAAARFVuaXggdGltZXN0YW1wIChzZWNvbmRzKSB3aGVuIHRoZSBwcmljZSB3YXMgcHVibGlzaGVkIGJ5IHRoZSBvcmFjbGUuAAAADHB1Ymxpc2hfdGltZQAAAAY=",
        "AAAAAAAAAChSZXR1cm5zIHRoZSBQeXRoIExhemVyIGNvbnRyYWN0IGFkZHJlc3MuAAAABWxhemVyAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAADNVcGRhdGUgdGhlIFB5dGggTGF6ZXIgY29udHJhY3QgYWRkcmVzcy4gT3duZXIgb25seS4AAAAADHVwZGF0ZV9sYXplcgAAAAEAAAAAAAAACW5ld19sYXplcgAAAAAAABMAAAAA",
        "AAAAAAAAAiZWZXJpZnkgYSBQeXRoIExhemVyIHVwZGF0ZSBhbmQgcmV0dXJuIHRoZSBwcmljZSBmb3IgYSBzcGVjaWZpYyBmZWVkLgoKYGZlZWRfaWRgIHNlbGVjdHMgdGhlIGZlZWQgZnJvbSB0aGUgKHBvc3NpYmx5IG11bHRpLWZlZWQpIHBheWxvYWQ7IGBleHBvbmVudGAKaXMgdGhlIGNhbGxlcidzIGltbXV0YWJsZSBzY2FsZSBhbmNob3IgYW5kIG11c3QgZXF1YWwgdGhlIGZlZWQncyBleHBvbmVudC4KVGhlIHJldHVybmVkIHByaWNlIGlzIGNvbmZpZGVuY2UtIGFuZCBzdGFsZW5lc3MtY2hlY2tlZC4KCiMgUGFuaWNzCi0gYEludmFsaWRQcmljZWAgaWYgY29uZmlkZW5jZSBleGNlZWRzIGJvdW5kcyBvciByZXF1aXJlZCBmaWVsZHMgYXJlIG1pc3NpbmcuCi0gYEZlZWROb3RGb3VuZGAgaWYgYGZlZWRfaWRgIGlzIGFic2VudCBmcm9tIHRoZSBwYXlsb2FkLgotIGBXcm9uZ0V4cG9uZW50YCBpZiB0aGUgZmVlZCdzIGV4cG9uZW50IGRpZmZlcnMgZnJvbSBgZXhwb25lbnRgLgotIGBQcmljZVN0YWxlYCBpZiB0aGUgcHJpY2UgaXMgb2xkZXIgdGhhbiBgbWF4X3N0YWxlbmVzc2AuAAAAAAAMdmVyaWZ5X3ByaWNlAAAAAwAAAAAAAAALdXBkYXRlX2RhdGEAAAAADgAAAAAAAAAHZmVlZF9pZAAAAAAEAAAAAAAAAAhleHBvbmVudAAAAAUAAAABAAAH0AAAAAlQcmljZURhdGEAAAA=",
        "AAAAAAAAAexJbml0aWFsaXplIHRoZSBwcmljZSB2ZXJpZmllci4KCiMgUGFyYW1ldGVycwotIGBvd25lcmAgLSBBZG1pbiBhZGRyZXNzIGZvciB1cGRhdGluZyB0aGUgbGF6ZXIgYWRkcmVzcy9zdGFsZW5lc3MvY29uZmlkZW5jZQotIGBsYXplcmAgLSBBZGRyZXNzIG9mIHRoZSBkZXBsb3llZCBQeXRoIExhemVyIHZlcmlmaWNhdGlvbiBjb250cmFjdAotIGBtYXhfY29uZmlkZW5jZV9icHNgIC0gTWF4aW11bSBhbGxvd2VkIGNvbmZpZGVuY2UgaW50ZXJ2YWwgaW4gYmFzaXMgcG9pbnRzCihlLmcuIDEwMCA9IDElKS4gUHJpY2VzIHdpdGggd2lkZXIgY29uZmlkZW5jZSBhcmUgcmVqZWN0ZWQuCi0gYG1heF9zdGFsZW5lc3NgIC0gTWF4aW11bSBhZ2Ugb2YgYSBwcmljZSB1cGRhdGUgaW4gc2Vjb25kcy4KCiMgUGFuaWNzCi0gYFByaWNlVmVyaWZpZXJFcnJvcjo6SW52YWxpZFN0YWxlbmVzc2AgaWYgYG1heF9zdGFsZW5lc3NgIGV4Y2VlZHMgYE1BWF9TVEFMRU5FU1NfU0VDT05EU2AAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAQAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAFbGF6ZXIAAAAAAAATAAAAAAAAABJtYXhfY29uZmlkZW5jZV9icHMAAAAAAAQAAAAAAAAADW1heF9zdGFsZW5lc3MAAAAAAAAGAAAAAA==",
        "AAAAAAAAADdSZXR1cm5zIHRoZSBjdXJyZW50IG1heCBzdGFsZW5lc3MgdGhyZXNob2xkIGluIHNlY29uZHMuAAAAAA1tYXhfc3RhbGVuZXNzAAAAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAOVWZXJpZnkgYSBQeXRoIExhemVyIHByaWNlIHVwZGF0ZSBhbmQgcmV0dXJuIGFsbCBwcmljZSBmZWVkcyBpbiB0aGUgcGF5bG9hZC4KCkVhY2ggZmVlZCBpcyBpbmRpdmlkdWFsbHkgc3RhbGVuZXNzLWNoZWNrZWQuIFJhdyBiYXRjaCBhY2Nlc3NvciBrZXB0IGZvcgptdWx0aS1mZWVkIHJlYWRzIChlLmcuIGEgZnV0dXJlIHZlcmlmeS1vbmNlIHByaWNlIGNhY2hlKSBhbmQgb2ZmLWNoYWluIHRvb2xpbmcuAAAAAAAADXZlcmlmeV9wcmljZXMAAAAAAAABAAAAAAAAAAt1cGRhdGVfZGF0YQAAAAAOAAAAAQAAA+oAAAfQAAAACVByaWNlRGF0YQAAAA==",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAADxSZXR1cm5zIHRoZSBjdXJyZW50IG1heCBjb25maWRlbmNlIGludGVydmFsIGluIGJhc2lzIHBvaW50cy4AAAASbWF4X2NvbmZpZGVuY2VfYnBzAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAKBVcGRhdGUgdGhlIG1heCBzdGFsZW5lc3MgdGhyZXNob2xkIGluIHNlY29uZHMuIE93bmVyIG9ubHkuCgojIFBhbmljcwotIGBQcmljZVZlcmlmaWVyRXJyb3I6OkludmFsaWRTdGFsZW5lc3NgIGlmIGBtYXhfc3RhbGVuZXNzYCBleGNlZWRzIGBNQVhfU1RBTEVORVNTX1NFQ09ORFNgAAAAFHVwZGF0ZV9tYXhfc3RhbGVuZXNzAAAAAQAAAAAAAAANbWF4X3N0YWxlbmVzcwAAAAAAAAYAAAAA",
        "AAAAAAAAADNVcGRhdGUgdGhlIG1heCBjb25maWRlbmNlIGJhc2lzIHBvaW50cy4gT3duZXIgb25seS4AAAAAGXVwZGF0ZV9tYXhfY29uZmlkZW5jZV9icHMAAAAAAAABAAAAAAAAABJtYXhfY29uZmlkZW5jZV9icHMAAAAAAAQAAAAA",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGluaXRpYXRlZC4AAAAAAAAAAAART3duZXJzaGlwVHJhbnNmZXIAAAAAAAABAAAAEm93bmVyc2hpcF90cmFuc2ZlcgAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNvbXBsZXRlZC4AAAAAAAAAAAAaT3duZXJzaGlwVHJhbnNmZXJDb21wbGV0ZWQAAAAAAAEAAAAcb3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAEAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg=="
    ]);

    static readonly parsers = {
        // Price verification
        verifyPrice: (result: string): PriceVerifierPriceData =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        verifyPrices: (result: string): PriceVerifierPriceData[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Admin (void returns)
        updateLazer: () => {},
        updateMaxConfidenceBps: () => {},
        updateMaxStaleness: () => {},
        // Getters
        lazer: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        maxConfidenceBps: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        maxStaleness: (result: string): u64 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Ownable
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
    };

    /**
     * Deploy a new instance of the PriceVerifier contract
     * Constructor: __constructor(owner, lazer, max_confidence_bps, max_staleness)
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: PriceVerifierConstructorArgs,
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
                Address.fromString(args.lazer).toScVal(),
                xdr.ScVal.scvU32(args.max_confidence_bps),
                nativeToScVal(args.max_staleness, { type: 'u64' }),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Price Verification
    // ============================================================

    /**
     * Verify a single Pyth Lazer price update and return the price for a specific feed
     * @param updateData - Raw Pyth Lazer update payload (signature + price data)
     * @param feedId - Feed to select from the (possibly multi-feed) payload
     * @param exponent - Caller's immutable scale anchor; must equal the feed's exponent
     * @returns base64 XDR operation; parse result with `parsers.verifyPrice`
     */
    verifyPrice(updateData: Buffer | Uint8Array, feedId: u32, exponent: i32): string {
        const dataBuffer = updateData instanceof Buffer
            ? updateData
            : Buffer.from(updateData);
        return this.call(
            'verify_price',
            xdr.ScVal.scvBytes(dataBuffer),
            xdr.ScVal.scvU32(feedId),
            xdr.ScVal.scvI32(exponent),
        ).toXDR('base64');
    }

    /**
     * Verify a Pyth Lazer price update and return all price feeds in the payload
     * Each feed is individually staleness-checked.
     * @param updateData - Raw Pyth Lazer update payload (signature + price data)
     * @returns base64 XDR operation; parse result with `parsers.verifyPrices`
     */
    verifyPrices(updateData: Buffer | Uint8Array): string {
        const dataBuffer = updateData instanceof Buffer
            ? updateData
            : Buffer.from(updateData);
        return this.call(
            'verify_prices',
            xdr.ScVal.scvBytes(dataBuffer),
        ).toXDR('base64');
    }

    // ============================================================
    // Owner-only Admin Methods
    // ============================================================

    /**
     * Update the Pyth Lazer contract address (owner only)
     * @param newLazer - Address of the new deployed Pyth Lazer verification contract
     */
    updateLazer(newLazer: Address | string): string {
        const addr = typeof newLazer === 'string' ? Address.fromString(newLazer) : newLazer;
        return this.call(
            'update_lazer',
            addr.toScVal(),
        ).toXDR('base64');
    }

    /**
     * Update the max confidence interval in basis points (owner only)
     * e.g. 100 = 1%. Prices with wider confidence are rejected.
     * @param maxConfidenceBps - Maximum allowed confidence interval in basis points
     */
    updateMaxConfidenceBps(maxConfidenceBps: u32): string {
        return this.call(
            'update_max_confidence_bps',
            xdr.ScVal.scvU32(maxConfidenceBps),
        ).toXDR('base64');
    }

    /**
     * Update the max staleness threshold in seconds (owner only)
     * @param maxStaleness - Maximum age of a price update in seconds
     */
    updateMaxStaleness(maxStaleness: u64): string {
        return this.call(
            'update_max_staleness',
            nativeToScVal(maxStaleness, { type: 'u64' }),
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
    // View / Getter Methods
    // ============================================================

    /**
     * Get the current max confidence interval in basis points
     */
    maxConfidenceBps(): string {
        return this.call('max_confidence_bps').toXDR('base64');
    }

    /**
     * Get the current max staleness threshold in seconds
     */
    maxStaleness(): string {
        return this.call('max_staleness').toXDR('base64');
    }

    /**
     * Get the Pyth Lazer contract address
     */
    lazer(): string {
        return this.call('lazer').toXDR('base64');
    }
}
