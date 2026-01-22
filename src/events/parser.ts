import { rpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';
import { Asset } from '../types/asset.js';
import {
    ZenexContractType,
    TradingEventType,
    VaultEventType,
    TradingEvent,
    VaultEvent,
    ZenexEvent,
    BaseTradingEvent,
    BaseVaultEvent,
    TradingSetConfigEvent,
    TradingQueueSetConfigEvent,
    TradingQueueSetMarketEvent,
    TradingCancelSetMarketEvent,
    TradingSetMarketEvent,
    TradingSetStatusEvent,
    TradingOpenPositionEvent,
    TradingClosePositionEvent,
    TradingFillPositionEvent,
    TradingLiquidationEvent,
    TradingTakeProfitEvent,
    TradingStopLossEvent,
    TradingCancelPositionEvent,
    TradingWithdrawCollateralEvent,
    TradingDepositCollateralEvent,
    TradingSetTakeProfitEvent,
    TradingSetStopLossEvent,
    VaultStrategyWithdrawEvent,
} from '../types/events.js';

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
                } as TradingSetConfigEvent;

            case TradingEventType.QueueSetConfig:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.QueueSetConfig,
                    oracle: eventData.oracle,
                    callerTakeRate: eventData.caller_take_rate,
                    maxPositions: eventData.max_positions,
                    unlockTime: eventData.unlock_time,
                } as TradingQueueSetConfigEvent;

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
                    assetIndex: extractU32(1),
                } as TradingSetMarketEvent;

            case TradingEventType.SetStatus:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetStatus,
                    status: eventData.status,
                } as TradingSetStatusEvent;

            case TradingEventType.OpenPosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.OpenPosition,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                } as TradingOpenPositionEvent;

            case TradingEventType.ClosePosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.ClosePosition,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    price: eventData.price,
                    fee: eventData.fee,
                } as TradingClosePositionEvent;

            case TradingEventType.FillPosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.FillPosition,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                } as TradingFillPositionEvent;

            case TradingEventType.Liquidation:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.Liquidation,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    price: eventData.price,
                    fee: eventData.fee,
                } as TradingLiquidationEvent;

            case TradingEventType.TakeProfit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.TakeProfit,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    price: eventData.price,
                    fee: eventData.fee,
                } as TradingTakeProfitEvent;

            case TradingEventType.StopLoss:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.StopLoss,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    price: eventData.price,
                    fee: eventData.fee,
                } as TradingStopLossEvent;

            case TradingEventType.CancelPosition:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.CancelPosition,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                } as TradingCancelPositionEvent;

            case TradingEventType.WithdrawCollateral:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.WithdrawCollateral,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    amount: eventData.amount,
                } as TradingWithdrawCollateralEvent;

            case TradingEventType.DepositCollateral:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.DepositCollateral,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    amount: eventData.amount,
                } as TradingDepositCollateralEvent;

            case TradingEventType.SetTakeProfit:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetTakeProfit,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    price: eventData.price,
                } as TradingSetTakeProfitEvent;

            case TradingEventType.SetStopLoss:
                return {
                    ...baseEvent,
                    eventType: TradingEventType.SetStopLoss,
                    assetIndex: extractU32(1),
                    user: extractAddress(2),
                    positionId: eventData.position_id,
                    price: eventData.price,
                } as TradingSetStopLossEvent;

            default:
                return undefined;
        }
    } catch (error) {
        console.warn('Failed to parse trading event:', error);
        return undefined;
    }
}

/**
 * Parse a vault event from RPC event response
 */
export function parseVaultEvent(
    eventResponse: rpc.Api.RawEventResponse
): VaultEvent | undefined {
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

        const baseEvent: BaseVaultEvent = {
            id: eventResponse.id,
            contractId: eventResponse.contractId,
            contractType: ZenexContractType.Vault,
            eventType: eventType as VaultEventType,
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

        switch (eventType) {
            case VaultEventType.StrategyWithdraw:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.StrategyWithdraw,
                    strategy: extractAddress(1),
                    amount: eventData.amount,
                } as VaultStrategyWithdrawEvent;

            default:
                return undefined;
        }
    } catch (error) {
        console.warn('Failed to parse vault event:', error);
        return undefined;
    }
}

/**
 * Parse any Zenex event from RPC event response
 * Tries trading first, then vault
 */
export function parseEvent(
    eventResponse: rpc.Api.RawEventResponse
): ZenexEvent | undefined {
    // Try parsing as trading event first
    const tradingEvent = parseTradingEvent(eventResponse);
    if (tradingEvent) return tradingEvent;

    // Then try vault event
    const vaultEvent = parseVaultEvent(eventResponse);
    if (vaultEvent) return vaultEvent;

    return undefined;
}

/**
 * Check if an event is a trading event
 */
export function isTradingEvent(event: ZenexEvent): event is TradingEvent {
    return event.contractType === ZenexContractType.Trading;
}

/**
 * Check if an event is a vault event
 */
export function isVaultEvent(event: ZenexEvent): event is VaultEvent {
    return event.contractType === ZenexContractType.Vault;
}
