// =============================================================================
// Zenex SDK - Public API
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

// Typed event surface (types only; consumers own their decode path)
export { ZenexContractType } from './base_event.js';
export type { BaseZenexEvent, ZenexEvent } from './base_event.js';

// =============================================================================
// Trading Module (order -> keeper-execute contract)
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
    // Events
    TradingEventType,
} from './contracts/trading/index.js';

export type {
    // Argument interfaces
    DeployArgs,
    // Core types
    Order,
    VaultOrder,
    Position,
    SidePair,
    MarketData,
    AdlState,
    TradingConfig,
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
    TradingOpenFillEvent,
    TradingIncreaseFillEvent,
    TradingDecreaseFillEvent,
    TradingCloseFillEvent,
    TradingLiquidationEvent,
    TradingEvent,
    TradingInstanceState,
} from './contracts/trading/index.js';

export { parseTradingInstance } from './contracts/trading/index.js';

// =============================================================================
// State layer (getLedgerEntries reads, one round trip each)
// =============================================================================

export * from './state/index.js';

// =============================================================================
// Trading Router Module (stateless batching + create-and-fill flows)
// =============================================================================

export {
    TradingRouterContract,
    callToScVal,
    createOrderCall,
    parseCallOutcome,
    UNTYPED_FAILURE,
} from './contracts/router/index.js';

export type {
    Call,
    CallOutcome,
    OrderParams,
    CreateAndFillWithFeeArgs,
    MulticallWithFeeArgs,
} from './contracts/router/index.js';

// =============================================================================
// Factory Module
// =============================================================================

export { FactoryContract, FactoryEventType } from './contracts/factory/index.js';

export type {
    FactoryInitMeta,
    FactoryConstructorArgs,
    BaseFactoryEvent,
    FactoryDeployEvent,
    FactoryEvent,
} from './contracts/factory/index.js';

// =============================================================================
// Governance Module (generic timelock)
// =============================================================================

export {
    GovernanceContract,
    GovernanceEventType,
} from './contracts/governance/index.js';

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
} from './contracts/governance/index.js';

// =============================================================================
// Oracle Module (Chainlink Data Streams verifier)
// =============================================================================

export { OracleContract } from './contracts/oracle/index.js';

export type {
    OraclePriceData,
    OracleConstructorArgs,
} from './contracts/oracle/index.js';

// =============================================================================
// Treasury Module
// =============================================================================

export { TreasuryContract, parseTreasuryRate } from './contracts/treasury/index.js';

export type { TreasuryConstructorArgs } from './contracts/treasury/index.js';

// =============================================================================
// Vault Module
// =============================================================================

export {
    VaultContract,
    VaultEventType,
    parseVaultInstance,
} from './contracts/vault/index.js';

// Token ledger-entry reads (any holder, any token)
export {
    parseTokenBalance,
    tokenBalanceOrZero,
} from './contracts/token/index.js';

export type {
    VaultConstructorArgs,
    VaultInstanceState,
    BaseVaultEvent,
    VaultDepositEvent,
    VaultWithdrawEvent,
    VaultStrategyWithdrawEvent,
    VaultEvent,
} from './contracts/vault/index.js';

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
export { tradingErrorMessages, parseContractErrorCode } from './errors.js';

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
    tradingStatusKey,
    tradingVaultKey,
    tradingTokenKey,
    tradingOracleKey,
    tradingTreasuryKey,
    tradingDelistedAtKey,
    tradingTerminalPriceKey,
    tradingAdlKey,
    // Trading DataKey mirrors - persistent / temporary entries
    tradingMarketDataLedgerKey,
    tradingPriceCacheLedgerKey,
    tradingPositionLedgerKey,
    tradingVaultOrderLedgerKey,
    tradingOrderCounterLedgerKey,
    tradingClaimableFundingLedgerKey,
    tradingOrderLedgerKey,
} from './ledger-keys.js';

// Fixed-Point Math
export * as FixedMath from './math/index.js';

// Simulation
export { simulateAndParse } from './simulate.js';

// =============================================================================
// Exact quote and order boundaries
// =============================================================================

export * from './math/index.js';
export * from './trading/quote/index.js';
export * from './trading/market/index.js';
export * from './trading/position/index.js';
export * from './trading/order/index.js';

// =============================================================================
// Display layer (approximate floats, for rendering only)
//
// Never feed these back into a transaction: quote with the exact surfaces above
// and parse user input with `parseAtomic`. Also available namespaced as
// `Display` for call sites that want the distinction visible.
// =============================================================================

export * from './display/index.js';
export * as Display from './display/index.js';

export {
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    deriveVaultMinimumOutput,
    quoteVaultDeposit,
    quoteVaultDepositFill,
    quoteVaultOrderCreation,
    quoteVaultRedeem,
    quoteVaultRedeemFill,
} from './trading/quote/vault.js';
export {
    checkVaultWithdrawGates,
    evaluateVaultWithdrawGates,
    VaultProtocolGateError,
} from './trading/quote/vault_gates.js';
export type {
    DeriveVaultMinimumOutputInput,
    ExactVaultOrderCreationQuote,
    ExactVaultRestingOrderCreationQuote,
    VaultAtomicState,
    VaultEstimatedOutputReference,
    VaultMinimumOutput,
    VaultOrderCreationOutcome,
    VaultOrderCreationQuoteInput,
    VaultRestingOrderCreation,
    VaultRetiredImmediateRedeem,
    VaultQuoteOutcome,
    VaultQuoteContext,
    VaultDepositQuoteInput,
    VaultRedeemQuoteInput,
    VaultGateInput,
} from './trading/quote/vault.js';
export type { VaultWithdrawHeadroom } from './trading/quote/vault_gates.js';


// =============================================================================
// Browser compatibility
// =============================================================================
if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Buffer = (window as any).Buffer || Buffer;
}
