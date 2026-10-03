import type { PriceData } from './internal/math.js';
import type { Market } from './market.js';

/**
 * An 18-dec price the estimates are computed at, mirroring how the contracts
 * pick a side: entry at the adverse open side, exit at the adverse close side.
 *
 * A UI holds one number and builds a zero-spread price with {@link Price.from}.
 * A caller holding a verified Data Streams report constructs the full bid/ask
 * shape and the same math prices the spread.
 */
export class Price {
    constructor(
        /** Best bid (18-dec); the adverse close side for a long. */
        public bid: bigint,
        /** Best ask (18-dec); the adverse open side for a long. */
        public ask: bigint,
        /**
         * Observation time, unix seconds. Feeds the engine's time gates
         * (position price floor, anti-replay, vault-order postdate).
         */
        public publishTime: bigint,
    ) {}

    /** A zero-spread price: `bid = ask = price`. `publishTime` defaults to the wall clock. */
    static from(price: bigint, publishTime?: bigint): Price {
        return new Price(price, price, publishTime ?? wallClock());
    }

    /** The price a position opens at: the ask for a long, the bid for a short. */
    entry(isLong: boolean): bigint {
        return isLong ? this.ask : this.bid;
    }

    /** The price a position closes at: the bid for a long, the ask for a short. */
    exit(isLong: boolean): bigint {
        return isLong ? this.bid : this.ask;
    }
}

/** Accepted anywhere an estimate takes a price: a bare 18-dec bigint becomes `Price.from(value)`. */
export type PriceInput = Price | bigint;

/** @internal Unix seconds now, from the wall clock. */
export function wallClock(): bigint {
    return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * @internal The clock a quote against `market` runs at: `now`, or the wall
 * clock, but never before the market's stored accrual. The chain's ledger
 * clock cannot predate `accruedAt`, so a client clock that lags it would
 * otherwise gate a valid fill.
 */
export function quoteTime(market: Market, now?: bigint): bigint {
    const clock = now ?? wallClock();
    return clock > market.data.accruedAt ? clock : market.data.accruedAt;
}

/**
 * @internal Resolve a {@link PriceInput} to the engine's `PriceData` shape. A
 * bare bigint carries no observation time, so it takes `publishTime`, or the
 * wall clock when that is omitted.
 */
export function resolvePrice(input: PriceInput, publishTime?: bigint): PriceData {
    const price = typeof input === 'bigint' ? Price.from(input, publishTime) : input;
    return {
        bid: price.bid,
        ask: price.ask,
        publishTime: price.publishTime,
    };
}
