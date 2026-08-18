// =============================================================================
// Order intents: named orders -> `OrderParams` data.
//
// `create_order` is one entrypoint carrying eight positional arguments whose
// meaning depends on the `OrderKind` discriminant: a market order ignores
// `triggerPrice`, a margin-only change sets `notional` to 0, a full close sets
// it to the `FULL_CLOSE` sentinel. These builders encode those combinations so
// callers name the order they want instead of memorizing the encoding.
//
// They return DATA, not XDR. Feed the result to `buildOrderOperation`, which
// runs `validateOrder` against a ledger snapshot and applies the execution
// policy. Building the operation straight off a contract binding would skip
// both, so intents deliberately stop at the parameter object.
// =============================================================================

import type { i128, u32 } from '../../index.js';
import type { OrderParams } from '../../contracts/router/router_types.js';
import {
    FULL_CLOSE,
    OrderKind,
    VaultOrderKind,
} from '../../contracts/trading/trading_types.js';

// =============================================================================
// Argument interfaces
// =============================================================================

/** Fields every position order carries, whatever its kind. */
export interface OrderIntentBase {
    /** The trading contract the order is created on. */
    trading: string;
    /** The order owner. */
    user: string;
    /** Side the order targets. */
    isLong: boolean;
    /** Ledger sequence; eligible while the current sequence <= expiration. */
    expiration: u32;
}

/** Open a position at market (no trigger). */
export interface OpenMarketArgs extends OrderIntentBase {
    notional: i128;
    margin: i128;
    priceBound: i128;
}

/** Open a position once the trigger price is crossed. */
export interface OpenLimitArgs extends OrderIntentBase {
    notional: i128;
    margin: i128;
    triggerPrice: i128;
    priceBound: i128;
}

/** Fully close a position at market. */
export interface ClosePositionArgs extends OrderIntentBase {
    priceBound: i128;
}

/** Partially decrease a position, optionally withdrawing margin. */
export interface DecreasePositionArgs extends OrderIntentBase {
    notional: i128;
    margin: i128;
    priceBound: i128;
}

/** Margin-only order (notional 0): add or withdraw margin without changing size. */
export interface ModifyMarginArgs extends OrderIntentBase {
    amount: i128;
}

/** A take-profit or stop-loss trigger order. */
export interface TriggerOrderArgs extends OrderIntentBase {
    triggerPrice: i128;
    /** Size to close on trigger; defaults to `FULL_CLOSE`. */
    notional?: i128;
    priceBound: i128;
}

/** Deposit assets into the vault. */
export interface VaultDepositArgs {
    trading: string;
    user: string;
    amount: i128;
    /** Minimum shares received at fill, net of the deposit fee; 0 = unset. */
    minOut: i128;
}

/** Redeem vault shares for assets. */
export interface VaultRedeemArgs {
    trading: string;
    user: string;
    shares: i128;
    /** Minimum assets received at fill, net of the redeem fee; 0 = unset. */
    minOut: i128;
}

/** Arguments of a `create_vault_order` call, as data. */
export interface VaultOrderParams {
    /** The target trading contract the `create_vault_order` runs on. */
    trading: string;
    /** The order owner. */
    user: string;
    /** Deposit or Redeem. */
    kind: VaultOrderKind;
    /** Assets to deposit, or shares to redeem; token-dec. */
    amount: i128;
    /** Minimum output at fill, net of the vault fee; 0 = unset. */
    minOut: i128;
}

// =============================================================================
// Position orders
// =============================================================================

/** Open (or add to) a position at market: `MarketIncrease`, `triggerPrice` unread. */
export function openMarketParams(args: OpenMarketArgs): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketIncrease,
        notional: args.notional,
        margin: args.margin,
        triggerPrice: 0n,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Open a position once the trigger price is crossed favorably
 * (`LimitIncrease`): a long buys at-or-below the trigger, a short sells
 * at-or-above it.
 */
export function openLimitParams(args: OpenLimitArgs): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.LimitIncrease,
        notional: args.notional,
        margin: args.margin,
        triggerPrice: args.triggerPrice,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Fully close a position at market: `MarketDecrease` with the `FULL_CLOSE`
 * notional sentinel and no margin withdrawal.
 */
export function closePositionParams(args: ClosePositionArgs): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketDecrease,
        notional: FULL_CLOSE,
        margin: 0n,
        triggerPrice: 0n,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/** Partially decrease a position at market, optionally withdrawing margin. */
export function decreasePositionParams(
    args: DecreasePositionArgs,
): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketDecrease,
        notional: args.notional,
        margin: args.margin,
        triggerPrice: 0n,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/** Add margin to a position without changing its size (`notional` 0). */
export function addMarginParams(args: ModifyMarginArgs): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketIncrease,
        notional: 0n,
        margin: args.amount,
        triggerPrice: 0n,
        priceBound: 0n,
        expiration: args.expiration,
    };
}

/** Withdraw margin from a position without changing its size (`notional` 0). */
export function withdrawMarginParams(args: ModifyMarginArgs): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketDecrease,
        notional: 0n,
        margin: args.amount,
        triggerPrice: 0n,
        priceBound: 0n,
        expiration: args.expiration,
    };
}

/**
 * Place a take-profit trigger (`LimitDecrease`): a decrease that fires when the
 * price crosses the trigger favorably (upside for a long, downside for a
 * short). Defaults to a full close.
 */
export function takeProfitParams(args: TriggerOrderArgs): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.LimitDecrease,
        notional: args.notional ?? FULL_CLOSE,
        margin: 0n,
        triggerPrice: args.triggerPrice,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Place a stop-loss trigger (`StopDecrease`): a decrease that fires when the
 * price crosses the trigger adversely (downside for a long, upside for a
 * short). Defaults to a full close.
 */
export function stopLossParams(args: TriggerOrderArgs): OrderParams {
    return {
        trading: args.trading,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.StopDecrease,
        notional: args.notional ?? FULL_CLOSE,
        margin: 0n,
        triggerPrice: args.triggerPrice,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

// =============================================================================
// Vault orders
// =============================================================================

/** Deposit assets into the vault for the keeper to fill. */
export function vaultDepositParams(args: VaultDepositArgs): VaultOrderParams {
    return {
        trading: args.trading,
        user: args.user,
        kind: VaultOrderKind.Deposit,
        amount: args.amount,
        minOut: args.minOut,
    };
}

/**
 * Redeem vault shares for assets, for the keeper to fill. The share count
 * travels in the same `amount` argument a deposit uses for assets.
 */
export function vaultRedeemParams(args: VaultRedeemArgs): VaultOrderParams {
    return {
        trading: args.trading,
        user: args.user,
        kind: VaultOrderKind.Redeem,
        amount: args.shares,
        minOut: args.minOut,
    };
}
