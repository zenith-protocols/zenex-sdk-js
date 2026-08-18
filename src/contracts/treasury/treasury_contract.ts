import { treasurySpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32 } from '../../index.js';

export interface TreasuryConstructorArgs {
    owner: string;
    rate: i128;
}

/**
 * TreasuryContract - Operation builder for the Zenex Treasury contract
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class TreasuryContract extends Contract {
    static spec: contract.Spec = new contract.Spec(treasurySpec);

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
     * Deploy a new instance of the Treasury contract
     * Constructor: __constructor(owner, rate)
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

    // ============================================================
    // Owner-only Admin Methods
    // ============================================================

    /**
     * Set the protocol fee rate (owner only)
     * Rate must be in range [0, SCALAR_18/2]
     */
    setRate(rate: i128): string {
        return this.call(
            'set_rate',
            nativeToScVal(rate, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Withdraw accumulated fees to the specified address (owner only)
     * @param token - Token contract address
     * @param to - Recipient address
     * @param amount - Amount to withdraw
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
     * Get the current protocol fee rate (SCALAR_18 fraction)
     */
    getRate(): string {
        return this.call('get_rate').toXDR('base64');
    }
}
