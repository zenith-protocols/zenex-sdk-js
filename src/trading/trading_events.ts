import { rpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';
import { i128, u32, u64, Asset } from '../index.ts';
import { BaseZenexEvent, ZenexContractType } from '../base_event.js';

export enum TradingEventType {
    SetConfig = 'set_config',
    QueueSetMarket = 'queue_set_market',
    SetMarket = 'set_market',
    SetStatus = 'set_status',
    OpenPosition = 'open_position',
    ModifyRisk = 'modify_risk',
    ClosePosition = 'close_position',
    FillPosition = 'fill_position',
    Liquidation = 'liquidation',
    CancelPosition = 'cancel_position',
    UpgradeWasm = 'upgrade_wasm'
}

export interface BaseTradingEvent extends BaseZenexEvent {
    id: string;
    contractId: string;
    eventType: TradingEventType;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
}

export interface TradingSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetConfig;
    admin: string;
    oracle: string;
    callerTakeRate: i128;
    maxPositions: u32;
}

export interface TradingQueueSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.QueueSetMarket;
    admin: string;
    asset: Asset;
    config: {
        enabled: boolean;
        maxLeverage: u32;
        maxPayout: i128;
        minCollateral: i128;
        maxCollateral: i128;
        liquidationThreshold: i128;
        totalAvailable: i128;
        baseFee: i128;
        priceImpactScalar: i128;
        minHourlyRate: i128;
        maxHourlyRate: i128;
        targetHourlyRate: i128;
        targetUtilization: i128;
    };
}

export interface TradingSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetMarket;
    asset: Asset;
}

export interface TradingSetStatusEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetStatus;
    admin: string;
    status: u32;
}

export interface TradingOpenPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.OpenPosition;
    user: string;
    asset: Asset;
    positionId: u32;
    collateral: i128;
    leverage: u32;
    isLong: boolean;
    entryPrice: i128;
}

export interface TradingModifyRiskEvent extends BaseTradingEvent {
    eventType: TradingEventType.ModifyRisk;
    user: string;
    positionId: u32;
    stopLoss: i128;
    takeProfit: i128;
}

export interface TradingClosePositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClosePosition;
    user: string;
    asset: Asset;
    positionId: u32;
    pnl: i128;
    fee: i128;
    exitPrice: i128;
}

export interface TradingFillPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.FillPosition;
    user: string;
    asset: Asset;
    caller: string;
    positionId: u32;
    fillPrice: i128;
    callerFee: i128;
}

export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    user: string;
    asset: Asset;
    liquidator: string;
    positionId: u32;
    collateral: i128;
    loss: i128;
    liquidatorFee: i128;
}

export interface TradingCancelPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelPosition;
    user: string;
    asset: Asset;
    positionId: u32;
    collateralReturned: i128;
}

export interface TradingUpgradeWasmEvent extends BaseTradingEvent {
    eventType: TradingEventType.UpgradeWasm;
    admin: string;
    wasmHash: string;
}

export type TradingEvent =
    | TradingSetConfigEvent
    | TradingQueueSetMarketEvent
    | TradingSetMarketEvent
    | TradingSetStatusEvent
    | TradingOpenPositionEvent
    | TradingModifyRiskEvent
    | TradingClosePositionEvent
    | TradingFillPositionEvent
    | TradingLiquidationEvent
    | TradingCancelPositionEvent
    | TradingUpgradeWasmEvent;

/**
 * Parse trading events from RPC event responses
 */
export function tradingEventFromEventResponse(
    eventResponse: rpc.Api.RawEventResponse
): TradingEvent | undefined {
    if (
        eventResponse.type !== 'contract' ||
        eventResponse.topic.length === 0 ||
        eventResponse.contractId === undefined
    ) {
        return undefined;
    }

    try {
        const topicXdr = xdr.ScVal.fromXDR(eventResponse.topic[0], 'base64');
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

        // Extract additional topic data based on event type
        const extractAddress = (topicIndex: number): string => {
            if (eventResponse.topic.length > topicIndex) {
                const addressXdr = xdr.ScVal.fromXDR(eventResponse.topic[topicIndex], 'base64');
                return Address.fromScVal(addressXdr).toString();
            }
            return '';
        };

        const extractAsset = (topicIndex: number): Asset | undefined => {
            if (eventResponse.topic.length > topicIndex) {
                const assetXdr = xdr.ScVal.fromXDR(eventResponse.topic[topicIndex], 'base64');
                return scValToNative(assetXdr) as Asset;
            }
            return undefined;
        };

        switch (eventType) {
            case TradingEventType.SetConfig:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetConfig,
                    admin: extractAddress(1),
                    oracle: eventData[0],
                    callerTakeRate: eventData[1],
                    maxPositions: eventData[2],
                } as TradingSetConfigEvent;

            case TradingEventType.QueueSetMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.QueueSetMarket,
                    admin: extractAddress(1),
                    asset: eventData[0],
                    config: eventData[1],
                } as TradingQueueSetMarketEvent;

            case TradingEventType.SetMarket:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetMarket,
                    asset: eventData,
                } as TradingSetMarketEvent;

            case TradingEventType.SetStatus:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetStatus,
                    admin: extractAddress(1),
                    status: eventData,
                } as TradingSetStatusEvent;

            case TradingEventType.OpenPosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.OpenPosition,
                    user: extractAddress(1),
                    asset: extractAsset(2),
                    positionId: eventData[0],
                    collateral: eventData[1],
                    leverage: eventData[2],
                    isLong: eventData[3],
                    entryPrice: eventData[4],
                } as TradingOpenPositionEvent;

            case TradingEventType.ModifyRisk:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ModifyRisk,
                    user: extractAddress(1),
                    positionId: eventData[0],
                    stopLoss: eventData[1],
                    takeProfit: eventData[2],
                } as TradingModifyRiskEvent;

            case TradingEventType.ClosePosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ClosePosition,
                    user: extractAddress(1),
                    asset: extractAsset(2),
                    positionId: eventData[0],
                    pnl: eventData[1],
                    fee: eventData[2],
                    exitPrice: eventData[3],
                } as TradingClosePositionEvent;

            case TradingEventType.FillPosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.FillPosition,
                    user: extractAddress(1),
                    asset: extractAsset(2),
                    caller: extractAddress(3),
                    positionId: eventData[0],
                    fillPrice: eventData[1],
                    callerFee: eventData[2],
                } as TradingFillPositionEvent;

            case TradingEventType.Liquidation:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.Liquidation,
                    user: extractAddress(1),
                    asset: extractAsset(2),
                    liquidator: extractAddress(3),
                    positionId: eventData[0],
                    collateral: eventData[1],
                    loss: eventData[2],
                    liquidatorFee: eventData[3],
                } as TradingLiquidationEvent;

            case TradingEventType.CancelPosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.CancelPosition,
                    user: extractAddress(1),
                    asset: extractAsset(2),
                    positionId: eventData[0],
                    collateralReturned: eventData[1],
                } as TradingCancelPositionEvent;

            case TradingEventType.UpgradeWasm:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.UpgradeWasm,
                    admin: extractAddress(1),
                    wasmHash: eventData,
                } as TradingUpgradeWasmEvent;

            default:
                return undefined;
        }
    } catch (error) {
        console.warn('Failed to parse trading event:', error);
        return undefined;
    }
}