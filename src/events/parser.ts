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
    TradingQueueSetMarketEvent,
    TradingSetMarketEvent,
    TradingSetStatusEvent,
    TradingOpenPositionEvent,
    TradingClosePositionEvent,
    TradingFillPositionEvent,
    TradingLiquidationEvent,
    TradingCancelPositionEvent,
    TradingModifyRiskEvent,
    TradingUpgradeWasmEvent,
    VaultStrategyWithdrawEvent,
    VaultStrategyDepositEvent,
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
                    newNetImpact: eventData.new_net_impact,
                } as VaultStrategyWithdrawEvent;

            case VaultEventType.StrategyDeposit:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.StrategyDeposit,
                    strategy: extractAddress(1),
                    amount: eventData.amount,
                    newNetImpact: eventData.new_net_impact,
                } as VaultStrategyDepositEvent;

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
