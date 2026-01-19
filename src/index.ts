// =============================================================================
// Zenex SDK v2 - Public API
// =============================================================================

// Types - Primitives and Network
export type {
    u32,
    i32,
    u64,
    i64,
    u128,
    i128,
    Option,
    Network,
} from './types/index.js';

export {
    SCALAR_7,
    SCALAR_18,
    I128_MAX,
} from './types/index.js';

// Types - Asset
export type { Asset } from './types/index.js';
export { getAssetKey, getAssetName, assetsEqual } from './types/index.js';

// Types - Trading
export {
    ContractStatus,
    PositionStatus,
    ExecuteRequestType,
} from './types/index.js';

export type {
    PositionPnL,
    PositionData,
    MarketConfig,
    MarketData,
    MarketInfo,
    TradingConfigData,
    TradingInstanceData,
    ExecuteRequest,
    OpenPositionArgs,
    SetTriggersArgs,
    ModifyCollateralArgs,
    ExecuteArgs,
    PriceData,
} from './types/index.js';

// Types - Vault
export type {
    VaultStateData,
} from './types/index.js';

// Types - Events
export {
    ZenexContractType,
    TradingEventType,
    VaultEventType,
} from './types/index.js';

export type {
    ZenexEvent,
    TradingEvent,
    VaultEvent,
    TradingOpenPositionEvent,
    TradingClosePositionEvent,
    TradingFillPositionEvent,
    TradingLiquidationEvent,
    TradingModifyRiskEvent,
    VaultStrategyWithdrawEvent,
    VaultStrategyDepositEvent,
} from './types/index.js';

// Trading Module
export { TradingContract } from './trading/index.js';
export { Position } from './trading/index.js';
export { Market } from './trading/index.js';
export { TradingConfig } from './trading/index.js';
export { Oracle } from './trading/index.js';

// Vault Module
export { VaultContract } from './vault/index.js';
export { VaultState } from './vault/index.js';

// Events
export {
    parseEvent,
    parseTradingEvent,
    parseVaultEvent,
    isTradingEvent,
    isVaultEvent,
} from './events/index.js';

// Errors
export {
    ContractError,
    ContractErrorType,
    parseError,
    parseResult,
    isContractError,
} from './errors/index.js';

// =============================================================================
// Browser compatibility
// =============================================================================
if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Buffer = (window as any).Buffer || Buffer;
}
