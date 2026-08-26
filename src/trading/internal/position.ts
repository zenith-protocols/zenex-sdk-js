import type { MarketData, Position, SidePair, MarketConfig } from '../../contracts/market/types.js';
import { SCALAR_18, addI128, checkedI128, mulDivCeil, mulDivFloor, subI128 } from '../../math/fixed.js';
import { advanceMarketAccruals, exactPositionPnl, marketSidePnl, quoteTradeFees, sideCapacity } from './math.js';
import type { PriceData } from './math.js';
import { decodeLedgerSequence, estimate, exact, unavailable } from './quote.js';
import type { PositionQuoteContext, QuoteResult } from './quote.js';

/**
 * Itemized costs one action settles against a stored position, token-dec.
 *
 * Mirrors the parts `Position::increase` and `Position::decrease` assemble
 * via `Market::trade_fees` and `Fees::debit`. `base` and `impact` price only
 * the fill, not the position's full size.
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
 * The exact fee debit and claimable-funding delta for one action, token-dec.
 * `quotePositionFees` returns this and leaves the position unchanged.
 */
export interface QuotedPositionFees {
    /** Itemized costs the action settles. */
    fees: PositionFeeBreakdown;
    /**
     * Earned funding credited to the trader's claimable balance. `0` when
     * `fees.funding` is paid rather than earned.
     */
    claimableCreditDelta: bigint;
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
    config: MarketConfig;
    /** Side the fees settle against. */
    isLong: boolean;
    /**
     * Signed notional of the fill: positive grows the side, negative shrinks
     * it. Feeds the base and impact split, not the funding or borrowing
     * accrual.
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
 * Quote the exact fee debit for one fill against `input.position`. This call
 * does not change `input.position`. Ports `Position::settle_accruals`
 * (funding, borrowing) and `Market::trade_fees` (base, impact);
 * `marginDebit` mirrors `Fees::debit`.
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
        claimableCreditDelta: earnedFunding,
    };
}

const OVERFLOW_MESSAGE = 'value is outside the i128 range';

function side(pair: { long: bigint; short: bigint }, isLong: boolean): bigint {
    return isLong ? pair.long : pair.short;
}


function haircutPnl(
    pnl: bigint,
    context: Pick<
        PositionQuoteContext,
        'market' | 'config' | 'price' | 'vaultAssets' | 'isLong'
    >,
): bigint {
    if (pnl <= 0n) return pnl;
    const pending = marketSidePnl(
        context.market,
        context.price,
        context.isLong,
        true,
    );
    const allowance = sideCapacity(
        context.vaultAssets,
        context.config.maxPnlTrader,
    );
    return pending > allowance ? mulDivFloor(pnl, allowance, pending) : pnl;
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
        error instanceof Error
            ? error.message
            : 'invalid position lifecycle input',
    );
}

/**
 * Average entry price implied by `position`, price_scalar:
 * `floor(notional * SCALAR_18 / tokens)`. `undefined` when `position.tokens`
 * is `0n` (no open size), matching the entry-implied note on
 * `Position::tokens`.
 */
export function impliedEntryPrice(position: Position): bigint | undefined {
    if (position.tokens === 0n) return undefined;
    return mulDivFloor(position.notional, SCALAR_18, position.tokens);
}

/**
 * Leverage of `position` marked at `price`, SCALAR_18 (`SCALAR_18` = 1x):
 * `notional / (margin + pnl)`. The denominator is margin plus raw PnL, not
 * the fee-settled equity `liquidationState` returns. It also excludes
 * pending funding and borrowing, named in the result's `assumptions`.
 *
 * The contract has no leverage function; `MarketConfig.initMargin` states
 * the inverse relation, "max leverage = 1 / initMargin".
 *
 * @returns `estimate` of `0n` when `position.notional` is `0n`.
 *   `unavailable` (`INVALID_INPUT`) when margin plus PnL is zero or
 *   negative: leverage against non-positive equity is undefined.
 *   `unavailable` (`CONTRACT_OVERFLOW`) on an i128 overflow, or
 *   (`INVALID_INPUT`) on any other input error.
 */
export function positionLeverage(
    position: Position,
    price: PriceData,
    isLong: boolean,
): QuoteResult<bigint> {
    try {
        if (position.notional === 0n) {
            return estimate(0n, [
                'excludes unsettled funding and borrowing accruals',
            ]);
        }
        const equity = addI128(
            position.margin,
            exactPositionPnl(position, price, isLong),
        );
        if (equity <= 0n) {
            return unavailable(
                'INVALID_INPUT',
                'position equity must be positive to quote leverage',
            );
        }
        return estimate(mulDivFloor(position.notional, SCALAR_18, equity), [
            'excludes unsettled funding and borrowing accruals',
        ]);
    } catch (error) {
        return caughtUnavailable(error);
    }
}

/**
 * Exact liquidation check for `position` at `context.ledger`, token-dec.
 * Mirrors `Position::is_liquidatable`: advances the market's funding and
 * borrowing indices to `context.now` (`Market::load`), settles the full
 * position at `context.price` the way `Position::settle` would on a close,
 * and compares the result to the maintenance line.
 *
 * `equity` is the settled equity floored at `0n`, matching what a close or a
 * liquidation would pay out. `maintenanceRequired` is
 * `ceil(notional * maintenanceMargin / SCALAR_18)` (`Position::margin_requirement`).
 * `liquidatable` is `equity < maintenanceRequired`: `true` is
 * `Position::liquidate`'s eligibility gate, `false` is `Position::decrease`'s
 * solvency gate.
 *
 * @returns `unavailable` (`CONTRACT_GATE`, "contract error #720: position not
 *   found") when `position.notional` is `0n`. `unavailable`
 *   (`CONTRACT_OVERFLOW`) on an i128 overflow, or (`INVALID_INPUT`) on any
 *   other input error. Otherwise `exact` at `context.ledger`.
 */
export function liquidationState(
    position: Position,
    context: PositionQuoteContext,
): QuoteResult<{
    equity: bigint;
    maintenanceRequired: bigint;
    liquidatable: boolean;
}> {
    try {
        const accrued = advanceMarketAccruals(
            context.market,
            context.config,
            context.price,
            context.vaultAssets,
            context.now,
        ).market;
        const notional = position.notional;
        if (notional === 0n) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #720: position not found',
            );
        }
        const funding = accruedAmount(
            notional,
            side(accrued.fundingIdx, context.isLong),
            position.fundingIdx,
        );
        const borrowing = accruedAmount(
            notional,
            side(accrued.borrowingIdx, context.isLong),
            position.borrowingIdx,
        );

        const trade = quoteTradeFees(
            accrued,
            context.config,
            context.isLong,
            subI128(0n, notional),
            subI128(0n, position.tokens),
        );
        const debit = addI128(
            addI128(trade.base, trade.impact),
            addI128(borrowing, funding > 0n ? funding : 0n),
        );
        const rawPnl = exactPositionPnl(
            position,
            context.price,
            context.isLong,
        );
        const pnl = haircutPnl(rawPnl, {
            market: accrued,
            config: context.config,
            price: context.price,
            vaultAssets: context.vaultAssets,
            isLong: context.isLong,
        });
        const settledEquity = addI128(
            subI128(position.margin, debit),
            pnl,
        );
        const equity = settledEquity > 0n ? settledEquity : 0n;
        const maintenanceRequired = mulDivCeil(
            notional,
            context.config.maintenanceMargin,
            SCALAR_18,
        );

        return exact(
            {
                equity,
                maintenanceRequired,
                liquidatable: equity < maintenanceRequired,
            },
            context.ledger,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

/**
 * Signed PnL of `position` marked at `price`, token-dec.
 *
 * Ports `math::pnl`: a long is `floor(tokens * price / priceScalar) - notional`,
 * a short is `notional - ceil(tokens * price / priceScalar)`. The mark rounds
 * against the trader, matching the contract's conservative-for-the-vault
 * rounding. `price` is the exit price (`price.exit(is_long)` on-chain).
 *
 * @param priceScalar The scalar baked into `position.tokens` by
 *   `math::to_tokens`. Pass `SCALAR_18`.
 */
export function positionPnl(
    position: Position,
    price: bigint,
    priceScalar: bigint,
    isLong: boolean,
): bigint {
    if (isLong) {
        return (
            mulDivFloor(position.tokens, price, priceScalar) - position.notional
        );
    }
    return position.notional - mulDivCeil(position.tokens, price, priceScalar);
}

/**
 * Pending funding accrual on `position`, token-dec; positive is owed by the
 * trader, negative is earned.
 *
 * Ports `Position::settle_accruals` / `math::accrued_amount`:
 * `ceil(notional * (marketFundingIdx[side] - position.fundingIdx) / SCALAR_18)`.
 * The ceil rounds toward +inf for both signs so a payer never underpays and a
 * receiver (negative delta) never over-claims. `marketData`'s index is as of
 * the market's last on-chain accrual; this does not extrapolate to now.
 */
export function pendingFunding(
    position: Position,
    marketData: MarketData,
    isLong: boolean,
): bigint {
    const marketIdx = isLong
        ? marketData.fundingIdx.long
        : marketData.fundingIdx.short;
    return mulDivCeil(
        position.notional,
        marketIdx - position.fundingIdx,
        SCALAR_18,
    );
}

/**
 * Pending borrowing accrual on `position`, token-dec (non-negative; indices
 * only ever grow).
 *
 * Ports `Position::settle_accruals` / `math::accrued_amount`:
 * `ceil(notional * (marketBorrowingIdx[side] - position.borrowingIdx) / SCALAR_18)`.
 * `marketData`'s index is as of the market's last on-chain accrual; this does
 * not extrapolate to now.
 */
export function pendingBorrowing(
    position: Position,
    marketData: MarketData,
    isLong: boolean,
): bigint {
    const marketIdx = isLong
        ? marketData.borrowingIdx.long
        : marketData.borrowingIdx.short;
    return mulDivCeil(
        position.notional,
        marketIdx - position.borrowingIdx,
        SCALAR_18,
    );
}

/**
 * Position equity, token-dec: `margin + pnl - max(0, pendingFunding) -
 * pendingBorrowing`.
 *
 * The contract's settled equity (`Position::settle`) is
 * `margin - fees.debit() + pnl`, which folds in base and impact trade fees
 * along with funding and borrowing. This excludes base and impact since no
 * fill is priced here. Matching `Fees::debit`, only paid funding (a positive
 * accrual) debits the margin; earned funding routes to the user's separate
 * claimable balance and never shores up equity. A stored position read by the
 * SDK has not been settled, so this subtracts the pending funding and
 * borrowing accruals through their index deltas.
 *
 * The `marketData` indices are as of the market's last on-chain accrual; this
 * does not extrapolate the current rates over the seconds since, whereas the
 * contract advances both indices to `now` before any equity check. Between
 * keeper touches the result slightly overstates equity. Use `liquidationState`
 * for the exact settled equity checked against the maintenance line.
 *
 * @param priceScalar The scalar baked into `position.tokens` by
 *   `math::to_tokens`. Pass `SCALAR_18`.
 */
export function positionEquity(
    position: Position,
    marketData: MarketData,
    price: bigint,
    priceScalar: bigint,
    isLong: boolean,
): bigint {
    const funding = pendingFunding(position, marketData, isLong);
    const paidFunding = funding > 0n ? funding : 0n;
    return (
        position.margin +
        positionPnl(position, price, priceScalar, isLong) -
        paidFunding -
        pendingBorrowing(position, marketData, isLong)
    );
}

/**
 * The notional still open and unlocked at `nowSecs`, token-dec.
 *
 * Ports `Position::locked`: `locked_notional` counts only while
 * `now < unlocks_at`, so `unlockedNotional = notional - locked`. At the exact
 * boundary `now == unlocks_at` the lock has expired and the whole notional is
 * unlocked.
 */
export function unlockedNotional(position: Position, nowSecs: bigint): bigint {
    const locked = nowSecs < position.unlocksAt ? position.lockedNotional : 0n;
    return position.notional - locked;
}

/**
 * Estimated liquidation price for `position`, in price_scalar units; `0` when
 * there is no open size.
 *
 * The contract has no liquidation-price function: it checks
 * `equity < ceil(maintenance_margin * notional)` directly
 * (`Position::is_liquidatable`, called from `require_valid` and `liquidate`).
 * This inverts that maintenance line against the same equity model as
 * `positionEquity` to solve for the price at which equity meets the
 * maintenance margin. It excludes the incremental base and impact close fee,
 * which is second-order for the threshold estimate, and does not extrapolate
 * accrual rates past the market's last on-chain accrual. Use
 * `liquidationState` for an exact checked result at a declared ledger and
 * authenticated price.
 */
export function liquidationPrice(
    position: Position,
    config: MarketConfig,
    marketData: MarketData,
    isLong: boolean,
): bigint {
    if (position.tokens === 0n) {
        return 0n;
    }
    // maintenance margin = ceil(notional * maintenance_margin / SCALAR_18) (apply_factor_ceil).
    const mm = mulDivCeil(
        position.notional,
        config.maintenanceMargin,
        SCALAR_18,
    );
    const funding = pendingFunding(position, marketData, isLong);
    const paidFunding = funding > 0n ? funding : 0n;
    const borrowing = pendingBorrowing(position, marketData, isLong);

    // Solve equity(price) == mm, where equity = margin + pnl - paidFunding
    // - borrowing and pnl = tokens * price / SCALAR_18 signed by side.
    let target: bigint;
    if (isLong) {
        // floor(tokens*price/SCALAR_18) = mm + notional - margin + paidFunding + borrowing
        target =
            mm +
            position.notional -
            position.margin +
            paidFunding +
            borrowing;
    } else {
        // ceil(tokens*price/SCALAR_18) = notional + margin - paidFunding - borrowing - mm
        target =
            position.notional +
            position.margin -
            paidFunding -
            borrowing -
            mm;
    }
    const price = mulDivFloor(target, SCALAR_18, position.tokens);
    return price < 0n ? 0n : price;
}
