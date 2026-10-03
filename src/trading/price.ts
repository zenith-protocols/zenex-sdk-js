import { SCALAR_18, mulDivFloor } from '../math/fixed.js';
import type { PriceData } from './internal/math.js';
import type { Market } from './market.js';

/**
 * An 18-dec price the estimates are computed at, mirroring how the contracts
 * pick a side: entry at the adverse open side, exit at the adverse close side.
 *
 * `bid` and `ask` must be the oracle-verified sides, after its spread
 * reduction. The stored `PriceCache` and a `verify_price` result already are.
 * A raw Data Streams report is not: build it with {@link Price.fromReport}
 * or `Market.priceFromReport`. The SDK cannot tell raw sides from reduced
 * ones, so it never narrows a plain `bid`/`ask` itself.
 */
export class Price {
    constructor(
        /** Best bid (18-dec), post-reduction; the adverse close side for a long. */
        public bid: bigint,
        /** Best ask (18-dec), post-reduction; the adverse open side for a long. */
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

    /**
     * The price the chain fills at for a raw Data Streams report: `bid` and
     * `ask` as the report carries them (18-dec), narrowed by the oracle's
     * `spreadReductionFactor` exactly as {@link reduceSpread} does.
     *
     * @param publishTime The report's observation time, unix seconds.
     * @param spreadReductionFactor SCALAR_18, `Market.spreadReductionFactor`.
     * @throws {RangeError} as {@link reduceSpread}.
     */
    static fromReport(
        bid: bigint,
        ask: bigint,
        publishTime: bigint,
        spreadReductionFactor: bigint,
    ): Price {
        const reduced = reduceSpread(bid, ask, spreadReductionFactor);
        return new Price(reduced.bid, reduced.ask, publishTime);
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

/**
 * Narrow a raw report's `bid` and `ask` toward their midpoint, as the oracle
 * does before the market reads a price. `factor` is SCALAR_18: `0` leaves
 * both sides unchanged, and `SCALAR_18` sets both to `bid + (ask - bid) / 2`.
 * Any other factor moves each side inward by
 * `floor(floor((ask - bid) / 2) * factor / SCALAR_18)`.
 *
 * @throws {RangeError} if a side is not positive, `bid` is above `ask`, or
 *   `factor` is outside `[0, SCALAR_18]`. The oracle rejects such a report
 *   (#781) or such a factor (#785).
 */
export function reduceSpread(
    bid: bigint,
    ask: bigint,
    factor: bigint,
): { bid: bigint; ask: bigint } {
    if (bid <= 0n || ask <= 0n || bid > ask) {
        throw new RangeError('report bid and ask must be positive with bid <= ask');
    }
    if (factor < 0n || factor > SCALAR_18) {
        throw new RangeError('spread reduction factor must be in [0, SCALAR_18]');
    }
    if (factor === 0n) return { bid, ask };
    if (factor === SCALAR_18) {
        const mid = bid + (ask - bid) / 2n;
        return { bid: mid, ask: mid };
    }
    const cut = mulDivFloor((ask - bid) / 2n, factor, SCALAR_18);
    return { bid: bid + cut, ask: ask - cut };
}

/**
 * Accepted anywhere an estimate takes a price: a bare 18-dec bigint is a
 * zero-spread price. Like {@link Price}, it must be a post-reduction value.
 */
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

/**
 * @internal The price `market` acts on at `ledgerTime`. Once the market holds
 * a terminal price, that is both sides, observed at `ledgerTime`, and `input`
 * is ignored, exactly as the contract prices a wind-down. Otherwise `input`,
 * a bare bigint stamped at `stamp`.
 */
export function marketPrice(
    market: Market,
    input: PriceInput,
    ledgerTime: bigint,
    stamp: bigint = ledgerTime,
): PriceData {
    const terminal = market.terminalPrice;
    if (terminal !== undefined) {
        return { bid: terminal, ask: terminal, publishTime: ledgerTime };
    }
    return resolvePrice(input, stamp);
}
