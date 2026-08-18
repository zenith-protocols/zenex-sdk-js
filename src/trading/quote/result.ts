/** Inclusive upper bound for a u32 ledger sequence. */
const U32_MAX = 4_294_967_295;

/**
 * Why a `QuoteResult` came back `unavailable` instead of a value.
 * `MISSING_STATE` is a state argument the quote needed but the caller did not
 * supply. `INCONSISTENT_LEDGER` is chain state read at mismatched ledgers.
 * `STALE_PRICE` is a price argument outside the quote's freshness window.
 * `INVALID_INPUT` is an argument the SDK rejected before contract math ran.
 * `CONTRACT_OVERFLOW` is a value outside the i128 range. `CONTRACT_GATE`
 * mirrors a contract error; the `reason` string on the result names which one.
 * `NO_WITHDRAWABLE_MARGIN` is a position with no margin free to withdraw.
 */
export type QuoteUnavailableCode =
    | 'MISSING_STATE'
    | 'INCONSISTENT_LEDGER'
    | 'STALE_PRICE'
    | 'INVALID_INPUT'
    | 'CONTRACT_OVERFLOW'
    | 'CONTRACT_GATE'
    | 'NO_WITHDRAWABLE_MARGIN';

/**
 * The outcome of a quote call across the quoting API. Check `kind` before you
 * read `value`; a business-logic failure never throws, it comes back
 * `unavailable` instead.
 *
 * `exact` prices the call against on-chain state as of `ledger`, a ledger
 * sequence. `estimate` is a caller-side preview; `assumptions` lists the
 * facts it took as true, and any of them can change before a fill.
 * `unavailable` carries a `code` to branch on and a `reason` string for logs,
 * not for parsing.
 */
export type QuoteResult<T> =
    | { kind: 'exact'; value: T; ledger: number }
    | { kind: 'estimate'; value: T; assumptions: string[] }
    | { kind: 'unavailable'; code: QuoteUnavailableCode; reason: string };

/**
 * Check that `value` is a valid ledger sequence and return it as a `number`.
 *
 * @param value - candidate ledger sequence; must be a nonnegative u32 safe integer.
 * @throws {TypeError} if `value` is not a number.
 * @throws {RangeError} if `value` is negative, unsafe, or above the u32 range.
 */
export function decodeLedgerSequence(value: unknown): number {
    if (typeof value !== 'number') {
        throw new TypeError('ledger sequence must be a number');
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
        throw new RangeError('ledger sequence must be a nonnegative u32 safe integer');
    }
    return value;
}

/**
 * Wrap `value` as an exact quote, priced against on-chain state as of `ledger`.
 *
 * @param ledger - ledger sequence the value was computed against.
 * @throws {RangeError} if `ledger` is negative, unsafe, or above the u32 range.
 */
export function exact<T>(value: T, ledger: number): QuoteResult<T> {
    return {
        kind: 'exact',
        value,
        ledger: decodeLedgerSequence(ledger),
    };
}

/** Wrap `value` as an estimate; `assumptions` lists what could make it wrong before a fill. */
export function estimate<T>(value: T, assumptions: string[]): QuoteResult<T> {
    return { kind: 'estimate', value, assumptions: [...assumptions] };
}

/** Wrap `code` and `reason` as an unavailable quote. Never throws. */
export function unavailable<T>(code: QuoteUnavailableCode, reason: string): QuoteResult<T> {
    return { kind: 'unavailable', code, reason };
}
