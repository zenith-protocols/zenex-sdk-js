import { scValToNative, type xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import type { Order, VaultOrder } from '../contracts/market/types.js';
import { parseOrder, parsePosition, parseVaultOrder } from '../contracts/market/types.js';
import {
    marketClaimableCreditLedgerKey,
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
 * a vault deposit/redeem order, tagged by which. `archived` is `true` when
 * the entry's TTL lapsed: the order still stands, and the next transaction
 * that touches it restores it.
 */
export type PendingOrder =
    | { id: number; type: 'order'; order: Order; archived: boolean }
    | { id: number; type: 'vaultOrder'; order: VaultOrder; archived: boolean };

/** The four user-tier entries a {@link MarketUser} is read from. */
export type MarketUserEntry = 'long' | 'short' | 'orderCounter' | 'claimableCredit';

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
        /** Long side; zeroed when no row is stored (never opened). */
        public long: MarketPosition,
        /** Short side; zeroed when no row is stored (never opened). */
        public short: MarketPosition,
        /**
         * The id the user's next order gets (trade and vault orders share
         * the counter). `0` when no counter is stored: the user has never
         * created an order, and the contract allocates id 1 next.
         */
        public orderCounter: number,
        /** Funding owed to the user, plus any parked failed payout, token-dec. */
        public claimableCredit: bigint,
        /**
         * The entries whose TTL lapsed (archived). Each still decodes from
         * the value the RPC returns, which stays the user's state: the next
         * transaction that touches it restores it, and pays the restore fee.
         */
        public archived: readonly MarketUserEntry[] = [],
    ) {}

    /**
     * Read one subject's positions, counter, and claimable credit. One
     * `getLedgerEntries`, four keys. An archived entry decodes as usual and
     * is listed in {@link MarketUser.archived}; it never fails the read.
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
            keys.claimableCredit,
        ]);
        return decodeUser(marketId, userId, batch);
    }

    /**
     * Probe the newest `lookback` ids of this user's shared order-id space
     * (`orderCounter - lookback .. orderCounter - 1`) in one
     * `getLedgerEntries` and return the live orders, sorted by id. Trade and
     * vault orders draw ids from the same counter, so each id resolves to at
     * most one of the two; filled or cancelled rows are deleted on-chain and
     * simply do not appear. An archived order is returned with
     * `archived: true`.
     *
     * A chain-only fallback (the official frontend lists open orders through
     * the indexer). `lookback` defaults to 50 and is clamped to the counter
     * and the RPC's per-request key budget (2 keys per id).
     *
     * @throws {RangeError} if `lookback` is not a non-negative safe integer.
     */
    async loadOrders(
        network: Network,
        lookback?: number,
    ): Promise<PendingOrder[]> {
        const requested = lookback ?? DEFAULT_ORDER_LOOKBACK;
        if (!Number.isSafeInteger(requested) || requested < 0) {
            throw new RangeError('lookback must be a non-negative safe integer');
        }
        const window = Math.min(
            requested,
            MAX_ORDER_LOOKBACK,
            this.orderCounter - 1,
        );
        if (window <= 0) return [];

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
            const order = batch.entry(probe.order);
            if (order !== undefined) {
                live.push({
                    id: probe.id,
                    type: 'order',
                    order: parseOrder(scValToNative(order.value)),
                    archived: order.archived,
                });
                continue;
            }
            const vaultOrder = batch.entry(probe.vaultOrder);
            if (vaultOrder !== undefined) {
                live.push({
                    id: probe.id,
                    type: 'vaultOrder',
                    order: parseVaultOrder(scValToNative(vaultOrder.value)),
                    archived: vaultOrder.archived,
                });
            }
        }
        return live;
    }

    /**
     * What a `claim_credit` call would pay out right now, token-dec:
     * {@link MarketUser.claimableCredit} capped at what the market's
     * credit pool holds. The contract pays the minimum and keeps the
     * remainder claimable for a later call.
     */
    claimable(market: Market): bigint {
        const pool = market.data.creditPool;
        const amount =
            this.claimableCredit < pool ? this.claimableCredit : pool;
        return amount > 0n ? amount : 0n;
    }
}

/** @internal The four ledger keys one subject's state collapses to. */
export function marketUserKeys(
    marketId: string,
    userId: string,
): Record<MarketUserEntry, xdr.LedgerKey> {
    return {
        long: marketPositionLedgerKey(marketId, userId, true),
        short: marketPositionLedgerKey(marketId, userId, false),
        orderCounter: marketOrderCounterLedgerKey(marketId, userId),
        claimableCredit: marketClaimableCreditLedgerKey(marketId, userId),
    };
}

/**
 * @internal Decode one subject from a batch holding their four keys. User
 * rows archive after about 120 idle days, but an archived value is still
 * the user's state, so it decodes and is listed rather than failing the read.
 */
export function decodeUser(
    marketId: string,
    userId: string,
    batch: EntryBatch,
): MarketUser {
    const keys = marketUserKeys(marketId, userId);
    const archived: MarketUserEntry[] = [];
    const read = (name: MarketUserEntry): xdr.ScVal | undefined => {
        const entry = batch.entry(keys[name]);
        if (entry?.archived) archived.push(name);
        return entry?.value;
    };
    const side = (name: 'long' | 'short', isLong: boolean): MarketPosition => {
        const value = read(name);
        return value
            ? MarketPosition.from(parsePosition(scValToNative(value)), isLong)
            : zeroPosition(isLong);
    };

    const long = side('long', true);
    const short = side('short', false);
    const counter = read('orderCounter');
    const credit = read('claimableCredit');

    return new MarketUser(
        marketId,
        userId,
        long,
        short,
        counter ? Number(scValToNative(counter)) : 0,
        credit ? (scValToNative(credit) as bigint) : 0n,
        archived,
    );
}
