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

    // Trading Errors (v1, 700-760): removed. The v2 trading contract's error
    // range (700-772) overlaps with GovernanceError (770-772) below, so trading
    // errors can no longer be safely merged into this flat cross-contract enum.
    // Decode trading errors with the dedicated `TradingError` enum instead (it
    // mirrors trading/src/errors.rs exactly; see below).

    // Governance Errors (770-772)
    GovNotQueued = 770,
    GovNotUnlocked = 771,
    GovInvalidDelay = 772,

    // Price Verifier Errors (780-791). 790 (FeedNotFound) and 791 (WrongExponent)
    // are intentionally absent: they collide with StrategyInvalidAmount (790) and
    // SharesLocked (791) in the Strategy Vault section below, and this flat enum
    // cannot hold both meanings for one number.
    PVInvalidData = 780,
    PVInvalidPrice = 781,
    PVPriceStale = 782,
    PVInvalidStaleness = 783,
    PVTruncatedData = 784,
    PVInvalidPayloadLength = 785,
    PVInvalidPayloadMagic = 786,
    PVInvalidChannel = 787,
    PVInvalidProperty = 788,
    PVInvalidMarketSession = 789,

    // Strategy Vault Errors (790-793)
    StrategyInvalidAmount = 790,
    SharesLocked = 791,
    UnauthorizedStrategy = 792,
    BelowMinDeposit = 793,

    // Treasury Errors (900)
    TreasuryInvalidRate = 900,
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
    [-12]: 'Bad sequence number — account may have pending transactions',
    [-11]: 'Transaction has no operations',
    [-10]: 'Transaction submitted after its validity window',
    [-9]: 'Transaction submitted before its validity window',

    // Host Function
    [-5]: 'Insufficient refundable fee for host function execution',
    [-4]: 'Contract entry has been archived — restore it first',
    [-3]: 'Resource limit exceeded (CPU, memory, or storage)',
    [-2]: 'Host function trapped — contract panicked',
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

    // Trading: v1 messages removed. The v2 trading messages live in
    // `tradingErrorMessages` below and resolve through the dedicated
    // `TradingError` enum (see the note in ContractErrorType above).

    // Governance
    [770]: 'Queued call not found or has expired',
    [771]: 'Timelock delay has not yet passed',
    [772]: 'Invalid delay value — must be between 1 second and 60 days',

    // Price Verifier
    [780]: 'Price update signature or format is invalid',
    [781]: 'Price confidence exceeds bounds or required fields missing',
    [782]: 'Price update is stale (exceeds max staleness threshold)',
    [783]: 'max_staleness exceeds MAX_STALENESS_SECONDS cap (15)',
    [784]: 'Price update payload is truncated',
    [785]: 'Price update payload has trailing bytes (invalid length)',
    [786]: 'Price update payload magic number is invalid',
    [787]: 'Price update payload channel is invalid',
    [788]: 'Price update payload contains an unknown property',
    [789]: 'Price update payload market session is invalid',

    // Strategy Vault
    [790]: 'Invalid amount for strategy operation',
    [791]: 'Shares are still locked — wait for lock period to expire',
    [792]: 'Caller is not the authorized strategy contract',
    [793]: 'Deposit/mint asset amount is below the vault min_deposit',

    // Treasury
    [900]: 'Fee rate out of range — must be between 0 and 50%',
};

export class ContractError extends Error {
    public type: ContractErrorType | TradingError;

    constructor(type: ContractErrorType | TradingError, message?: string) {
        super(message ?? errorMessages[type] ?? `Contract error ${type}`);
        this.type = type;
    }
}

/** Contract-type hint for resolving codes that are ambiguous across contracts. */
export type ContractErrorSource = 'trading' | 'governance';

/**
 * Resolve a raw on-chain error code to a ContractError.
 *
 * Codes 770-772 exist in BOTH the v2 trading contract (AdlNotTriggered,
 * AdlOvershoot, AdlNotEligible) and the governance contract (NotQueued,
 * NotUnlocked, InvalidDelay). For those three codes the name is
 * context-dependent, so they only resolve when the caller passes a
 * `contractType` hint; without one they return UnknownError rather than
 * guessing. Every other code is unambiguous: it resolves from
 * ContractErrorType first, then falls back to the standalone TradingError
 * enum (trading codes 700-760 are not in the merged enum).
 */
export function contractErrorFromCode(
    code: number,
    contractType?: ContractErrorSource
): ContractError {
    const inMerged = code in ContractErrorType;
    const inTrading = code in TradingError;

    if (inMerged && inTrading) {
        // Ambiguous (770-772): only a hint can disambiguate.
        if (contractType === 'trading') {
            return new ContractError(code as TradingError, tradingErrorMessages[code]);
        }
        if (contractType === 'governance') {
            return new ContractError(code as ContractErrorType);
        }
        return new ContractError(ContractErrorType.UnknownError);
    }
    if (inMerged) {
        return new ContractError(code as ContractErrorType);
    }
    if (inTrading) {
        return new ContractError(code as TradingError, tradingErrorMessages[code]);
    }
    return new ContractError(ContractErrorType.UnknownError);
}

/**
 * TradingError - exact v2 `trading/src/errors.rs` `TradingError` enum.
 *
 * Kept as its own enum rather than merged into `ContractErrorType`: v2 trading
 * error codes (700-772) overlap with `GovernanceError` (770-772), so a single
 * flat cross-contract code space can no longer represent both unambiguously.
 * Decode a trading-contract error against this enum specifically (the caller
 * already knows which contract raised the error).
 */
export enum TradingError {
    // --- config / construction ---
    /** A config value is out of bounds, or a range/ordering invariant is violated. */
    InvalidConfig = 700,
    /** Flat settlement price is not strictly positive. */
    InvalidPrice = 701,
    /** Illegal status transition, or the action requires a different operational status. */
    InvalidStatus = 702,
    /** A borrowing rate changed without a same-ledger `accrue`. */
    BorrowingNotAccrued = 703,
    /** Action halted by the operational status: `Frozen`, or `Retired` on trading paths. */
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

    // --- orders / price ---
    /** No keeper order exists for `(user, id)`. */
    OrderNotFound = 730,
    /** Order `expiration` is behind the current ledger sequence. */
    OrderExpired = 731,
    /** Delta pair is not an allowed combination, a moved value is below its dust
     * floor, or the expiration lies beyond the storage horizon. */
    InvalidOrder = 732,
    /** Verified price predates the position or order (anti-replay). */
    StalePrice = 740,
    /** Fill price is worse than the order's `price_bound`. */
    PriceBoundExceeded = 741,
    /** Order `trigger_price` has not been crossed at the verified price. */
    TriggerNotMet = 742,

    // --- vault orders ---
    /** No vault order exists for `(user, id)`. */
    VaultOrderNotFound = 750,
    /** Redeem order filled before its `redeem_lock` cooldown elapsed. */
    VaultOrderLocked = 751,
    /** Vault order filled while pending trader PnL exceeds the gate factor. */
    PendingPnlExceeded = 752,
    /** Deposit fill would push the vault balance above `max_vault_balance`. */
    VaultBalanceExceeded = 753,

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

/** Human-readable messages for the v2 TradingError codes. */
export const tradingErrorMessages: Record<number, string> = {
    [700]: 'Trading config value out of bounds or invariant violated',
    [701]: 'Flat settlement price is not strictly positive',
    [702]: 'Illegal status transition or action requires a different status',
    [703]: 'Borrowing rate changed without a same-ledger accrue',
    [704]: 'Action halted by operational status (Frozen, or Retired on trading paths)',
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
    [730]: 'No keeper order exists for (user, id)',
    [731]: 'Order expiration is behind the current ledger sequence',
    [732]: 'Invalid order (delta pair, dust floor, or expiration horizon)',
    [740]: 'Verified price predates the position or order (anti-replay)',
    [741]: 'Fill price is worse than the order price_bound',
    [742]: 'Order trigger_price has not been crossed at the verified price',
    [750]: 'No vault order exists for (user, id)',
    [751]: 'Redeem order filled before its redeem_lock cooldown elapsed',
    [752]: 'Vault order filled while pending trader PnL exceeds the gate factor',
    [753]: 'Deposit fill would push the vault balance above max_vault_balance',
    [760]: 'Claim attempted with no claimable funding balance',
    [770]: 'ADL execution attempted while the PnL ratio is at or below the trigger',
    [771]: 'ADL close left the pending PnL under the clear target',
    [772]: 'ADL close did not reduce the pending PnL',
};
