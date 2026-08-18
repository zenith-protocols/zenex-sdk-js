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

/**
 * Fields every position order carries, whatever its kind. Every builder below
 * returns `OrderParams` data, not XDR. Pass the result to `buildOrderOperation`,
 * which validates it against a ledger snapshot before submission.
 */
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
    /** Size to open, token-dec. */
    notional: i128;
    /** Margin to escrow with the position, token-dec. */
    margin: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Open a position once the trigger price is crossed. */
export interface OpenLimitArgs extends OrderIntentBase {
    /** Size to open once the order fills, token-dec. */
    notional: i128;
    /** Margin to escrow with the position, token-dec. */
    margin: i128;
    /** Crossing price that makes the order eligible, price_scalar. Must be positive. */
    triggerPrice: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Fully close a position at market. */
export interface ClosePositionArgs extends OrderIntentBase {
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Decrease a position at market, optionally withdrawing margin. */
export interface DecreasePositionArgs extends OrderIntentBase {
    /** Size to close, token-dec. A value at or above the open size closes it fully. */
    notional: i128;
    /** Margin to withdraw, token-dec. 0 keeps the current margin. */
    margin: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Margin-only order (notional 0): add or withdraw margin without changing size. */
export interface ModifyMarginArgs extends OrderIntentBase {
    /** Margin to add or withdraw, token-dec. Always positive; the builder sets the direction. */
    amount: i128;
}

/** A take-profit or stop-loss trigger order. */
export interface TriggerOrderArgs extends OrderIntentBase {
    /** Crossing price that makes the order eligible, price_scalar. Must be positive. */
    triggerPrice: i128;
    /** Size to close on trigger, token-dec. Defaults to `FULL_CLOSE`, which closes the whole position. */
    notional?: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Deposit assets into the vault. */
export interface VaultDepositArgs {
    /** The trading contract the order is created on. */
    trading: string;
    /** The order owner. */
    user: string;
    /** Assets to deposit, token-dec. */
    amount: i128;
    /** Minimum shares received at fill, net of the deposit fee; 0 = unset. */
    minOut: i128;
}

/** Redeem vault shares for assets. */
export interface VaultRedeemArgs {
    /** The trading contract the order is created on. */
    trading: string;
    /** The order owner. */
    user: string;
    /** Shares to redeem, vault share decimals. */
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
    /** Assets to deposit, token-dec, or shares to redeem, vault share decimals. */
    amount: i128;
    /** Minimum output at fill, net of the vault fee; 0 = unset. */
    minOut: i128;
}

// =============================================================================
// Position orders
// =============================================================================

/**
 * Open or add to a position at market (`MarketIncrease`). Fills `notional`,
 * `margin`, and `priceBound` from the caller. `triggerPrice` is always 0; a
 * market kind never reads it.
 */
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
 * Fully close a position at market (`MarketDecrease`). `notional` is always
 * `FULL_CLOSE`, which tells the contract to close the entire position.
 * `margin` is always 0, so nothing is withdrawn beyond the closed proceeds.
 * `triggerPrice` is always 0; a market kind never reads it.
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

/**
 * Decrease a position at market (`MarketDecrease`), optionally withdrawing
 * margin. `triggerPrice` is always 0; a market kind never reads it.
 */
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

/**
 * Add margin to a position without changing its size (`MarketIncrease` with
 * `notional` fixed at 0). `triggerPrice` is always 0 and unread by a market
 * kind. `priceBound` is always 0, so the fill has no slippage limit.
 */
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

/**
 * Withdraw margin from a position without changing its size (`MarketDecrease`
 * with `notional` fixed at 0). `triggerPrice` is always 0 and unread by a
 * market kind. `priceBound` is always 0, so the fill has no slippage limit.
 */
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
 * Place a take-profit trigger (`LimitDecrease`): closes size when the price
 * crosses `triggerPrice` favorably, upside for a long and downside for a
 * short. `margin` is always 0; a trigger order never withdraws margin.
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
 * Place a stop-loss trigger (`StopDecrease`): closes size when the price
 * crosses `triggerPrice` adversely, downside for a long and upside for a
 * short. `margin` is always 0; a trigger order never withdraws margin.
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
