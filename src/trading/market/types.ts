/**
 * Verified oracle price consumed by the math mirrors. Ports the oracle
 * contract's `PriceData` (oracle/src/lib.rs): prices are fixed 18-dec with no
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

export interface TradeFees {
    worsening: bigint;
    improving: bigint;
    base: bigint;
    impact: bigint;
}
