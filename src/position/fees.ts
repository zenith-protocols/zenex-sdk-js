import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivCeil,
    subI128,
} from '../math/fixed.js';
import { quoteTradeFees } from '../market/capacity.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../trading/trading_types.js';

export interface PositionFeeBreakdown {
    base: bigint;
    impact: bigint;
    funding: bigint;
    borrowing: bigint;
    execution: bigint;
    relay: bigint;
    marginDebit: bigint;
}

export interface QuotedPositionFees {
    fees: PositionFeeBreakdown;
    claimableFundingDelta: bigint;
}

export interface QuotePositionFeesInput {
    position: Position;
    market: MarketData;
    config: TradingConfig;
    isLong: boolean;
    signedNotional: bigint;
    signedTokens: bigint;
    executionFee: bigint;
    relayFee: bigint;
}

function nonnegative(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
}

function pairValue(pair: SidePair, isLong: boolean): bigint {
    return isLong ? pair.long : pair.short;
}

function accruedAmount(
    notional: bigint,
    marketIndex: bigint,
    positionIndex: bigint,
): bigint {
    return mulDivCeil(notional, subI128(marketIndex, positionIndex), SCALAR_18);
}

/** @internal Quote the exact fee debit without mutating position state. */
export function quotePositionFees(
    input: QuotePositionFeesInput,
): QuotedPositionFees {
    const notional = nonnegative(input.position.notional, 'position notional');
    const funding = accruedAmount(
        notional,
        pairValue(input.market.fundingIdx, input.isLong),
        input.position.fundingIdx,
    );
    const borrowingIndex = pairValue(input.market.borrowingIdx, input.isLong);
    if (borrowingIndex < input.position.borrowingIdx) {
        throw new RangeError('borrowing index moved backwards');
    }
    const borrowing = accruedAmount(
        notional,
        borrowingIndex,
        input.position.borrowingIdx,
    );

    const trade = quoteTradeFees(
        input.market,
        input.config,
        input.isLong,
        input.signedNotional,
        input.signedTokens,
    );
    const paidFunding = funding > 0n ? funding : 0n;
    const earnedFunding = funding < 0n ? subI128(0n, funding) : 0n;
    const marginDebit = addI128(
        addI128(trade.base, trade.impact),
        addI128(borrowing, paidFunding),
    );

    return {
        fees: {
            base: trade.base,
            impact: trade.impact,
            funding,
            borrowing,
            execution: nonnegative(input.executionFee, 'execution fee'),
            relay: nonnegative(input.relayFee, 'relay fee'),
            marginDebit,
        },
        claimableFundingDelta: earnedFunding,
    };
}
