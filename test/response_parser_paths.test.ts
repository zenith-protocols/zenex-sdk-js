import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { parseError, parseResult, ZenexErrorCode } from '../src/response_parser.js';

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
    const operationTrapped = xdr.OperationResult.opInner(
        xdr.OperationResultTr.invokeHostFunction(
            xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped(),
        ),
    );
    return new xdr.TransactionResult({
        feeCharged: new xdr.Int64(100),
        result: xdr.TransactionResultResult.txFailed([operationTrapped]),
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
    it('resolves a market code without any hint', () => {
        const error = parseError(simulationError('HostError: Error(Contract, #720)'));
        expect(error.code).toBe(ZenexErrorCode.PositionNotFound);
    });

    it('resolves 770 unhinted now that governance vacated the ADL range', () => {
        const error = parseError(simulationError('Error(Contract, #770)'));
        expect(error.code).toBe(ZenexErrorCode.AdlNotTriggered);
        expect(error.message).toMatch(/ADL/);
    });

    it('resolves merged-enum codes and falls back to UnknownError', () => {
        expect(parseError(simulationError('Error(Contract, #100)')).code)
            .toBe(ZenexErrorCode.InsufficientBalance);
        expect(parseError(simulationError('Error(Contract, #99999)')).code)
            .toBe(ZenexErrorCode.UnknownError);
        expect(parseError(simulationError('no code in this message')).code)
            .toBe(ZenexErrorCode.UnknownError);
    });
});

describe('parseError: send-transaction responses', () => {
    it('maps a trapped host function through errorResult', () => {
        // InvokeHostFunctionResultCode: trapped = -2 = InvokeHostFunctionTrapped
        const error = parseError({ status: 'ERROR', errorResult: txFailedResult() } as never);
        expect(error.code).toBe(ZenexErrorCode.InvokeHostFunctionTrapped);
    });

    it('maps a tx-level error code through the switch-value offset', () => {
        // TransactionResultCode txBadSeq = -5; parser offset -7 lands on -12 = txBadSeq
        const error = parseError({ status: 'ERROR', errorResult: txBadSeqResult() } as never);
        expect(error.code).toBe(ZenexErrorCode.txBadSeq);
    });
});

describe('parseError: get-transaction responses', () => {
    it('maps a trapped host function through resultXdr', () => {
        const error = parseError({ resultXdr: txFailedResult() } as never);
        expect(error.code).toBe(ZenexErrorCode.InvokeHostFunctionTrapped);
    });

    it('maps a tx-level error code through resultXdr', () => {
        const error = parseError({ resultXdr: txBadSeqResult() } as never);
        expect(error.code).toBe(ZenexErrorCode.txBadSeq);
    });
});

describe('parseResult', () => {
    const returnValue = nativeToScVal(42n, { type: 'i128' });
    const parser = (base64Xdr: string) => xdr.ScVal.fromXDR(base64Xdr, 'base64');

    it('reads a simulation result', () => {
        const parsed = parseResult({ result: { retval: returnValue } } as never, parser);
        expect(parsed).toBeDefined();
    });

    it('reads a transaction returnValue', () => {
        const parsed = parseResult({ returnValue } as never, parser);
        expect(parsed).toBeDefined();
    });

    it('returns undefined when neither is present', () => {
        expect(parseResult({} as never, parser)).toBeUndefined();
    });
});
