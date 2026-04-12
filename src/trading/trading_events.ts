import { i128, u32, u64 } from '../index.js';
import { ZenexContractType, BaseZenexEvent, NormalizedEvent } from '../base_event.js';

// Trading event types (matches Rust events)
export enum TradingEventType {
    SetConfig = 'set_config',
    SetMarket = 'set_market',
    DelMarket = 'del_market',
    SetStatus = 'set_status',
    OpenMarket = 'open_market',
    PlaceLimit = 'place_limit',
    ClosePosition = 'close_position',
    FillLimit = 'fill_limit',
    Liquidation = 'liquidation',
    TakeProfit = 'take_profit',
    StopLoss = 'stop_loss',
    ModifyCollateral = 'modify_collateral',
    SetTriggers = 'set_triggers',
    ApplyFunding = 'apply_funding',
    RefundPosition = 'refund_position',
    ADLTriggered = 'adl_triggered',
}

// Trading Events
export interface BaseTradingEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Trading;
    eventType: TradingEventType;
}

export interface TradingSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetConfig;
    config: Record<string, unknown>;
}

export interface TradingSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetMarket;
    marketId: u32;
}

export interface TradingDelMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.DelMarket;
    marketId: u32;
}

export interface TradingSetStatusEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetStatus;
    status: u32;
}

export interface TradingOpenMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.OpenMarket;
    marketId: u32;
    user: string;
    positionId: u32;
    // Full post-fill position state (Position has no prior row).
    long: boolean;
    col: i128;
    notional: i128;
    entryPrice: i128;
    sl: i128;
    tp: i128;
    fundIdx: i128;
    borrIdx: i128;
    adlIdx: i128;
    createdAt: u64;
    baseFee: i128;
    impactFee: i128;
}

export interface TradingPlaceLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.PlaceLimit;
    marketId: u32;
    user: string;
    positionId: u32;
    // Initial limit-order state. Indices (fund/borr/adl) are snapshotted
    // at fill, not at placement — use FillLimit event for those.
    long: boolean;
    col: i128;
    notional: i128;
    entryPrice: i128; // limit trigger price
    sl: i128;
    tp: i128;
    createdAt: u64;
}

export interface TradingClosePositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClosePosition;
    marketId: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
}

export interface TradingFillLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.FillLimit;
    marketId: u32;
    user: string;
    positionId: u32;
    // Fill-time state. long/col/notional/sl/tp inherited from prior
    // PlaceLimit row; only fill-specific fields emitted here.
    entryPrice: i128; // actual fill price (may differ from limit trigger)
    fundIdx: i128;
    borrIdx: i128;
    adlIdx: i128;
    createdAt: u64; // fill time supersedes placement time
    baseFee: i128;
    impactFee: i128;
}

export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    marketId: u32;
    user: string;
    positionId: u32;
    price: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
    liqFee: i128;
}

export interface TradingTakeProfitEvent extends BaseTradingEvent {
    eventType: TradingEventType.TakeProfit;
    marketId: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
}

export interface TradingStopLossEvent extends BaseTradingEvent {
    eventType: TradingEventType.StopLoss;
    marketId: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
}

export interface TradingModifyCollateralEvent extends BaseTradingEvent {
    eventType: TradingEventType.ModifyCollateral;
    marketId: u32;
    user: string;
    positionId: u32;
    col: i128; // new collateral; delta = col - prior_col (caller computes)
}

export interface TradingSetTriggersEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetTriggers;
    marketId: u32;
    user: string;
    positionId: u32;
    sl: i128;
    tp: i128;
}

export interface TradingApplyFundingEvent extends BaseTradingEvent {
    eventType: TradingEventType.ApplyFunding;
}

export interface TradingRefundPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.RefundPosition;
    marketId: u32;
    user: string;
    positionId: u32;
}

export interface TradingADLTriggeredEvent extends BaseTradingEvent {
    eventType: TradingEventType.ADLTriggered;
    reductionPct: i128;
    deficit: i128;
}

export type TradingEvent =
    | TradingSetConfigEvent
    | TradingSetMarketEvent
    | TradingDelMarketEvent
    | TradingSetStatusEvent
    | TradingOpenMarketEvent
    | TradingPlaceLimitEvent
    | TradingClosePositionEvent
    | TradingFillLimitEvent
    | TradingLiquidationEvent
    | TradingTakeProfitEvent
    | TradingStopLossEvent
    | TradingModifyCollateralEvent
    | TradingSetTriggersEvent
    | TradingRefundPositionEvent
    | TradingApplyFundingEvent
    | TradingADLTriggeredEvent;

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

    const marketId = topicArgs[0] as number ?? 0;
    const user = topicArgs[1] as string ?? '';
    const positionId = topicArgs[2] as number ?? 0;

    switch (eventType) {
        case TradingEventType.SetConfig:
            return {
                ...baseEvent,
                eventType: TradingEventType.SetConfig,
                config: data,
            } as TradingSetConfigEvent;

        case TradingEventType.SetMarket:
            return {
                ...baseEvent,
                eventType: TradingEventType.SetMarket,
                marketId,
            } as TradingSetMarketEvent;

        case TradingEventType.DelMarket:
            return {
                ...baseEvent,
                eventType: TradingEventType.DelMarket,
                marketId,
            } as TradingDelMarketEvent;

        case TradingEventType.SetStatus:
            return {
                ...baseEvent,
                eventType: TradingEventType.SetStatus,
                status: data.status as number,
            } as TradingSetStatusEvent;

        case TradingEventType.OpenMarket:
            return {
                ...baseEvent,
                eventType: TradingEventType.OpenMarket,
                marketId,
                user,
                positionId,
                long: data.long,
                col: data.col,
                notional: data.notional,
                entryPrice: data.entry_price,
                sl: data.sl,
                tp: data.tp,
                fundIdx: data.fund_idx,
                borrIdx: data.borr_idx,
                adlIdx: data.adl_idx,
                createdAt: data.created_at,
                baseFee: data.base_fee,
                impactFee: data.impact_fee,
            } as TradingOpenMarketEvent;

        case TradingEventType.PlaceLimit:
            return {
                ...baseEvent,
                eventType: TradingEventType.PlaceLimit,
                marketId,
                user,
                positionId,
                long: data.long,
                col: data.col,
                notional: data.notional,
                entryPrice: data.entry_price,
                sl: data.sl,
                tp: data.tp,
                createdAt: data.created_at,
            } as TradingPlaceLimitEvent;

        case TradingEventType.ClosePosition:
            return {
                ...baseEvent,
                eventType: TradingEventType.ClosePosition,
                marketId,
                user,
                positionId,
                price: data.price,
                pnl: data.pnl,
                baseFee: data.base_fee,
                impactFee: data.impact_fee,
                funding: data.funding,
                borrowingFee: data.borrowing_fee,
            } as TradingClosePositionEvent;

        case TradingEventType.FillLimit:
            return {
                ...baseEvent,
                eventType: TradingEventType.FillLimit,
                marketId,
                user,
                positionId,
                entryPrice: data.entry_price,
                fundIdx: data.fund_idx,
                borrIdx: data.borr_idx,
                adlIdx: data.adl_idx,
                createdAt: data.created_at,
                baseFee: data.base_fee,
                impactFee: data.impact_fee,
            } as TradingFillLimitEvent;

        case TradingEventType.Liquidation:
            return {
                ...baseEvent,
                eventType: TradingEventType.Liquidation,
                marketId,
                user,
                positionId,
                price: data.price,
                baseFee: data.base_fee,
                impactFee: data.impact_fee,
                funding: data.funding,
                borrowingFee: data.borrowing_fee,
                liqFee: data.liq_fee,
            } as TradingLiquidationEvent;

        case TradingEventType.TakeProfit:
            return {
                ...baseEvent,
                eventType: TradingEventType.TakeProfit,
                marketId,
                user,
                positionId,
                price: data.price,
                pnl: data.pnl,
                baseFee: data.base_fee,
                impactFee: data.impact_fee,
                funding: data.funding,
                borrowingFee: data.borrowing_fee,
            } as TradingTakeProfitEvent;

        case TradingEventType.StopLoss:
            return {
                ...baseEvent,
                eventType: TradingEventType.StopLoss,
                marketId,
                user,
                positionId,
                price: data.price,
                pnl: data.pnl,
                baseFee: data.base_fee,
                impactFee: data.impact_fee,
                funding: data.funding,
                borrowingFee: data.borrowing_fee,
            } as TradingStopLossEvent;

        case TradingEventType.ModifyCollateral:
            return {
                ...baseEvent,
                eventType: TradingEventType.ModifyCollateral,
                marketId,
                user,
                positionId,
                col: data.col,
            } as TradingModifyCollateralEvent;

        case TradingEventType.SetTriggers:
            return {
                ...baseEvent,
                eventType: TradingEventType.SetTriggers,
                marketId,
                user,
                positionId,
                sl: data.sl,
                tp: data.tp,
            } as TradingSetTriggersEvent;

        case TradingEventType.RefundPosition:
            return {
                ...baseEvent,
                eventType: TradingEventType.RefundPosition,
                marketId,
                user,
                positionId,
            } as TradingRefundPositionEvent;

        case TradingEventType.ApplyFunding:
            return {
                ...baseEvent,
                eventType: TradingEventType.ApplyFunding,
            } as TradingApplyFundingEvent;

        case TradingEventType.ADLTriggered:
            return {
                ...baseEvent,
                eventType: TradingEventType.ADLTriggered,
                reductionPct: data.reduction_pct,
                deficit: data.deficit,
            } as TradingADLTriggeredEvent;

        default:
            return undefined;
    }
}
