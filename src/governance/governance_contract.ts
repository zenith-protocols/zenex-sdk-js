import { governanceSpec } from '../generated/contract_specs.js';
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
    static spec: contract.Spec = new contract.Spec(governanceSpec);

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
