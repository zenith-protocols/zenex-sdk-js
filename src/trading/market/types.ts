export interface PriceData {
    feedId: number;
    exponent: number;
    bid: bigint;
    ask: bigint;
}

export interface TradeFees {
    worsening: bigint;
    improving: bigint;
    base: bigint;
    impact: bigint;
}
