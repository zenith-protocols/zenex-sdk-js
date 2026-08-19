import { scValToNative, type xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import type { Order, VaultOrder } from '../contracts/market/types.js';
import { parseOrder, parsePosition, parseVaultOrder } from '../contracts/market/types.js';
import {
    marketClaimableFundingLedgerKey,
    marketOrderCounterLedgerKey,
    marketOrderLedgerKey,
    marketPositionLedgerKey,
    marketVaultOrderLedgerKey,
} from '../contracts/market/keys.js';
import { readEntries } from '../entries.js';
import type { EntryBatch } from '../entries.js';
import type { Market } from './market.js';
import { MarketPosition } from './position.js';

/**
 * One live entry in a user's shared order-id space: a keeper trade order or
 * a vault deposit/redeem order, tagged by which.
 */
export type PendingOrder =
    | { id: number; type: 'order'; order: Order }
    | { id: number; type: 'vaultOrder'; order: VaultOrder };

/** How many ids {@link MarketUser.loadOrders} probes by default. */
const DEFAULT_ORDER_LOOKBACK = 50;
/** Per-request key budget the RPC tolerates; 2 keys per probed id. */
const MAX_ORDER_LOOKBACK = 90;

/** A never-opened side reads as the contract's `Position::zeroed`. */
function zeroPosition(isLong: boolean): MarketPosition {
    return new MarketPosition(isLong, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, []);
}

/**
 * One subject's state on one market: both stored positions, the order
 * counter, and claimable funding. Plain public fields. Pairing a user with
 * the market it was read against is the caller's responsibility.
 */
export class MarketUser {
    constructor(
        /** The market (trading) contract this state was read from. */
        public marketId: string,
        /** Position owner. */
        public userId: string,
        /** Long side; zeroed when never opened (or TTL-evicted). */
        public long: MarketPosition,
        /** Short side; zeroed when never opened (or TTL-evicted). */
        public short: MarketPosition,
        /** Next order id for this user (trade + vault), allocated from 1. */
        public orderCounter: number,
        /** Funding owed to the user, token-dec. */
        public claimableFunding: bigint,
    ) {}

    /**
     * Read one subject's positions, counter, and claimable funding. One
     * `getLedgerEntries`, four keys.
     */
    static async load(
        network: Network,
        marketId: string,
        userId: string,
    ): Promise<MarketUser> {
        const keys = marketUserKeys(marketId, userId);
        const batch = await readEntries(network, [
            keys.long,
            keys.short,
            keys.orderCounter,
            keys.claimableFunding,
        ]);
        return decodeUser(marketId, userId, batch);
    }

    /**
     * Probe the newest `lookback` ids of this user's shared order-id space
     * (`orderCounter - lookback .. orderCounter - 1`) in one
     * `getLedgerEntries` and return the live orders, sorted by id. Trade and
     * vault orders draw ids from the same counter, so each id resolves to at
     * most one of the two; filled or cancelled rows are deleted on-chain and
     * simply do not appear.
     *
     * A chain-only fallback (the official frontend lists open orders through
     * the indexer). `lookback` defaults to 50 and is clamped to the counter
     * and the RPC's per-request key budget (2 keys per id).
     */
    async loadOrders(
        network: Network,
        lookback?: number,
    ): Promise<PendingOrder[]> {
        const window = Math.min(
            lookback ?? DEFAULT_ORDER_LOOKBACK,
            MAX_ORDER_LOOKBACK,
            Math.max(0, this.orderCounter - 1),
        );
        if (window === 0) return [];

        const from = this.orderCounter - window;
        const probes: {
            id: number;
            order: xdr.LedgerKey;
            vaultOrder: xdr.LedgerKey;
        }[] = [];
        for (let id = from; id < this.orderCounter; id++) {
            probes.push({
                id,
                order: marketOrderLedgerKey(this.marketId, this.userId, id),
                vaultOrder: marketVaultOrderLedgerKey(
                    this.marketId,
                    this.userId,
                    id,
                ),
            });
        }
        const batch = await readEntries(
            network,
            probes.flatMap((probe) => [probe.order, probe.vaultOrder]),
        );

        const live: PendingOrder[] = [];
        for (const probe of probes) {
            const order = batch.at(probe.order, `order ${probe.id}`);
            if (order !== undefined) {
                live.push({
                    id: probe.id,
                    type: 'order',
                    order: parseOrder(scValToNative(order)),
                });
                continue;
            }
            const vaultOrder = batch.at(
                probe.vaultOrder,
                `vault order ${probe.id}`,
            );
            if (vaultOrder !== undefined) {
                live.push({
                    id: probe.id,
                    type: 'vaultOrder',
                    order: parseVaultOrder(scValToNative(vaultOrder)),
                });
            }
        }
        return live;
    }

    /**
     * What a `claim_funding` call would pay out right now, token-dec:
     * {@link MarketUser.claimableFunding} capped at what the market's
     * funding pool holds — the contract pays the minimum and keeps the
     * remainder claimable for a later call.
     */
    claimable(market: Market): bigint {
        const pool = market.data.fundingPool;
        const amount =
            this.claimableFunding < pool ? this.claimableFunding : pool;
        return amount > 0n ? amount : 0n;
    }
}

/** @internal The four ledger keys one subject's state collapses to. */
export function marketUserKeys(
    marketId: string,
    userId: string,
): {
    long: xdr.LedgerKey;
    short: xdr.LedgerKey;
    orderCounter: xdr.LedgerKey;
    claimableFunding: xdr.LedgerKey;
} {
    return {
        long: marketPositionLedgerKey(marketId, userId, true),
        short: marketPositionLedgerKey(marketId, userId, false),
        orderCounter: marketOrderCounterLedgerKey(marketId, userId),
        claimableFunding: marketClaimableFundingLedgerKey(marketId, userId),
    };
}

/** @internal Decode one subject from a batch holding their four keys. */
export function decodeUser(
    marketId: string,
    userId: string,
    batch: EntryBatch,
): MarketUser {
    const keys = marketUserKeys(marketId, userId);

    const side = (key: xdr.LedgerKey, isLong: boolean): MarketPosition => {
        const value = batch.at(
            key,
            `${isLong ? 'long' : 'short'} position for ${userId} on ${marketId}`,
        );
        return value
            ? MarketPosition.from(parsePosition(scValToNative(value)), isLong)
            : zeroPosition(isLong);
    };

    const counter = batch.at(
        keys.orderCounter,
        `order counter for ${userId} on ${marketId}`,
    );
    const funding = batch.at(
        keys.claimableFunding,
        `claimable funding for ${userId} on ${marketId}`,
    );

    return new MarketUser(
        marketId,
        userId,
        side(keys.long, true),
        side(keys.short, false),
        // Absent counter means the user has never created an order; the
        // contract allocates from 1, so 0 is the correct "none yet".
        counter ? Number(scValToNative(counter)) : 0,
        funding ? (scValToNative(funding) as bigint) : 0n,
    );
}
