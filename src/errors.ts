/**
 * Non-market contract error codes: Soroban host and transaction codes, plus
 * the shared, token, vault, oracle, strategy-vault, governance, treasury and
 * fee-abstraction domains, plus the shared admin and OpenZeppelin
 * ownable/role-transfer domains. Market codes (700-772) live in `MarketError`
 * instead. Resolve a raw code with `contractErrorFromCode`. Do not match on
 * codes in this enum directly.
 */
export enum ContractErrorType {
    UnknownError = -1000,

    // Transaction Submission Errors
    txSorobanInvalid = -24,
    txMalformed = -23,
    txBadMinSeqAgeOrGap = -22,
    txBadSponsorship = -21,
    txFeeBumpInnerFailed = -20,
    txNotSupported = -19,
    txInternalError = -18,
    txBadAuthExtra = -17,
    txInsufficientFee = -16,
    txNoAccount = -15,
    txInsufficientBalance = -14,
    txBadAuth = -13,
    txBadSeq = -12,
    txMissingOperation = -11,
    txTooLate = -10,
    txTooEarly = -9,

    // Host Function Errors
    InvokeHostFunctionInsufficientRefundableFee = -5,
    InvokeHostFunctionEntryArchived = -4,
    InvokeHostFunctionResourceLimitExceeded = -3,
    InvokeHostFunctionTrapped = -2,
    InvokeHostFunctionMalformed = -1,

    // Common Errors
    InternalError = 1,
    OperationNotSupportedError = 2,
    AlreadyInitializedError = 3,
    UnauthorizedError = 4,
    AuthenticationError = 5,
    AccountMissingError = 6,
    AccountIsNotClassic = 7,
    NegativeAmountError = 8,
    AllowanceError = 9,
    BalanceError = 10,
    BalanceDeauthorizedError = 11,
    OverflowError = 12,
    TrustlineMissingError = 13,

    // FungibleTokenError (100-114)
    InsufficientBalance = 100,
    InsufficientAllowance = 101,
    InvalidLiveUntilLedger = 102,
    LessThanZero = 103,
    FungibleMathOverflow = 104,
    UnsetMetadata = 105,
    ExceededCap = 106,
    InvalidCap = 107,
    CapNotSet = 108,
    SACNotSet = 109,
    SACAddressMismatch = 110,
    SACMissingFnParam = 111,
    SACInvalidFnParam = 112,
    UserNotAllowed = 113,
    UserBlocked = 114,

    // VaultTokenError (400-410)
    VaultAssetAddressNotSet = 400,
    VaultAssetAddressAlreadySet = 401,
    VaultVirtualDecimalsOffsetAlreadySet = 402,
    VaultInvalidAssetsAmount = 403,
    VaultInvalidSharesAmount = 404,
    VaultExceededMaxDeposit = 405,
    VaultExceededMaxMint = 406,
    VaultExceededMaxWithdraw = 407,
    VaultExceededMaxRedeem = 408,
    VaultMaxDecimalsOffsetExceeded = 409,
    VaultMathOverflow = 410,

    // Market Errors (700-772): kept out of this flat enum. Decode market
    // errors with the dedicated `MarketError` enum instead (it mirrors
    // the contract's `MarketError` exactly; see below). `contractErrorFromCode` falls
    // through to it automatically.

    // Shared admin (600): raised with the same name and meaning by every
    // upgradeable contract (market, oracle, factory), so the bare code
    // still names one condition.
    UpgradeNotOwner = 600,

    // Oracle Errors (780-793): the oracle owns the 78x/79x domain inherited
    // from the price-verifier it replaces. Codes whose semantics carried over
    // keep their numbers (780-783, 790, 793); the Lazer parser block
    // (784-789) is retired, with 784 reassigned to the report-expiry reject
    // that replaced that machinery.
    OracleInvalidData = 780,
    OracleInvalidPrice = 781,
    OraclePriceStale = 782,
    OracleInvalidStaleness = 783,
    OracleReportExpired = 784,
    OracleInvalidSpreadReduction = 785,
    OracleFeedMismatch = 790,
    OraclePriceAhead = 793,

    // Strategy Vault Errors (800-801)
    StrategyInvalidAmount = 800,
    StrategyPnlExceedsAssets = 801,

    // Governance Errors (810-812)
    GovNotQueued = 810,
    GovNotUnlocked = 811,
    GovInvalidDelay = 812,

    // Treasury Errors (900)
    TreasuryInvalidRate = 900,

    // OwnableError (2100-2102): OpenZeppelin ownable, raised by every
    // owner-gated contract.
    OwnerNotSet = 2100,
    OwnershipTransferInProgress = 2101,
    OwnerAlreadySet = 2102,

    // RoleTransferError (2200-2203): OpenZeppelin two-step ownership
    // transfer machinery.
    NoPendingTransfer = 2200,
    TransferInvalidLiveUntilLedger = 2201,
    InvalidPendingAccount = 2202,
    TransferExpired = 2203,

    // Fee Abstraction Errors (5000-5006)
    // Emitted by OpenZeppelin's stellar-fee-abstraction library inside the
    // market router (the relay's fee-bump gateway); mirrored so relay
    // simulations decode end-to-end.
    FeeTokenNotAllowed = 5000,
    FeeTokenAlreadyAllowed = 5001,
    TokenCountOverflow = 5002,
    FeeAbstractionInvalidFeeBounds = 5003,
    NoTokensToSweep = 5004,
    FeeAbstractionInvalidUser = 5005,
    FeeAbstractionInvalidExpirationLedger = 5006,
}

const errorMessages: Record<number, string> = {
    [-1000]: 'Unknown contract error',

    // Transaction
    [-24]: 'Transaction contains invalid Soroban operations',
    [-23]: 'Transaction is malformed',
    [-22]: 'Minimum sequence age or gap not met',
    [-21]: 'Bad sponsorship configuration',
    [-20]: 'Fee bump inner transaction failed',
    [-19]: 'Transaction type not supported',
    [-18]: 'Internal transaction processing error',
    [-17]: 'Extra auth entries not allowed',
    [-16]: 'Fee is below the network minimum',
    [-15]: 'Source account does not exist',
    [-14]: 'Insufficient balance to cover fees and operations',
    [-13]: 'Transaction authentication failed',
    [-12]: 'Bad sequence number; account may have pending transactions',
    [-11]: 'Transaction has no operations',
    [-10]: 'Transaction submitted after its validity window',
    [-9]: 'Transaction submitted before its validity window',

    // Host Function
    [-5]: 'Insufficient refundable fee for host function execution',
    [-4]: 'Contract entry has been archived; restore it first',
    [-3]: 'Resource limit exceeded (CPU, memory, or storage)',
    [-2]: 'Host function trapped; contract panicked',
    [-1]: 'Malformed host function invocation',

    // Common
    [1]: 'Unauthorized caller or internal contract error',
    [2]: 'Operation not supported by this contract',
    [3]: 'Contract is already initialized',
    [4]: 'Caller is not authorized for this operation',
    [5]: 'Authentication failed',
    [6]: 'Account not found',
    [7]: 'Account is not a classic Stellar account',
    [8]: 'Amount must be non-negative',
    [9]: 'Allowance is insufficient for this operation',
    [10]: 'Insufficient token balance',
    [11]: 'Balance is deauthorized',
    [12]: 'Arithmetic overflow',
    [13]: 'Required trustline is missing',

    // FungibleToken
    [100]: 'Insufficient token balance',
    [101]: 'Insufficient allowance',
    [102]: 'Invalid live_until_ledger value',
    [103]: 'Amount must be non-negative',
    [104]: 'Token math overflow',
    [105]: 'Token metadata not set',
    [106]: 'Token cap exceeded',
    [107]: 'Invalid token cap value',
    [108]: 'Token cap not set',
    [109]: 'Stellar Asset Contract address not set',
    [110]: 'Stellar Asset Contract address mismatch',
    [111]: 'Missing SAC function parameter',
    [112]: 'Invalid SAC function parameter',
    [113]: 'User not allowed',
    [114]: 'User is blocked',

    // VaultToken
    [400]: 'Vault asset address not set',
    [401]: 'Vault asset address already set',
    [402]: 'Vault decimals offset already set',
    [403]: 'Invalid asset amount for vault operation',
    [404]: 'Invalid shares amount for vault operation',
    [405]: 'Deposit exceeds maximum allowed',
    [406]: 'Mint exceeds maximum allowed',
    [407]: 'Withdrawal exceeds maximum allowed',
    [408]: 'Redemption exceeds maximum allowed',
    [409]: 'Decimals offset exceeds maximum (10)',
    [410]: 'Vault math overflow',

    // Market: the market messages live in `marketErrorMessages` below
    // and resolve through the dedicated `MarketError` enum (see the note in
    // ContractErrorType above).

    // Oracle
    [780]: 'Verified report body failed decoding',
    [781]: 'Non-positive price side, crossed book (bid > ask), or int192 overflow',
    [782]: 'Price observation is older than the selected staleness window (trade_staleness for fills, close_staleness for gap-closing calls)',
    [783]: 'Staleness pair violates 3 <= trade_staleness <= 15 or trade_staleness <= close_staleness <= 120 seconds',
    [784]: 'Ledger clock has passed the report expiresAt',
    [785]: 'spread_reduction_factor outside [0, SCALAR_18]',
    [790]: 'Report prices a different stream than the feed anchor',
    [793]: 'Report validity window not open, or observation more than trade_staleness ahead of the ledger clock (the forward allowance never widens with the call class)',

    // Strategy Vault
    [800]: 'Invalid amount for strategy operation',
    [801]: 'Strategy withdrawal exceeds the vault assets',

    // Governance
    [810]: 'Queued call not found or has expired',
    [811]: 'Timelock delay has not yet passed',
    [812]: 'Invalid delay value (must be between 1 second and 60 days)',

    // Shared admin
    [600]: 'upgrade called by an operator that is not the contract owner',

    // Treasury
    [900]: 'Fee rate out of range (must be between 0 and 50%)',

    // Ownable
    [2100]: 'Contract owner is not set',
    [2101]: 'An ownership transfer is already in progress',
    [2102]: 'Contract owner is already set',

    // Role transfer
    [2200]: 'No matching pending ownership transfer',
    [2201]: 'Invalid live_until_ledger for the ownership transfer',
    [2202]: 'Caller is not the pending owner',
    [2203]: 'The pending ownership transfer has expired',

    // Fee Abstraction (OpenZeppelin stellar-fee-abstraction)
    [5000]: 'Fee token is not on the allowlist',
    [5001]: 'Fee token is already on the allowlist',
    [5002]: 'Fee token count overflow',
    [5003]: 'Relayer fee is outside the signed fee bounds',
    [5004]: 'No tokens to sweep',
    [5005]: 'Invalid user for fee abstraction',
    [5006]: 'Invalid expiration ledger for fee abstraction',
};

/**
 * An error decoded from a failed contract call or RPC response. `type`
 * carries the numeric code. The message defaults to the code's entry in
 * `errorMessages` or `marketErrorMessages`, or a fallback string when the
 * code is not recognized.
 */
export class ContractError extends Error {
    public type: ContractErrorType | MarketError;

    constructor(type: ContractErrorType | MarketError, message?: string) {
        super(message ?? errorMessages[type] ?? `Contract error ${type}`);
        this.type = type;
    }
}

/**
 * Resolve a raw on-chain error code to a ContractError.
 *
 * The per-contract code namespaces are disjoint (shared admin 600,
 * market 700-772, oracle 780-793, strategy-vault 800-801,
 * governance 810-812, treasury 900, ownable 2100-2102, role transfer
 * 2200-2203, fee-abstraction 5000-5006), so every code resolves without a
 * hint: from the merged `ContractErrorType` first, then the standalone
 * `MarketError` enum.
 */
export function contractErrorFromCode(code: number): ContractError {
    if (code in ContractErrorType) {
        return new ContractError(code as ContractErrorType);
    }
    if (code in MarketError) {
        return new ContractError(code as MarketError, marketErrorMessages[code]);
    }
    return new ContractError(ContractErrorType.UnknownError);
}

// Soroban contract error codes are u32; anything larger is not a real code.
const MAXIMUM_ERROR_CODE = 4_294_967_295;

// Strictly the host's `Error(Contract, #N)` shape. Bare `#N` fragments in
// diagnostics are NOT trusted as contract codes.
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d{1,10})\)/;

/**
 * The contract error code inside a raw RPC simulation or diagnostic string,
 * or `undefined` when the strict `Error(Contract, #N)` shape is absent or the
 * number is not a valid u32. Feed the result to `contractErrorFromCode`.
 */
export function parseContractErrorCode(rpcError: string): number | undefined {
    const match = CONTRACT_ERROR_PATTERN.exec(rpcError);
    if (match?.[1] === undefined) return undefined;
    const code = Number(match[1]);
    return Number.isSafeInteger(code) && code <= MAXIMUM_ERROR_CODE ? code : undefined;
}

/**
 * MarketError - exact mirror of the contract's `MarketError` enum.
 *
 * Kept as its own enum so the market domain (the largest error surface)
 * mirrors it one-to-one; `contractErrorFromCode` resolves market
 * codes through it automatically.
 */
export enum MarketError {
    // --- config / construction ---
    /** A config value is out of bounds, or a range/ordering invariant is violated. */
    InvalidConfig = 700,
    /** Flat settlement price is not strictly positive. */
    InvalidPrice = 701,
    /** Illegal status transition, or the action requires a different operational status. */
    InvalidStatus = 702,
    /** An accrual-rate parameter (borrowing or funding) changed without a same-ledger `accrue`. */
    MarketNotAccrued = 703,
    /** Action halted by the operational status: `Frozen`, or `Retired` on the market paths. */
    MarketFrozen = 704,
    /** An `Increase` was executed while the market does not accept opens. */
    IncreaseHalted = 705,
    /** Retirement attempted while positions remain open. */
    MarketNotCleared = 706,

    // --- general ---
    /** A number that must be non-negative is negative. */
    NegativeValueNotAllowed = 710,

    // --- position sizing / margin ---
    /** Resulting position notional is below `min_position_notional`. */
    NotionalBelowMinimum = 711,
    /** Position notional (or an increase delta) exceeds `max_position_notional`. */
    NotionalAboveMaximum = 712,
    /** Equity below the initial-margin floor (open, increase, or withdraw). */
    InsufficientMargin = 713,
    /** Open interest would exceed the utilization cap. */
    UtilizationExceeded = 714,
    /** A side's open interest would exceed the `max_open_interest` ceiling. */
    OpenInterestExceeded = 715,

    // --- position lifecycle ---
    /** No position exists for `(user, is_long)`. */
    PositionNotFound = 720,
    /** Requested close exceeds the position's unlocked notional. */
    NotionalLocked = 721,
    /** Liquidation attempted while equity is still above maintenance margin. */
    NotLiquidatable = 722,
    /** Decrease or ADL attempted while settled equity is below maintenance
     * margin: a liquidatable position's only legal transition is `liquidate`. */
    PositionLiquidatable = 723,

    // --- orders / price ---
    /** No keeper order exists for `(user, id)`. */
    OrderNotFound = 730,
    /** Order `expiration` is behind the current ledger sequence. */
    OrderExpired = 731,
    /** Delta pair is not an allowed combination, a moved value is below its dust
     * floor, a trigger kind carries a non-positive `trigger_price`, or an
     * increase's `margin + exec_fee` escrow sum overflows. */
    InvalidOrder = 732,
    /** A side already holds `MAX_ORDERS_PER_SIDE` pending decrease orders. */
    TooManyOrders = 733,
    /** An order or vault-order `kind` discriminant is not a known variant. */
    UnknownKind = 734,
    /** Verified price predates the position or order (anti-replay). */
    StalePrice = 740,
    /** Fill price is worse than the order's `price_bound`. */
    PriceBoundExceeded = 741,
    /** Order `trigger_price` has not been crossed at the verified price. */
    TriggerNotMet = 742,

    // --- vault orders ---
    /** No vault order exists for `(user, id)`. */
    VaultOrderNotFound = 750,
    /** Vault order filled before its kind's lock cooldown elapsed. */
    VaultOrderLocked = 751,
    /** Vault order fill returned less than the order's `min_out`. */
    MinOutNotMet = 752,
    /** Deposit fill would push the vault balance above `max_vault_balance`. */
    VaultBalanceExceeded = 753,
    /** Redeem fill while a side's pending PnL exceeds `max_pnl_withdraw` of
     * half the post-redeem vault balance. */
    PendingPnlExceeded = 754,
    /** A settlement's vault draw exceeds the vault's balance. */
    VaultInsolvent = 755,

    // --- funding ---
    /** Claim attempted with no claimable funding balance. */
    NothingToClaim = 760,

    // --- ADL ---
    /** ADL execution attempted while the PnL ratio is at or below the trigger. */
    AdlNotTriggered = 770,
    /** ADL close left the side's pending PnL under the clear target. */
    AdlOvershoot = 771,
    /** ADL close did not reduce the side's pending PnL. */
    AdlNotEligible = 772,
}

/** Human-readable messages for the MarketError codes. */
export const marketErrorMessages: Record<number, string> = {
    [700]: 'Market config value out of bounds or invariant violated',
    [701]: 'Flat settlement price is not strictly positive',
    [702]: 'Illegal status transition or action requires a different status',
    [703]: 'Borrowing or funding rate changed without a same-ledger accrue',
    [704]: 'Action halted by operational status (Frozen, or Retired on the market paths)',
    [705]: 'Increase executed while the market does not accept opens',
    [706]: 'Retirement attempted while positions remain open',
    [710]: 'A number that must be non-negative is negative',
    [711]: 'Resulting position notional is below min_position_notional',
    [712]: 'Position notional exceeds max_position_notional',
    [713]: 'Equity below the initial-margin floor',
    [714]: 'Open interest would exceed the utilization cap',
    [715]: 'Open interest would exceed the max_open_interest ceiling',
    [720]: 'No position exists for (user, is_long)',
    [721]: 'Requested close exceeds the unlocked notional',
    [722]: 'Liquidation attempted while equity is above maintenance margin',
    [723]: 'Decrease or ADL attempted on a liquidatable position (equity below maintenance margin)',
    [730]: 'No keeper order exists for (user, id)',
    [731]: 'Order expiration is behind the current ledger sequence',
    [732]: 'Invalid order (no-op shape, dust floor, missing trigger price, or escrow-sum overflow)',
    [733]: 'Side already holds the maximum pending decrease orders',
    [734]: 'Order kind discriminant is not a known variant',
    [740]: 'Verified price predates the position or order (anti-replay)',
    [741]: 'Fill price is worse than the order price_bound',
    [742]: 'Order trigger_price has not been crossed at the verified price',
    [750]: 'No vault order exists for (user, id)',
    [751]: 'Vault order filled before its lock cooldown elapsed',
    [752]: 'Vault order fill returned less than the order min_out',
    [753]: 'Deposit fill would push the vault balance above max_vault_balance',
    [754]: 'Redeem fill would leave pending PnL above the max_pnl_withdraw gate',
    [755]: 'Settlement vault draw exceeds the vault balance',
    [760]: 'Claim attempted with no claimable funding balance',
    [770]: 'ADL execution attempted while the PnL ratio is at or below the trigger',
    [771]: 'ADL close left the pending PnL under the clear target',
    [772]: 'ADL close did not reduce the pending PnL',
};
