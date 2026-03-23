// =============================================================================
// Zenex SDK v2 - Public API
// =============================================================================

import { rpc } from '@stellar/stellar-sdk';
import { ZenexContractType } from './base_event.js';
import type { TradingEvent } from './trading/trading_events.js';
import type { VaultEvent } from './vault/vault_events.js';
import { parseTradingEvent } from './trading/trading_events.js';
import { parseVaultEvent } from './vault/vault_events.js';

// Types - Primitives and Network
export type u32 = number;
export type i32 = number;
export type u64 = bigint;
export type i64 = bigint;
export type u128 = bigint;
export type i128 = bigint;
export type Option<T> = T | undefined;

export interface Network {
    /** RPC URL (e.g., 'https://soroban-testnet.stellar.org') */
    rpc: string;
    /** Network passphrase for tx signing (use Networks from @stellar/stellar-sdk) */
    passphrase: string;
    /** Optional RPC server options */
    opts?: rpc.Server.Options;
}

// Types - Asset
export type { Asset } from './asset.js';
export { getAssetKey, getAssetName, assetsEqual, assetToScVal, assetFromScVal, assetFromKey } from './asset.js';

// Types - Base Event
export { ZenexContractType } from './base_event.js';
export type { BaseZenexEvent } from './base_event.js';

// Union of all events
export type ZenexEvent = TradingEvent | VaultEvent;

// Trading Module
export {
    TradingContract,
    Position,
    Market,
    TradingConfig,
    ContractStatus,
    ExecuteRequestType,
    TradingEventType,
    OrderValidationError,
    parseTradingEvent,
} from './trading/index.js';

export type {
    FeeBreakdown,
    PositionPnL,
    PositionBreakdown,
    PositionData,
    ValidateOrderParams,
    GrossCollateralParams,
    GrossCollateralResult,
    MarketConfig,
    MarketData,
    TradingConfigData,
    TradingInstanceData,
    ExecuteRequest,
    PlaceLimitArgs,
    OpenMarketArgs,
    SetTriggersArgs,
    ModifyCollateralArgs,
    ExecuteArgs,
    DeployArgs,
    BaseTradingEvent,
    TradingSetConfigEvent,
    TradingSetMarketEvent,
    TradingDelMarketEvent,
    TradingSetStatusEvent,
    TradingOpenMarketEvent,
    TradingPlaceLimitEvent,
    TradingClosePositionEvent,
    TradingFillLimitEvent,
    TradingLiquidationEvent,
    TradingTakeProfitEvent,
    TradingStopLossEvent,
    TradingCancelLimitEvent,
    TradingModifyCollateralEvent,
    TradingSetTriggersEvent,
    TradingApplyFundingEvent,
    TradingADLTriggeredEvent,
    TradingEvent,
} from './trading/index.js';

// Factory Module
export {
    FactoryContract,
} from './factory/index.js';

export type {
    FactoryInitMeta,
    FactoryDeployArgs,
    FactoryConstructorArgs,
} from './factory/index.js';

// Governance Module (time-locked admin for trading)
export {
    GovernanceContract,
} from './governance/index.js';

export type {
    QueuedConfig,
    QueuedMarket,
    GovernanceConstructorArgs,
} from './governance/index.js';

// Vault Module
export {
    VaultContract,
    VaultState,
    VaultEventType,
    parseVaultEvent,
} from './vault/index.js';

export type {
    VaultStateData,
    BaseVaultEvent,
    VaultStrategyWithdrawEvent,
    VaultEvent,
} from './vault/index.js';

// Oracle
export { getOraclePrice, getOracleDecimals } from './oracle.js';
export type { PriceData } from './oracle.js';

// Events - Combined utilities
/**
 * Parse any Zenex event from RPC event response
 * Tries trading first, then vault
 */
export function parseEvent(
    eventResponse: rpc.Api.RawEventResponse
): ZenexEvent | undefined {
    const tradingEvent = parseTradingEvent(eventResponse);
    if (tradingEvent) return tradingEvent;

    const vaultEvent = parseVaultEvent(eventResponse);
    if (vaultEvent) return vaultEvent;

    return undefined;
}

/**
 * Check if an event is a trading event
 */
export function isTradingEvent(event: ZenexEvent): event is TradingEvent {
    return event.contractType === ZenexContractType.Trading;
}

/**
 * Check if an event is a vault event
 */
export function isVaultEvent(event: ZenexEvent): event is VaultEvent {
    return event.contractType === ZenexContractType.Vault;
}

// Response Parser / Errors
export {
    ContractError,
    ContractErrorType,
    parseError,
    parseResult,
} from './response_parser.js';

// Fixed-Point Math
export * as FixedMath from './math.js';

// Simulation
export { simulateAndParse } from './simulate.js';

// =============================================================================
// Browser compatibility
// =============================================================================
if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Buffer = (window as any).Buffer || Buffer;
}
