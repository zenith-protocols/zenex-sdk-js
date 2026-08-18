// =============================================================================
// Batched `getLedgerEntries` machinery shared by every state loader.
//
// Three invariants live here, and each exists because the RPC will otherwise
// bite silently:
//
//  1. KEYS ARE DEDUPED. `getLedgerEntries` rejects a request containing the
//     same key twice, and reports it as
//     `could not query captive core: http request failed with non-200 status
//     code (404)` -- which blames the server for a caller bug. Markets in one
//     deployment share a treasury and usually a settlement token, so a naive
//     `flatMap` over several markets produces duplicates and fails the whole
//     batch.
//  2. DECODE IS KEYED BY EXACT KEY BYTES, never by position. The RPC silently
//     OMITS keys it cannot find, so the response is not positionally aligned
//     with the request. (Blend demultiplexes on the decoded storage-key symbol
//     instead; that cannot work here, because a market batch contains three
//     different contracts' `ContractInstance` keys, which all decode to the
//     same symbol.)
//  3. TTL FAILS CLOSED. An entry whose `liveUntilLedgerSeq` is behind the
//     response's `latestLedger` is expired-but-not-yet-evicted. The chain will
//     refuse to transact against it, so decoding it as live state does not risk
//     funds -- but it would render a stale position or quote against stale
//     funding indices and then eat an opaque rejection at submit. Treating it
//     as missing turns that into an actionable error.
// =============================================================================

import { rpc, xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';

/** Cap for a single `getLedgerEntries` round trip, in unique keys. */
export const MAX_KEYS_PER_REQUEST = 180;

/** Codes for a failed state read. */
export type MarketStateFailureCode =
    | 'INVALID_INPUT'
    | 'MISSING_STATE'
    | 'IDENTITY_MISMATCH';

/** A batched contract-state read could not produce a coherent result. */
export class MarketStateError extends Error {
    constructor(
        readonly code: MarketStateFailureCode,
        reason: string,
    ) {
        super(reason);
        this.name = 'MarketStateError';
    }
}

/** A returned contract-data entry plus the TTL the RPC reported for it. */
interface ReturnedEntry {
    readonly value: xdr.ScVal;
    readonly liveUntilLedgerSeq?: number;
}

/**
 * The result of one batched read: the ledger it closed at, plus key-addressed
 * lookup that fails closed on expiry.
 */
export interface EntryBatch {
    /** Latest ledger the batch read closed at. */
    readonly ledger: number;
    /** Decoded value for a key, or `undefined` when the RPC omitted it. */
    at(key: xdr.LedgerKey, label: string): xdr.ScVal | undefined;
    /** As {@link at}, but a missing entry is a `MISSING_STATE` error. */
    require(key: xdr.LedgerKey, label: string): xdr.ScVal;
}

function contractDataValue(data: xdr.LedgerEntryData): xdr.ScVal | undefined {
    if (data.switch() !== xdr.LedgerEntryType.contractData()) return undefined;
    return data.contractData().val();
}

/**
 * Fetch every key in one round trip.
 *
 * Duplicates in `keys` are collapsed before the request and resolve normally on
 * lookup, so callers may build per-market key lists independently without
 * coordinating on the addresses they share.
 *
 * @throws {MarketStateError} `INVALID_INPUT` when the deduped key count exceeds
 *   {@link MAX_KEYS_PER_REQUEST}.
 */
export async function readEntries(
    network: Network,
    keys: readonly xdr.LedgerKey[],
): Promise<EntryBatch> {
    const unique = new Map<string, xdr.LedgerKey>();
    for (const key of keys) unique.set(key.toXDR('base64'), key);

    if (unique.size > MAX_KEYS_PER_REQUEST) {
        throw new MarketStateError(
            'INVALID_INPUT',
            `state batch of ${unique.size} unique keys exceeds the ${MAX_KEYS_PER_REQUEST}-key request cap; page the markets`,
        );
    }

    const server = new rpc.Server(network.rpc, network.opts);
    const response = await server.getLedgerEntries(...unique.values());
    const ledger = response.latestLedger;

    const returned = new Map<string, ReturnedEntry>();
    for (const entry of response.entries) {
        const value = contractDataValue(entry.val);
        if (value === undefined) continue;
        returned.set(entry.key.toXDR('base64'), {
            value,
            liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
        });
    }

    const at = (key: xdr.LedgerKey, label: string): xdr.ScVal | undefined => {
        const entry = returned.get(key.toXDR('base64'));
        if (!entry) return undefined;
        if (
            entry.liveUntilLedgerSeq !== undefined &&
            entry.liveUntilLedgerSeq < ledger
        ) {
            throw new MarketStateError(
                'MISSING_STATE',
                `${label} is TTL-expired (live until ledger ${entry.liveUntilLedgerSeq}, latest ${ledger}); restore or extend it before reading`,
            );
        }
        return entry.value;
    };

    return {
        ledger,
        at,
        require(key, label) {
            const value = at(key, label);
            if (value === undefined) {
                throw new MarketStateError(
                    'MISSING_STATE',
                    `${label} not found`,
                );
            }
            return value;
        },
    };
}
