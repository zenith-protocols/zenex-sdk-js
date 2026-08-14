import {
    SCALAR_18,
    addI128,
    mulDivCeil,
    subI128,
} from '../../math/fixed.js';
import { quoteTradeFees } from '../market/capacity.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../contracts/trading/trading_types.js';

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
    const notional = input.position.notional;
    const funding = accruedAmount(
        notional,
        pairValue(input.market.fundingIdx, input.isLong),
        input.position.fundingIdx,
    );
    const borrowing = accruedAmount(
        notional,
        pairValue(input.market.borrowingIdx, input.isLong),
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
            execution: input.executionFee,
            relay: input.relayFee,
            marginDebit,
        },
        claimableFundingDelta: earnedFunding,
    };
}
