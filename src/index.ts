// =============================================================================
// Zenex SDK v2 - Public API
// =============================================================================

import { rpc } from '@stellar/stellar-sdk';

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

// Base Event types, normalizers, and unified decoder
export { ZenexContractType, normalizeRpc, normalizeMercury, normalizeGoldsky, decodeEvent } from './base_event.js';
export type { BaseZenexEvent, NormalizedEvent, MercuryWebhookEvent, MercuryScVal, GoldskyWebhookEvent, ZenexEvent } from './base_event.js';

// Trading Module
export {
    TradingContract,
    Position,
    Market,
    TradingConfig,
    ContractStatus,
    TradingEventType,
    OrderValidationError,
    decodeTradingEvent,
} from './trading/index.js';

export type {
    FeeBreakdown,
    PositionPnL,
    PositionBreakdown,
    PositionData,
    PositionRaw,
    ValidateOrderParams,
    GrossCollateralParams,
    GrossCollateralResult,
    MarketConfig,
    MarketData,
    TradingConfigData,
    TradingInstanceData,
    PlaceLimitArgs,
    OpenMarketArgs,
    ClosePositionArgs,
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
    TradingModifyCollateralEvent,
    TradingSetTriggersEvent,
    TradingRefundPositionEvent,
    TradingApplyFundingEvent,
    TradingADLTriggeredEvent,
    TradingEvent,
    TradingConfigArgs,
    MarketConfigArgs,
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

// Governance Module (generic timelock)
export {
    GovernanceContract,
    GovernanceEventType,
    decodeGovernanceEvent,
} from './governance/index.js';

export type {
    QueuedCall,
    GovernanceConstructorArgs,
    BaseGovernanceEvent,
    GovernanceQueuedEvent,
    GovernanceExecutedEvent,
    GovernanceCancelledEvent,
    GovernanceStatusSetEvent,
    GovernanceDelaySetEvent,
    GovernanceEvent,
} from './governance/index.js';

// Price Verifier Module
export {
    PriceVerifierContract,
} from './price-verifier/index.js';

export type {
    PriceVerifierPriceData,
    PriceVerifierConstructorArgs,
} from './price-verifier/index.js';

// Treasury Module
export {
    TreasuryContract,
} from './treasury/index.js';

export type {
    TreasuryConstructorArgs,
} from './treasury/index.js';

// Smart Account Module
export {
    SmartAccountContract,
    signerToScVal,
    contextRuleTypeToScVal,
    sessionConfigToScVal,
} from './smart-account/index.js';

export type {
    Signer as SmartAccountSigner,
    ContextRuleType,
    SessionConfig,
    AddContextRuleArgs,
} from './smart-account/index.js';

// Vault Module
export {
    VaultContract,
    VaultState,
    VaultEventType,
    decodeVaultEvent,
} from './vault/index.js';

export type {
    VaultConstructorArgs,
    VaultStateData,
    BaseVaultEvent,
    VaultStrategyWithdrawEvent,
    VaultEvent,
} from './vault/index.js';

// Oracle
export { getOraclePrice, getOracleDecimals } from './oracle.js';
export type { PriceData } from './oracle.js';

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
