import { i128, u32 } from '../index.js';
import { ZenexContractType, BaseZenexEvent, NormalizedEvent } from '../base_event.js';
import {
    Order, VaultOrder, Position, TradingConfig,
    parseOrder, parseVaultOrder, parsePosition, parseTradingConfig,
} from './trading_types.js';

// =============================================================================
// Trading event types (v2) — mirrors `trading/src/events.rs`.
//
// Each `#[contractevent]` struct's topics are `[<snake_case event name>,
// ...#[topic] fields in declaration order]`; remaining fields land in the
// data map. Nested structs (`order`, `position`, `config`) are routed
// through the Task 1 parsers so they decode to the same camelCase
// interfaces used elsewhere in the SDK.
// =============================================================================

export enum TradingEventType {
    CreateOrder = 'create_order',
    CancelOrder = 'cancel_order',
    CreateVaultOrder = 'create_vault_order',
    CancelVaultOrder = 'cancel_vault_order',
    ExecuteVaultOrder = 'execute_vault_order',
    ClaimFunding = 'claim_funding',
    AdlUpdate = 'adl_update',
    StatusUpdate = 'status_update',
    ConfigUpdate = 'config_update',
    TerminalPriceUpdate = 'terminal_price_update',
    IncreaseFill = 'increase_fill',
    DecreaseFill = 'decrease_fill',
    Liquidation = 'liquidation',
    PositionUpdate = 'position_update',
}

// Trading Events
export interface BaseTradingEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Trading;
    eventType: TradingEventType;
}

/** Order created via `create_order`. */
export interface TradingCreateOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CreateOrder;
    user: string;
    orderId: u32;
    /** The stored order row, as returned by `get_order`. */
    order: Order;
}

/** Pending order removed via `cancel_order`. */
export interface TradingCancelOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelOrder;
    user: string;
    orderId: u32;
}

/** Vault deposit or redeem order created via `create_vault_order`. */
export interface TradingCreateVaultOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CreateVaultOrder;
    user: string;
    orderId: u32;
    /** The stored vault-order row, as returned by `get_vault_order`. */
    order: VaultOrder;
}

/** Pending vault order removed via `cancel_vault_order`. */
export interface TradingCancelVaultOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelVaultOrder;
    user: string;
    orderId: u32;
}

/** Vault order filled by the keeper via `execute_vault_order` (panics on failure). */
export interface TradingExecuteVaultOrderEvent extends BaseTradingEvent {
    eventType: TradingEventType.ExecuteVaultOrder;
    user: string;
    orderId: u32;
    /** Amount moved this fill: assets (deposit) or shares (redeem), token-dec. */
    filled: i128;
    /** Order remainder after the fill; 0 = completed and removed. */
    remaining: i128;
}

/** Claimable funding balance paid out via `claim_funding`. */
export interface TradingClaimFundingEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClaimFunding;
    user: string;
    /** Paid claimable balance, token-dec. */
    amount: i128;
}

/** ADL flags recomputed via `update_adl_state` or `execute_adl`. */
export interface TradingAdlUpdateEvent extends BaseTradingEvent {
    eventType: TradingEventType.AdlUpdate;
    /** Long-side ADL enabled (long increases blocked). */
    long: boolean;
    /** Short-side ADL enabled (short increases blocked). */
    short: boolean;
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
 * A keeper fill of an increase order (the user's itemized receipt).
 *
 * The fill price is implied, `notional * SCALAR_18 / tokens` (price_scalar
 * units). The resulting position state is carried by the paired
 * `PositionUpdate` event.
 */
export interface TradingIncreaseFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.IncreaseFill;
    user: string;
    orderId: u32;
    isLong: boolean;
    /** Size added, token-dec. */
    notional: i128;
    /** Base size bought, base-dec. */
    tokens: i128;
    /** Collateral pulled from the trader, token-dec. */
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
 * A keeper fill of a decrease order (the user's itemized receipt).
 *
 * The fill price is implied, `notional * SCALAR_18 / tokens` (price_scalar
 * units). `collateral` and `pnl` are gross of the itemized fees; `returned`
 * is the actual payout: the gross legs less the fees they cover, floored at
 * zero (a partial close pays only the profit leg, a realized loss debits
 * the surviving margin; a full close pays out at most the freed margin, any
 * shortfall emitted as `badDebt`). The resulting position state is carried
 * by the paired `PositionUpdate` event.
 *
 * A `decrease_fill` whose `orderId` is `0` is an ADL slice (there is no
 * user-submitted order backing it; the keeper force-decreases the position
 * directly).
 */
export interface TradingDecreaseFillEvent extends BaseTradingEvent {
    eventType: TradingEventType.DecreaseFill;
    user: string;
    /** Order id; `0` marks this fill as an ADL slice rather than a user order. */
    orderId: u32;
    isLong: boolean;
    /** Closed size: the order's request clamped to the position, token-dec. */
    notional: i128;
    /** Base size closed, base-dec. */
    tokens: i128;
    /** Gross collateral leg: requested withdrawal (partial) or freed margin (full), token-dec. */
    collateral: i128;
    /** Realized PnL on the closed fraction, gross of settled costs, token-dec. */
    pnl: i128;
    /** Trade fee charged, token-dec. */
    baseFee: i128;
    /** Impact fee charged, token-dec. */
    impactFee: i128;
    /** Settled funding, token-dec; + = paid from collateral, - = credited claimable. */
    funding: i128;
    /** Settled borrowing fee, token-dec. */
    borrowing: i128;
    /** Fees and losses past the freed margin, absorbed by the vault, token-dec; 0 on partial closes. */
    badDebt: i128;
    /** Amount transferred to the trader, token-dec. */
    returned: i128;
}

/**
 * A keeper liquidation receipt (the full size is force-closed).
 *
 * `collateral` and `pnl` are gross of the itemized fees; the post-fee
 * remainder (equity, floored at zero) lands on `returned` (trader) on the
 * soft tier and `forfeit` (vault) on the hard tier; any shortfall past the
 * freed margin is emitted as `badDebt` and absorbed by the vault. The
 * resulting (zeroed) position state is carried by the paired
 * `PositionUpdate` event.
 */
export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    user: string;
    isLong: boolean;
    /** Force-closed size, token-dec. */
    notional: i128;
    /** Base size closed, base-dec. */
    tokens: i128;
    /** Freed margin, gross of the itemized fees, token-dec. */
    collateral: i128;
    /** Realized PnL on the closed size, gross of settled costs, token-dec. */
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

/**
 * The resulting netted position after any change (fill or liquidation).
 * The cause and its fees live on the paired `IncreaseFill` / `DecreaseFill`
 * / `Liquidation` event.
 */
export interface TradingPositionUpdateEvent extends BaseTradingEvent {
    eventType: TradingEventType.PositionUpdate;
    user: string;
    isLong: boolean;
    /** The stored position row, as returned by `get_position`; zeroed = closed. */
    position: Position;
}

export type TradingEvent =
    | TradingCreateOrderEvent
    | TradingCancelOrderEvent
    | TradingCreateVaultOrderEvent
    | TradingCancelVaultOrderEvent
    | TradingExecuteVaultOrderEvent
    | TradingClaimFundingEvent
    | TradingAdlUpdateEvent
    | TradingStatusUpdateEvent
    | TradingConfigUpdateEvent
    | TradingTerminalPriceUpdateEvent
    | TradingIncreaseFillEvent
    | TradingDecreaseFillEvent
    | TradingLiquidationEvent
    | TradingPositionUpdateEvent;

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

        case TradingEventType.ExecuteVaultOrder:
            return {
                ...baseEvent,
                eventType: TradingEventType.ExecuteVaultOrder,
                user: topicArgs[0] as string,
                orderId: topicArgs[1] as number,
                filled: data.filled as i128,
                remaining: data.remaining as i128,
            } as TradingExecuteVaultOrderEvent;

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
                isLong: topicArgs[2] as boolean,
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
            } as TradingDecreaseFillEvent;

        case TradingEventType.Liquidation:
            return {
                ...baseEvent,
                eventType: TradingEventType.Liquidation,
                user: topicArgs[0] as string,
                isLong: topicArgs[1] as boolean,
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

        case TradingEventType.PositionUpdate:
            return {
                ...baseEvent,
                eventType: TradingEventType.PositionUpdate,
                user: topicArgs[0] as string,
                isLong: topicArgs[1] as boolean,
                position: parsePosition(data.position as Record<string, unknown>),
            } as TradingPositionUpdateEvent;

        default:
            return undefined;
    }
}
