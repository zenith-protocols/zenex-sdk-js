import { rpc } from '@stellar/stellar-sdk';

export class ContractError extends Error {
    public type: ContractErrorType;

    constructor(type: ContractErrorType) {
        super();
        this.type = type;
    }
}

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

    // FungibleTokenError (100-114) - from stellar_tokens
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

    // Trading Errors (700-759) - matches Rust TradingError
    // Config & Market (700-709)
    InvalidConfig = 700,
    MarketNotFound = 701,
    MarketDisabled = 702,
    MaxMarketsReached = 703,
    // Price (710-719)
    InvalidPrice = 710,
    StalePrice = 711,
    // Position (720-739)
    PositionNotFound = 720,
    PositionNotPending = 721,
    MaxPositionsReached = 722,
    NegativeValueNotAllowed = 723,
    NotionalBelowMinimum = 724,
    NotionalAboveMaximum = 725,
    LeverageAboveMaximum = 726,
    CollateralUnchanged = 727,
    WithdrawalBreaksMargin = 728,
    InvalidTakeProfitPrice = 729,
    InvalidStopLossPrice = 730,
    NotActionable = 731,
    PositionTooNew = 732,
    ActionNotAllowedForStatus = 733,
    // Status (740-749)
    InvalidStatus = 740,
    ContractOnIce = 741,
    ContractFrozen = 742,
    // Utilization & Funding (750-759)
    ThresholdNotMet = 750,
    UtilizationExceeded = 751,
    FundingTooEarly = 752,

    // Governance Errors (770-779)
    GovNotQueued = 770,
    GovNotUnlocked = 771,
    GovInvalidDelay = 772,

    // Price Verifier Errors (780-789)
    PVInvalidData = 780,
    PVInvalidPrice = 781,
    PVPriceStale = 782,

    // Strategy Vault Errors (790-799)
    StrategyInvalidAmount = 790,
    SharesLocked = 791,
    UnauthorizedStrategy = 792,

    // VaultTokenError (400-410) - from stellar_tokens vault (OZ)
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

    // Treasury Errors (900)
    TreasuryInvalidRate = 900,
}

export function parseError(
    errorResponse:
        | rpc.Api.GetFailedTransactionResponse
        | rpc.Api.SendTransactionResponse
        | rpc.Api.SimulateTransactionErrorResponse
): ContractError {
    // Simulation Error
    if ('id' in errorResponse) {
        const match = errorResponse.error.match(/Error\(Contract, #(\d+)\)/);
        if (match) {
            const errorValue = parseInt(match[1], 10);
            if (errorValue in ContractErrorType)
                return new ContractError(errorValue as ContractErrorType);
        }
        return new ContractError(ContractErrorType.UnknownError);
    }

    // Send Transaction Error
    if ('errorResult' in errorResponse && errorResponse.errorResult) {
        const txErrorName = errorResponse.errorResult.result().switch().name;
        if (txErrorName == 'txFailed') {
            if (errorResponse.errorResult.result().results().length == 1) {
                const hostFunctionError = errorResponse.errorResult
                    .result()
                    .results()[0]
                    .tr()
                    .invokeHostFunctionResult()
                    .switch().value;
                if (hostFunctionError in ContractErrorType)
                    return new ContractError(hostFunctionError as ContractErrorType);
            }
        } else {
            const txErrorValue = errorResponse.errorResult.result().switch().value - 7;
            if (txErrorValue in ContractErrorType) {
                return new ContractError(txErrorValue as ContractErrorType);
            }
        }
    }

    // Get Transaction Error
    if ('resultXdr' in errorResponse) {
        const txResult = errorResponse.resultXdr.result();
        const txErrorName = txResult.switch().name;

        if (txErrorName == 'txFailed') {
            if (errorResponse.resultXdr.result().results().length == 1) {
                const hostFunctionError = txResult
                    .results()[0]
                    .tr()
                    .invokeHostFunctionResult()
                    .switch().value;
                if (hostFunctionError in ContractErrorType)
                    return new ContractError(hostFunctionError as ContractErrorType);
            }
        }

        const txErrorValue = txResult.switch().value - 7;
        if (txErrorValue in ContractErrorType) {
            return new ContractError(txErrorValue as ContractErrorType);
        }
    }

    return new ContractError(ContractErrorType.UnknownError);
}

export function parseResult<T>(
    response: rpc.Api.SimulateTransactionSuccessResponse | rpc.Api.GetSuccessfulTransactionResponse,
    parser: (xdr: string) => T
): T | undefined {
    if ('result' in response && response.result) {
        return parser(response.result.retval.toXDR('base64'));
    } else if ('returnValue' in response && response.returnValue) {
        return parser(response.returnValue.toXDR('base64'));
    } else {
        return undefined;
    }
}
