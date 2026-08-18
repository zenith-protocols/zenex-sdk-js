/**
 * Verified oracle price consumed by the math mirrors. Ports the oracle
 * contract's `PriceData`: prices are fixed 18-dec with no
 * exponent, and `publishTime` anchors the position price floor, order
 * anti-replay, and the vault-order fill postdate gates.
 */
export interface PriceData {
    /** Data Streams stream id (the report's `feedId`), 32 bytes. */
    feedId: Buffer | Uint8Array;
    /** Best bid (18-dec), after spread reduction; the adverse close side. */
    bid: bigint;
    /** Best ask (18-dec), after spread reduction; the adverse open side. */
    ask: bigint;
    /** Unix timestamp (seconds) when the price was observed by the oracle. */
    publishTime: bigint;
}

/**
 * Trade fee split for a signed notional change on one side of the book,
 * token-dec. Ports `Market::trade_fees` and `MarketData::skew_split`. The
 * total fee charged is `base + impact`.
 */
export interface TradeFees {
    /** Portion of the fill's notional that widens the book's token imbalance. Sums with `improving` to the fill's notional. */
    worsening: bigint;
    /** Portion of the fill's notional that narrows the book's token imbalance. */
    improving: bigint;
    /** Base fee: `ceil(worsening * feeDom)` plus `ceil(improving * feeNonDom)`, both SCALAR_18 rates. */
    base: bigint;
    /** Size-quadratic impact fee on the fill's full notional, capped at 10% of it. */
    impact: bigint;
}
