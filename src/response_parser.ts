import { rpc } from '@stellar/stellar-sdk';
import {
    ZenexError,
    ZenexErrorCode,
    zenexErrorFromCode,
    parseContractErrorCode,
} from './errors.js';

export { ZenexError, ZenexErrorCode, zenexErrorFromCode } from './errors.js';

/**
 * Parse a failed simulation, send-transaction, or get-transaction response
 * into a ZenexError.
 *
 * Never throws. Returns a ZenexError with type `UnknownError` when the
 * response carries no recognizable contract error code.
 */
export function parseError(
    errorResponse:
        | rpc.Api.GetFailedTransactionResponse
        | rpc.Api.SendTransactionResponse
        | rpc.Api.SimulateTransactionErrorResponse
): ZenexError {
    const resolve = (code: number): ZenexError | undefined => {
        const resolved = zenexErrorFromCode(code);
        return resolved.code === ZenexErrorCode.UnknownError ? undefined : resolved;
    };

    // Simulation Error
    if ('id' in errorResponse) {
        const code = parseContractErrorCode(errorResponse.error);
        if (code !== undefined) {
            const resolved = resolve(code);
            if (resolved) return resolved;
        }
        return new ZenexError(ZenexErrorCode.UnknownError);
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
                const resolved = resolve(hostFunctionError);
                if (resolved) return resolved;
            }
        } else {
            const txErrorValue = errorResponse.errorResult.result().switch().value - 7;
            const resolved = resolve(txErrorValue);
            if (resolved) return resolved;
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
                const resolved = resolve(hostFunctionError);
                if (resolved) return resolved;
            }
        } else {
            const txErrorValue = txResult.switch().value - 7;
            const resolved = resolve(txErrorValue);
            if (resolved) return resolved;
        }
    }

    return new ZenexError(ZenexErrorCode.UnknownError);
}

/**
 * Decode the return value of a successful simulation or transaction, using
 * `parser` to decode the XDR. Returns `undefined` when the response carries
 * no return value.
 */
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
