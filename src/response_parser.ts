import { rpc } from '@stellar/stellar-sdk';
import { ContractError, ContractErrorType } from './errors.js';

export { ContractError, ContractErrorType, TradingError } from './errors.js';

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
        } else {
            const txErrorValue = txResult.switch().value - 7;
            if (txErrorValue in ContractErrorType) {
                return new ContractError(txErrorValue as ContractErrorType);
            }
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
