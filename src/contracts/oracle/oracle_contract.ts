import { oracleSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, u64, i128 } from '../../index.js';

// Verified price data returned by the oracle. Carries the bid/ask pair
// (18-dec, after spread reduction toward the mid); the trading contract
// fills the adverse side. No exponent travels with the price — every
// consumer converts notional to tokens and back at the same fixed scale.
export interface OraclePriceData {
    feed_id: Buffer;
    bid: i128;
    ask: i128;
    publish_time: u64;
}

// Constructor arguments
export interface OracleConstructorArgs {
    owner: string;
    verifier: string;
    max_staleness: u64;
    spread_reduction_factor: i128;
}

function toBuffer(data: Buffer | Uint8Array): Buffer {
    return data instanceof Buffer ? data : Buffer.from(data);
}

function feedIdToScVal(feedId: Buffer | Uint8Array): xdr.ScVal {
    const buf = toBuffer(feedId);
    if (buf.length !== 32) {
        throw new Error(`feedId must be exactly 32 bytes, got ${buf.length}`);
    }
    return xdr.ScVal.scvBytes(buf);
}

/**
 * OracleContract - Operation builder for the Zenex Oracle contract
 *
 * Adapts Chainlink Data Streams on-chain: DON signature verification is
 * delegated to Chainlink's deployed verifier contract (pinned at
 * construction), then the V3 report body is decoded and every protocol
 * gate — feed identity, validity window, two-sided staleness, price
 * sanity, spread reduction — is enforced before the price is exposed.
 * Used by the trading contract to determine entry/exit prices and
 * compute PnL.
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class OracleContract extends Contract {
    static spec: contract.Spec = new contract.Spec(oracleSpec);

    static readonly parsers = {
        // Price verification
        verifyPrice: (result: string): OraclePriceData =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Admin (void returns)
        updateMaxStaleness: () => {},
        updateSpreadReductionFactor: () => {},
        // Getters
        verifier: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        maxStaleness: (result: string): u64 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        spreadReductionFactor: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Ownable
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
    };

    /**
     * Deploy a new instance of the Oracle contract
     * Constructor: __constructor(owner, verifier, max_staleness, spread_reduction_factor)
     *
     * `verifier` is the address of Chainlink's deployed Data Streams verifier
     * contract and is immutable after deployment. `max_staleness` must lie in
     * [3, 15] seconds; `spread_reduction_factor` is SCALAR_18-scaled in
     * [0, SCALAR_18] (0 = off, SCALAR_18 = collapse to the mid).
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: OracleConstructorArgs,
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
                Address.fromString(args.verifier).toScVal(),
                nativeToScVal(args.max_staleness, { type: 'u64' }),
                nativeToScVal(args.spread_reduction_factor, { type: 'i128' }),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Price Verification
    // ============================================================

    /**
     * Verify a signed Data Streams report and return the price for a stream
     * @param report - The signed report blob, exactly as fetched from the API
     * @param feedId - The caller's immutable 32-byte stream anchor; must equal the report's `feedId`
     * @returns base64 XDR operation; parse result with `parsers.verifyPrice`
     */
    verifyPrice(report: Buffer | Uint8Array, feedId: Buffer | Uint8Array): string {
        return this.call(
            'verify_price',
            xdr.ScVal.scvBytes(toBuffer(report)),
            feedIdToScVal(feedId),
        ).toXDR('base64');
    }

    // ============================================================
    // Owner-only Admin Methods
    // ============================================================

    /**
     * Update the max staleness threshold in seconds (owner only)
     * Must lie in [MIN_STALENESS_SECONDS=3, MAX_STALENESS_SECONDS=15].
     * @param maxStaleness - Maximum age of a price observation in seconds
     */
    updateMaxStaleness(maxStaleness: u64): string {
        return this.call(
            'update_max_staleness',
            nativeToScVal(maxStaleness, { type: 'u64' }),
        ).toXDR('base64');
    }

    /**
     * Update the spread reduction factor (owner only)
     * SCALAR_18-scaled symmetric bid/ask narrowing toward the mid;
     * must lie in [0, SCALAR_18] (0 = off, SCALAR_18 = collapse to the mid).
     * @param spreadReductionFactor - SCALAR_18-scaled narrowing factor
     */
    updateSpreadReductionFactor(spreadReductionFactor: i128): string {
        return this.call(
            'update_spread_reduction_factor',
            nativeToScVal(spreadReductionFactor, { type: 'i128' }),
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
     * Get the Chainlink Data Streams verifier contract address (immutable)
     */
    verifier(): string {
        return this.call('verifier').toXDR('base64');
    }

    /**
     * Get the current max staleness threshold in seconds
     */
    maxStaleness(): string {
        return this.call('max_staleness').toXDR('base64');
    }

    /**
     * Get the current spread reduction factor (SCALAR_18-scaled)
     */
    spreadReductionFactor(): string {
        return this.call('spread_reduction_factor').toXDR('base64');
    }
}
