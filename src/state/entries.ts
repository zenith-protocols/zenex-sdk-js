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
    /**
     * Decoded value for a key, or `undefined` when the RPC omitted it.
     * @throws {MarketStateError} `MISSING_STATE` when the entry's TTL lapsed
     *   before `ledger`. A lapsed entry is reported as missing, never decoded.
     */
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
