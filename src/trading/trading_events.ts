import { rpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';
import { i128, u32 } from '../index.js';
import { ZenexContractType, BaseZenexEvent } from '../base_event.js';

// Trading event types (matches Rust events)
export enum TradingEventType {
    SetConfig = 'SetConfig',
    SetMarket = 'SetMarket',
    DelMarket = 'DelMarket',
    SetStatus = 'SetStatus',
    OpenMarket = 'OpenMarket',
    PlaceLimit = 'PlaceLimit',
    ClosePosition = 'ClosePosition',
    FillLimit = 'FillLimit',
    Liquidation = 'Liquidation',
    TakeProfit = 'TakeProfit',
    StopLoss = 'StopLoss',
    CancelLimit = 'CancelLimit',
    ModifyCollateral = 'ModifyCollateral',
    SetTriggers = 'SetTriggers',
    ApplyFunding = 'ApplyFunding',
    ADLTriggered = 'ADLTriggered',
    ADLMarket = 'ADLMarket',
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
    feedId: u32;
}

export interface TradingDelMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.DelMarket;
    feedId: u32;
}

export interface TradingSetStatusEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetStatus;
    status: u32;
}

// Position events - market order open
export interface TradingOpenMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.OpenMarket;
    feedId: u32;
    user: string;
    positionId: u32;
    baseFee: i128;
    impactFee: i128;
}

// Limit order placed (topics only, no data fields)
export interface TradingPlaceLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.PlaceLimit;
    feedId: u32;
    user: string;
    positionId: u32;
}

// Position closed
export interface TradingClosePositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClosePosition;
    feedId: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
}

// Limit order filled
export interface TradingFillLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.FillLimit;
    feedId: u32;
    user: string;
    positionId: u32;
    baseFee: i128;
    impactFee: i128;
}

// Liquidation
export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    feedId: u32;
    user: string;
    positionId: u32;
    price: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
    liqFee: i128;
}

// Take profit triggered
export interface TradingTakeProfitEvent extends BaseTradingEvent {
    eventType: TradingEventType.TakeProfit;
    feedId: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
}

// Stop loss triggered
export interface TradingStopLossEvent extends BaseTradingEvent {
    eventType: TradingEventType.StopLoss;
    feedId: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    funding: i128;
    borrowingFee: i128;
}

// Limit order cancelled (topics only, no data fields)
export interface TradingCancelLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelLimit;
    feedId: u32;
    user: string;
    positionId: u32;
}

// Collateral modified (positive = deposit, negative = withdraw)
export interface TradingModifyCollateralEvent extends BaseTradingEvent {
    eventType: TradingEventType.ModifyCollateral;
    feedId: u32;
    user: string;
    positionId: u32;
    amount: i128;
}

// Triggers set
export interface TradingSetTriggersEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetTriggers;
    feedId: u32;
    user: string;
    positionId: u32;
    takeProfit: i128;
    stopLoss: i128;
}

// Apply funding event
export interface TradingApplyFundingEvent extends BaseTradingEvent {
    eventType: TradingEventType.ApplyFunding;
    rates: Record<number, i128>;
}

// ADL triggered event
export interface TradingADLTriggeredEvent extends BaseTradingEvent {
    eventType: TradingEventType.ADLTriggered;
    reductionPct: i128;
    deficit: i128;
}

// ADL market event
export interface TradingADLMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.ADLMarket;
    feedId: u32;
    factor: i128;
    long: boolean;
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
    | TradingCancelLimitEvent
    | TradingModifyCollateralEvent
    | TradingSetTriggersEvent
    | TradingApplyFundingEvent
    | TradingADLTriggeredEvent
    | TradingADLMarketEvent;

/**
 * Parse a trading event from RPC event response
 */
export function parseTradingEvent(
    eventResponse: rpc.Api.RawEventResponse
): TradingEvent | undefined {
    if (
        eventResponse.type !== 'contract' ||
        !eventResponse.topic ||
        eventResponse.topic.length === 0 ||
        eventResponse.contractId === undefined
    ) {
        return undefined;
    }

    const topic = eventResponse.topic;

    try {
        const topicXdr = xdr.ScVal.fromXDR(topic[0], 'base64');
        const eventType = scValToNative(topicXdr) as string;

        const valueXdr = xdr.ScVal.fromXDR(eventResponse.value, 'base64');
        const eventData = scValToNative(valueXdr);

        const baseEvent: BaseTradingEvent = {
            id: eventResponse.id,
            contractId: eventResponse.contractId,
            contractType: ZenexContractType.Trading,
            eventType: eventType as TradingEventType,
            ledger: eventResponse.ledger,
            ledgerClosedAt: eventResponse.ledgerClosedAt,
            txHash: eventResponse.txHash || '',
        };

        const extractAddress = (topicIndex: number): string => {
            if (topic.length > topicIndex) {
                const addressXdr = xdr.ScVal.fromXDR(topic[topicIndex], 'base64');
                return Address.fromScVal(addressXdr).toString();
            }
            return '';
        };

        const extractU32 = (topicIndex: number): number => {
            if (topic.length > topicIndex) {
                const u32Xdr = xdr.ScVal.fromXDR(topic[topicIndex], 'base64');
                return scValToNative(u32Xdr) as number;
            }
            return 0;
        };

        switch (eventType) {
            case TradingEventType.SetConfig:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetConfig,
                    config: eventData,
                } as TradingSetConfigEvent;

            case TradingEventType.SetMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetMarket,
                    feedId: extractU32(1),
                } as TradingSetMarketEvent;

            case TradingEventType.DelMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.DelMarket,
                    feedId: extractU32(1),
                } as TradingDelMarketEvent;

            case TradingEventType.SetStatus:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetStatus,
                    status: eventData.status,
                } as TradingSetStatusEvent;

            case TradingEventType.OpenMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.OpenMarket,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                } as TradingOpenMarketEvent;

            case TradingEventType.PlaceLimit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.PlaceLimit,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                } as TradingPlaceLimitEvent;

            case TradingEventType.ClosePosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ClosePosition,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    pnl: eventData.pnl,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    funding: eventData.funding,
                    borrowingFee: eventData.borrowing_fee,
                } as TradingClosePositionEvent;

            case TradingEventType.FillLimit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.FillLimit,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                } as TradingFillLimitEvent;

            case TradingEventType.Liquidation:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.Liquidation,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    funding: eventData.funding,
                    borrowingFee: eventData.borrowing_fee,
                    liqFee: eventData.liq_fee,
                } as TradingLiquidationEvent;

            case TradingEventType.TakeProfit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.TakeProfit,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    pnl: eventData.pnl,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    funding: eventData.funding,
                    borrowingFee: eventData.borrowing_fee,
                } as TradingTakeProfitEvent;

            case TradingEventType.StopLoss:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.StopLoss,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    pnl: eventData.pnl,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    funding: eventData.funding,
                    borrowingFee: eventData.borrowing_fee,
                } as TradingStopLossEvent;

            case TradingEventType.CancelLimit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.CancelLimit,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                } as TradingCancelLimitEvent;

            case TradingEventType.ModifyCollateral:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ModifyCollateral,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    amount: eventData.amount,
                } as TradingModifyCollateralEvent;

            case TradingEventType.SetTriggers:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetTriggers,
                    feedId: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    takeProfit: eventData.take_profit,
                    stopLoss: eventData.stop_loss,
                } as TradingSetTriggersEvent;

            case TradingEventType.ApplyFunding:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ApplyFunding,
                    rates: eventData.rates,
                } as TradingApplyFundingEvent;

            case TradingEventType.ADLTriggered:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ADLTriggered,
                    reductionPct: eventData.reduction_pct,
                    deficit: eventData.deficit,
                } as TradingADLTriggeredEvent;

            case TradingEventType.ADLMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ADLMarket,
                    feedId: extractU32(1),
                    factor: eventData.factor,
                    long: eventData.long,
                } as TradingADLMarketEvent;

            default:
                return undefined;
        }
    } catch (error) {
        console.warn('Failed to parse trading event:', error);
        return undefined;
    }
}
