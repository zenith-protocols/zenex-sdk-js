import { rpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../index.js';
import { Asset } from '../asset.js';
import { ZenexContractType, BaseZenexEvent } from '../base_event.js';
import { MarketConfig } from './trading_market.js';

// Trading event types (matches Rust events)
export enum TradingEventType {
    SetConfig = 'SetConfig',
    QueueSetConfig = 'QueueSetConfig',
    CancelSetConfig = 'CancelSetConfig',
    QueueSetMarket = 'QueueSetMarket',
    CancelSetMarket = 'CancelSetMarket',
    SetMarket = 'SetMarket',
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
}

// Trading Events
export interface BaseTradingEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Trading;
    eventType: TradingEventType;
}

export interface TradingSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetConfig;
    oracle: string;
    callerTakeRate: i128;
    maxPositions: u32;
    maxPriceAge: u32;
    minOpenTime: u64;
}

export interface TradingQueueSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.QueueSetConfig;
    oracle: string;
    callerTakeRate: i128;
    maxPositions: u32;
    maxPriceAge: u32;
    minOpenTime: u64;
    unlockTime: u64;
}

export interface TradingCancelSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelSetConfig;
    oracle: string;
    callerTakeRate: i128;
    maxPositions: u32;
    maxPriceAge: u32;
    minOpenTime: u64;
}

export interface TradingQueueSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.QueueSetMarket;
    asset: Asset;
    config: MarketConfig;
}

export interface TradingCancelSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelSetMarket;
    asset: Asset;
}

export interface TradingSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetMarket;
    asset: Asset;
    assetIndex: u32;
}

export interface TradingSetStatusEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetStatus;
    status: u32;
}

// Position events with fee breakdown (market order open)
export interface TradingOpenMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.OpenMarket;
    assetIndex: u32;
    user: string;
    positionId: u32;
    baseFee: i128;
    impactFee: i128;
}

// Limit order placed
export interface TradingPlaceLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.PlaceLimit;
    assetIndex: u32;
    user: string;
    positionId: u32;
    baseFee: i128;
    impactFee: i128;
}

// Position closed
export interface TradingClosePositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClosePosition;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    interest: i128;
}

// Limit order filled
export interface TradingFillLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.FillLimit;
    assetIndex: u32;
    user: string;
    positionId: u32;
    baseFee: i128;
    impactFee: i128;
}

// Liquidation
export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    interest: i128;
}

// Take profit triggered
export interface TradingTakeProfitEvent extends BaseTradingEvent {
    eventType: TradingEventType.TakeProfit;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    interest: i128;
}

// Stop loss triggered
export interface TradingStopLossEvent extends BaseTradingEvent {
    eventType: TradingEventType.StopLoss;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    pnl: i128;
    baseFee: i128;
    impactFee: i128;
    interest: i128;
}

// Limit order cancelled
export interface TradingCancelLimitEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelLimit;
    assetIndex: u32;
    user: string;
    positionId: u32;
    baseFee: i128;
    impactFee: i128;
}

// Collateral modified (positive = deposit, negative = withdraw)
export interface TradingModifyCollateralEvent extends BaseTradingEvent {
    eventType: TradingEventType.ModifyCollateral;
    assetIndex: u32;
    user: string;
    positionId: u32;
    amount: i128;
}

// Triggers set
export interface TradingSetTriggersEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetTriggers;
    assetIndex: u32;
    user: string;
    positionId: u32;
    takeProfit: i128;
    stopLoss: i128;
}

export type TradingEvent =
    | TradingSetConfigEvent
    | TradingQueueSetConfigEvent
    | TradingCancelSetConfigEvent
    | TradingQueueSetMarketEvent
    | TradingCancelSetMarketEvent
    | TradingSetMarketEvent
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
    | TradingSetTriggersEvent;

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

        const extractAsset = (topicIndex: number): Asset | undefined => {
            if (topic.length > topicIndex) {
                const assetXdr = xdr.ScVal.fromXDR(topic[topicIndex], 'base64');
                return scValToNative(assetXdr) as Asset;
            }
            return undefined;
        };

        switch (eventType) {
            case TradingEventType.SetConfig:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetConfig,
                    oracle: eventData.oracle,
                    callerTakeRate: eventData.caller_take_rate,
                    maxPositions: eventData.max_positions,
                    maxPriceAge: eventData.max_price_age,
                    minOpenTime: eventData.min_open_time,
                } as TradingSetConfigEvent;

            case TradingEventType.QueueSetConfig:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.QueueSetConfig,
                    oracle: eventData.oracle,
                    callerTakeRate: eventData.caller_take_rate,
                    maxPositions: eventData.max_positions,
                    maxPriceAge: eventData.max_price_age,
                    minOpenTime: eventData.min_open_time,
                    unlockTime: eventData.unlock_time,
                } as TradingQueueSetConfigEvent;

            case TradingEventType.CancelSetConfig:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.CancelSetConfig,
                    oracle: eventData.oracle,
                    callerTakeRate: eventData.caller_take_rate,
                    maxPositions: eventData.max_positions,
                    maxPriceAge: eventData.max_price_age,
                    minOpenTime: eventData.min_open_time,
                } as TradingCancelSetConfigEvent;

            case TradingEventType.QueueSetMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.QueueSetMarket,
                    asset: extractAsset(1)!,
                    config: eventData.config,
                } as TradingQueueSetMarketEvent;

            case TradingEventType.CancelSetMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.CancelSetMarket,
                    asset: extractAsset(1)!,
                } as TradingCancelSetMarketEvent;

            case TradingEventType.SetMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetMarket,
                    asset: extractAsset(1)!,
                    assetIndex: eventData.asset_index,
                } as TradingSetMarketEvent;

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
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                } as TradingOpenMarketEvent;

            case TradingEventType.PlaceLimit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.PlaceLimit,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                } as TradingPlaceLimitEvent;

            case TradingEventType.ClosePosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ClosePosition,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    pnl: eventData.pnl,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    interest: eventData.interest,
                } as TradingClosePositionEvent;

            case TradingEventType.FillLimit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.FillLimit,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                } as TradingFillLimitEvent;

            case TradingEventType.Liquidation:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.Liquidation,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    pnl: eventData.pnl,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    interest: eventData.interest,
                } as TradingLiquidationEvent;

            case TradingEventType.TakeProfit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.TakeProfit,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    pnl: eventData.pnl,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    interest: eventData.interest,
                } as TradingTakeProfitEvent;

            case TradingEventType.StopLoss:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.StopLoss,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    price: eventData.price,
                    pnl: eventData.pnl,
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                    interest: eventData.interest,
                } as TradingStopLossEvent;

            case TradingEventType.CancelLimit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.CancelLimit,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    baseFee: eventData.base_fee,
                    impactFee: eventData.impact_fee,
                } as TradingCancelLimitEvent;

            case TradingEventType.ModifyCollateral:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ModifyCollateral,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    amount: eventData.amount,
                } as TradingModifyCollateralEvent;

            case TradingEventType.SetTriggers:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetTriggers,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: extractU32(3),
                    takeProfit: eventData.take_profit,
                    stopLoss: eventData.stop_loss,
                } as TradingSetTriggersEvent;

            default:
                return undefined;
        }
    } catch (error) {
        console.warn('Failed to parse trading event:', error);
        return undefined;
    }
}
