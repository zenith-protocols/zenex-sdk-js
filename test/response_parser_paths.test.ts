import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { parseError, parseResult, ContractErrorType, TradingError } from '../src/response_parser.js';

// =============================================================================
// Exercises every parseError input shape: simulation errors (regex path),
// send-transaction errors (errorResult XDR), and get-transaction failures
// (resultXdr), plus both parseResult retrieval branches.
// =============================================================================

function simulationError(message: string) {
    return {
        id: 'sim-1',
        latestLedger: 1,
        events: [],
        error: message,
    } as never;
}

function txFailedResult() {
    const opTrapped = xdr.OperationResult.opInner(
        xdr.OperationResultTr.invokeHostFunction(
            xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped(),
        ),
    );
    return new xdr.TransactionResult({
        feeCharged: new xdr.Int64(100),
        result: xdr.TransactionResultResult.txFailed([opTrapped]),
        ext: new xdr.TransactionResultExt(0),
    });
}

function txBadSeqResult() {
    return new xdr.TransactionResult({
        feeCharged: new xdr.Int64(100),
        result: xdr.TransactionResultResult.txBadSeq(),
        ext: new xdr.TransactionResultExt(0),
    });
}

describe('parseError: simulation responses', () => {
    it('resolves an unambiguous trading code without a hint', () => {
        const err = parseError(simulationError('HostError: Error(Contract, #720)'));
        expect(err.type).toBe(TradingError.PositionNotFound);
    });

    it('resolves an ambiguous code (770) only with a contract hint', () => {
        const noHint = parseError(simulationError('Error(Contract, #770)'));
        expect(noHint.type).toBe(ContractErrorType.UnknownError);

        const trading = parseError(simulationError('Error(Contract, #770)'), 'trading');
        expect(trading.type).toBe(TradingError.AdlNotTriggered);
        expect(trading.message).toMatch(/ADL/);

        const governance = parseError(simulationError('Error(Contract, #770)'), 'governance');
        expect(governance.type).toBe(ContractErrorType.GovNotQueued);
    });

    it('resolves merged-enum codes and falls back to UnknownError', () => {
        expect(parseError(simulationError('Error(Contract, #100)')).type)
            .toBe(ContractErrorType.InsufficientBalance);
        expect(parseError(simulationError('Error(Contract, #99999)')).type)
            .toBe(ContractErrorType.UnknownError);
        expect(parseError(simulationError('no code in this message')).type)
            .toBe(ContractErrorType.UnknownError);
    });
});

describe('parseError: send-transaction responses', () => {
    it('maps a trapped host function through errorResult', () => {
        const err = parseError({ status: 'ERROR', errorResult: txFailedResult() } as never);
        expect(err.type).toBe(ContractErrorType.InvokeHostFunctionTrapped);
    });

    it('maps a tx-level error code through the switch-value offset', () => {
        const err = parseError({ status: 'ERROR', errorResult: txBadSeqResult() } as never);
        expect(err.type).toBe(ContractErrorType.txBadSeq);
    });
});

describe('parseError: get-transaction responses', () => {
    it('maps a trapped host function through resultXdr', () => {
        const err = parseError({ resultXdr: txFailedResult() } as never);
        expect(err.type).toBe(ContractErrorType.InvokeHostFunctionTrapped);
    });

    it('maps a tx-level error code through resultXdr', () => {
        const err = parseError({ resultXdr: txBadSeqResult() } as never);
        expect(err.type).toBe(ContractErrorType.txBadSeq);
    });
});

describe('parseResult', () => {
    const retval = nativeToScVal(42n, { type: 'i128' });
    const parser = (b64: string) => xdr.ScVal.fromXDR(b64, 'base64');

    it('reads a simulation result', () => {
        const out = parseResult({ result: { retval } } as never, parser);
        expect(out).toBeDefined();
    });

    it('reads a transaction returnValue', () => {
        const out = parseResult({ returnValue: retval } as never, parser);
        expect(out).toBeDefined();
    });

    it('returns undefined when neither is present', () => {
        expect(parseResult({} as never, parser)).toBeUndefined();
    });
});
