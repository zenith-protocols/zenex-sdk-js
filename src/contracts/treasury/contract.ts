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
     * If `args.rate` is out of range, the call traps with `InvalidRate`.
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
     * Set the protocol fee rate that the market reads at every settlement (owner only).
     * @param rate - SCALAR_18 fraction, e.g. 1e17 = 10%. If `rate` is outside
     *   `[0, SCALAR_18 / 2]` (0% to 50%), the call traps with `InvalidRate`.
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
     * Begin a two-step transfer of ownership to `newOwner` (owner only).
     * @param newOwner - Must call `acceptOwnership` before the deadline to
     *   complete the transfer.
     * @param liveUntilLedger - Ledger sequence deadline. `0` cancels any
     *   pending transfer instead.
     */
    transferOwnership(newOwner: Address | string, liveUntilLedger: u32): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /** Complete a pending ownership transfer; callable only by the proposed new owner. */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Permanently remove the owner, disabling `setRate` and `withdraw` for
     * good (owner only). Fails if a transfer is pending.
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
