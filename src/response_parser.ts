import { rpc, xdr } from '@stellar/stellar-sdk';
import {
    ZenexError,
    ZenexErrorCode,
    zenexErrorFromCode,
    parseContractErrorCode,
} from './errors.js';

export { ZenexError, ZenexErrorCode, zenexErrorFromCode } from './errors.js';

/** Any host error in an RPC error string, e.g. `Error(Auth, InvalidAction)`. */
const HOST_ERROR_PATTERN = /Error\((\w+), ([^)]*)\)/;
/** The recording-mode diagnostic for a `require_auth` below the root invocation. */
const NON_ROOT_AUTH = 'not tied to the root contract invocation';
/** Longest raw text an UnknownError message carries. */
const MAX_DETAIL = 200;

/**
 * Parse a failed simulation, send-transaction, or get-transaction response
 * into a ZenexError.
 *
 * Never throws. A recognized contract, transaction or host-function code
 * resolves to its `ZenexErrorCode`. Anything else returns `UnknownError`
 * with a message that names what failed: the host error of a failed
 * simulation, such as `Error(Auth, InvalidAction)`, or the operation
 * result of a failed transaction.
 */
export function parseError(
    errorResponse:
        | rpc.Api.GetFailedTransactionResponse
        | rpc.Api.SendTransactionResponse
        | rpc.Api.SimulateTransactionErrorResponse
): ZenexError {
    try {
        return decodeErrorResponse(errorResponse);
    } catch {
        return new ZenexError(ZenexErrorCode.UnknownError);
    }
}

function resolve(code: number): ZenexError | undefined {
    const resolved = zenexErrorFromCode(code);
    return resolved.code === ZenexErrorCode.UnknownError ? undefined : resolved;
}

function unknown(detail: string): ZenexError {
    const trimmed =
        detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}...` : detail;
    return new ZenexError(ZenexErrorCode.UnknownError, trimmed);
}

function decodeErrorResponse(errorResponse: unknown): ZenexError {
    if (typeof errorResponse !== 'object' || errorResponse === null) {
        return new ZenexError(ZenexErrorCode.UnknownError);
    }
    const response = errorResponse as {
        error?: unknown;
        errorResult?: xdr.TransactionResult;
        resultXdr?: xdr.TransactionResult;
    };

    // Simulation Error
    if (typeof response.error === 'string') {
        return fromSimulationError(response.error);
    }
    // Send Transaction Error
    if (response.errorResult) {
        return fromTransactionResult(response.errorResult);
    }
    // Get Transaction Error
    if (response.resultXdr) {
        return fromTransactionResult(response.resultXdr);
    }
    return new ZenexError(ZenexErrorCode.UnknownError);
}

function fromSimulationError(raw: string): ZenexError {
    const code = parseContractErrorCode(raw);
    const resolved = code === undefined ? undefined : resolve(code);
    if (resolved) return resolved;

    const host = HOST_ERROR_PATTERN.exec(raw);
    if (host === null) {
        const line = raw.split('\n', 1)[0].trim();
        return line.length > 0
            ? unknown(line)
            : new ZenexError(ZenexErrorCode.UnknownError);
    }
    if (host[1] === 'Contract') {
        return unknown(`Unknown contract error ${host[0]}`);
    }
    if (raw.includes(NON_ROOT_AUTH)) {
        return unknown(
            `Host error ${host[0]}: a require_auth below the root invocation; simulate with authMode 'record_allow_nonroot'`,
        );
    }
    return unknown(`Host error ${host[0]}`);
}

function fromTransactionResult(result: xdr.TransactionResult): ZenexError {
    const outcome = result.result();
    if (outcome.switch().name !== 'txFailed') {
        // TransactionResultCode sits 7 above the ZenexErrorCode tx range.
        return (
            resolve(outcome.switch().value - 7) ??
            unknown(`Transaction failed: ${outcome.switch().name}`)
        );
    }
    const operations = outcome.results();
    if (operations.length !== 1) {
        return unknown(`Transaction failed with ${operations.length} operation results`);
    }
    return fromOperationResult(operations[0]);
}

function fromOperationResult(operation: xdr.OperationResult): ZenexError {
    if (operation.switch().name !== 'opInner') {
        return unknown(`Operation failed: ${operation.switch().name}`);
    }
    const inner = operation.tr();
    if (inner.switch().name !== 'invokeHostFunction') {
        // A restore, a TTL extension or a classic operation: its result arm
        // names the failure, but no ZenexErrorCode covers it.
        const arm = inner.value() as { switch(): { name: string } };
        return unknown(`Operation failed: ${arm.switch().name}`);
    }
    const hostFunction = inner.invokeHostFunctionResult().switch();
    return (
        resolve(hostFunction.value) ??
        unknown(`Operation failed: ${hostFunction.name}`)
    );
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
