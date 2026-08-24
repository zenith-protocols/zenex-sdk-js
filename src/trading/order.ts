import type { OrderParams } from '../contracts/router/types.js';
import { ZenexError, zenexErrorFromGate } from '../errors.js';
import { OrderKind } from '../contracts/market/types.js';
import { SCALAR_18, mulDivFloor } from '../math/fixed.js';
import { formatPrice, formatToken, formatTokenFloor } from '../float.js';
import type { Market } from './market.js';
import { MarketPosition } from './position.js';
import type { PositionEstimate } from './position_est.js';
import { estimatePosition } from './position_est.js';
import { Price, resolvePrice } from './price.js';
import type { PriceInput } from './price.js';
import type { MarketContext } from './internal/apply.js';
import {
    applyOrder,
    orderPriceBound as enginePriceBound,
} from './internal/apply.js';
import { quoteTradeFees } from './internal/math.js';
import {
    closePositionParams,
    decreasePositionParams,
    addMarginParams,
    withdrawMarginParams,
    openLimitParams,
    openMarketParams,
    stopLossParams,
    takeProfitParams,
    isDecreaseOrderKind,
    isIncreaseOrderKind,
    isMarketOrderKind,
    isTriggerOrderKind,
} from './internal/order.js';

export {
    isDecreaseOrderKind,
    isIncreaseOrderKind,
    isMarketOrderKind,
    isTriggerOrderKind,
};

/**
 * Order factory bound to one ticket's context: a market snapshot, an owner,
 * and a side. Each method builds one complete, signable `OrderParams` in a
 * single call — preview it with `previewOrder` / `position.preview`, sign
 * the identical object.
 *
 * The bound market supplies what a caller would otherwise wire by hand:
 * `expiration` derives from `market.ledger + ttlLedgers`, and a fill bound
 * derives from `slippageBps` against the execution price the kind fills at.
 * The methods also encode the contract's conventions that `OrderKind` alone
 * does not express: the `FULL_CLOSE` sentinel, margin-only orders as
 * `notional: 0n`, and the trigger-direction rules for TP/SL.
 */
export class OrderIntent {
    constructor(
        /** Market snapshot expirations and price bounds derive from. */
        public market: Market,
        /** The order owner. */
        public user: string,
        /** Side every built order targets. */
        public isLong: boolean,
        /** Default order lifetime in ledgers (`expiration = market.ledger + ttlLedgers`). */
        public ttlLedgers: number = 60,
        /** Default maximum adverse slippage, basis points (10_000 = 100%). 0 = unbounded, matching the contract's own default. */
        public slippageBps: bigint = 0n,
    ) {}

    private base(): { market: string; user: string; isLong: boolean; expiration: number } {
        return {
            market: this.market.id,
            user: this.user,
            isLong: this.isLong,
            expiration: this.market.ledger + this.ttlLedgers,
        };
    }

    /** @throws {RangeError} when a slippage bound is configured but no price was given to measure it against. */
    private bound(kind: OrderKind, price?: PriceInput): bigint {
        if (this.slippageBps === 0n) return 0n;
        if (price === undefined) {
            throw new RangeError(
                'slippageBps is set, so a price is required to derive the fill bound',
            );
        }
        return orderPriceBound(price, this.isLong, kind, this.slippageBps);
    }

    /** Open or increase a position at market. */
    openMarket(args: {
        /** Size to open, token-dec. */
        notional: bigint;
        /** Margin to escrow with the position, token-dec. */
        margin: bigint;
        /** Execution price the slippage bound is measured against. Required only when `slippageBps` is nonzero. */
        price?: PriceInput;
    }): OrderParams {
        return openMarketParams({
            ...this.base(),
            notional: args.notional,
            margin: args.margin,
            priceBound: this.bound(OrderKind.MarketIncrease, args.price),
        });
    }

    /** Open once the trigger price is crossed. The bound is measured against the trigger. */
    openLimit(args: {
        notional: bigint;
        margin: bigint;
        /** Crossing price that makes the order eligible, 18-dec. Must be positive. */
        triggerPrice: bigint;
    }): OrderParams {
        return openLimitParams({
            ...this.base(),
            notional: args.notional,
            margin: args.margin,
            triggerPrice: args.triggerPrice,
            priceBound: this.bound(
                OrderKind.LimitIncrease,
                Price.from(args.triggerPrice),
            ),
        });
    }

    /**
     * Fully close the position at market. Encodes the `FULL_CLOSE` sentinel
     * (`2^127 - 1`) rather than the current size, so the close cannot turn
     * partial by racing a size change.
     */
    closePosition(price?: PriceInput): OrderParams {
        return closePositionParams({
            ...this.base(),
            priceBound: this.bound(OrderKind.MarketDecrease, price),
        });
    }

    /** Decrease at market, optionally withdrawing margin. A notional at or above the open size closes fully. */
    decrease(args: {
        notional: bigint;
        /** Margin to withdraw, token-dec. Defaults to 0 (keep the current margin). */
        margin?: bigint;
        /** Required only when `slippageBps` is nonzero. */
        price?: PriceInput;
    }): OrderParams {
        return decreasePositionParams({
            ...this.base(),
            notional: args.notional,
            margin: args.margin ?? 0n,
            priceBound: this.bound(OrderKind.MarketDecrease, args.price),
        });
    }

    /**
     * Add margin without changing size. Encodes the margin-only convention:
     * `MarketIncrease` with `notional: 0n` and the amount on `margin`.
     */
    addMargin(amount: bigint): OrderParams {
        return addMarginParams({ ...this.base(), amount });
    }

    /** Withdraw margin without changing size (`MarketDecrease`, `notional: 0n`). */
    withdrawMargin(amount: bigint): OrderParams {
        return withdrawMarginParams({ ...this.base(), amount });
    }

    /**
     * Close (part of) the position once the price crosses the trigger
     * FAVORABLY: `LimitDecrease`, which a long fills at or above the trigger
     * and a short at or below. The bound is measured against the trigger.
     */
    takeProfit(args: {
        /** Crossing price, 18-dec. Must be positive. */
        triggerPrice: bigint;
        /** Size to close on trigger, token-dec. Defaults to `FULL_CLOSE`. */
        notional?: bigint;
    }): OrderParams {
        return takeProfitParams({
            ...this.base(),
            triggerPrice: args.triggerPrice,
            notional: args.notional,
            priceBound: this.bound(
                OrderKind.LimitDecrease,
                Price.from(args.triggerPrice),
            ),
        });
    }

    /**
     * Close (part of) the position once the price crosses the trigger
     * ADVERSELY: `StopDecrease`, which a long fills at or below the trigger
     * and a short at or above.
     */
    stopLoss(args: {
        triggerPrice: bigint;
        notional?: bigint;
    }): OrderParams {
        return stopLossParams({
            ...this.base(),
            triggerPrice: args.triggerPrice,
            notional: args.notional,
            priceBound: this.bound(
                OrderKind.StopDecrease,
                Price.from(args.triggerPrice),
            ),
        });
    }
}

/**
 * Derive the adverse `priceBound` for an order kind from a maximum slippage
 * in basis points against the execution price the kind fills at. Exposed for
 * callers writing `OrderParams` literals; `OrderIntent` applies it
 * internally.
 */
export function orderPriceBound(
    price: PriceInput,
    isLong: boolean,
    kind: OrderKind,
    maxSlippageBps: bigint,
): bigint {
    return enginePriceBound(resolvePrice(price), isLong, kind, maxSlippageBps);
}

/**
 * The transition record {@link previewOrder} returns: whether the order
 * fills, what it costs, and the resulting position when it does.
 */
export interface OrderEstimate {
    /** `fills`: exact transition below. `rests`: creates but does not fill at this price. `gate`: can never fill. */
    outcome: 'fills' | 'rests' | 'gate';
    /**
     * The gate when `outcome === 'gate'`, else `undefined`: `code` is the
     * mirrored contract error (e.g. 713), or an SDK sentinel
     * (`QuoteInvalidInput`, `QuoteOverflow`) for a failure the contract
     * never sees.
     */
    gate: ZenexError | undefined;
    /** Why a `rests` outcome rests at this price, else `undefined`. */
    reason: string | undefined;
    /** Skew-split base fee, token units. */
    baseFee: number;
    /** Size-quadratic impact fee, token units. */
    impactFee: number;
    /** Flat keeper execution fee escrowed with the order, token units. */
    execFee: number;
    /** baseFee + impactFee + execFee, token units. */
    totalFees: number;
    /** Funding settled by the fill over the pre-fill notional, token units. Positive is paid by the trader, negative earned. */
    funding: number;
    /** Borrowing settled by the fill, token units (never negative). */
    borrowing: number;
    /** Escrowed at creation: margin + execFee on an increase, execFee alone otherwise. Token units. */
    escrowed: number;
    /** Execution price the fill is sized at (entry side for an increase, exit side for a decrease). */
    executionPrice: number;
    /** What actually pays out on a decrease (the paid withdrawal plus the profit the fees did not consume), token units. */
    payout: number;
    /** The position after the fill. `undefined` unless `outcome === 'fills'`; a full close yields a flat position. */
    position: PositionEstimate | undefined;
}

/** @internal Assemble the engine's context record from the public objects. */
export function marketContext(
    market: Market,
    position: MarketPosition,
    price: PriceInput,
    now?: bigint,
    user = '',
): MarketContext {
    return {
        subject: { user, isLong: position.isLong },
        ledger: market.ledger,
        ledgerTime: now ?? BigInt(Math.floor(Date.now() / 1000)),
        status: market.status,
        config: market.config,
        market: market.data,
        position,
        price: resolvePrice(price),
        vault: market.vaultAtomic(),
        treasuryRate: market.treasuryRate,
        adl: market.adl,
        retirement: market.retirement,
    };
}

/**
 * The creation pre-flight: preview applying `order` (the same `OrderParams`
 * you will sign, e.g. from `OrderIntent`) to `position` at `price`. Runs
 * the exact fill engine — what you preview is what the chain would do. This
 * catches what creation does not: the chain accepts orders that can never
 * fill (a decrease that would break the margin gate, #713).
 */
export function previewOrder(
    market: Market,
    position: MarketPosition,
    order: OrderParams,
    price: PriceInput,
    now?: bigint,
): OrderEstimate {
    const decimals = market.assetDecimals;
    const execFee = formatToken(market.config.execFee, decimals);
    const escrowedAtomic =
        (isIncreaseOrderKind(order.kind) ? order.margin : 0n) +
        market.config.execFee;
    const escrowed = formatToken(escrowedAtomic, decimals);

    const empty = {
        baseFee: 0,
        impactFee: 0,
        execFee,
        totalFees: execFee,
        funding: 0,
        borrowing: 0,
        escrowed,
        executionPrice: 0,
        payout: 0,
        position: undefined,
    };

    const context = marketContext(market, position, price, now, order.user);
    const applied = applyOrder(context, order, {
        executionFee: market.config.execFee,
    });

    if (applied.kind === 'rests') {
        return {
            outcome: 'rests',
            gate: undefined,
            reason: applied.reason,
            ...empty,
        };
    }
    if (applied.kind === 'gate') {
        return {
            outcome: 'gate',
            gate: zenexErrorFromGate(applied.code, applied.reason),
            reason: undefined,
            ...empty,
        };
    }

    const outcome = applied.outcome;
    const fees = outcome.fees;
    const post = MarketPosition.from(outcome.postPosition, position.isLong);
    return {
        outcome: 'fills',
        gate: undefined,
        reason: undefined,
        baseFee: formatToken(fees.base, decimals),
        impactFee: formatToken(fees.impact, decimals),
        execFee,
        totalFees: formatToken(
            fees.base + fees.impact + market.config.execFee,
            decimals,
        ),
        funding: formatToken(fees.funding, decimals),
        borrowing: formatToken(fees.borrowing, decimals),
        escrowed,
        executionPrice: formatPrice(outcome.executionPrice),
        payout: formatToken(outcome.walletPayout, decimals),
        position: estimatePosition(
            market.withData(outcome.postMarket),
            post,
            price,
            now,
        ),
    };
}

const LEVERAGE_SCALE = 10_000n;

/**
 * Largest margin a wallet balance affords at a chosen leverage: solves
 * `balance = margin + tradeFee(margin * leverage) + execFee` against the
 * fee model (base fee at the side's rate plus the size-quadratic impact
 * fee). The order ticket's "Max" button. Token units, floor-rounded so the
 * value round-trips through an input field and `parseAtomic` without
 * exceeding the true maximum. `0` when the balance cannot cover the fees.
 */
export function maxMarginForBalance(
    market: Market,
    isLong: boolean,
    balance: bigint,
    leverage: number,
    price: PriceInput,
): number {
    if (balance <= market.config.execFee || leverage <= 0) return 0;
    const priceData = resolvePrice(price);
    const entry = isLong ? priceData.ask : priceData.bid;
    if (entry <= 0n) return 0;
    const leverageScaled = BigInt(Math.round(leverage * Number(LEVERAGE_SCALE)));
    const budget = balance - market.config.execFee;

    const cost = (margin: bigint): bigint => {
        const notional = (margin * leverageScaled) / LEVERAGE_SCALE;
        const tokens = mulDivFloor(notional, SCALAR_18, entry);
        const fees = quoteTradeFees(
            market.data,
            market.config,
            isLong,
            notional,
            tokens,
        );
        return margin + fees.base + fees.impact;
    };

    // cost() grows monotonically with margin, so binary search the largest
    // margin whose all-in cost still fits the budget.
    let low = 0n;
    let high = budget;
    while (low < high) {
        const mid = low + (high - low + 1n) / 2n;
        if (cost(mid) <= budget) low = mid;
        else high = mid - 1n;
    }
    return formatTokenFloor(low, market.assetDecimals);
}
