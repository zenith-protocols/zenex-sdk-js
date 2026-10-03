// =============================================================================
// Zenex SDK - Public API
// =============================================================================

import { rpc } from '@stellar/stellar-sdk';

// Types - Primitives and Network
/** A Soroban `u32`, carried as a number. */
export type u32 = number;
/** A Soroban `i32`, carried as a number. */
export type i32 = number;
/** A Soroban `u64` (timestamps, ledger-time seconds), carried as a bigint. */
export type u64 = bigint;
/** A Soroban `i64`, carried as a bigint. */
export type i64 = bigint;
/** A Soroban `u128`, carried as a bigint. */
export type u128 = bigint;
/** A Soroban `i128` (token amounts, prices, fixed-point values), carried as a bigint. */
export type i128 = bigint;
/** A Soroban `Option<T>`: the value, or `undefined` for `None`. */
export type Option<T> = T | undefined;

/** The Stellar network every loader and simulation runs against. */
export interface Network {
    /** Stellar RPC URL: your own node, or a provider's endpoint for the network. */
    rpc: string;
    /** Network passphrase, for example `Networks.PUBLIC` (from @stellar/stellar-sdk) for mainnet. */
    passphrase: string;
    /** Options for the RPC client, such as `allowHttp` for a node reached over plain HTTP. */
    opts?: rpc.Server.Options;
}

// Typed event surface (types only; consumers own their decode path)
export { ZenexContractType } from './base_event.js';
export type { BaseZenexEvent, ZenexEvent } from './base_event.js';
export { OwnableEventType } from './contracts/ownable/index.js';
export type {
    OwnableContractType,
    BaseOwnableEvent,
    OwnershipTransferEvent,
    OwnershipTransferCompletedEvent,
    OwnershipRenouncedEvent,
    OwnableEvent,
} from './contracts/ownable/index.js';

// =============================================================================
// Market Module (order -> keeper-execute contract)
// =============================================================================

export {
    // Contract binding
    MarketContract,
    // Core enums, sentinels, converters, and parsers
    Status,
    OrderKind,
    VaultOrderKind,
    FULL_CLOSE,
    MAX_ORDERS_PER_SIDE,
    DELIST_GRACE,
    DELIST_DEADLINE,
    marketConfigToScVal,
    parseSidePair,
    parseOrder,
    parseVaultOrder,
    parsePosition,
    parseMarketData,
    parseAdlState,
    parseMarketConfig,
    // Events
    MarketEventType,
} from './contracts/market/index.js';

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
    MarketConfig,
    // Events
    BaseMarketEvent,
    MarketCreateOrderEvent,
    MarketCancelOrderEvent,
    MarketCreateVaultOrderEvent,
    MarketCancelVaultOrderEvent,
    MarketDepositFillEvent,
    MarketRedeemFillEvent,
    MarketRejectVaultOrderEvent,
    MarketClaimCreditEvent,
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
    MarketInstanceState,
} from './contracts/market/index.js';

export { parseMarketInstance } from './contracts/market/index.js';

// Instance-storage walkers, one per contract that keeps instance state.
// Each is a single ledger key holding every value below, including `Owner`.
export { instanceStorage } from './contracts/instance.js';
export type { InstanceStorage } from './contracts/instance.js';
export {
    parseOracleInstance,
    type OracleInstanceState,
} from './contracts/oracle/index.js';
export {
    parseFactoryInstance,
    type FactoryInstanceState,
} from './contracts/factory/index.js';
export {
    parseGovernanceInstance,
    type GovernanceInstanceState,
} from './contracts/governance/index.js';
export {
    parseTreasuryInstance,
    type TreasuryInstanceState,
} from './contracts/treasury/index.js';

// =============================================================================
// State reads (getLedgerEntries, one round trip each)
// =============================================================================

export { MarketStateError } from './entries.js';
export type { MarketStateFailureCode } from './entries.js';

// =============================================================================
// Market Router Module (stateless batching + create-and-fill flows)
// =============================================================================

export {
    MarketRouterContract,
    callToScVal,
    createOrderCall,
    parseCallOutcome,
    UNTYPED_FAILURE,
} from './contracts/router/index.js';

export type {
    Call,
    CallOutcome,
    OrderParams,
} from './contracts/router/index.js';

export {
    FeeForwarderContract,
    FeeForwarderEventType,
} from './contracts/fee_forwarder/index.js';

export type {
    ForwardTarget,
    RelayFee,
    BaseFeeForwarderEvent,
    FeeForwarderFeeCollectedEvent,
    FeeForwarderEvent,
} from './contracts/fee_forwarder/index.js';

// =============================================================================
// Factory Module
// =============================================================================

export { FactoryContract, FactoryEventType } from './contracts/factory/index.js';

export type {
    FactoryInitMeta,
    FactoryConstructorArgs,
    BaseFactoryEvent,
    FactoryDeployEvent,
    FactoryInitMetaUpdateEvent,
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
export { OracleEventType } from './contracts/oracle/index.js';

export type {
    OraclePriceData,
    OracleConstructorArgs,
    BaseOracleEvent,
    OracleStalenessUpdateEvent,
    OracleSpreadReductionUpdateEvent,
    OracleEvent,
} from './contracts/oracle/index.js';

// =============================================================================
// Treasury Module
// =============================================================================

export { TreasuryContract, parseTreasuryRate } from './contracts/treasury/index.js';
export { TreasuryEventType } from './contracts/treasury/index.js';

export type { TreasuryConstructorArgs } from './contracts/treasury/index.js';
export type {
    BaseTreasuryEvent,
    TreasuryWithdrawEvent,
    TreasuryRateUpdateEvent,
    TreasuryEvent,
} from './contracts/treasury/index.js';

// =============================================================================
// Vault Module
// =============================================================================

export {
    VaultContract,
    VaultEventType,
    parseVaultInstance,
} from './contracts/vault/index.js';



export type {
    VaultConstructorArgs,
    VaultInstanceState,
    BaseVaultEvent,
    VaultDepositEvent,
    VaultWithdrawEvent,
    VaultStrategyWithdrawEvent,
    VaultTransferEvent,
    VaultApproveEvent,
    VaultEvent,
} from './contracts/vault/index.js';

// =============================================================================
// Errors / Response Parsing
// =============================================================================

export {
    ZenexError,
    ZenexErrorCode,
    zenexErrorFromCode,
    parseError,
    parseResult,
} from './response_parser.js';
export { parseContractErrorCode } from './errors.js';

// =============================================================================
// Ledger Keys (direct storage reads)
// =============================================================================

export {
    enumStorageKeyWithAddress,
    decodeEntryKey,
    contractInstanceLedgerKey,
    persistentLedgerKey,
    temporaryLedgerKey,
} from './contracts/keys.js';
export {
    marketDataLedgerKey,
    marketPriceCacheLedgerKey,
    marketPositionLedgerKey,
    marketVaultOrderLedgerKey,
    marketOrderCounterLedgerKey,
    marketClaimableCreditLedgerKey,
    marketOrderLedgerKey,
} from './contracts/market/keys.js';

// Token reads. Any holder, any token. Not a Zenex contract binding.
export * from './token.js';

// Fixed-Point Math
export * as FixedMath from './math/index.js';

// Simulation
export { simulateAndParse } from './simulate.js';

// =============================================================================
// Market tier: loaded chain objects, order intents, and float estimates.
// Estimates render approximate numbers for display only; never feed a float
// back into a transaction — parse user input with `parseAtomic`.
// =============================================================================

export * from './math/index.js';
export * from './trading/index.js';
