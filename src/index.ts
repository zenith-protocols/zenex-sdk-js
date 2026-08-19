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
    MarketClaimFundingEvent,
    MarketAdlUpdateEvent,
    MarketFundingAccrualEvent,
    MarketBorrowingAccrualEvent,
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
    MarketError,
    contractErrorFromCode,
    parseError,
    parseResult,
} from './response_parser.js';
export { marketErrorMessages, parseContractErrorCode } from './errors.js';

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
    marketClaimableFundingLedgerKey,
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


// =============================================================================
// Browser compatibility
// =============================================================================
if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Buffer = (window as any).Buffer || Buffer;
}
