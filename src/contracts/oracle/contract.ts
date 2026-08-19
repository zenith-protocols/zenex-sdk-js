import { oracleSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, u64, i128 } from '../../index.js';

/**
 * Verified price returned by the oracle. Bid and ask share one scale:
 * 18-dec on most V3 crypto streams, 8-dec on some. No exponent travels
 * with the price, so every consumer converts notional to tokens and back
 * at the same scale.
 */
export interface OraclePriceData {
    /** Best bid, after spread reduction. The market fills the adverse close side here. */
    bid: i128;
    /** Best ask, same precision as bid. The market fills the adverse open side here. */
    ask: i128;
    /** Observation time (Unix seconds). Not the start of the validity window. */
    publish_time: u64;
}

/** Constructor arguments for {@link OracleContract.deploy}. */
export interface OracleConstructorArgs {
    /** Admin address that may update the staleness pair and the spread reduction factor. */
    owner: string;
    /** Chainlink Data Streams verifier contract address. Immutable after deployment. */
    verifier: string;
    /** Max report age for order fills (seconds); in [3, 15]. */
    trade_staleness: u64;
    /** Max report age for gap-closing calls (seconds); in [trade_staleness, 120]. */
    close_staleness: u64;
    /** Bid/ask narrowing toward the mid (SCALAR_18-scaled); in [0, SCALAR_18]. 0 = off, SCALAR_18 = collapse to the mid. */
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
     * Result parsers for each contract method, keyed by JS method name.
     * Pass the base64 XDR returned by simulation through the matching
     * parser to get the native value.
     */
    static readonly parsers = {
        // Price verification
        verifyPrice: (result: string): OraclePriceData =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Admin (void returns)
        updateStaleness: () => {},
        updateSpreadReductionFactor: () => {},
        upgrade: () => {},
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
     * Build the constructor operation for a new Oracle contract instance.
     * See {@link OracleConstructorArgs} for argument bounds; traps with
     * `InvalidStaleness` (783) or `InvalidSpreadReduction` (785) if they
     * are violated.
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
     * Verify a signed Data Streams report and return the price for the
     * stream; parse the result with `parsers.verifyPrice`.
     * @param report - The signed report blob, exactly as fetched from the
     *   API; traps if the Chainlink verifier rejects it (invalid
     *   signatures or an inactive verifier configuration), with
     *   `InvalidData` (780) if the body fails to decode or the feed is
     *   not a V3 stream (`0x0003` prefix), with `PriceAhead` (793) if the
     *   report sits ahead of the ledger clock by more than the forward
     *   allowance, with `ReportExpired` (784) if the ledger clock has
     *   passed its expiry, or with `InvalidPrice` (781) on a
     *   non-positive price side, a crossed book, or an oversized price
     *   value
     * @param feedId - The caller's immutable 32-byte stream anchor;
     *   traps with `FeedMismatch` (790) if the report prices a different
     *   stream
     * @param protective - Selects the staleness window: `false` (default)
     *   uses the strict `trade_staleness` window for order fills, `true`
     *   the wider `close_staleness` window for gap-closing calls such as
     *   liquidation, ADL, and accrual. Only the past side widens; the
     *   forward allowance stays at `trade_staleness` for both values.
     *   Traps with `PriceStale` (782) if the observation is older than
     *   the selected window.
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
     * Update both staleness windows atomically (owner only).
     * @param tradeStaleness - Max report age for order fills (seconds);
     *   in [3, 15]
     * @param closeStaleness - Max report age for gap-closing calls
     *   (seconds); in [tradeStaleness, 120]. Traps with
     *   `InvalidStaleness` (783) if either bound is violated.
     */
    updateStaleness(tradeStaleness: u64, closeStaleness: u64): string {
        return this.call(
            'update_staleness',
            nativeToScVal(tradeStaleness, { type: 'u64' }),
            nativeToScVal(closeStaleness, { type: 'u64' }),
        ).toXDR('base64');
    }

    /**
     * Update the spread reduction factor (owner only).
     * @param spreadReductionFactor - Bid/ask narrowing toward the mid
     *   (SCALAR_18-scaled); in [0, SCALAR_18]. 0 = off, SCALAR_18 =
     *   collapse to the mid. Traps with `InvalidSpreadReduction` (785)
     *   if out of range.
     */
    updateSpreadReductionFactor(spreadReductionFactor: i128): string {
        return this.call(
            'update_spread_reduction_factor',
            nativeToScVal(spreadReductionFactor, { type: 'i128' }),
        ).toXDR('base64');
    }


    // ============================================================
    // Upgrade
    // ============================================================

    /**
     * Replace the contract's WASM executable (owner only). Storage is
     * untouched; the host emits a SYSTEM `executable_update` event.
     *
     * @param newWasmHash - Hash of the already-uploaded replacement WASM.
     * @param operator - Must equal the owner. The trait shape mandates the
     *   argument; it carries no authority of its own.
     *
     * # Errors
     * - `UpgradeNotOwner` (600) if `operator` is not the owner.
     */
    upgrade(newWasmHash: Buffer | Uint8Array, operator: string): string {
        const hash = newWasmHash instanceof Buffer ? newWasmHash : Buffer.from(newWasmHash);
        return this.call(
            'upgrade',
            xdr.ScVal.scvBytes(hash),
            Address.fromString(operator).toScVal(),
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

    /** Complete a pending ownership transfer. Only the proposed new owner may call this. */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Permanently remove the owner, disabling `updateStaleness` and
     * `updateSpreadReductionFactor` (owner only). Fails if a transfer is
     * pending.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    // ============================================================
    // View / Getter Methods
    // ============================================================

    /** Get the Chainlink Data Streams verifier contract address. */
    verifier(): string {
        return this.call('verifier').toXDR('base64');
    }

    /** Get the trade_staleness window used for order fills (seconds). */
    tradeStaleness(): string {
        return this.call('trade_staleness').toXDR('base64');
    }

    /** Get the close_staleness window used for gap-closing calls (seconds). */
    closeStaleness(): string {
        return this.call('close_staleness').toXDR('base64');
    }

    /** Get the current spread reduction factor (SCALAR_18-scaled). */
    spreadReductionFactor(): string {
        return this.call('spread_reduction_factor').toXDR('base64');
    }
}
