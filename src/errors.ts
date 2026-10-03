/**
 * Every error code the SDK can decode, one flat enum: Soroban host and
 * transaction codes, the shared, token, vault, market, oracle,
 * strategy-vault, governance, treasury, ownable/role-transfer,
 * smart-account, session-policy, fee-abstraction, fee-forwarder and
 * referral domains, plus the SDK-side sentinels (negative, never on chain).
 *
 * A contract code takes the contract's variant name. The Stellar Asset
 * Contract codes, the market codes and the OpenZeppelin token, vault-token,
 * ownable, role-transfer and fee-abstraction codes keep the bare name, with a
 * prefix only where it would collide or read ambiguously:
 * `FungibleMathOverflow`, `VaultMathOverflow`,
 * `TransferInvalidLiveUntilLedger`, `OwnershipTransferInProgress` and three
 * `FeeAbstraction*` members. Every other contract's codes carry a domain
 * prefix: `Oracle`, `Strategy`, `Gov`, `Treasury`, `SmartAccount`,
 * `Session`, `FeeForwarder` and `Referral`. Resolve a raw code with
 * `zenexErrorFromCode`.
 */
export enum ZenexErrorCode {
    // SDK-side sentinels: negative, never emitted by a contract.
    /** No known code matched. `zenexErrorFromCode` and `parseError` fall back to it. */
    UnknownError = -1000,
    /** Quote/preview math rejected an input before any contract rule ran. */
    QuoteInvalidInput = -1001,
    /** A quoted settlement step left the i128 range; on chain this traps without a code. */
    QuoteOverflow = -1002,

    // Transaction Submission Errors: the transaction result code minus 7.
    /** `txSorobanInvalid`: a Soroban-specific precondition is not met. */
    txSorobanInvalid = -24,
    /** `txMalformed`: a precondition is invalid. */
    txMalformed = -23,
    /** `txBadMinSeqAgeOrGap`: the minimum sequence age or ledger gap is not met. */
    txBadMinSeqAgeOrGap = -22,
    /** `txBadSponsorship`: a sponsorship is not confirmed. */
    txBadSponsorship = -21,
    /** `txFeeBumpInnerFailed`: the inner transaction of a fee bump failed. */
    txFeeBumpInnerFailed = -20,
    /** `txNotSupported`: the network does not support this transaction type. */
    txNotSupported = -19,
    /** `txInternalError`: the network hit an unknown internal error. */
    txInternalError = -18,
    /** `txBadAuthExtra`: the transaction carries unused signatures. */
    txBadAuthExtra = -17,
    /** `txInsufficientFee`: the fee is below the network minimum. */
    txInsufficientFee = -16,
    /** `txNoAccount`: the source account does not exist. */
    txNoAccount = -15,
    /** `txInsufficientBalance`: the fee would take the source below its reserve. */
    txInsufficientBalance = -14,
    /** `txBadAuth`: too few valid signatures, or the wrong network. */
    txBadAuth = -13,
    /** `txBadSeq`: the sequence number does not match the source account. */
    txBadSeq = -12,
    /** `txMissingOperation`: the transaction has no operation. */
    txMissingOperation = -11,
    /** `txTooLate`: the ledger closed after the transaction's validity window. */
    txTooLate = -10,
    /** `txTooEarly`: the ledger closed before the transaction's validity window. */
    txTooEarly = -9,

    // Host Function Errors: the InvokeHostFunction result code.
    /** The refundable fee does not cover the invocation's rent and events. */
    InvokeHostFunctionInsufficientRefundableFee = -5,
    /** The footprint touches an archived entry. Restore it first. */
    InvokeHostFunctionEntryArchived = -4,
    /** The invocation exceeded a CPU, memory or I/O resource limit. */
    InvokeHostFunctionResourceLimitExceeded = -3,
    /** The invocation failed while it ran, for example on a contract error or an auth failure. */
    InvokeHostFunctionTrapped = -2,
    /** The invocation is malformed. */
    InvokeHostFunctionMalformed = -1,

    // Common Errors: the Stellar Asset Contract codes (1-13). Governance also
    // defines code 1 (`Unauthorized`), but no entry point raises it.
    /** Code 1: reserved by the Stellar Asset Contract, and governance's never-raised `Unauthorized`. */
    InternalError = 1,
    /** The token does not support this operation. */
    OperationNotSupportedError = 2,
    /** The token is already initialized. */
    AlreadyInitializedError = 3,
    /** The caller is not authorized for this operation. */
    UnauthorizedError = 4,
    /** Authentication failed. */
    AuthenticationError = 5,
    /** The account does not exist. */
    AccountMissingError = 6,
    /** The address is not a classic Stellar account. */
    AccountIsNotClassic = 7,
    /** A negative amount. */
    NegativeAmountError = 8,
    /** The allowance is too small, or its `live_until_ledger` is invalid. */
    AllowanceError = 9,
    /** The balance is too small for the transfer. */
    BalanceError = 10,
    /** The balance is deauthorized. */
    BalanceDeauthorizedError = 11,
    /** An amount overflowed. */
    OverflowError = 12,
    /** The account has no trustline for the asset. */
    TrustlineMissingError = 13,

    // FungibleTokenError (100-114): the vault share token.
    /** The sender's balance is too small. */
    InsufficientBalance = 100,
    /** The spender's allowance is too small. */
    InsufficientAllowance = 101,
    /** An allowance's `live_until_ledger` is invalid. */
    InvalidLiveUntilLedger = 102,
    /** An input that must be at least 0 is negative. */
    LessThanZero = 103,
    /** A token sum overflowed. */
    FungibleMathOverflow = 104,
    /** The token metadata is not set. */
    UnsetMetadata = 105,
    /** The operation would push the total supply above the cap. */
    ExceededCap = 106,
    /** The supplied cap is not valid. */
    InvalidCap = 107,
    /** The cap is not set. */
    CapNotSet = 108,
    /** The Stellar Asset Contract address is not set. */
    SACNotSet = 109,
    /** The Stellar Asset Contract address differs from the expected one. */
    SACAddressMismatch = 110,
    /** A Stellar Asset Contract call context misses a parameter. */
    SACMissingFnParam = 111,
    /** A Stellar Asset Contract call context carries an invalid parameter. */
    SACInvalidFnParam = 112,
    /** The user may not perform this operation. */
    UserNotAllowed = 113,
    /** The user is blocked. */
    UserBlocked = 114,

    // VaultTokenError (400-410): the strategy vault.
    /** The vault asset address is not set. */
    VaultAssetAddressNotSet = 400,
    /** The vault asset address is already set. */
    VaultAssetAddressAlreadySet = 401,
    /** The vault decimals offset is already set. */
    VaultVirtualDecimalsOffsetAlreadySet = 402,
    /** The amount is not a valid asset amount. */
    VaultInvalidAssetsAmount = 403,
    /** The amount is not a valid share amount. */
    VaultInvalidSharesAmount = 404,
    /** A deposit exceeds the maximum for the address. */
    VaultExceededMaxDeposit = 405,
    /** A mint exceeds the maximum for the address. */
    VaultExceededMaxMint = 406,
    /** A withdrawal exceeds the maximum for the address. */
    VaultExceededMaxWithdraw = 407,
    /** A redemption exceeds the maximum for the address. */
    VaultExceededMaxRedeem = 408,
    /** The decimals offset exceeds the maximum of 10. */
    VaultMaxDecimalsOffsetExceeded = 409,
    /** Vault math overflowed. */
    VaultMathOverflow = 410,

    // Market Errors (700-772), following the contract's MarketError docs.
    // --- config / construction ---
    /** A config value is out of bounds, a range or ordering invariant is violated, or the feed id is not a V3 stream id. */
    InvalidConfig = 700,
    /** The flat settlement price is not strictly positive. */
    InvalidPrice = 701,
    /** An illegal status transition, an unknown status discriminant, or an action that needs a different operational status. */
    InvalidStatus = 702,
    /** A borrowing or funding parameter, or `max_util_open`, changed without a same-ledger `accrue`. */
    MarketNotAccrued = 703,
    /** The operational status halted the action: `Frozen`, or `Retired` on the market paths. */
    MarketFrozen = 704,
    /** A size-growing increase ran while the market does not accept opens, or the target side has ADL enabled. */
    IncreaseHalted = 705,
    /** Retirement was attempted while positions remain open. */
    MarketNotCleared = 706,

    // --- general ---
    /** A number that must be non-negative is negative. */
    NegativeValueNotAllowed = 710,

    // --- position sizing / margin ---
    /** The resulting position notional is below `min_position_notional`. */
    NotionalBelowMinimum = 711,
    /** The position notional, or an increase delta, exceeds `max_position_notional`. */
    NotionalAboveMaximum = 712,
    /** Posted margin is below the initial-margin floor after an open, increase, or withdraw. Unrealized PnL does not count. */
    InsufficientMargin = 713,
    /** A side's reserve exceeds its utilization cap of half the vault balance, after an increase or a redeem. */
    UtilizationExceeded = 714,
    /** A side's open interest would exceed the `max_open_interest` ceiling. */
    OpenInterestExceeded = 715,
    /** An increase's notional buys no base size at the entry price. */
    SizeRoundsToZero = 716,

    // --- position lifecycle ---
    /** No position exists for `(user, is_long)`. */
    PositionNotFound = 720,
    /** The close exceeds the position's unlocked notional. */
    NotionalLocked = 721,
    /** Liquidation was attempted while equity is at or above the maintenance margin and the delist deadline has not passed. */
    NotLiquidatable = 722,
    /** Settled equity is below the maintenance margin, before a decrease or ADL close, or after an open, increase, withdraw, or partial close. */
    PositionLiquidatable = 723,

    // --- orders / price ---
    /** No keeper order exists for `(user, id)`. */
    OrderNotFound = 730,
    /** The order's `expiration` is behind the current ledger sequence. */
    OrderExpired = 731,
    /** The order is malformed: an illegal delta pair, a value under its dust or deposit floor, a zero `trigger_price` on a trigger kind, an escrow overflow, or a zero amount. */
    InvalidOrder = 732,
    /** A side already holds `MAX_ORDERS_PER_SIDE` pending decrease orders. */
    TooManyOrders = 733,
    /** An order or vault-order `kind` discriminant is not a known variant. */
    UnknownKind = 734,
    /** The price predates the order's creation or the position's last mark, or a vault fill runs in its order's creation ledger. A market order filled in its creation ledger skips the creation check. */
    StalePrice = 740,
    /** The fill price is worse than the order's `price_bound`. */
    PriceBoundExceeded = 741,
    /** The order's `trigger_price` has not been crossed at the fill price. */
    TriggerNotMet = 742,

    // --- vault orders ---
    /** No vault order exists for `(user, id)`. */
    VaultOrderNotFound = 750,
    /** A redeem fill ran before its `redeem_lock` cooldown elapsed. */
    VaultOrderLocked = 751,
    // 752 is retired: a fill quoted below the order's `min_out` no longer
    // reverts. `execute_vault_order` rejects the order instead and emits
    // `reject_vault_order`.
    /** A deposit fill would push the vault balance above `max_vault_balance`. */
    VaultBalanceExceeded = 753,
    /** A redeem fill ran while a side's pending PnL exceeds `max_pnl_withdraw` of half the post-redeem vault balance. */
    PendingPnlExceeded = 754,
    /** A settlement's vault draw exceeds the vault's balance. */
    VaultInsolvent = 755,

    // --- funding ---
    /** A claim found no claimable credit balance, or an empty credit pool. */
    NothingToClaim = 760,

    // --- ADL ---
    /** ADL was attempted on a side that is not flagged, or whose pending PnL is already at or below the clear target. */
    AdlNotTriggered = 770,
    /** An ADL close left the side's pending PnL under the clear target. */
    AdlOvershoot = 771,
    /** An ADL close did not reduce the side's pending PnL. */
    AdlNotEligible = 772,

    // Shared admin (600): raised with the same name and meaning by every
    // upgradeable contract (market, oracle, factory), so the bare code
    // still names one condition.
    /** `upgrade` was called with an `operator` that is not the owner. */
    UpgradeNotOwner = 600,

    // Oracle Errors (780-793): the oracle owns the 78x/79x domain inherited
    // from the price-verifier it replaces. Codes whose semantics carried over
    // keep their numbers (780-783, 790, 793); the Lazer parser block
    // (784-789) is retired, with 784 reassigned to the report-expiry reject
    // that replaced that machinery.
    /** The verified report body failed decoding, or the feed id is not a V3 stream id. */
    OracleInvalidData = 780,
    /** A non-positive benchmark or price side, a crossed book (bid > ask), or an int192 value that overflows i128. */
    OracleInvalidPrice = 781,
    /** The observation is older than the selected staleness window. */
    OraclePriceStale = 782,
    /** The staleness pair violates `3 <= trade_staleness <= 15` or `trade_staleness <= close_staleness <= 120`. */
    OracleInvalidStaleness = 783,
    /** The ledger clock has passed the report's `expiresAt`. */
    OracleReportExpired = 784,
    /** The spread reduction factor is outside `[0, SCALAR_18]`. */
    OracleInvalidSpreadReduction = 785,
    /** The report prices a different stream than the caller's feed anchor. */
    OracleFeedMismatch = 790,
    /** The report's validity window opens, or its observation sits, more than `trade_staleness` ahead of the ledger clock. */
    OraclePriceAhead = 793,

    // Strategy Vault Errors (800-801)
    /** An amount argument is negative, or zero where a positive value is required. */
    StrategyInvalidAmount = 800,
    /** The pending trader PnL passed in exceeds the vault's asset balance. */
    StrategyPnlExceedsAssets = 801,

    // Governance Errors (810-812)
    /** No call is queued under the nonce, or no delay change is pending. */
    GovNotQueued = 810,
    /** The timelock delay has not passed yet. */
    GovNotUnlocked = 811,
    /** The delay is zero or above the 60-day ceiling. */
    GovInvalidDelay = 812,

    // Treasury Errors (900)
    /** The fee rate is outside `[0, SCALAR_18 / 2]` (0% to 50%). */
    TreasuryInvalidRate = 900,

    // OwnableError (2100-2102): OpenZeppelin ownable, raised by every
    // owner-gated contract.
    /** The contract has no owner: ownership was renounced. */
    OwnerNotSet = 2100,
    /** Renounce was attempted while an ownership transfer is pending. */
    OwnershipTransferInProgress = 2101,
    /** The owner is already set. Only the constructor sets it. */
    OwnerAlreadySet = 2102,

    // RoleTransferError (2200-2203): OpenZeppelin two-step ownership
    // transfer machinery.
    /** No pending ownership transfer exists to accept or cancel. */
    NoPendingTransfer = 2200,
    /** The transfer's `live_until_ledger` is in the past or beyond the maximum entry TTL. */
    TransferInvalidLiveUntilLedger = 2201,
    /** A cancel (`live_until_ledger` 0) names an address other than the pending owner. */
    InvalidPendingAccount = 2202,
    /** The pending transfer's `live_until_ledger` has passed. */
    TransferExpired = 2203,

    // SmartAccountError (3000-3016): the smart-account wallet that the
    // wallet factory deploys. Passkey and session-key authorizations fail
    // with these codes. 3001 is unassigned.
    /** No context rule exists with the given id. */
    SmartAccountContextRuleNotFound = 3000,
    /** A selected context rule does not validate its call: the rule expired, its context type differs, or a policy-free rule lacks a signer. */
    SmartAccountUnvalidatedContext = 3002,
    /** An external signer's signature failed verification. */
    SmartAccountExternalVerificationFailed = 3003,
    /** A context rule would hold no signer and no policy. */
    SmartAccountNoSignersAndPolicies = 3004,
    /** A context rule's `valid_until` ledger is already past. */
    SmartAccountPastValidUntil = 3005,
    /** The signer is not registered, or not in the context rule. */
    SmartAccountSignerNotFound = 3006,
    /** The signer is already in the context rule. */
    SmartAccountDuplicateSigner = 3007,
    /** The policy is not registered, or not in the context rule. */
    SmartAccountPolicyNotFound = 3008,
    /** The policy is already in the context rule. */
    SmartAccountDuplicatePolicy = 3009,
    /** A context rule would hold more than 15 signers. */
    SmartAccountTooManySigners = 3010,
    /** A context rule would hold more than 5 policies. */
    SmartAccountTooManyPolicies = 3011,
    /** An internal id counter (context rule, signer, or policy) reached `u32::MAX`. */
    SmartAccountMathOverflow = 3012,
    /** An external signer's key data exceeds the maximum size. */
    SmartAccountKeyDataTooLarge = 3013,
    /** The auth payload names a different number of context rules than there are auth contexts. */
    SmartAccountContextRuleIdsLengthMismatch = 3014,
    /** A context rule name exceeds the maximum length. */
    SmartAccountNameTooLong = 3015,
    /** The auth payload carries a signer that no selected context rule holds. */
    SmartAccountUnauthorizedSigner = 3016,

    // SessionPolicyError (4002-4007): the session policy that limits a
    // wallet's session key to trading. A refused one-click trade simulates as
    // `Error(Auth, InvalidAction)` with the policy code in the diagnostics.
    /** The session key may not call this contract. */
    SessionContractNotAllowed = 4002,
    /** A token call other than `transfer` or `approve`. */
    SessionFunctionNotAllowed = 4003,
    /** A token `transfer` to an address that is not one of the policy's markets. */
    SessionTransferNotAllowed = 4004,
    /** A token `approve` whose spender is not the fee forwarder. */
    SessionApproveNotAllowed = 4005,
    /** A relayed call signs a fee recipient other than the policy's own. */
    SessionForwardNotAllowed = 4006,
    /** The session key did not sign. */
    SessionSignerNotAuthenticated = 4007,

    // Fee Abstraction Errors (5000-5006): OpenZeppelin's
    // stellar-fee-abstraction library inside the fee forwarder. The deployed
    // forwarder keeps no fee-token allowlist and collects eagerly, so it can
    // raise only 5003 and 5005.
    /** The fee token is not on the allowlist. */
    FeeTokenNotAllowed = 5000,
    /** The fee token is already on the allowlist. */
    FeeTokenAlreadyAllowed = 5001,
    /** The allowlist reached `u32::MAX` tokens. */
    TokenCountOverflow = 5002,
    /** The relayer's fee is not above 0, or exceeds the signed maximum. */
    FeeAbstractionInvalidFeeBounds = 5003,
    /** No tokens to sweep. */
    NoTokensToSweep = 5004,
    /** The fee payer is the fee abstraction contract itself. */
    FeeAbstractionInvalidUser = 5005,
    /** The fee allowance's expiration ledger has passed. */
    FeeAbstractionInvalidExpirationLedger = 5006,

    // FeeForwarderError (6001-6002): the fee forwarder's own rejects.
    /** The target function is `transfer_from` or `burn_from`, which spend an allowance. */
    FeeForwarderTargetNotAllowed = 6001,
    /** The fee recipient is the forwarder itself. */
    FeeForwarderInvalidRecipient = 6002,

    // ReferralError (7001): the referral attestation contract.
    /** The caller names itself as its referrer. */
    ReferralSelfReferral = 7001,
}

const errorMessages: Record<number, string> = {
    [-1000]: 'Unknown contract error',
    [-1001]: 'SDK rejected the input before contract math ran',
    [-1002]: 'A quoted settlement step left the i128 range',

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
    [-2]: 'Host function trapped: a contract, auth or host failure',
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

    // Market
    [700]: 'Market config value out of bounds, invariant violated, or feed id not a V3 stream',
    [701]: 'Flat settlement price is not strictly positive',
    [702]: 'Illegal status transition, unknown status, or action requires a different status',
    [703]: 'Borrowing, funding or max_util_open parameter changed without a same-ledger accrue',
    [704]: 'Action halted by operational status (Frozen, or Retired on the market paths)',
    [705]: 'Size-growing increase while the market does not accept opens or the side has ADL enabled',
    [706]: 'Retirement attempted while positions remain open',
    [710]: 'A number that must be non-negative is negative',
    [711]: 'Resulting position notional is below min_position_notional',
    [712]: 'Position notional exceeds max_position_notional',
    [713]: 'Posted margin below the initial-margin floor',
    [714]: 'A side reserve would exceed its utilization cap of half the vault, after an increase or a redeem',
    [715]: 'Open interest would exceed the max_open_interest ceiling',
    [716]: 'Increase notional buys no base size at the entry price',
    [720]: 'No position exists for (user, is_long)',
    [721]: 'Requested close exceeds the unlocked notional',
    [722]: 'Liquidation attempted while equity is at or above maintenance margin before the delist deadline',
    [723]: 'Settled equity below maintenance margin: before a decrease or ADL close, or left on the surviving position by a fill',
    [730]: 'No keeper order exists for (user, id)',
    [731]: 'Order expiration is behind the current ledger sequence',
    [732]: 'Invalid order: no-op shape, value under its dust or deposit floor, zero trigger price, escrow overflow, or zero amount',
    [733]: 'Side already holds the maximum pending decrease orders',
    [734]: 'Order kind discriminant is not a known variant',
    [740]: 'Price predates the order or the position mark, or a vault fill ran in its creation ledger',
    [741]: 'Fill price is worse than the order price_bound',
    [742]: 'Order trigger_price has not been crossed at the verified price',
    [750]: 'No vault order exists for (user, id)',
    [751]: 'Redeem filled before its redeem_lock cooldown elapsed',
    [753]: 'Deposit fill would push the vault balance above max_vault_balance',
    [754]: 'Redeem fill would leave pending PnL above the max_pnl_withdraw gate',
    [755]: 'Settlement vault draw exceeds the vault balance',
    [760]: 'No claimable credit balance, or the credit pool is empty',
    [770]: 'ADL attempted on a side not flagged by update_adl_state, or whose pending PnL is at or below the clear target',
    [771]: 'ADL close left the pending PnL under the clear target',
    [772]: 'ADL close did not reduce the pending PnL',

    // Oracle
    [780]: 'Verified report body failed decoding, or the feed is not a V3 stream',
    [781]: 'Non-positive benchmark or price side, crossed book (bid > ask), or int192 overflow',
    [782]: 'Price observation is older than the selected staleness window (trade_staleness for fills, close_staleness for gap-closing calls)',
    [783]: 'Staleness pair violates 3 <= trade_staleness <= 15 or trade_staleness <= close_staleness <= 120 seconds',
    [784]: 'Ledger clock has passed the report expiresAt',
    [785]: 'spread_reduction_factor outside [0, SCALAR_18]',
    [790]: 'Report prices a different stream than the feed anchor',
    [793]: 'Report validity window opens, or observation sits, more than trade_staleness ahead of the ledger clock (the forward allowance never widens with the call class)',

    // Strategy Vault
    [800]: 'Invalid amount for strategy operation',
    [801]: 'Pending trader PnL exceeds the vault asset balance',

    // Governance
    [810]: 'No call queued under this nonce, or no pending delay change',
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
    [2202]: 'Cancel names an address other than the pending owner',
    [2203]: 'The pending ownership transfer has expired',

    // Smart account
    [3000]: 'Smart-account context rule not found',
    [3002]: 'Smart-account context rule does not validate the call: expired, wrong context type, or a missing signer',
    [3003]: 'Smart-account external signature failed verification',
    [3004]: 'Smart-account context rule needs at least one signer or policy',
    [3005]: 'Smart-account context rule valid_until is a past ledger',
    [3006]: 'Smart-account signer not found',
    [3007]: 'Smart-account signer is already in the context rule',
    [3008]: 'Smart-account policy not found',
    [3009]: 'Smart-account policy is already in the context rule',
    [3010]: 'Smart-account context rule exceeds 15 signers',
    [3011]: 'Smart-account context rule exceeds 5 policies',
    [3012]: 'Smart-account id counter overflow',
    [3013]: 'Smart-account external signer key data is too large',
    [3014]: 'Smart-account auth payload rule count differs from the auth context count',
    [3015]: 'Smart-account context rule name is too long',
    [3016]: 'Smart-account auth payload carries a signer outside every selected context rule',

    // Session policy
    [4002]: 'Session key may not call this contract',
    [4003]: 'Session key may call only transfer or approve on the token',
    [4004]: 'Session key token transfer must go to a market',
    [4005]: 'Session key approve must name the fee forwarder as spender',
    [4006]: 'Relayed call pays a fee recipient other than the session policy recipient',
    [4007]: 'Session key did not sign',

    // Fee Abstraction (OpenZeppelin stellar-fee-abstraction)
    [5000]: 'Fee token is not on the allowlist',
    [5001]: 'Fee token is already on the allowlist',
    [5002]: 'Fee token count overflow',
    [5003]: 'Relayer fee is outside the signed fee bounds',
    [5004]: 'No tokens to sweep',
    [5005]: 'Invalid user for fee abstraction',
    [5006]: 'Invalid expiration ledger for fee abstraction',

    // Fee forwarder
    [6001]: 'Fee forwarder target function is transfer_from or burn_from',
    [6002]: 'Fee recipient is the fee forwarder itself',

    // Referral
    [7001]: 'Referral names the caller as its own referrer',
};

/**
 * The one error shape the SDK reports, from a failed contract call, an RPC
 * response, or the SDK's own quote/preview gates. `code` carries the
 * numeric code. The message defaults to the code's entry in
 * `errorMessages`, or a fallback string when the code is not recognized.
 */
export class ZenexError extends Error {
    /** The numeric code: a contract error code, a transaction or host code, or an SDK sentinel. */
    public code: ZenexErrorCode;

    constructor(code: ZenexErrorCode, message?: string) {
        super(message ?? errorMessages[code] ?? `Contract error ${code}`);
        this.code = code;
    }
}

/**
 * Resolve a raw on-chain error code to a ZenexError.
 *
 * The per-contract code namespaces are disjoint (Stellar Asset Contract
 * 1-13, fungible token 100-114, vault token 400-410, shared admin 600,
 * market 700-772, oracle 780-793, strategy-vault 800-801, governance
 * 810-812, treasury 900, ownable 2100-2102, role transfer 2200-2203, smart
 * account 3000-3016, session policy 4002-4007, fee-abstraction 5000-5006,
 * fee forwarder 6001-6002, referral 7001), so every code resolves without a
 * hint. A code outside them resolves to `UnknownError`.
 */
export function zenexErrorFromCode(code: number): ZenexError {
    if (code in ZenexErrorCode) {
        return new ZenexError(code as ZenexErrorCode);
    }
    return new ZenexError(ZenexErrorCode.UnknownError);
}

/**
 * Resolve a quote/preview gate to a `ZenexError`: the canonical message for
 * a contract code, the gate's own `reason` for an SDK sentinel. A sentinel
 * reason is built in place and carries more context than the generic
 * sentinel message.
 */
export function zenexErrorFromGate(code: number, reason: string): ZenexError {
    if (
        code === ZenexErrorCode.QuoteInvalidInput ||
        code === ZenexErrorCode.QuoteOverflow
    ) {
        return new ZenexError(code, reason);
    }
    return zenexErrorFromCode(code);
}

// Soroban contract error codes are u32; anything larger is not a real code.
const MAXIMUM_ERROR_CODE = 4_294_967_295;

// Strictly the host's `Error(Contract, #N)` shape. Bare `#N` fragments in
// diagnostics are NOT trusted as contract codes.
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d{1,10})\)/;

/**
 * The contract error code inside a raw RPC simulation or diagnostic string,
 * or `undefined` when the strict `Error(Contract, #N)` shape is absent or the
 * number is not a valid u32. Feed the result to `zenexErrorFromCode`.
 */
export function parseContractErrorCode(rpcError: string): number | undefined {
    const match = CONTRACT_ERROR_PATTERN.exec(rpcError);
    if (match?.[1] === undefined) return undefined;
    const code = Number(match[1]);
    return Number.isSafeInteger(code) && code <= MAXIMUM_ERROR_CODE ? code : undefined;
}

