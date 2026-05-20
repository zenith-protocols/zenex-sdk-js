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

    // Trading Errors (700-752)
    InvalidConfig = 700,
    MarketNotFound = 701,
    MarketDisabled = 702,
    MaxMarketsReached = 703,
    InvalidPrice = 710,
    StalePrice = 711,
    PriceSlippage = 712,
    PositionNotFound = 720,
    PositionNotPending = 721,
    NegativeValueNotAllowed = 723,
    NotionalBelowMinimum = 724,
    NotionalAboveMaximum = 725,
    LeverageAboveMaximum = 726,
    CollateralUnchanged = 727,
    WithdrawalBreaksMargin = 728,
    NotActionable = 731,
    PositionTooNew = 732,
    ActionNotAllowedForStatus = 733,
    InvalidInput = 734,
    InvalidStatus = 740,
    ContractOnIce = 741,
    ContractFrozen = 742,
    ThresholdNotMet = 750,
    UtilizationExceeded = 751,
    FundingTooEarly = 752,
    Expired = 760,

    // Governance Errors (770-772)
    GovNotQueued = 770,
    GovNotUnlocked = 771,
    GovInvalidDelay = 772,

    // Price Verifier Errors (780-783)
    PVInvalidData = 780,
    PVInvalidPrice = 781,
    PVPriceStale = 782,
    PVInvalidStaleness = 783,

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

    // Trading
    [700]: 'Trading config parameter out of valid range',
    [701]: 'No market registered for this market ID',
    [702]: 'Market is disabled — new positions cannot be opened',
    [703]: 'Maximum number of markets reached',
    [710]: 'Price verification failed or feed ID mismatch',
    [711]: 'Price data is stale, predates position open time',
    [712]: 'Fill price outside the user-supplied price_bound (slippage)',
    [720]: 'Position not found',
    [721]: 'Position is already filled — expected pending',
    [723]: 'Parameter must be positive',
    [724]: 'Notional size is below the minimum',
    [725]: 'Notional size exceeds the maximum',
    [726]: 'Leverage exceeds maximum (notional × margin > collateral)',
    [727]: 'Collateral amount is unchanged',
    [728]: 'Collateral withdrawal would breach margin requirement',
    [731]: 'Position has no actionable trigger (fill, liquidation, SL, or TP)',
    [732]: 'Position is too new to close — wait at least 30 seconds',
    [733]: 'Action not allowed for current position status',
    [734]: 'Malformed input (e.g. mismatched parallel vec lengths)',
    [740]: 'Invalid or disallowed contract status value',
    [741]: 'Contract is on ice — new positions are blocked',
    [742]: 'Contract is frozen — all position operations are blocked',
    [750]: 'PnL threshold not met for status change',
    [751]: 'Position would exceed utilization cap',
    [752]: 'Funding can only be applied once per hour',
    [760]: 'Transaction expired (current ledger past expiration_ledger)',

    // Governance
    [770]: 'Queued call not found or has expired',
    [771]: 'Timelock delay has not yet passed',
    [772]: 'Invalid delay value — must be between 1 second and 60 days',

    // Price Verifier
    [780]: 'Price update signature or format is invalid',
    [781]: 'Price confidence exceeds bounds or required fields missing',
    [782]: 'Price update is stale (exceeds max staleness threshold)',
    [783]: 'max_staleness exceeds MAX_STALENESS_SECONDS cap (30)',

    // Strategy Vault
    [790]: 'Invalid amount for strategy operation',
    [791]: 'Shares are still locked — wait for lock period to expire',
    [792]: 'Caller is not the authorized strategy contract',
    [793]: 'Deposit/mint asset amount is below the vault min_deposit',

    // Treasury
    [900]: 'Fee rate out of range — must be between 0 and 50%',
};

export class ContractError extends Error {
    public type: ContractErrorType;

    constructor(type: ContractErrorType) {
        super(errorMessages[type] ?? `Contract error ${type}`);
        this.type = type;
    }
}
