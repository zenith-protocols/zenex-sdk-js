import { i128, u32 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';
import {
    Order, VaultOrder, MarketConfig,
    parseOrder, parseVaultOrder, parseMarketConfig,
} from './types.js';

/** Discriminates a decoded {@link MarketEvent}. */
export enum MarketEventType {
    CreateOrder = 'create_order',
    CancelOrder = 'cancel_order',
    CreateVaultOrder = 'create_vault_order',
    CancelVaultOrder = 'cancel_vault_order',
    DepositFill = 'deposit_fill',
    RedeemFill = 'redeem_fill',
    ClaimFunding = 'claim_funding',
    AdlUpdate = 'adl_update',
    AccrualUpdate = 'accrual_update',
    StatusUpdate = 'status_update',
    ConfigUpdate = 'config_update',
    TerminalPriceUpdate = 'terminal_price_update',
    OpenFill = 'open_fill',
    IncreaseFill = 'increase_fill',
    DecreaseFill = 'decrease_fill',
    CloseFill = 'close_fill',
    Liquidation = 'liquidation',
}

/** Base shape shared by every decoded market contract event. */
export interface BaseMarketEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Market;
    eventType: MarketEventType;
}

/**
 * Order created via `create_order`. The row is immutable while pending, so
 * the payload stays authoritative until the order's fill or cancel receipt.
 */
export interface MarketCreateOrderEvent extends BaseMarketEvent {
    eventType: MarketEventType.CreateOrder;
    user: string;
    orderId: u32;
    /** The stored order row, as returned by `get_order`. */
    order: Order;
}

/**
 * Pending order cancelled by its owner via `cancel_order`, or by the closure
 * sweep that cancels every decrease order resting on a side whose position
 * closed. A direct cancel pays the refund in its own transfer. A swept
 * cancel's refund rides the same-tx `close_fill` or `liquidation` payout
 * transfer, one receipt per swept order.
 */
export interface MarketCancelOrderEvent extends BaseMarketEvent {
    eventType: MarketEventType.CancelOrder;
    user: string;
    orderId: u32;
    /** Escrow returned by this cancel, token-dec. */
    refund: i128;
}

/**
 * Vault deposit or redeem order created via `create_vault_order`. The row is
 * immutable while pending, so the payload stays authoritative until the
 * order's fill or cancel receipt.
 */
export interface MarketCreateVaultOrderEvent extends BaseMarketEvent {
    eventType: MarketEventType.CreateVaultOrder;
    user: string;
    orderId: u32;
    /** The stored vault-order row, as returned by `get_vault_order`. */
    order: VaultOrder;
}

/** Pending vault order cancelled by its owner via `cancel_vault_order`. */
export interface MarketCancelVaultOrderEvent extends BaseMarketEvent {
    eventType: MarketEventType.CancelVaultOrder;
    user: string;
    orderId: u32;
}

/** A keeper fill of a deposit order via `execute_vault_order` (the user's receipt). */
export interface MarketDepositFillEvent extends BaseMarketEvent {
    eventType: MarketEventType.DepositFill;
    user: string;
    orderId: u32;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Gross assets moved from escrow, token-dec. The vault receives assets - fee. */
    assets: i128;
    /** Shares minted to the user. */
    shares: i128;
    /** Vault fill fee deducted (keeper, treasury, and vault cuts), token-dec. */
    fee: i128;
    /** Capped net pending trader PnL the share mint priced against, signed, token-dec. */
    netPnl: i128;
}

/** A keeper fill of a redeem order via `execute_vault_order` (the user's receipt). */
export interface MarketRedeemFillEvent extends BaseMarketEvent {
    eventType: MarketEventType.RedeemFill;
    user: string;
    orderId: u32;
    /** `'order'` for a keeper fill of a pending order, `'instant'` for a Retired-market direct redeem. */
    source: 'order' | 'instant';
    /** The keeper rewarded for the fill. On an instant redeem, this is the user. */
    keeper: string;
    /** Shares burned from escrow. */
    shares: i128;
    /** Gross assets redeemed, token-dec. The user is paid assets - fee. */
    assets: i128;
    /** Vault fill fee deducted (keeper, treasury, and vault cuts), token-dec. */
    fee: i128;
    /** Capped net pending trader PnL the share burn priced against, signed, token-dec. */
    netPnl: i128;
}

/** Claimable funding balance paid out via `claim_funding`. */
export interface MarketClaimFundingEvent extends BaseMarketEvent {
    eventType: MarketEventType.ClaimFunding;
    user: string;
    /** Paid claimable balance, token-dec. */
    amount: i128;
}

/** ADL flags recomputed via `update_adl_state`. */
export interface MarketAdlUpdateEvent extends BaseMarketEvent {
    eventType: MarketEventType.AdlUpdate;
    /** Long-side ADL enabled (long increases blocked). */
    long: boolean;
    /** Short-side ADL enabled (short increases blocked). */
    short: boolean;
}

/**
 * A keeper advanced the accrual indices via `accrue`. The event only marks
 * the poke and carries no payload. Read the post-accrual funding and
 * borrowing state from `get_market_data`.
 */
export interface MarketAccrualUpdateEvent extends BaseMarketEvent {
    eventType: MarketEventType.AccrualUpdate;
}

/** Operational status changed via `set_status`. */
export interface MarketStatusUpdateEvent extends BaseMarketEvent {
    eventType: MarketEventType.StatusUpdate;
    /** The new status, as a `Status` discriminant. */
    status: u32;
}

/** Global configuration replaced via `set_config`. */
export interface MarketConfigUpdateEvent extends BaseMarketEvent {
    eventType: MarketEventType.ConfigUpdate;
    /** The new global trading configuration. */
    config: MarketConfig;
}

/** Flat settlement price set or refreshed via `set_terminal_price`. */
export interface MarketTerminalPriceUpdateEvent extends BaseMarketEvent {
    eventType: MarketEventType.TerminalPriceUpdate;
    /** Flat settlement price, price_scalar units. */
    price: i128;
}

/**
 * A keeper fill of an increase order that opens the side. There was no
 * prior position. An increase on an already-open position emits
 * `increase_fill` instead, which also settles funding and borrowing.
 */
export interface MarketOpenFillEvent extends BaseMarketEvent {
    eventType: MarketEventType.OpenFill;
    user: string;
    orderId: u32;
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Entry-side execution price (ask for a long, bid for a short), price_scalar units. */
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
export interface MarketIncreaseFillEvent extends BaseMarketEvent {
    eventType: MarketEventType.IncreaseFill;
    user: string;
    orderId: u32;
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Entry-side execution price (ask for a long, bid for a short), price_scalar units. */
    price: i128;
    /** Size added, token-dec. */
    notional: i128;
    /** Base size bought, base-dec. */
    tokens: i128;
    /** Margin pulled from the trader, token-dec. */
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
 * A keeper fill of a partial decrease. The position survives the fill.
 *
 * `notional` and `tokens` are the closed fraction at entry pricing, so
 * `notional * SCALAR_18 / tokens` is the entry price of the closed chunk.
 */
export interface MarketDecreaseFillEvent extends BaseMarketEvent {
    eventType: MarketEventType.DecreaseFill;
    user: string;
    orderId: u32;
    /** `'order'` for a keeper fill of a user order, `'adl'` for an ADL close. */
    source: 'order' | 'adl';
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Exit-side execution price (bid for a long, ask for a short), price_scalar units. */
    price: i128;
    /** Closed size at entry pricing, token-dec. */
    notional: i128;
    /** Base size closed, base-dec. */
    tokens: i128;
    /** The requested margin withdrawal, token-dec. The paid amount caps at the surviving margin; see `returned`. */
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
    /** Amount transferred to the trader, token-dec. The paid withdrawal plus the profit the fees did not consume: fees pay from profit first, the margin absorbs the uncovered rest, and the withdrawal caps at the margin that survives. */
    returned: i128;
}

/** A keeper fill that closes the whole position. The stored row zeroes. */
export interface MarketCloseFillEvent extends BaseMarketEvent {
    eventType: MarketEventType.CloseFill;
    user: string;
    orderId: u32;
    /** `'order'` for a keeper fill of a user order, `'adl'` for an ADL close. */
    source: 'order' | 'adl';
    isLong: boolean;
    /** The keeper rewarded for the fill. */
    keeper: string;
    /** Exit-side execution price (bid for a long, ask for a short), price_scalar units. */
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
    /** Post-fee equity floored at zero, transferred to the trader, token-dec. The transfer adds the swept decrease-order escrows announced by the same-tx `cancel_order` receipts. */
    returned: i128;
}

/** A keeper liquidation receipt. The full size is force-closed. */
export interface MarketLiquidationEvent extends BaseMarketEvent {
    eventType: MarketEventType.Liquidation;
    user: string;
    isLong: boolean;
    /** The keeper rewarded for the liquidation. */
    keeper: string;
    /** Exit-side execution price (bid for a long, ask for a short), price_scalar units. */
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
     * Remainder paid to the trader net of the liquidation fee, token-dec. It
     * is zero exactly where the fee saturates the whole remainder. The
     * transfer adds the swept decrease-order escrows announced by the
     * same-tx `cancel_order` receipts.
     */
    returned: i128;
    /** Liquidation fee charged: min(equity, ceil(config.liqFee * notional)), token-dec. Split between the keeper, treasury, and vault like a trade fee. */
    liqFee: i128;
}

/** A decoded market contract event. Narrow on `eventType` for the concrete shape. */
export type MarketEvent =
    | MarketCreateOrderEvent
    | MarketCancelOrderEvent
    | MarketCreateVaultOrderEvent
    | MarketCancelVaultOrderEvent
    | MarketDepositFillEvent
    | MarketRedeemFillEvent
    | MarketClaimFundingEvent
    | MarketAdlUpdateEvent
    | MarketAccrualUpdateEvent
    | MarketStatusUpdateEvent
    | MarketConfigUpdateEvent
    | MarketTerminalPriceUpdateEvent
    | MarketOpenFillEvent
    | MarketIncreaseFillEvent
    | MarketDecreaseFillEvent
    | MarketCloseFillEvent
    | MarketLiquidationEvent;
