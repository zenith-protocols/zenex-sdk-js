import { addI128, checkedI128, subI128 } from '../math/fixed.js';
import { exact, unavailable } from '../quote/result.js';
import type { QuoteResult, QuoteUnavailableCode } from '../quote/result.js';
import type { Position } from '../trading/trading_types.js';
import {
    quotePositionAction,
    type FeeBreakdown,
    type MarginState,
    type PositionActionOutcome,
    type PositionQuoteContext,
} from './quote.js';

const OVERFLOW_MESSAGE = 'value is outside the i128 range';

export type MarginAmount = bigint | { kind: 'max' };
export type MarginBinding = 'initial' | 'maintenance' | 'both';

export interface MarginAdjustmentQuote {
    direction: 'add' | 'withdraw';
    requestedAtomicDelta: bigint;
    maximumAtomicDelta: bigint;
    netWalletAmount: bigint;
    postPosition: Position;
    costs: FeeBreakdown;
    margin: MarginState;
    bindingConstraint: MarginBinding;
}

export interface MarginAdjustmentInput extends PositionQuoteContext {
    direction: 'add' | 'withdraw';
    amount: MarginAmount;
    executionFee: bigint;
    relayFee: bigint;
}

type ExactActionQuote = Extract<
    QuoteResult<PositionActionOutcome>,
    { kind: 'exact' }
>;

type UnavailableActionQuote = Extract<
    QuoteResult<PositionActionOutcome>,
    { kind: 'unavailable' }
>;

type MaximumSearch =
    | { kind: 'found'; amount: bigint; quote: ExactActionQuote }
    | { kind: 'none' }
    | { kind: 'unavailable'; quote: UnavailableActionQuote };

function isMax(amount: MarginAmount): amount is { kind: 'max' } {
    return typeof amount !== 'bigint';
}

function quoteAdjustmentAction(
    input: MarginAdjustmentInput,
    amount: bigint,
): QuoteResult<PositionActionOutcome> {
    return quotePositionAction({
        ledger: input.ledger,
        now: input.now,
        isLong: input.isLong,
        position: input.position,
        market: input.market,
        config: input.config,
        price: input.price,
        vaultAssets: input.vaultAssets,
        treasuryRate: input.treasuryRate,
        action: {
            kind: 'adjustCollateral',
            direction: input.direction,
            amount,
        },
        executionFee: input.executionFee,
        relayFee: input.relayFee,
    });
}

function isMarginBound(quote: UnavailableActionQuote): boolean {
    return quote.code === 'CONTRACT_GATE' && quote.reason.includes('#713');
}

function unavailableAction(
    code: QuoteUnavailableCode,
    reason: string,
): UnavailableActionQuote {
    return { kind: 'unavailable', code, reason };
}

function findMaximumWithdrawal(input: MarginAdjustmentInput): MaximumSearch {
    const minimum = checkedI128(input.config.minOrderCollateral);
    if (minimum <= 0n) {
        return {
            kind: 'unavailable',
            quote: unavailableAction(
                'INVALID_INPUT',
                'minimum order collateral must be positive',
            ),
        };
    }

    const first = quoteAdjustmentAction(input, minimum);
    if (first.kind === 'unavailable') {
        return isMarginBound(first)
            ? { kind: 'none' }
            : { kind: 'unavailable', quote: first };
    }
    if (first.kind !== 'exact') {
        return {
            kind: 'unavailable',
            quote: unavailableAction(
                'MISSING_STATE',
                'exact position transition is unavailable',
            ),
        };
    }

    const rawCollateral = checkedI128(input.position.collateral);
    if (rawCollateral < minimum) return { kind: 'none' };

    let low = minimum;
    let high = rawCollateral;
    while (low < high) {
        const mid = low + (high - low + 1n) / 2n;
        const candidate = quoteAdjustmentAction(input, mid);
        if (candidate.kind === 'exact') {
            low = mid;
            continue;
        }
        if (candidate.kind === 'unavailable' && isMarginBound(candidate)) {
            high = mid - 1n;
            continue;
        }
        return {
            kind: 'unavailable',
            quote:
                candidate.kind === 'unavailable'
                    ? candidate
                    : unavailableAction(
                          'MISSING_STATE',
                          'exact position transition is unavailable',
                      ),
        };
    }

    const finalQuote =
        low === minimum ? first : quoteAdjustmentAction(input, low);
    if (finalQuote.kind !== 'exact') {
        return {
            kind: 'unavailable',
            quote:
                finalQuote.kind === 'unavailable'
                    ? finalQuote
                    : unavailableAction(
                          'MISSING_STATE',
                          'exact maximum transition is unavailable',
                      ),
        };
    }

    return { kind: 'found', amount: low, quote: finalQuote };
}

function bindingConstraint(margin: MarginState): MarginBinding {
    if (margin.initialHeadroom === margin.maintenanceHeadroom) return 'both';
    return margin.initialHeadroom < margin.maintenanceHeadroom
        ? 'initial'
        : 'maintenance';
}

function netWalletAmount(
    direction: MarginAdjustmentInput['direction'],
    amount: bigint,
    outcome: PositionActionOutcome,
): bigint {
    const externalCosts = addI128(outcome.fees.execution, outcome.fees.relay);
    return direction === 'add'
        ? subI128(subI128(0n, amount), externalCosts)
        : subI128(outcome.walletPayout, externalCosts);
}

function resultFromAction(
    input: MarginAdjustmentInput,
    amount: bigint,
    maximum: bigint,
    action: ExactActionQuote,
): QuoteResult<MarginAdjustmentQuote> {
    return exact(
        {
            direction: input.direction,
            requestedAtomicDelta: amount,
            maximumAtomicDelta: maximum,
            netWalletAmount: netWalletAmount(
                input.direction,
                amount,
                action.value,
            ),
            postPosition: action.value.postPosition,
            costs: action.value.fees,
            margin: action.value.margin,
            bindingConstraint: bindingConstraint(action.value.margin),
        },
        action.ledger,
        action.priceTime,
    );
}

function caughtUnavailable<T>(error: unknown): QuoteResult<T> {
    if (
        error instanceof RangeError &&
        error.message.includes(OVERFLOW_MESSAGE)
    ) {
        return unavailable('CONTRACT_OVERFLOW', error.message);
    }
    return unavailable(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'invalid margin quote input',
    );
}

export function quoteMarginAdjustment(
    input: MarginAdjustmentInput,
): QuoteResult<MarginAdjustmentQuote> {
    try {
        if (isMax(input.amount)) {
            if (input.direction !== 'withdraw') {
                return unavailable(
                    'INVALID_INPUT',
                    'Max collateral adjustment is only defined for withdrawals',
                );
            }
            const maximum = findMaximumWithdrawal(input);
            if (maximum.kind === 'none') {
                return unavailable(
                    'NO_WITHDRAWABLE_COLLATERAL',
                    'no submit-ready collateral withdrawal is available',
                );
            }
            if (maximum.kind === 'unavailable') return maximum.quote;
            return resultFromAction(
                input,
                maximum.amount,
                maximum.amount,
                maximum.quote,
            );
        }

        const requested = checkedI128(input.amount);
        if (requested < 0n) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #710: collateral adjustment cannot be negative',
            );
        }
        const minimum = checkedI128(input.config.minOrderCollateral);
        if (minimum <= 0n) {
            return unavailable(
                'INVALID_INPUT',
                'minimum order collateral must be positive',
            );
        }
        if (requested === 0n || requested < minimum) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #732: collateral adjustment is below the order dust floor',
            );
        }

        const requestedQuote = quoteAdjustmentAction(input, requested);
        if (requestedQuote.kind !== 'exact') {
            return requestedQuote.kind === 'unavailable'
                ? requestedQuote
                : unavailable(
                      'MISSING_STATE',
                      'exact requested transition is unavailable',
                  );
        }

        if (input.direction === 'add') {
            return resultFromAction(
                input,
                requested,
                requested,
                requestedQuote,
            );
        }

        const maximum = findMaximumWithdrawal(input);
        if (maximum.kind === 'unavailable') return maximum.quote;
        if (maximum.kind === 'none') {
            return unavailable(
                'NO_WITHDRAWABLE_COLLATERAL',
                'no submit-ready collateral withdrawal is available',
            );
        }
        return resultFromAction(
            input,
            requested,
            maximum.amount,
            requestedQuote,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}
