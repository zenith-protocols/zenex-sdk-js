// Contract binding + its constructor arguments. Named-order helpers live in
// `src/trading/order/intents.ts`, not here -- this file is the entrypoint
// binding surface and nothing else.
export { MarketContract } from './contract.js';
export type { DeployArgs } from './contract.js';

// Core types, enums, converters, and parsers
export {
    Status,
    OrderKind,
    VaultOrderKind,
    FULL_CLOSE,
    marketConfigToScVal,
    parseSidePair,
    parseOrder,
    parseVaultOrder,
    parsePosition,
    parseMarketData,
    parseAdlState,
    parseMarketConfig,
} from './types.js';

export type {
    Order,
    VaultOrder,
    Position,
    SidePair,
    MarketData,
    AdlState,
    MarketConfig,
} from './types.js';

export { MarketEventType } from './events.js';

// Instance-storage walker (getLedgerEntries reads)
export { parseMarketInstance } from './instance.js';
export type { MarketInstanceState } from './instance.js';

// State loaders live in the trading tier (`src/trading/`): `Market.load`,
// `MarketUser.load`, `loadTreasuryRate` — plus `loadTokenBalance` in
// `src/token.ts`.

export type {
    BaseMarketEvent,
    MarketCreateOrderEvent,
    MarketCancelOrderEvent,
    MarketCreateVaultOrderEvent,
    MarketCancelVaultOrderEvent,
    MarketDepositFillEvent,
    MarketRedeemFillEvent,
    MarketClaimFundingEvent,
    MarketAdlUpdateEvent,
    MarketAccrualUpdateEvent,
    MarketStatusUpdateEvent,
    MarketConfigUpdateEvent,
    MarketTerminalPriceUpdateEvent,
    MarketOpenFillEvent,
    MarketIncreaseFillEvent,
    MarketDecreaseFillEvent,
    MarketCloseFillEvent,
    MarketLiquidationEvent,
    MarketEvent,
} from './events.js';
