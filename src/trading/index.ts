// The trading domain: loaded chain objects (Market, MarketUser,
// MarketPosition), the order intents, and the float estimate tier. The
// exact fill engine lives under ./internal/ and is deliberately NOT
// re-exported here; it is reachable for advanced callers but carries no
// API promises.

export { loadTreasuryInstance, loadTreasuryRate } from './treasury.js';
export { Price } from './price.js';
export type { PriceInput } from './price.js';
export { Market } from './market.js';
export type { MarketContracts } from './market.js';
export { MarketUser } from './user.js';
export type { PendingOrder } from './user.js';
export { MarketPosition } from './position.js';
export {
    OrderIntent,
    maxMarginForBalance,
    previewOrder,
    isDecreaseOrderKind,
    isIncreaseOrderKind,
    isMarketOrderKind,
    isTriggerOrderKind,
    orderPriceBound,
} from './order.js';
export type { OrderEstimate } from './order.js';
export { estimateMarket } from './market_est.js';
export type { MarketEstimate, SideRatesEstimate } from './market_est.js';
export { estimatePosition } from './position_est.js';
export type { PositionEstimate } from './position_est.js';
export { VaultOrderIntent } from './vault_order.js';
