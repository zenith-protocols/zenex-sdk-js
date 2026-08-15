import { i128, u32, u64 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';
import {
    Order, VaultOrder, SidePair, TradingConfig,
    parseOrder, parseVaultOrder, parseSidePair, parseTradingConfig,
} from './trading_types.js';

// =============================================================================
// Trading event types, mirroring `trading/src/events.rs`.
//
// Each `#[contractevent]` struct's topics are `[<snake_case event name>,
// ...#[topic] fields in declaration order]`; remaining fields land in the
// data map. Nested structs (`order`, `config`, the accrual `SidePair`s) are
// routed through the trading_types parsers so they decode to the same
// camelCase interfaces used elsewhere in the SDK.
//
// Fill receipts reuse the order-id topic as a provenance sentinel: id `0` on
// `decrease_fill`/`close_fill` marks an ADL close, and on `redeem_fill` a
// Retired-market instant redeem. The decoded shapes surface that as an
// explicit `source` discriminator so consumers never match on the raw `0`.
// =============================================================================

export enum TradingEventType {
    CreateOrder = 'create_order',
    CancelOrder = 'cancel_order',
    CreateVaultOrder = 'create_vault_order',
    CancelVaultOrder = 'cancel_vault_order',
    DepositFill = 'deposit_fill',
    RedeemFill = 'redeem_fill',
    ClaimFunding = 'claim_funding',
    AdlUpdate = 'adl_update',
    FundingAccrual = 'funding_accrual',
    BorrowingAccrual = 'borrowing_accrual',
    StatusUpdate = 'status_update',
    ConfigUpdate = 'config_update',
    TerminalPriceUpdate = 'terminal_price_update',
    OpenFill = 'open_fill',
    IncreaseFill = 'increase_fill',
    DecreaseFill = 'decrease_fill',
    CloseFill = 'close_fill',
    Liquidation = 'liquidation',
}

// Trading Events
export interface BaseTradingEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Trading;
    eventType: TradingEventType;
}

/**
 * Order created via `create_order`. The row is immutable while pending, so
 * the payload stays authoritative until the order's fill or cancel receipt.
 */
export interface TradingCreateOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CreateOrder;
    user: string;
    orderId: u32;
    /** The stored order row, as returned by `get_order`. */
    order: Order;
}

/**
 * Pending order cancelled: by its owner via `cancel_order` (the refund pays
 * in its own transfer), or by the closure sweep that cancels every decrease
 * order still resting on a side whose position closed (the refunds ride the
 * same-tx `close_fill`/`liquidation` payout transfer, one receipt per swept
 * order).
 */
export interface TradingCancelOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelOrder;
    user: string;
    orderId: u32;
    /** Escrow returned by this cancel (`Order::escrow_amount`), token-dec. */
    refund: i128;
}

/**
 * Vault deposit or redeem order created via `create_vault_order`. The row is
 * immutable while pending, so the payload stays authoritative until the
 * order's fill or cancel receipt.
 */
export interface TradingCreateVaultOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CreateVaultOrder;
    user: string;
    orderId: u32;
    /** The stored vault-order row, as returned by `get_vault_order`. */
    order: VaultOrder;
}

/** Pending vault order cancelled by its owner via `cancel_vault_order`. */
export interface TradingCancelVaultOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelVaultOrder;
    user: string;
    orderId: u32;
}

/** A keeper fill of a deposit order via `execute_vault_order` (the user's receipt). */
export interface TradingDepositFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.DepositFill;
    user: string;
    orderId: u32;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Gross assets moved from escrow, token-dec. */
    assets: i128;
    /** Shares minted to the depositor. */
    shares: i128;
    /** Vault fill fee deducted (keeper, treasury, and vault cuts), token-dec. */
    fee: i128;
    /** Capped net pending trader PnL the share mint priced against, signed, token-dec. */
    netPnl: i128;
}

/** A keeper fill of a redeem order via `execute_vault_order` (the user's receipt). */
export interface TradingRedeemFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.RedeemFill;
    user: string;
    /** Order id; `0` marks a Retired-market instant redeem (see `source`). */
    orderId: u32;
    /** `'order'` for a keeper fill of a pending order, `'instant'` for a Retired-market direct redeem (orderId `0`). */
    source: 'order' | 'instant';
    /** The keeper rewarded for the fill; the user themselves on an instant redeem. */
    keeper: string;
    /** Shares burned. */
    shares: i128;
    /** Gross assets redeemed (the user is paid assets - fee), token-dec. */
    assets: i128;
    /** Vault fill fee deducted (keeper, treasury, and vault cuts), token-dec. */
    fee: i128;
    /** Capped net pending trader PnL the share burn priced against, signed, token-dec. */
    netPnl: i128;
}

/** Claimable funding balance paid out via `claim_funding`. */
export interface TradingClaimFundingEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClaimFunding;
    user: string;
    /** Paid claimable balance, token-dec. */
    amount: i128;
}

/** ADL flags recomputed via `update_adl_state`. */
export interface TradingAdlUpdateEvent extends BaseTradingEvent {
    eventType: TradingEventType.AdlUpdate;
    /** Long-side ADL enabled (long increases blocked). */
    long: boolean;
    /** Short-side ADL enabled (short increases blocked). */
    short: boolean;
}

/** The market's post-accrual funding state, emitted by the `accrue` entry. */
export interface TradingFundingAccrualEvent extends BaseTradingEvent {
    eventType: TradingEventType.FundingAccrual;
    /** Signed funding rate, + = longs pay (SCALAR_18, per second). */
    fundingRate: i128;
    /** Cumulative funding index per side (SCALAR_18). */
    fundingIdx: SidePair;
    /** Accrual timestamp, seconds. */
    timestamp: u64;
}

/** The market's post-accrual borrowing state, emitted by `accrue`. */
export interface TradingBorrowingAccrualEvent extends BaseTradingEvent {
    eventType: TradingEventType.BorrowingAccrual;
    /** Cumulative borrowing index per side (SCALAR_18). */
    borrowingIdx: SidePair;
    /** Accrual timestamp, seconds. */
    timestamp: u64;
}

/** Operational status changed via `set_status`. */
export interface TradingStatusUpdateEvent extends BaseTradingEvent {
    eventType: TradingEventType.StatusUpdate;
    /** The new operational status (Status discriminant). */
    status: u32;
}

/** Global configuration replaced via `set_config`. */
export interface TradingConfigUpdateEvent extends BaseTradingEvent {
    eventType: TradingEventType.ConfigUpdate;
    /** The new global trading configuration. */
    config: TradingConfig;
}

/** Flat settlement price set or refreshed via `set_terminal_price`. */
export interface TradingTerminalPriceUpdateEvent extends BaseTradingEvent {
    eventType: TradingEventType.TerminalPriceUpdate;
    /** Flat settlement price (price_scalar units). */
    price: i128;
}

/**
 * A keeper fill of an increase order that OPENS the side (no prior position);
 * an increase on an already-open position emits `increase_fill` instead, which
 * additionally settles funding and borrowing.
 */
export interface TradingOpenFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.OpenFill;
    user: string;
    orderId: u32;
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Entry-side execution price (ask long / bid short), price_scalar units. */
    price: i128;
    /** Size opened, token-dec. */
    notional: i128;
    /** Base size bought, base-dec. */
    tokens: i128;
    /** Margin pulled from the trader, token-dec. */
    margin: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
}

/** A keeper fill of an increase order on an already-open position (the user's itemized receipt). */
export interface TradingIncreaseFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.IncreaseFill;
    user: string;
    orderId: u32;
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Entry-side execution price (ask long / bid short), price_scalar units. */
    price: i128;
    /** Size added, token-dec. */
    notional: i128;
    /** Base size bought, base-dec. */
    tokens: i128;
    /** Margin pulled from escrow, token-dec. */
    margin: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from margin, - = credited claimable. */
    funding: i128;
    /** Settled borrowing fee, token-dec. */
    borrowing: i128;
}

/**
 * A keeper fill of a partial decrease (the position survives the fill).
 *
 * `notional` and `tokens` are the closed fraction at ENTRY pricing (what
 * leaves the position), so `notional * SCALAR_18 / tokens` is the entry
 * price of the closed chunk; `price` is the exit price the close settled at.
 * `margin` and `pnl` are gross of the itemized fees; `returned` is the
 * actual payout: the withdrawal plus the profit leg, less the fees they
 * cover (a realized loss debits the surviving margin, never the payout).
 */
export interface TradingDecreaseFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.DecreaseFill;
    user: string;
    /** Order id; `0` marks an ADL close (see `source`). */
    orderId: u32;
    /** `'order'` for a keeper fill of a user order, `'adl'` for an ADL close (orderId `0`). */
    source: 'order' | 'adl';
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Exit-side execution price (bid long / ask short), price_scalar units. */
    price: i128;
    /** Closed size at entry pricing, token-dec. */
    notional: i128;
    /** Base size closed, base-dec. */
    tokens: i128;
    /** Requested margin withdrawal, gross of the itemized fees, token-dec. */
    margin: i128;
    /** Realized PnL on the closed fraction (post-haircut), gross of settled costs, token-dec. */
    pnl: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from margin, - = credited claimable. */
    funding: i128;
    /** Settled borrowing fee, token-dec. */
    borrowing: i128;
    /** Amount transferred to the trader, token-dec. */
    returned: i128;
}

/**
 * A keeper fill that closes the whole position (the stored row zeroes).
 *
 * `notional` and `tokens` are the full closed size at ENTRY pricing; `price`
 * is the exit price the close settled at. `margin` and `pnl` are gross
 * of the itemized fees; `returned` is the post-fee equity floored at zero,
 * any shortfall emitted as `badDebt`. The transfer to the trader adds the
 * swept decrease-order escrows announced by the same-tx `cancel_order`
 * receipts.
 */
export interface TradingCloseFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.CloseFill;
    user: string;
    /** Order id; `0` marks an ADL close (see `source`). */
    orderId: u32;
    /** `'order'` for a keeper fill of a user order, `'adl'` for an ADL close (orderId `0`). */
    source: 'order' | 'adl';
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Exit-side execution price (bid long / ask short), price_scalar units. */
    price: i128;
    /** Full closed size at entry pricing, token-dec. */
    notional: i128;
    /** Base size closed, base-dec. */
    tokens: i128;
    /** Freed margin, gross of the itemized fees, token-dec. */
    margin: i128;
    /** Realized PnL on the closed size (post-haircut), gross of settled costs, token-dec. */
    pnl: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from margin, - = credited claimable. */
    funding: i128;
    /** Settled borrowing fee, token-dec. */
    borrowing: i128;
    /** Fees and losses past the freed margin, absorbed by the vault, token-dec. */
    badDebt: i128;
    /** Post-fee equity floored at zero, transferred to the trader, token-dec. */
    returned: i128;
}

/**
 * A keeper liquidation receipt (the full size is force-closed).
 *
 * `margin` and `pnl` are gross of the itemized fees; every liquidation
 * charges `liqFee = min(equity, ceil(config.liqFee * notional))` (split
 * keeper/treasury/vault like a trade fee) and pays the trader the rest on
 * `returned` — zero exactly where the fee saturates on the whole remainder;
 * any shortfall past the freed margin is emitted as `badDebt` and absorbed
 * by the vault.
 */
export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    user: string;
    isLong: boolean;
    /** The keeper rewarded for the liquidation. */
    keeper: string;
    /** Exit-side execution price (bid long / ask short), price_scalar units. */
    price: i128;
    /** Force-closed size, token-dec. */
    notional: i128;
    /** Base size closed, base-dec. */
    tokens: i128;
    /** Freed margin, gross of the itemized fees, token-dec. */
    margin: i128;
    /** Realized PnL on the closed size (post-haircut), gross of settled costs, token-dec. */
    pnl: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from margin, - = credited claimable. */
    funding: i128;
    /** Settled borrowing fee, token-dec. */
    borrowing: i128;
    /** Fees and losses past the freed margin, absorbed by the vault, token-dec. */
    badDebt: i128;
    /**
     * Remainder paid to the trader net of the liquidation fee, token-dec; the
     * transfer adds the swept decrease-order escrows announced by the same-tx
     * `cancel_order` receipts.
     */
    returned: i128;
    /** Liquidation fee charged: min(equity, ceil(config.liqFee * notional)), token-dec. */
    liqFee: i128;
}

export type TradingEvent =
    | TradingCreateOrderEvent
    | TradingCancelOrderEvent
    | TradingCreateVaultOrderEvent
    | TradingCancelVaultOrderEvent
    | TradingDepositFillEvent
    | TradingRedeemFillEvent
    | TradingClaimFundingEvent
    | TradingAdlUpdateEvent
    | TradingFundingAccrualEvent
    | TradingBorrowingAccrualEvent
    | TradingStatusUpdateEvent
    | TradingConfigUpdateEvent
    | TradingTerminalPriceUpdateEvent
    | TradingOpenFillEvent
    | TradingIncreaseFillEvent
    | TradingDecreaseFillEvent
    | TradingCloseFillEvent
    | TradingLiquidationEvent;
