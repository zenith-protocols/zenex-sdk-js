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
    /**
     * Long side. Zeroed when never opened. An entry evicted after its TTL
     * archived also reads as zeroed, so a zeroed side is not always proof the
     * side was never opened.
     */
    readonly long: Position;
    /** Short side. See {@link MarketUserData.long} for the zeroed case. */
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

    // An absent Position is ambiguous: never opened, or TTL-archived and
    // evicted. `getLedgerEntries` cannot see an evicted entry, but a
    // simulation can (`rpc.Api.isSimulationRestore`).
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

    /**
     * Read one subject's state. One `getLedgerEntries`, four keys.
     *
     * @throws {MarketStateError} `MISSING_STATE` when a returned entry's TTL
     *   has lapsed.
     */
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
     * request order.
     *
     * @throws {MarketStateError} `MISSING_STATE` when a returned entry's TTL
     *   has lapsed.
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
     * than assumed. Reading a user against the wrong market would otherwise
     * silently produce zeroed positions, which is exactly the failure this
     * guards against.
     *
     * @throws {Error} When `market` is not the market this user state was
     *   read from.
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
