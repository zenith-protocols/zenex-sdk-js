// =============================================================================
// Trading module public surface (v2).
// =============================================================================

// Contract binding + argument interfaces
export { TradingContract } from './trading_contract.js';
export type {
    DeployArgs,
    OpenMarketArgs,
    OpenLimitArgs,
    ClosePositionArgs,
    DecreasePositionArgs,
    ModifyCollateralArgs,
    TriggerOrderArgs,
    VaultDepositArgs,
    VaultRedeemArgs,
} from './trading_contract.js';

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

// Position math + loader
export {
    PositionView,
    positionPnl,
    positionEquity,
    pendingFunding,
    pendingBorrowing,
    liquidationPrice,
    unlockedNotional,
} from './trading_position.js';

// Market math + loader
export {
    MarketView,
    sidePnl,
    netPnl,
    utilization,
    impactFee,
    skewSplitFees,
} from './trading_market.js';

export type { SkewSplitFees } from './trading_market.js';

// Config validation
export { validateTradingConfig } from './trading_config.js';

// Events (v2 event layer; matches trading/src/events.rs)
export { TradingEventType, decodeTradingEvent } from './trading_events.js';

// Coherent exact quote snapshot
export { loadTradingSnapshot } from './trading_snapshot.js';
export type {
    SubjectBoundTradingSnapshot,
    TradingDeployment,
    TradingSnapshot,
    TradingSnapshotRequest,
    TradingSnapshotSubject,
} from './trading_snapshot.js';

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
    TradingIncreaseFillEvent,
    TradingDecreaseFillEvent,
    TradingCloseFillEvent,
    TradingLiquidationEvent,
    TradingEvent,
} from './trading_events.js';
