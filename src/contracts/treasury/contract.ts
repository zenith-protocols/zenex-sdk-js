import { treasurySpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32 } from '../../index.js';

/** Constructor arguments for {@link TreasuryContract.deploy}. */
export interface TreasuryConstructorArgs {
    /** Admin address; may change the rate and withdraw accumulated fees. */
    owner: string;
    /** Protocol fee rate (SCALAR_18 fraction, e.g. 1e17 = 10%); bounded to [0, SCALAR_18 / 2] (0% to 50%). */
    rate: i128;
}

/**
 * Operation builder for the Zenex Treasury contract.
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class TreasuryContract extends Contract {
    static spec: contract.Spec = new contract.Spec(treasurySpec);

    /** Parsers for each contract method's simulated result (base64 XDR), keyed by JS method name. */
    static readonly parsers = {
        // Treasury methods
        getRate: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        setRate: () => {},
        withdraw: () => {},
        // Ownable methods
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
    };

    /**
     * Deploy a new instance of the Treasury contract.
     *
     * If `args.rate` is out of range, the call traps with
     * `TreasuryInvalidRate` (900).
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: TreasuryConstructorArgs,
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
                nativeToScVal(args.rate, { type: 'i128' }),
            ],
        }).toXDR('base64');
    }

    /**
     * Set the protocol fee rate that the market reads at every settlement
     * (owner only).
     * @param rate - SCALAR_18 fraction, e.g. 1e17 = 10%. If `rate` is outside
     *   `[0, SCALAR_18 / 2]` (0% to 50%), the call traps with
     *   `TreasuryInvalidRate` (900).
     */
    setRate(rate: i128): string {
        return this.call(
            'set_rate',
            nativeToScVal(rate, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Withdraw accumulated protocol fees to `to` (owner only). The contract
     * does not check the balance itself. If `amount` is more than the
     * balance, the token transfer traps.
     * @param amount - Token-dec amount, not SCALAR_18.
     */
    withdraw(token: string, to: string, amount: i128): string {
        return this.call(
            'withdraw',
            Address.fromString(token).toScVal(),
            Address.fromString(to).toScVal(),
            nativeToScVal(amount, { type: 'i128' }),
        ).toXDR('base64');
    }

    // ============================================================
    // Ownable Methods
    // ============================================================

    /** Get the current owner address, or `undefined` if ownership was renounced. */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Begin a two-step transfer of ownership to `newOwner` (owner only). A
     * new call replaces any pending transfer.
     * @param newOwner - Must call `acceptOwnership` before the deadline to
     *   complete the transfer.
     * @param liveUntilLedger - Last ledger sequence `newOwner` can accept by.
     *   `0` cancels the pending transfer to `newOwner` instead, and
     *   `newOwner` must then equal the pending owner.
     *
     * # Errors
     * - OwnerNotSet (2100) once ownership is renounced.
     * - TransferInvalidLiveUntilLedger (2201) if `liveUntilLedger` is in the
     *   past or beyond the maximum entry TTL.
     * - NoPendingTransfer (2200) on a cancel with no pending transfer.
     * - InvalidPendingAccount (2202) on a cancel that names another address.
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
     * Complete a pending ownership transfer; callable only by the proposed
     * new owner.
     *
     * # Errors
     * - NoPendingTransfer (2200) if no transfer is pending.
     * - TransferExpired (2203) if the transfer's `liveUntilLedger` has passed.
     */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Permanently remove the owner, disabling `setRate`, `withdraw` and
     * `transferOwnership` for good (owner only). Fees left in the treasury
     * can then never be withdrawn.
     *
     * # Errors
     * - OwnerNotSet (2100) if ownership is already renounced.
     * - OwnershipTransferInProgress (2101) if an unexpired transfer is pending.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    // ============================================================
    // View / Getter Methods
    // ============================================================

    /** Get the current protocol fee rate (SCALAR_18 fraction, e.g. 1e17 = 10%). */
    getRate(): string {
        return this.call('get_rate').toXDR('base64');
    }
}
