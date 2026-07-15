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
export {
    getAssetKey,
    getAssetName,
    assetsEqual,
    assetToScVal,
    assetFromScVal,
    assetFromKey,
} from './asset.js';

// Base Event types, normalizers, and unified decoder
export {
    ZenexContractType,
    normalizeRpc,
    normalizeMercury,
    normalizeGoldsky,
    decodeEvent,
} from './base_event.js';
export type {
    BaseZenexEvent,
    NormalizedEvent,
    MercuryWebhookEvent,
    MercuryScVal,
    GoldskyWebhookEvent,
    ZenexEvent,
} from './base_event.js';

// =============================================================================
// Trading Module (v2 order -> keeper-execute contract)
// =============================================================================

export {
    // Contract binding
    TradingContract,
    // Core enums, sentinels, converters, and parsers
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
    // Position math + loader
    PositionView,
    positionPnl,
    positionEquity,
    pendingFunding,
    pendingBorrowing,
    liquidationPrice,
    unlockedNotional,
    // Market math + loader
    MarketView,
    sidePnl,
    netPnl,
    utilization,
    impactFee,
    skewSplitFees,
    // Config validation
    validateTradingConfig,
    // Events
    TradingEventType,
    decodeTradingEvent,
} from './trading/index.js';

export type {
    // Argument interfaces
    DeployArgs,
    OpenMarketArgs,
    OpenLimitArgs,
    ClosePositionArgs,
    DecreasePositionArgs,
    ModifyCollateralArgs,
    TriggerOrderArgs,
    VaultDepositArgs,
    VaultRedeemArgs,
    // Core types
    Order,
    VaultOrder,
    Position,
    SidePair,
    MarketData,
    AdlState,
    TradingConfig,
    SkewSplitFees,
    // Events
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
    TradingDeployment,
    TradingSnapshot,
    TradingSnapshotRequest,
} from './trading/index.js';

export { loadTradingSnapshot } from './trading/index.js';

// =============================================================================
// Trading Router Module (stateless batching + create-and-fill flows)
// =============================================================================

export {
    TradingRouterContract,
    callToScVal,
    createOrderCall,
    parseCallOutcome,
    UNTYPED_FAILURE,
} from './trading-router/index.js';

export type {
    Call,
    CallOutcome,
    OrderParams,
    CreateAndFillWithFeeArgs,
    MulticallWithFeeArgs,
} from './trading-router/index.js';

// =============================================================================
// Factory Module
// =============================================================================

export { FactoryContract } from './factory/index.js';

export type {
    FactoryInitMeta,
    FactoryConstructorArgs,
} from './factory/index.js';

// =============================================================================
// Governance Module (generic timelock)
// =============================================================================

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

// =============================================================================
// Price Verifier Module
// =============================================================================

export { PriceVerifierContract } from './price-verifier/index.js';

export type {
    PriceVerifierPriceData,
    PriceVerifierConstructorArgs,
} from './price-verifier/index.js';

// =============================================================================
// Treasury Module
// =============================================================================

export { TreasuryContract } from './treasury/index.js';

export type { TreasuryConstructorArgs } from './treasury/index.js';

// =============================================================================
// Smart Account Module
// =============================================================================

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

// =============================================================================
// Vault Module
// =============================================================================

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

// =============================================================================
// Errors / Response Parsing
// =============================================================================

export {
    ContractError,
    ContractErrorType,
    TradingError,
    contractErrorFromCode,
    parseError,
    parseResult,
} from './response_parser.js';
export { tradingErrorMessages } from './errors.js';

// =============================================================================
// Ledger Keys (direct storage reads)
// =============================================================================

export {
    // Generic key builders
    enumStorageKeyWithAddress,
    tokenBalanceLedgerKey,
    decodeEntryKey,
    contractInstanceLedgerKey,
    persistentLedgerKey,
    temporaryLedgerKey,
    // Trading DataKey mirrors - instance tier
    tradingConfigKey,
    tradingFeedIdKey,
    tradingExponentKey,
    tradingStatusKey,
    tradingVaultKey,
    tradingTokenKey,
    tradingPriceVerifierKey,
    tradingTreasuryKey,
    tradingDelistedAtKey,
    tradingTerminalPriceKey,
    tradingAdlKey,
    // Trading DataKey mirrors - persistent / temporary entries
    tradingMarketDataLedgerKey,
    tradingPositionLedgerKey,
    tradingVaultOrderLedgerKey,
    tradingOrderCounterLedgerKey,
    tradingClaimableFundingLedgerKey,
    tradingOrderLedgerKey,
} from './ledger-keys.js';

// Fixed-Point Math
export * as FixedMath from './math.js';

// Simulation
export { simulateAndParse } from './simulate.js';

// =============================================================================
// Exact quote, order, relay, and data boundaries
// =============================================================================

export * from './math/index.js';
export * from './quote/index.js';
export * from './market/index.js';
export * from './position/index.js';
export * from './order/index.js';
export * from './relay/index.js';

export {
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    quoteVaultDeposit,
    quoteVaultDepositFill,
    quoteVaultOrderCreation,
    quoteVaultRedeem,
    quoteVaultRedeemFill,
} from './vault/quote.js';
export {
    checkVaultWithdrawGates,
    evaluateVaultWithdrawGates,
    VaultProtocolGateError,
} from './vault/gates.js';
export type {
    ExactVaultRestingOrderCreationQuote,
    VaultAtomicState,
    VaultOrderCreationOutcome,
    VaultOrderCreationQuoteInput,
    VaultRestingOrderCreation,
    VaultRetiredImmediateRedeem,
    VaultQuoteOutcome,
    VaultQuoteContext,
    VaultDepositQuoteInput,
    VaultRedeemQuoteInput,
    VaultGateInput,
} from './vault/quote.js';
export type { VaultWithdrawHeadroom } from './vault/gates.js';

export * from './data/client.js';
export * from './data/events.js';
export * from './data/price.js';
export * from './data/resync.js';
export * from './data/trust.js';
export { decodeApiSchema, ZenexDataDecodeError } from './data/codec.js';
export {
    API_CONTRACT_PACKAGE_VERSION,
    API_CONTRACT_SOURCE_COMMIT,
    API_OPENAPI_SHA256,
    API_PACKAGE_CONTENT_SHA256,
    API_VERSION,
    API_PUBLIC_PATHS,
    ATOMIC_FIELD_POINTERS,
} from './data/generated.js';
export type {
    AccountFill,
    AccountFillQuery,
    AccountFillsResponse,
    AccountLifecycle,
    AccountLifecycleQuery,
    AccountLifecyclesResponse,
    AccountOrder,
    AccountOrderQuery,
    AccountOrdersResponse,
    AccountVaultOrderQuery,
    AccountVaultOrdersResponse,
    AtomicString,
    BaseMetadata,
    Candle,
    CandleMetadata,
    CandleQuery,
    CandlesResponse,
    Competition,
    CompetitionDetailResponse,
    CompetitionLifecycle,
    CompetitionLifecyclesResponse,
    CompetitionListQuery,
    CompetitionListResponse,
    CompetitionResponse,
    CompetitionStanding,
    CompetitionStandingsResponse,
    CompetitionState,
    ConfigMetadata,
    ConfigResponse,
    ErrorEnvelope,
    FaucetClaimResponse,
    FaucetClaimStatus,
    FaucetStatusResponse,
    FillFees,
    IndexedMetadata,
    LatestPrice,
    LatestPriceResponse,
    LeaderboardResponse,
    LifecycleFees,
    LifecyclePageQuery,
    LifecyclePageResponse,
    MarketSnapshot,
    MarketSnapshotQuery,
    MarketSnapshotsResponse,
    MarketTrade,
    MarketTradeQuery,
    MarketTradesResponse,
    OrderStatus,
    PageQuery,
    PriceMetadata,
    PriceResponse,
    PriceTickData,
    ProductMetadata,
    PublicConfig,
    PublicConfigResponse,
    RankedLifecycle,
    RankedMetadata,
    RankedStanding,
    ReferralCodeResponse,
    ReferralLookupResponse,
    ReferralStatsResponse,
    RelayMetadata,
    RelayRequestStatus,
    RelayRequestStatusResponse,
    RelayStatusResponse,
    RelaySubmitResponse,
    Resolution,
    RollingLifecyclesResponse,
    RollingStandingsResponse,
    RollingWindow,
    RouterFeeMethods,
    Side,
    StreamEvent as ZenexStreamEvent,
    UdfConfigResponse,
    UdfHistoryResponse,
    UdfQuery,
    UdfResponse,
    UdfRoute,
    UdfSearchResponse,
    UdfSymbolResponse,
    VaultOrder as IndexedVaultOrder,
    VaultOrderStatus,
    VaultOrdersResponse,
    VaultPerformance,
    VaultPerformanceQuery,
    VaultPerformanceResponse,
    RelayExecutionPolicy as ApiRelayExecutionPolicy,
    RelayRequest as ApiRelayRequest,
} from './data/generated.js';

// =============================================================================
// Browser compatibility
// =============================================================================
if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Buffer = (window as any).Buffer || Buffer;
}
