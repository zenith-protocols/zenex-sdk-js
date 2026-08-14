const U32_MAX = 4_294_967_295;

export type QuoteUnavailableCode =
    | 'MISSING_STATE'
    | 'INCONSISTENT_LEDGER'
    | 'STALE_PRICE'
    | 'INVALID_INPUT'
    | 'CONTRACT_OVERFLOW'
    | 'CONTRACT_GATE'
    | 'NO_WITHDRAWABLE_MARGIN';

export type QuoteResult<T> =
    | { kind: 'exact'; value: T; ledger: number }
    | { kind: 'estimate'; value: T; assumptions: string[] }
    | { kind: 'unavailable'; code: QuoteUnavailableCode; reason: string };

export function decodeLedgerSequence(value: unknown): number {
    if (typeof value !== 'number') {
        throw new TypeError('ledger sequence must be a number');
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
        throw new RangeError('ledger sequence must be a nonnegative u32 safe integer');
    }
    return value;
}

export function exact<T>(value: T, ledger: number): QuoteResult<T> {
    return {
        kind: 'exact',
        value,
        ledger: decodeLedgerSequence(ledger),
    };
}

export function estimate<T>(value: T, assumptions: string[]): QuoteResult<T> {
    return { kind: 'estimate', value, assumptions: [...assumptions] };
}

export function unavailable<T>(code: QuoteUnavailableCode, reason: string): QuoteResult<T> {
    return { kind: 'unavailable', code, reason };
}
