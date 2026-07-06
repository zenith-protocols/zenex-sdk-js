import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, u64 } from '../index.js';

// Queued call returned by get_queued
export interface QueuedCall {
    target: string;
    fn_name: string;
    args: unknown[];
    unlock_time: bigint;
}

// Constructor arguments
export interface GovernanceConstructorArgs {
    owner: string;
    delay: bigint;
}

/**
 * GovernanceContract - Operation builder for the Zenex Governance contract
 *
 * Provides a generic timelock for arbitrary contract calls.
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class GovernanceContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAAAAAAAAAAAAAFcXVldWUAAAAAAAADAAAAAAAAAAZ0YXJnZXQAAAAAABMAAAAAAAAAB2ZuX25hbWUAAAAAEQAAAAAAAAAEYXJncwAAA+oAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAGY2FuY2VsAAAAAAABAAAAAAAAAAVub25jZQAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAHZXhlY3V0ZQAAAAABAAAAAAAAAAVub25jZQAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAJZ2V0X2RlbGF5AAAAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAJc2V0X2RlbGF5AAAAAAAAAQAAAAAAAAAJbmV3X2RlbGF5AAAAAAAABgAAAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X3F1ZXVlZAAAAAAAAQAAAAAAAAAFbm9uY2UAAAAAAAAEAAAAAQAAB9AAAAAKUXVldWVkQ2FsbAAA",
        "AAAAAAAAAAAAAAAKc2V0X3N0YXR1cwAAAAAAAgAAAAAAAAAGdGFyZ2V0AAAAAAATAAAAAAAAAAZzdGF0dXMAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAALYXBwbHlfZGVsYXkAAAAAAAAAAAA=",
        "AAAAAAAAAOpJbml0aWFsaXplIHRoZSBnb3Zlcm5hbmNlIGNvbnRyYWN0IHdpdGggYW4gb3duZXIgYW5kIGRlbGF5IHBlcmlvZC4KCiMgUGFyYW1ldGVycwotIGBvd25lcmAgLSBBZG1pbiBhZGRyZXNzIGF1dGhvcml6ZWQgdG8gcXVldWUvY2FuY2VsIGNhbGxzIGFuZCBzZXQgc3RhdHVzCi0gYGRlbGF5YCAtIE1hbmRhdG9yeSB3YWl0aW5nIHBlcmlvZCBpbiBzZWNvbmRzIGJlZm9yZSBxdWV1ZWQgY2FsbHMgY2FuIGV4ZWN1dGUAAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAVkZWxheQAAAAAAAAYAAAAA",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAYVSZW5vdW5jZXMgb3duZXJzaGlwIG9mIHRoZSBjb250cmFjdC4KClBlcm1hbmVudGx5IHJlbW92ZXMgdGhlIG93bmVyLCBkaXNhYmxpbmcgYWxsIGZ1bmN0aW9ucyBnYXRlZCBieQpgI1tvbmx5X293bmVyXWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYE93bmFibGVFcnJvcjo6VHJhbnNmZXJJblByb2dyZXNzYF0gLSBJZiB0aGVyZSBpcyBhIHBlbmRpbmcgb3duZXJzaGlwCnRyYW5zZmVyLgoqIFtgT3duYWJsZUVycm9yOjpPd25lck5vdFNldGBdIC0gSWYgdGhlIG93bmVyIGlzIG5vdCBzZXQuCgojIE5vdGVzCgoqIEF1dGhvcml6YXRpb24gZm9yIHRoZSBjdXJyZW50IG93bmVyIGlzIHJlcXVpcmVkLgAAAAAAABJyZW5vdW5jZV9vd25lcnNoaXAAAAAAAAAAAAAA",
        "AAAAAAAAA45Jbml0aWF0ZXMgYSAyLXN0ZXAgb3duZXJzaGlwIHRyYW5zZmVyIHRvIGEgbmV3IGFkZHJlc3MuCgpSZXF1aXJlcyBhdXRob3JpemF0aW9uIGZyb20gdGhlIGN1cnJlbnQgb3duZXIuIFRoZSBuZXcgb3duZXIgbXVzdCBsYXRlcgpjYWxsIGBhY2NlcHRfb3duZXJzaGlwKClgIHRvIGNvbXBsZXRlIHRoZSB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgbmV3X293bmVyYCAtIFRoZSBwcm9wb3NlZCBuZXcgb3duZXIuCiogYGxpdmVfdW50aWxfbGVkZ2VyYCAtIExlZGdlciBudW1iZXIgdW50aWwgd2hpY2ggdGhlIG5ldyBvd25lciBjYW4KYWNjZXB0LiBBIHZhbHVlIG9mIGAwYCBjYW5jZWxzIGFueSBwZW5kaW5nIHRyYW5zZmVyLgoKIyBFcnJvcnMKCiogW2BPd25hYmxlRXJyb3I6Ok93bmVyTm90U2V0YF0gLSBJZiB0aGUgb3duZXIgaXMgbm90IHNldC4KKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgb3duZXIgaXMgcmVxdWlyZWQuAAAAAAASdHJhbnNmZXJfb3duZXJzaGlwAAAAAAACAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAABQAAAFtFbWl0dGVkIHdoZW4gYSBuZXcgY2FsbCBpcyBxdWV1ZWQgdmlhIGBxdWV1ZWAgb3Igd2hlbiBgc2V0X2RlbGF5YCBjcmVhdGVzIGEgcGVuZGluZyBjaGFuZ2UuAAAAAAAAAAAGUXVldWVkAAAAAAABAAAABnF1ZXVlZAAAAAAABAAAAAAAAAAFbm9uY2UAAAAAAAAEAAAAAQAAAAAAAAAGdGFyZ2V0AAAAAAATAAAAAAAAAAAAAAAHZm5fbmFtZQAAAAARAAAAAAAAAAAAAAALdW5sb2NrX3RpbWUAAAAABgAAAAAAAAAC",
        "AAAABQAAAEFFbWl0dGVkIHdoZW4gYSBwZW5kaW5nIGRlbGF5IGNoYW5nZSBpcyBhcHBsaWVkIHZpYSBgYXBwbHlfZGVsYXlgLgAAAAAAAAAAAAAIRGVsYXlTZXQAAAABAAAACWRlbGF5X3NldAAAAAAAAAIAAAAAAAAACW9sZF9kZWxheQAAAAAAAAYAAAAAAAAAAAAAAAluZXdfZGVsYXkAAAAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAD5FbWl0dGVkIHdoZW4gYSBxdWV1ZWQgY2FsbCBpcyBleGVjdXRlZCBhZnRlciB0aGUgZGVsYXkgcGVyaW9kLgAAAAAAAAAAAAhFeGVjdXRlZAAAAAEAAAAIZXhlY3V0ZWQAAAADAAAAAAAAAAVub25jZQAAAAAAAAQAAAABAAAAAAAAAAZ0YXJnZXQAAAAAABMAAAAAAAAAAAAAAAdmbl9uYW1lAAAAABEAAAAAAAAAAg==",
        "AAAABQAAADVFbWl0dGVkIHdoZW4gYSBxdWV1ZWQgY2FsbCBpcyBjYW5jZWxsZWQgYnkgdGhlIG93bmVyLgAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAQAAAAljYW5jZWxsZWQAAAAAAAABAAAAAAAAAAVub25jZQAAAAAAAAQAAAABAAAAAg==",
        "AAAABQAAADpFbWl0dGVkIHdoZW4gYHNldF9zdGF0dXNgIGlzIGNhbGxlZCAoaW1tZWRpYXRlLCBubyBkZWxheSkuAAAAAAAAAAAACVN0YXR1c1NldAAAAAAAAAEAAAAKc3RhdHVzX3NldAAAAAAAAgAAAAAAAAAGdGFyZ2V0AAAAAAATAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAAAAAAI=",
        "AAAAAQAAAAAAAAAAAAAAClF1ZXVlZENhbGwAAAAAAAQAAAAAAAAABGFyZ3MAAAPqAAAAAAAAAAAAAAAHZm5fbmFtZQAAAAARAAAAAAAAAAZ0YXJnZXQAAAAAABMAAAAAAAAAC3VubG9ja190aW1lAAAAAAY=",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGluaXRpYXRlZC4AAAAAAAAAAAART3duZXJzaGlwVHJhbnNmZXIAAAAAAAABAAAAEm93bmVyc2hpcF90cmFuc2ZlcgAAAAAAAwAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAAAAABFsaXZlX3VudGlsX2xlZGdlcgAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gb3duZXJzaGlwIGlzIHJlbm91bmNlZC4AAAAAAAAAAAAST3duZXJzaGlwUmVub3VuY2VkAAAAAAABAAAAE293bmVyc2hpcF9yZW5vdW5jZWQAAAAAAQAAAAAAAAAJb2xkX293bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYW4gb3duZXJzaGlwIHRyYW5zZmVyIGlzIGNvbXBsZXRlZC4AAAAAAAAAAAAaT3duZXJzaGlwVHJhbnNmZXJDb21wbGV0ZWQAAAAAAAEAAAAcb3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAEAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAAAAAAAAg=="
    ]);

    static readonly parsers = {
        // Timelock methods
        queue: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancel: () => {},
        execute: () => {},
        // Admin methods
        setStatus: () => {},
        setDelay: () => {},
        applyDelay: () => {},
        // Getters
        getDelay: (result: string): u64 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getQueued: (result: string): QueuedCall =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Ownable
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
    };

    /**
     * Deploy a new instance of the Governance contract
     * Constructor: __constructor(owner, delay)
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: GovernanceConstructorArgs,
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
                nativeToScVal(args.delay, { type: 'u64' }),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Timelock Methods
    // ============================================================

    /**
     * Queue an arbitrary contract call (owner only)
     * Returns the nonce for tracking the queued call
     * @param target - Address of the contract to call
     * @param fnName - Name of the function to call on the target
     * @param args - Pre-serialized ScVal arguments for the target function
     */
    queue(target: string, fnName: string, args: xdr.ScVal[]): string {
        return this.call(
            'queue',
            Address.fromString(target).toScVal(),
            nativeToScVal(fnName, { type: 'symbol' }),
            xdr.ScVal.scvVec(args),
        ).toXDR('base64');
    }

    /**
     * Cancel a queued call (owner only)
     * @param nonce - Nonce of the queued call to cancel
     */
    cancel(nonce: u32): string {
        return this.call(
            'cancel',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    /**
     * Execute a queued call after the delay has passed (permissionless)
     * @param nonce - Nonce of the queued call to execute
     */
    execute(nonce: u32): string {
        return this.call(
            'execute',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    // ============================================================
    // Admin Methods (Owner only)
    // ============================================================

    /**
     * Set the status on a target contract (immediate, no delay) (owner only)
     * @param target - Address of the contract to set status on
     * @param status - Status value to set
     */
    setStatus(target: string, status: u32): string {
        return this.call(
            'set_status',
            Address.fromString(target).toScVal(),
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Queue a delay change (owner only, goes through timelock)
     * @param newDelay - New delay value in seconds
     */
    setDelay(newDelay: bigint): string {
        return this.call(
            'set_delay',
            nativeToScVal(newDelay, { type: 'u64' }),
        ).toXDR('base64');
    }

    /**
     * Apply a pending delay change (permissionless)
     */
    applyDelay(): string {
        return this.call('apply_delay').toXDR('base64');
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
     * Get the configured delay in seconds
     */
    getDelay(): string {
        return this.call('get_delay').toXDR('base64');
    }

    /**
     * Get a queued call by nonce
     */
    getQueued(nonce: u32): string {
        return this.call(
            'get_queued',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }
}
