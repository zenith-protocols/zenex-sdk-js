export interface VerifiedPrice {
    feedId: number;
    exponent: number;
    bid: bigint;
    ask: bigint;
    publishTime: bigint;
    source: 'pyth' | 'terminal';
}

export interface TradeFees {
    worsening: bigint;
    improving: bigint;
    base: bigint;
    impact: bigint;
}
