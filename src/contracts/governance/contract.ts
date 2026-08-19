import { governanceSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, u64 } from '../../index.js';

/** A queued admin call. Returned by `getQueued`. */
export interface QueuedCall {
    /** Contract address the call will invoke. */
    target: string;
    /** Function name to invoke on `target`. */
    fn_name: string;
    /** Arguments passed to `fn_name`. */
    args: unknown[];
    /** Unix timestamp, in seconds, at or after which `execute` is allowed. */
    unlock_time: bigint;
}

/** Constructor arguments for {@link GovernanceContract.deploy}. */
export interface GovernanceConstructorArgs {
    /** Address that becomes the initial owner. */
    owner: string;
    /**
     * Mandatory timelock delay, in seconds. Must be in `(0, 60 days]` or
     * the constructor reverts with `InvalidDelay`.
     */
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

    /** Decoders for each method's `simulateTransaction` result. Methods that only emit events parse to nothing. */
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
     * Build the `createCustomContract` operation that deploys a Governance
     * instance and calls its constructor with `args`. The constructor
     * reverts with `InvalidDelay` if `args.delay` is out of range.
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
     * configured delay (owner only). Returns the nonce, starting at 0, used
     * to reference this call in `cancel`, `execute`, and `getQueued`.
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
     * `NotQueued` if `nonce` is unknown, already run, already cancelled, or
     * expired.
     */
    cancel(nonce: u32): string {
        return this.call(
            'cancel',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    /**
     * Execute a queued call once its delay has passed. Permissionless, any
     * caller may submit this. Reverts with `NotQueued` if the nonce is
     * unknown, already run, cancelled, or expired. Reverts with
     * `NotUnlocked` if called before `unlock_time`.
     */
    execute(nonce: u32): string {
        return this.call(
            'execute',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    /**
     * Immediately invoke `target.set_status(status)`, bypassing the timelock
     * delay (owner only). This is the bypass used for emergency halts.
     * @param status - The market contract's `Status` enum discriminant
     */
    setStatus(target: string, status: u32): string {
        return this.call(
            'set_status',
            Address.fromString(target).toScVal(),
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Queue a change to the timelock delay (owner only). This only queues
     * the change: it takes effect once the current delay elapses and
     * `applyDelay` is called, so a delay can never be shortened instantly.
     * @param newDelay - New delay, in seconds. Must be in `(0, 60 days]` or
     *   the call reverts with `InvalidDelay`.
     */
    setDelay(newDelay: bigint): string {
        return this.call(
            'set_delay',
            nativeToScVal(newDelay, { type: 'u64' }),
        ).toXDR('base64');
    }

    /**
     * Apply a delay change queued by `setDelay`, once the current delay has
     * elapsed. Permissionless. Reverts with `NotQueued` if no change is
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
     * or the offer lapses.
     * @param liveUntilLedger - Ledger sequence the offer expires at. Pass
     *   `0` to cancel a pending transfer to `newOwner` instead of starting
     *   one. Reverts with `InvalidLiveUntilLedger` if it is in the past or
     *   beyond the maximum allowed range. Reverts with `NoPendingTransfer`
     *   or `InvalidPendingAccount` if `0` and no matching transfer is
     *   pending.
     */
    transferOwnership(newOwner: Address | string, liveUntilLedger: u32): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /**
     * Accept a pending ownership transfer (pending owner only). Reverts
     * with `NoPendingTransfer` if none is pending, or `TransferExpired` if
     * the offer's `liveUntilLedger` has passed.
     */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Permanently remove the owner (owner only), disabling every owner-gated
     * method (`queue`, `cancel`, `setStatus`, `setDelay`, `transferOwnership`)
     * for good. Reverts with `TransferInProgress` if an ownership transfer
     * is currently pending.
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
     * is unknown, already run, already cancelled, or expired.
     */
    getQueued(nonce: u32): string {
        return this.call(
            'get_queued',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }
}
