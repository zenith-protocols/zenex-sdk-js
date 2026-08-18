// =============================================================================
// MarketUser — one subject's state on one market, in a single
// `getLedgerEntries`.
//
// Separate from `Market` because it refreshes on a different clock: market
// state moves with every fill, a user's own state only with their own activity,
// so a consumer caches them under different keys and invalidates the user's on
// their own trades. Following Blend, the accessors that interpret this state
// require the `Market` it belongs to — a position is meaningless without the
// market that prices it.
//
// Both sides are read unconditionally. They are two keys in a batch that is
// already round-tripping, and a caller almost always wants to know whether the
// opposite side exists.
// =============================================================================

import type { xdr } from '@stellar/stellar-sdk';
import { scValToNative } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import {
    tradingClaimableFundingLedgerKey,
    tradingOrderCounterLedgerKey,
    tradingPositionLedgerKey,
} from '../ledger-keys.js';
import { parsePosition } from '../contracts/trading/trading_types.js';
import type { Position } from '../contracts/trading/trading_types.js';
import { readEntries } from './entries.js';
import type { EntryBatch } from './entries.js';
import type { MarketContracts } from './market.js';
import type { Market } from './market.js';

/** A never-opened side reads as the contract's `Position::zeroed`. */
function zeroPosition(): Position {
    return {
        margin: 0n,
        notional: 0n,
        tokens: 0n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        pricedAt: 0n,
        decreaseOrders: [],
    };
}

/** One subject's decoded state on one market. Plain data. */
export interface MarketUserData {
    /** Latest ledger the read closed at. */
    readonly ledger: number;
    /** Market the state was read from. */
    readonly market: string;
    /** Position owner. */
    readonly user: string;
    /** Long side; zeroed when never opened. */
    readonly long: Position;
    /** Short side; zeroed when never opened. */
    readonly short: Position;
    /** Next order id for this user (trade + vault), allocated from 1. */
    readonly orderCounter: number;
    /** Funding owed to the user, token-dec. */
    readonly claimableFunding: bigint;
}

/** The keys one subject's state on one market collapses to. */
export function marketUserKeys(
    market: string,
    user: string,
): {
    long: xdr.LedgerKey;
    short: xdr.LedgerKey;
    orderCounter: xdr.LedgerKey;
    claimableFunding: xdr.LedgerKey;
} {
    return {
        long: tradingPositionLedgerKey(market, user, true),
        short: tradingPositionLedgerKey(market, user, false),
        orderCounter: tradingOrderCounterLedgerKey(market, user),
        claimableFunding: tradingClaimableFundingLedgerKey(market, user),
    };
}

function decodeUser(
    market: string,
    user: string,
    batch: EntryBatch,
): MarketUserData {
    const keys = marketUserKeys(market, user);

    // ARCHIVAL AMBIGUITY: a RETURNED-but-expired Position fails closed via the
    // TTL guard inside the batch. An ABSENT Position is still ambiguous: it can
    // mean "this side was never opened" (`Position::zeroed`) OR "the entry was
    // TTL-archived and evicted" — Position sits in the 100/120-day persistent
    // tier, and `getLedgerEntries` cannot see evicted entries. A simulation
    // can (`rpc.Api.isSimulationRestore`), so disambiguating means probing
    // `get_position` when the key is absent.
    // TODO(archival): probe on absence before decoding as "never opened".
    const side = (key: xdr.LedgerKey, label: string): Position => {
        const value = batch.at(key, label);
        return value ? parsePosition(scValToNative(value)) : zeroPosition();
    };

    const counter = batch.at(
        keys.orderCounter,
        `order counter for ${user} on ${market}`,
    );
    const funding = batch.at(
        keys.claimableFunding,
        `claimable funding for ${user} on ${market}`,
    );

    return {
        ledger: batch.ledger,
        market,
        user,
        long: side(keys.long, `long position for ${user} on ${market}`),
        short: side(keys.short, `short position for ${user} on ${market}`),
        // Absent counter means the user has never created an order; the
        // contract allocates from 1, so 0 is the correct "none yet".
        orderCounter: counter ? Number(scValToNative(counter)) : 0,
        claimableFunding: funding ? (scValToNative(funding) as bigint) : 0n,
    };
}

/** One subject's state on one market at a ledger. */
export class MarketUser {
    private constructor(readonly state: MarketUserData) {}

    /** Read one subject's state. One `getLedgerEntries`, four keys. */
    static async load(
        network: Network,
        contracts: Pick<MarketContracts, 'market'>,
        user: string,
    ): Promise<MarketUser> {
        const keys = marketUserKeys(contracts.market, user);
        const batch = await readEntries(network, [
            keys.long,
            keys.short,
            keys.orderCounter,
            keys.claimableFunding,
        ]);
        return new MarketUser(decodeUser(contracts.market, user, batch));
    }

    /**
     * Read many subjects on one market in a single `getLedgerEntries`, in
     * request order. This is the shape an indexer wants and the old
     * one-user-per-market request could not express.
     */
    static async loadMany(
        network: Network,
        contracts: Pick<MarketContracts, 'market'>,
        users: readonly string[],
    ): Promise<MarketUser[]> {
        if (users.length === 0) return [];
        const keys = users.flatMap((user) => {
            const k = marketUserKeys(contracts.market, user);
            return [k.long, k.short, k.orderCounter, k.claimableFunding];
        });
        const batch = await readEntries(network, keys);
        return users.map(
            (user) => new MarketUser(decodeUser(contracts.market, user, batch)),
        );
    }

    /** Rebuild from cached plain data. */
    static fromData(state: MarketUserData): MarketUser {
        return new MarketUser(state);
    }

    get user(): string {
        return this.state.user;
    }

    get ledger(): number {
        return this.state.ledger;
    }

    get claimableFunding(): bigint {
        return this.state.claimableFunding;
    }

    get orderCounter(): number {
        return this.state.orderCounter;
    }

    /** The stored position for a side, zeroed when never opened. */
    position(isLong: boolean): Position {
        return isLong ? this.state.long : this.state.short;
    }

    /** Whether a side carries any size. */
    hasPosition(isLong: boolean): boolean {
        return this.position(isLong).notional > 0n;
    }

    /**
     * Sides this subject currently holds, in `[long, short]` order.
     *
     * Takes the {@link Market} it belongs to so the pairing is checked rather
     * than assumed — reading a user against the wrong market silently produces
     * zeroed positions, which is exactly the failure this guards.
     */
    openSides(market: Market): boolean[] {
        if (market.contracts.market !== this.state.market) {
            throw new Error(
                `market mismatch: user state is for ${this.state.market}, market is ${market.contracts.market}`,
            );
        }
        return [true, false].filter((isLong) => this.hasPosition(isLong));
    }
}
