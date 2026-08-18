// =============================================================================
// Trading module public surface.
// =============================================================================

// Contract binding + its constructor arguments. Named-order helpers live in
// `src/trading/order/intents.ts`, not here -- this file is the entrypoint
// binding surface and nothing else.
export { TradingContract } from './trading_contract.js';
export type { DeployArgs } from './trading_contract.js';

// Core types, enums, converters, and parsers
export {
    Status,
    OrderKind,
    VaultOrderKind,
    FULL_CLOSE,
    tradingConfigToScVal,
    parseSidePair,
    parseOrder,
    parseVaultOrder,
    parsePosition,
    parseMarketData,
    parseAdlState,
    parseTradingConfig,
} from './trading_types.js';

export type {
    Order,
    VaultOrder,
    Position,
    SidePair,
    MarketData,
    AdlState,
    TradingConfig,
} from './trading_types.js';

export { TradingEventType } from './trading_events.js';

// Instance-storage walker (getLedgerEntries reads)
export { parseTradingInstance } from './trading_instance.js';
export type { TradingInstanceState } from './trading_instance.js';

// State loaders live in `src/state/` — `Market.load`, `MarketUser.load`,
// `loadTokenBalance`, `loadTreasuryRate`.

export type {
    BaseTradingEvent,
    TradingCreateOrderEvent,
    TradingCancelOrderEvent,
    TradingCreateVaultOrderEvent,
    TradingCancelVaultOrderEvent,
    TradingDepositFillEvent,
    TradingRedeemFillEvent,
    TradingClaimFundingEvent,
    TradingAdlUpdateEvent,
    TradingFundingAccrualEvent,
    TradingBorrowingAccrualEvent,
    TradingStatusUpdateEvent,
    TradingConfigUpdateEvent,
    TradingTerminalPriceUpdateEvent,
    TradingOpenFillEvent,
    TradingIncreaseFillEvent,
    TradingDecreaseFillEvent,
    TradingCloseFillEvent,
    TradingLiquidationEvent,
    TradingEvent,
} from './trading_events.js';
