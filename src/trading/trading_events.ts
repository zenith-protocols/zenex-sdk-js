import { i128, u32, u64 } from '../index.js';
import { ZenexContractType, BaseZenexEvent, NormalizedEvent } from '../base_event.js';
import {
    Order, VaultOrder, SidePair, TradingConfig,
    parseOrder, parseVaultOrder, parseSidePair, parseTradingConfig,
} from './trading_types.js';

// =============================================================================
// Trading event types (v2), mirroring `trading/src/events.rs`.
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

/** Pending order cancelled by its owner via `cancel_order`. */
export interface TradingCancelOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelOrder;
    user: string;
    orderId: u32;
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

/** The market's post-accrual funding state, emitted by `accrue` and `accrue_funding`. */
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

/** A keeper fill of an increase order (the user's itemized receipt). */
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
    /** Collateral pulled from escrow, token-dec. */
    collateral: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from collateral, - = credited claimable. */
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
 * `collateral` and `pnl` are gross of the itemized fees; `returned` is the
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
    /** Requested collateral withdrawal, gross of the itemized fees, token-dec. */
    collateral: i128;
    /** Realized PnL on the closed fraction (post-haircut), gross of settled costs, token-dec. */
    pnl: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from collateral, - = credited claimable. */
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
 * is the exit price the close settled at. `collateral` and `pnl` are gross
 * of the itemized fees; `returned` is the post-fee equity floored at zero,
 * any shortfall emitted as `badDebt`. The transfer to the trader adds the
 * escrow refunds of cleared pending decrease orders.
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
    collateral: i128;
    /** Realized PnL on the closed size (post-haircut), gross of settled costs, token-dec. */
    pnl: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from collateral, - = credited claimable. */
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
 * `collateral` and `pnl` are gross of the itemized fees; the post-fee
 * remainder (equity, floored at zero) lands on `returned` (trader) on the
 * soft tier and `forfeit` (vault) on the hard tier; any shortfall past the
 * freed margin is emitted as `badDebt` and absorbed by the vault.
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
    collateral: i128;
    /** Realized PnL on the closed size (post-haircut), gross of settled costs, token-dec. */
    pnl: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from collateral, - = credited claimable. */
    funding: i128;
    /** Settled borrowing fee, token-dec. */
    borrowing: i128;
    /** Fees and losses past the freed margin, absorbed by the vault, token-dec. */
    badDebt: i128;
    /** Liquidation fee, token-dec; 0 = soft tier, > 0 = hard tier. */
    liqFee: i128;
    /** Post-fee remainder transferred to the trader (soft tier), token-dec. */
    returned: i128;
    /** Post-fee remainder forfeited to the vault (hard tier), token-dec. */
    forfeit: i128;
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
    | TradingIncreaseFillEvent
    | TradingDecreaseFillEvent
    | TradingCloseFillEvent
    | TradingLiquidationEvent;

/**
 * Decode a normalized event into a typed TradingEvent.
 * Returns undefined if the event type is not a known trading event.
 */
export function decodeTradingEvent(event: NormalizedEvent): TradingEvent | undefined {
    const { eventType, topicArgs, data } = event;

    if (!Object.values(TradingEventType).includes(eventType as TradingEventType)) return undefined;

    const baseEvent: BaseTradingEvent = {
        id: event.id,
        contractId: event.contractId,
        contractType: ZenexContractType.Trading,
        eventType: eventType as TradingEventType,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
        txHash: event.txHash,
    };

    switch (eventType) {
        case TradingEventType.CreateOrder:
            return {
                ...baseEvent,
                eventType: TradingEventType.CreateOrder,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                order: parseOrder(data.order as Record<string, unknown>),
            } as TradingCreateOrderEvent;

        case TradingEventType.CancelOrder:
            return {
                ...baseEvent,
                eventType: TradingEventType.CancelOrder,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
            } as TradingCancelOrderEvent;

        case TradingEventType.CreateVaultOrder:
            return {
                ...baseEvent,
                eventType: TradingEventType.CreateVaultOrder,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                order: parseVaultOrder(data.order as Record<string, unknown>),
            } as TradingCreateVaultOrderEvent;

        case TradingEventType.CancelVaultOrder:
            return {
                ...baseEvent,
                eventType: TradingEventType.CancelVaultOrder,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
            } as TradingCancelVaultOrderEvent;

        case TradingEventType.DepositFill:
            return {
                ...baseEvent,
                eventType: TradingEventType.DepositFill,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                keeper: data.keeper as string,
                assets: data.assets as i128,
                shares: data.shares as i128,
                fee: data.fee as i128,
                netPnl: data.net_pnl as i128,
            } as TradingDepositFillEvent;

        case TradingEventType.RedeemFill:
            return {
                ...baseEvent,
                eventType: TradingEventType.RedeemFill,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                source: (topicArgs[1] as number) === 0 ? 'instant' : 'order',
                keeper: data.keeper as string,
                shares: data.shares as i128,
                assets: data.assets as i128,
                fee: data.fee as i128,
                netPnl: data.net_pnl as i128,
            } as TradingRedeemFillEvent;

        case TradingEventType.ClaimFunding:
            return {
                ...baseEvent,
                eventType: TradingEventType.ClaimFunding,
                user: topicArgs[0] as string,
                amount: data.amount as i128,
            } as TradingClaimFundingEvent;

        case TradingEventType.AdlUpdate:
            return {
                ...baseEvent,
                eventType: TradingEventType.AdlUpdate,
                long: data.long as boolean,
                short: data.short as boolean,
            } as TradingAdlUpdateEvent;

        case TradingEventType.FundingAccrual:
            return {
                ...baseEvent,
                eventType: TradingEventType.FundingAccrual,
                fundingRate: data.funding_rate as i128,
                fundingIdx: parseSidePair(data.funding_idx as Record<string, unknown>),
                timestamp: data.timestamp as u64,
            } as TradingFundingAccrualEvent;

        case TradingEventType.BorrowingAccrual:
            return {
                ...baseEvent,
                eventType: TradingEventType.BorrowingAccrual,
                borrowingIdx: parseSidePair(data.borrowing_idx as Record<string, unknown>),
                timestamp: data.timestamp as u64,
            } as TradingBorrowingAccrualEvent;

        case TradingEventType.StatusUpdate:
            return {
                ...baseEvent,
                eventType: TradingEventType.StatusUpdate,
                status: data.status as number,
            } as TradingStatusUpdateEvent;

        case TradingEventType.ConfigUpdate:
            return {
                ...baseEvent,
                eventType: TradingEventType.ConfigUpdate,
                config: parseTradingConfig(data.config as Record<string, unknown>),
            } as TradingConfigUpdateEvent;

        case TradingEventType.TerminalPriceUpdate:
            return {
                ...baseEvent,
                eventType: TradingEventType.TerminalPriceUpdate,
                price: data.price as i128,
            } as TradingTerminalPriceUpdateEvent;

        case TradingEventType.IncreaseFill:
            return {
                ...baseEvent,
                eventType: TradingEventType.IncreaseFill,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                isLong: topicArgs[2] as boolean,
                keeper: data.keeper as string,
                price: data.price as i128,
                notional: data.notional as i128,
                tokens: data.tokens as i128,
                collateral: data.collateral as i128,
                baseFee: data.base_fee as i128,
                impactFee: data.impact_fee as i128,
                funding: data.funding as i128,
                borrowing: data.borrowing as i128,
            } as TradingIncreaseFillEvent;

        case TradingEventType.DecreaseFill:
            return {
                ...baseEvent,
                eventType: TradingEventType.DecreaseFill,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                source: (topicArgs[1] as number) === 0 ? 'adl' : 'order',
                isLong: topicArgs[2] as boolean,
                keeper: data.keeper as string,
                price: data.price as i128,
                notional: data.notional as i128,
                tokens: data.tokens as i128,
                collateral: data.collateral as i128,
                pnl: data.pnl as i128,
                baseFee: data.base_fee as i128,
                impactFee: data.impact_fee as i128,
                funding: data.funding as i128,
                borrowing: data.borrowing as i128,
                returned: data.returned as i128,
            } as TradingDecreaseFillEvent;

        case TradingEventType.CloseFill:
            return {
                ...baseEvent,
                eventType: TradingEventType.CloseFill,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                source: (topicArgs[1] as number) === 0 ? 'adl' : 'order',
                isLong: topicArgs[2] as boolean,
                keeper: data.keeper as string,
                price: data.price as i128,
                notional: data.notional as i128,
                tokens: data.tokens as i128,
                collateral: data.collateral as i128,
                pnl: data.pnl as i128,
                baseFee: data.base_fee as i128,
                impactFee: data.impact_fee as i128,
                funding: data.funding as i128,
                borrowing: data.borrowing as i128,
                badDebt: data.bad_debt as i128,
                returned: data.returned as i128,
            } as TradingCloseFillEvent;

        case TradingEventType.Liquidation:
            return {
                ...baseEvent,
                eventType: TradingEventType.Liquidation,
                user: topicArgs[0] as string,
                isLong: topicArgs[1] as boolean,
                keeper: data.keeper as string,
                price: data.price as i128,
                notional: data.notional as i128,
                tokens: data.tokens as i128,
                collateral: data.collateral as i128,
                pnl: data.pnl as i128,
                baseFee: data.base_fee as i128,
                impactFee: data.impact_fee as i128,
                funding: data.funding as i128,
                borrowing: data.borrowing as i128,
                badDebt: data.bad_debt as i128,
                liqFee: data.liq_fee as i128,
                returned: data.returned as i128,
                forfeit: data.forfeit as i128,
            } as TradingLiquidationEvent;

        default:
            return undefined;
    }
}
