import { governanceSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, u64 } from '../../index.js';

/**
 * A queued admin call, as returned by `getQueued`. `unlock_time` is the ledger
 * timestamp (Unix seconds) at or after which `execute` is allowed. The entry
 * lives in temporary storage with a TTL derived from the delay — once it
 * expires (or the call is executed/cancelled), lookups revert with `NotQueued`.
 */
export interface QueuedCall {
    target: string;
    fn_name: string;
    args: unknown[];
    unlock_time: bigint;
}

/**
 * `delay` is the mandatory timelock wait, in seconds, bounded to `(0, 60 days]`
 * — the constructor panics with `InvalidDelay` outside that range.
 */
export interface GovernanceConstructorArgs {
    owner: string;
    delay: bigint;
}

/**
 * Operation builder for the Zenex Governance contract (a generic timelock over
 * arbitrary `target.fn_name(args)` calls).
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class GovernanceContract extends Contract {
    static spec: contract.Spec = new contract.Spec(governanceSpec);

    /**
     * Decoders for each method's `simulateTransaction` result. Void-returning
     * methods (`cancel`, `execute`, `setStatus`, ...) only emit events on
     * chain, so their parsers are no-ops.
     */
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
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
    };

    /**
     * Build the `createCustomContract` operation deploying a Governance
     * instance, invoking `__constructor(owner, delay)`. `args.delay` must be
     * in `(0, 60 days]` seconds or the constructor panics with `InvalidDelay`.
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

    /**
     * Queue a `target.fnName(args)` call to become executable after the
     * configured delay (owner only). Returns the monotonically increasing
     * nonce (starting at 0) used to reference this call in `cancel`,
     * `execute`, and `getQueued`.
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
     * Cancel a queued call before it executes (owner only). Reverts with
     * `NotQueued` if `nonce` is unknown, already executed/cancelled, or expired.
     */
    cancel(nonce: u32): string {
        return this.call(
            'cancel',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    /**
     * Execute a queued call once its delay has elapsed (permissionless — any
     * caller may submit this). Reverts with `NotUnlocked` if called before
     * `unlock_time`, or `NotQueued` if the nonce is unknown, already run,
     * cancelled, or expired.
     */
    execute(nonce: u32): string {
        return this.call(
            'execute',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    /**
     * Immediately invoke `target.set_status(status)`, bypassing the timelock
     * entirely (owner only) — the escape hatch for emergency halts.
     * @param status - The target contract's `Status` enum discriminant
     */
    setStatus(target: string, status: u32): string {
        return this.call(
            'set_status',
            Address.fromString(target).toScVal(),
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Queue a change to the timelock delay itself (owner only). The new
     * value only takes effect once the *current* delay elapses and
     * `applyDelay` is called, so a delay can never be shortened instantly.
     * @param newDelay - New delay in seconds, must be in `(0, 60 days]`
     *   (reverts with `InvalidDelay` otherwise)
     */
    setDelay(newDelay: bigint): string {
        return this.call(
            'set_delay',
            nativeToScVal(newDelay, { type: 'u64' }),
        ).toXDR('base64');
    }

    /**
     * Apply a delay change queued by `setDelay`, once the current delay has
     * elapsed (permissionless). Reverts with `NotQueued` if no change is
     * pending, or `NotUnlocked` if called too early.
     */
    applyDelay(): string {
        return this.call('apply_delay').toXDR('base64');
    }

    /** Get the current owner, or `undefined` if ownership was renounced. */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Begin a 2-step ownership transfer to `newOwner` (owner only). The new
     * owner must call `acceptOwnership` by ledger sequence `liveUntilLedger`
     * or the offer lapses; passing `0` cancels any pending transfer instead.
     */
    transferOwnership(newOwner: Address | string, liveUntilLedger: u32): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /** Accept a pending ownership transfer (caller becomes owner). */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Permanently remove the owner (owner only), disabling every owner-gated
     * method (`queue`, `cancel`, `setStatus`, `setDelay`, `transferOwnership`)
     * for good. Reverts if a transfer is currently pending.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    /** Get the currently configured timelock delay, in seconds. */
    getDelay(): string {
        return this.call('get_delay').toXDR('base64');
    }

    /**
     * Look up a queued call by nonce. Reverts with `NotQueued` if the nonce
     * is unknown, already executed/cancelled, or has expired.
     */
    getQueued(nonce: u32): string {
        return this.call(
            'get_queued',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }
}
