import { SCALAR_18, mulDivCeil, mulDivFloor } from '../../math/fixed.js';
import type {
    MarketData,
    Position,
    TradingConfig,
} from '../../contracts/trading/trading_types.js';

// =============================================================================
// Display estimates over a stored (unsettled) position.
//
// Every formula is ported from the contract's `Position` and math modules.
// These mark a RAW stored position at a single price without
// settling accruals into margin, so they are estimates for display surfaces.
// Transaction code must use `quotePositionAction` / `applyOrder` with one
// coherent `TradingSnapshot`.
//
// Rounding matches the contract's fixed-point helpers: true floor (toward -inf)
// and true ceil (toward +inf) for every sign. `priceScalar` is the SCALAR_18
// scalar baked into `Position.tokens` by `math::to_tokens`; callers pass
// `SCALAR_18`.
// =============================================================================

/**
 * Signed PnL of `position` marked at `price`, token-dec.
 *
 * Ports `math::pnl`: a long is `floor(tokens * price / priceScalar) - notional`,
 * a short is `notional - ceil(tokens * price / priceScalar)`. The mark rounds
 * against the trader, matching the contract's conservative-for-the-vault
 * rounding. `price` is the exit price (`price.exit(is_long)` on-chain).
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
 * Ports `Position::calculate_fees` / `math::accrued_amount`:
 * `ceil(notional * (marketFundingIdx[side] - position.fundingIdx) / SCALAR_18)`.
 * The ceil rounds toward +inf for both signs so a payer never underpays and a
 * receiver (negative delta) never over-claims.
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
 * Ports `Position::calculate_fees` / `math::accrued_amount`:
 * `ceil(notional * (marketBorrowingIdx[side] - position.borrowingIdx) / SCALAR_18)`.
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
 * The contract's `Position::equity` is `margin + pnl` because
 * `calculate_fees` has already debited the accruals into `margin`; a stored
 * position read by the SDK has not been settled, so this subtracts the pending
 * accruals via their index deltas. Matching `Fees::debit`, only paid funding
 * (a positive accrual) debits the margin; earned funding routes to the user's
 * separate claimable balance and never shores up the position's equity.
 *
 * The `marketData` indices are as of the market's last on-chain accrual; this
 * does not extrapolate the current rates over the seconds since, whereas the
 * contract advances both indices to `now` before any equity check. Between
 * keeper touches the result slightly overstates equity.
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
 * (`Position::require_valid` / `liquidate`). This inverts that maintenance
 * line against the same equity model as `positionEquity` to solve for the
 * marking price where equity meets the maintenance margin. It excludes the
 * incremental base/impact close fee, which is second-order for the threshold
 * estimate, and does not extrapolate accrual rates past the market's last
 * on-chain accrual. Use `liquidationState` for an exact checked result at a
 * declared ledger and authenticated price.
 */
export function liquidationPrice(
    position: Position,
    config: TradingConfig,
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
