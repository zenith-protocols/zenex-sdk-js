const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;

export type QuoteUnavailableCode =
    | 'MISSING_STATE'
    | 'INCONSISTENT_LEDGER'
    | 'STALE_PRICE'
    | 'INVALID_INPUT'
    | 'CONTRACT_OVERFLOW'
    | 'CONTRACT_GATE'
    | 'NO_WITHDRAWABLE_COLLATERAL';

export type QuoteResult<T> =
    | { kind: 'exact'; value: T; ledger: number; priceTime: bigint }
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

function checkedPriceTime(value: bigint): bigint {
    if (typeof value !== 'bigint') {
        throw new TypeError('price time must be a bigint');
    }
    if (value < 0n || value > U64_MAX) {
        throw new RangeError('price time must be a nonnegative u64');
    }
    return value;
}

export function exact<T>(value: T, ledger: number, priceTime: bigint): QuoteResult<T> {
    return {
        kind: 'exact',
        value,
        ledger: decodeLedgerSequence(ledger),
        priceTime: checkedPriceTime(priceTime),
    };
}

export function estimate<T>(value: T, assumptions: string[]): QuoteResult<T> {
    return { kind: 'estimate', value, assumptions: [...assumptions] };
}

export function unavailable<T>(code: QuoteUnavailableCode, reason: string): QuoteResult<T> {
    return { kind: 'unavailable', code, reason };
}
