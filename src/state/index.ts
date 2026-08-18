// =============================================================================
// State layer: contract state read through `getLedgerEntries`.
//
// Every loader here is exactly ONE round trip. They are split by refresh clock,
// not by volatility: `Market` moves with every fill, `MarketUser` only with its
// own subject's activity, and the treasury rate effectively never.
// =============================================================================

export { Market, marketKeys } from './market.js';
export type { MarketContracts, MarketStateData } from './market.js';

export { MarketUser, marketUserKeys } from './market_user.js';
export type { MarketUserData } from './market_user.js';

export { loadTokenBalance, loadTokenBalances } from './balance.js';
export { loadTreasuryRate } from './treasury.js';

export { MarketStateError, MAX_KEYS_PER_REQUEST, readEntries } from './entries.js';
export type { EntryBatch, MarketStateFailureCode } from './entries.js';

export { marketContext } from './context.js';
export type { MarketContextInput } from './context.js';
