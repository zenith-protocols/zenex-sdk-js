import type { PriceData } from './internal/math.js';

/**
 * An 18-dec price the estimates are computed at, mirroring how the contracts
 * pick a side: entry at the adverse open side, exit at the adverse close side.
 *
 * A UI holds one number and builds a zero-spread price with {@link Price.from}.
 * A caller holding a verified Data Streams report (specter, a future bot)
 * constructs the full bid/ask shape and the same math prices the spread.
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
        const time = publishTime ?? BigInt(Math.floor(Date.now() / 1000));
        return new Price(price, price, time);
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

/** @internal Resolve a {@link PriceInput} to the engine's `PriceData` shape. */
export function resolvePrice(input: PriceInput): PriceData {
    const price = typeof input === 'bigint' ? Price.from(input) : input;
    return {
        feedId: new Uint8Array(32),
        bid: price.bid,
        ask: price.ask,
        publishTime: price.publishTime,
    };
}
