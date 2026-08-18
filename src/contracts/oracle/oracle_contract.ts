import { oracleSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, u64, i128 } from '../../index.js';

/**
 * Verified price data returned by the oracle. Carries the bid/ask pair at
 * feed-native precision (18-dec on most V3 crypto streams, 8-dec on some),
 * after spread reduction toward the mid; the trading contract fills the
 * adverse side. No exponent travels with the price — every consumer
 * converts notional to tokens and back at the same scale.
 */
export interface OraclePriceData {
    /** Data Streams stream id (32 bytes); equals the request's `feedId`. */
    feed_id: Buffer;
    bid: i128;
    ask: i128;
    /** Observation time, Unix seconds — not the validity window's start. */
    publish_time: u64;
}

/** Constructor arguments for {@link OracleContract.deploy}. */
export interface OracleConstructorArgs {
    /** Admin address; may update the staleness pair and spread reduction factor (not the verifier). */
    owner: string;
    /** Chainlink Data Streams verifier contract address; immutable after deployment. */
    verifier: string;
    /** Max report age for strict (fill) verifications, seconds; in [3, 15]. */
    trade_staleness: u64;
    /** Max report age for protective (gap-closing) verifications, seconds; in [trade_staleness, 120]. */
    close_staleness: u64;
    /** SCALAR_18-scaled bid/ask narrowing toward the mid, in [0, SCALAR_18] (0 = off, SCALAR_18 = collapse to mid). */
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
 * Operation builder for the Zenex Oracle contract (Chainlink Data Streams V3
 * reports, verified through a Chainlink verifier pinned at construction).
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class OracleContract extends Contract {
    static spec: contract.Spec = new contract.Spec(oracleSpec);

    /**
     * Result parsers for each contract method, keyed by JS method name —
     * pass the base64 XDR returned by simulation through the matching
     * parser to get the native value.
     */
    static readonly parsers = {
        // Price verification
        verifyPrice: (result: string): OraclePriceData =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Admin (void returns)
        updateStaleness: () => {},
        updateSpreadReductionFactor: () => {},
        // Getters
        verifier: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        tradeStaleness: (result: string): u64 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        closeStaleness: (result: string): u64 =>
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
     * Constructor: __constructor(owner, verifier, trade_staleness, close_staleness, spread_reduction_factor)
     *
     * `verifier` is the address of Chainlink's deployed Data Streams verifier
     * contract and is immutable after deployment. The staleness pair must
     * satisfy `3 <= trade_staleness <= 15` and
     * `trade_staleness <= close_staleness <= 120` (seconds), else the
     * constructor traps with `InvalidStaleness` (783).
     * `spread_reduction_factor` is SCALAR_18-scaled in [0, SCALAR_18]
     * (0 = off, SCALAR_18 = collapse to the mid).
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
                nativeToScVal(args.trade_staleness, { type: 'u64' }),
                nativeToScVal(args.close_staleness, { type: 'u64' }),
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
     *   and must be a V3 stream (first two bytes `0x00 0x03`), else the call traps
     * @param protective - Which staleness window gates the report's age:
     *   `false` (default) applies the strict `trade_staleness` used by order
     *   fills, `true` the wider `close_staleness` used by gap-closing calls
     *   (liquidation, ADL, accrual). Only the past side widens — the forward
     *   allowance is `trade_staleness` for both classes.
     * @returns base64 XDR operation; parse result with `parsers.verifyPrice`.
     *   Traps on an unverifiable report (bad signatures, inactive DON config),
     *   a feed mismatch, an observation older than the selected window, a
     *   report past its own expiry, or a non-positive/crossed price
     */
    verifyPrice(
        report: Buffer | Uint8Array,
        feedId: Buffer | Uint8Array,
        protective = false,
    ): string {
        return this.call(
            'verify_price',
            xdr.ScVal.scvBytes(toBuffer(report)),
            feedIdToScVal(feedId),
            xdr.ScVal.scvBool(protective),
        ).toXDR('base64');
    }

    // ============================================================
    // Owner-only Admin Methods
    // ============================================================

    /**
     * Update both staleness windows in seconds (owner only)
     *
     * One call sets the pair atomically, so the `trade <= close` ordering is
     * always checked against the values that will actually be stored. Must
     * satisfy `MIN_STALENESS_SECONDS=3 <= tradeStaleness <=
     * MAX_TRADE_STALENESS_SECONDS=15` and `tradeStaleness <= closeStaleness
     * <= MAX_CLOSE_STALENESS_SECONDS=120`.
     * @param tradeStaleness - Max report age for strict (fill) verifications
     * @param closeStaleness - Max report age for protective (gap-closing) verifications
     */
    updateStaleness(tradeStaleness: u64, closeStaleness: u64): string {
        return this.call(
            'update_staleness',
            nativeToScVal(tradeStaleness, { type: 'u64' }),
            nativeToScVal(closeStaleness, { type: 'u64' }),
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

    /** Get the current owner address, or `undefined` if ownership was renounced. */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Begin a two-step transfer to `newOwner`, who must call `acceptOwnership`
     * by `liveUntilLedger` (owner only). `liveUntilLedger = 0` cancels any
     * pending transfer instead.
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
     * Permanently remove the owner, disabling `updateStaleness` and
     * `updateSpreadReductionFactor` for good (owner only). Fails if a
     * transfer is pending.
     */
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
     * Get the strict (fill) staleness window in seconds
     */
    tradeStaleness(): string {
        return this.call('trade_staleness').toXDR('base64');
    }

    /**
     * Get the protective (gap-closing) staleness window in seconds
     */
    closeStaleness(): string {
        return this.call('close_staleness').toXDR('base64');
    }

    /**
     * Get the current spread reduction factor (SCALAR_18-scaled)
     */
    spreadReductionFactor(): string {
        return this.call('spread_reduction_factor').toXDR('base64');
    }
}
