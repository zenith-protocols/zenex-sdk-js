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

/**
 * Itemized costs one action settles against a stored position, token-dec.
 *
 * Mirrors the parts `Position::increase` and `Position::decrease` assemble
 * via `Market::trade_fees` and `Fees::debit`. `base` and `impact` price only the
 * fill, not the position's full size.
 */
export interface PositionFeeBreakdown {
    /** Skew-split trade fee on the fill, rounded up (`Market::trade_fees`). */
    base: bigint;
    /** Size-quadratic impact fee on the fill's full notional, rounded up. */
    impact: bigint;
    /**
     * Signed funding accrual. Positive is paid by the trader. Negative is
     * earned and credited to the trader's claimable balance instead.
     */
    funding: bigint;
    /** Borrowing accrual. Never negative; the borrowing index only grows. */
    borrowing: bigint;
    /** Execution fee, passed through from the input unchanged. */
    execution: bigint;
    /** Relay fee, passed through from the input unchanged. */
    relay: bigint;
    /**
     * The amount charged against margin (`Fees::debit`). Equals
     * `base + impact + borrowing`, plus `funding` when it is paid. Excludes
     * `execution` and `relay`.
     */
    marginDebit: bigint;
}

/**
 * The exact fee debit and claimable-funding delta for one action, computed
 * without mutating position state, token-dec.
 */
export interface QuotedPositionFees {
    /** Itemized costs the action settles. */
    fees: PositionFeeBreakdown;
    /**
     * Earned funding credited to the trader's claimable balance. `0` when
     * `fees.funding` is paid rather than earned.
     */
    claimableFundingDelta: bigint;
}

/** Input to {@link quotePositionFees}: the fill and the state it prices against. */
export interface QuotePositionFeesInput {
    /**
     * Position the accruals settle against. `position.notional` sizes both
     * the funding and the borrowing accrual.
     */
    position: Position;
    /**
     * Market state supplying the accrual indices. Must already be advanced
     * to the quote time; this call does not extrapolate them.
     */
    market: MarketData;
    /** Fee rates the base and impact fee are computed from. */
    config: TradingConfig;
    /** Side the fees settle against. */
    isLong: boolean;
    /**
     * Signed notional of the fill: positive grows the side, negative shrinks
     * it. Feeds the base/impact split, not the funding or borrowing accrual.
     */
    signedNotional: bigint;
    /** Signed base-size change of the fill, paired with `signedNotional`. */
    signedTokens: bigint;
    /** Execution fee to carry into the output breakdown unchanged. */
    executionFee: bigint;
    /** Relay fee to carry into the output breakdown unchanged. */
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

/**
 * @internal
 *
 * Quote the exact fee debit for one fill against `input.position`, without
 * mutating it. Ports `Position::settle_accruals` (funding, borrowing) and
 * `Market::trade_fees` (base, impact); `marginDebit` mirrors `Fees::debit`.
 */
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
