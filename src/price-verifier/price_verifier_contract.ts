import { priceVerifierSpec } from '../generated/contract_specs.js';
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
    static spec: contract.Spec = new contract.Spec(priceVerifierSpec);

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
