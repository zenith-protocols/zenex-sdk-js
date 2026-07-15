import { Address, rpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { SCALAR_18, mulFloor, mulCeil } from '../math.js';
import { persistentLedgerKey } from '../ledger-keys.js';
import {
    Position,
    MarketData,
    TradingConfig,
    parsePosition,
} from './trading_types.js';

// =============================================================================
// v2 position math and loader.
//
// Every formula is ported from `zenex-contracts/trading/src/trading/position.rs`
// and `.../math.rs` (branch v2/dev). A v2 position is netted per `(user,
// is_long)` and stores `tokens` (base-dec size) with the implied entry price
// `notional / tokens`; PnL is `tokens * price - notional` for a long, inverse
// for a short.
//
// Rounding semantics: the contract's fixed-point helpers use true floor
// (toward -inf) and true ceil (toward +inf). The SDK's `mulFloor` and
// `mulCeil` implement the same rounding for every sign, so each formula
// below reproduces the Rust exactly.
//
// The `priceScalar` argument on the PnL functions is the fixed-point scalar
// baked into `Position.tokens` by the contract's `math::to_tokens`
// (`tokens = notional * SCALAR_18 / price`), so for the v2 contract callers pass
// `SCALAR_18`. The oracle's own price scalar (`10^-exponent`) cancels between
// `tokens` and `price` and is not this argument.
// =============================================================================

/**
 * Signed PnL of `position` marked at `price`, token-dec.
 *
 * Ports `math::pnl`: a long is `floor(tokens * price / priceScalar) - notional`,
 * a short is `notional - ceil(tokens * price / priceScalar)`. The token->notional
 * mark rounds against the trader (floor for a long, ceil for a short), matching
 * the contract's conservative-for-the-vault rounding. `price` is the exit price
 * (`price.exit(is_long)` on-chain); `priceScalar` is `SCALAR_18` for v2.
 */
export function positionPnl(
    position: Position,
    price: bigint,
    priceScalar: bigint,
    isLong: boolean,
): bigint {
    if (isLong) {
        return (
            mulFloor(position.tokens, price, priceScalar) - position.notional
        );
    }
    return position.notional - mulCeil(position.tokens, price, priceScalar);
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
    return mulCeil(
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
    return mulCeil(
        position.notional,
        marketIdx - position.borrowingIdx,
        SCALAR_18,
    );
}

/**
 * Position equity, token-dec: `collateral + pnl - max(0, pendingFunding) -
 * pendingBorrowing`.
 *
 * The contract's `Position::equity` is `collateral + pnl` because
 * `calculate_fees` has already debited the accruals into `collateral`; a stored
 * position read by the SDK has not been settled, so this subtracts the pending
 * accruals via their index deltas. Matching `Fees::debit`, only paid funding
 * (a positive accrual) debits the margin; earned funding routes to the user's
 * separate claimable balance and never shores up the position's equity.
 *
 * The `marketData` indices themselves are as of the market's last on-chain
 * accrual (`fundingUpdate` / `borrowingUpdate`); this does not extrapolate the
 * current rates over the seconds since, whereas the contract advances both
 * indices to `now` before any equity check. Between keeper touches the result
 * slightly overstates equity.
 *
 * @remarks Display estimate only. Transaction code must use
 * `quotePositionAction` with one coherent `TradingSnapshot`.
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
        position.collateral +
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
 * `equity < ceil(maintenance_margin * notional)` directly (`Position::require_valid`
 * / `liquidate`). This inverts that maintenance line against the same equity
 * model as `positionEquity` (collateral, PnL, and the funding/borrowing index
 * accruals) to solve for the marking price where equity meets the maintenance
 * margin. It excludes the incremental base/impact close fee, which is
 * second-order for the threshold estimate. Funding is taken at
 * `max(0, pending)` since earned funding does not shore up the position's
 * liquidation equity (`Fees::debit` only debits paid funding).
 *
 * The `marketData` indices are as of the market's last on-chain accrual; the
 * estimate does not extrapolate the current rates over the seconds since,
 * whereas the contract advances both indices to `now` before a liquidation
 * check. Between keeper touches the estimate sits slightly further from the
 * mark than the true threshold.
 *
 * @remarks Display estimate only. Use `liquidationState` for an exact checked
 * result at a declared ledger and authenticated price.
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
    const mm = mulCeil(position.notional, config.maintenanceMargin, SCALAR_18);
    const funding = pendingFunding(position, marketData, isLong);
    const paidFunding = funding > 0n ? funding : 0n;
    const borrowing = pendingBorrowing(position, marketData, isLong);

    // Solve equity(price) == mm, where equity = collateral + pnl - paidFunding
    // - borrowing and pnl = tokens * price / SCALAR_18 signed by side.
    let target: bigint;
    if (isLong) {
        // floor(tokens*price/SCALAR_18) = mm + notional - collateral + paidFunding + borrowing
        target =
            mm +
            position.notional -
            position.collateral +
            paidFunding +
            borrowing;
    } else {
        // ceil(tokens*price/SCALAR_18) = notional + collateral - paidFunding - borrowing - mm
        target =
            position.notional +
            position.collateral -
            paidFunding -
            borrowing -
            mm;
    }
    const price = mulFloor(target, SCALAR_18, position.tokens);
    return price < 0n ? 0n : price;
}

/**
 * PositionView - loader for a netted v2 position, keyed `(user, is_long)`.
 *
 * Wraps the `Position` persistent entry (equivalent to the `get_position` view)
 * and exposes the pure math above as instance methods bound to the loaded state.
 * Mirrors the v1 loader role, adapted to the single-market, per-side v2 storage.
 */
export class PositionView {
    constructor(
        public readonly position: Position,
        public readonly user: string,
        public readonly isLong: boolean,
    ) {}

    /**
     * Load the netted position for `(user, isLong)` from the contract's
     * persistent storage (`DataKey::Position(user, is_long)`). Returns `null`
     * when the entry is absent (a never-opened side).
     */
    public static async load(
        network: Network,
        contractId: string,
        user: string,
        isLong: boolean,
    ): Promise<PositionView | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const key = persistentLedgerKey(contractId, [
            xdr.ScVal.scvSymbol('Position'),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return null;
            const native = scValToNative(
                response.entries[0].val.contractData().val(),
            );
            return new PositionView(parsePosition(native), user, isLong);
        } catch {
            return null;
        }
    }

    /** Signed PnL marked at `price` (`priceScalar` = SCALAR_18 for v2). */
    pnl(price: bigint, priceScalar: bigint = SCALAR_18): bigint {
        return positionPnl(this.position, price, priceScalar, this.isLong);
    }

    /** Pending funding accrual (signed) against `marketData`. */
    pendingFunding(marketData: MarketData): bigint {
        return pendingFunding(this.position, marketData, this.isLong);
    }

    /** Pending borrowing accrual against `marketData`. */
    pendingBorrowing(marketData: MarketData): bigint {
        return pendingBorrowing(this.position, marketData, this.isLong);
    }

    /** Equity: collateral + PnL less pending paid funding and borrowing. */
    equity(
        marketData: MarketData,
        price: bigint,
        priceScalar: bigint = SCALAR_18,
    ): bigint {
        return positionEquity(
            this.position,
            marketData,
            price,
            priceScalar,
            this.isLong,
        );
    }

    /** Estimated liquidation price in price_scalar units. */
    liquidationPrice(config: TradingConfig, marketData: MarketData): bigint {
        return liquidationPrice(this.position, config, marketData, this.isLong);
    }

    /** Open notional still unlocked at `nowSecs`. */
    unlockedNotional(nowSecs: bigint): bigint {
        return unlockedNotional(this.position, nowSecs);
    }
}
