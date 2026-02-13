import { rpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';
import { i128 } from '../index.js';
import { ZenexContractType, BaseZenexEvent } from '../base_event.js';

// Vault event types
export enum VaultEventType {
    StrategyWithdraw = 'StrategyWithdraw',
}

// Vault Events
export interface BaseVaultEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Vault;
    eventType: VaultEventType;
}

export interface VaultStrategyWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.StrategyWithdraw;
    strategy: string;
    amount: i128;
}

export type VaultEvent = VaultStrategyWithdrawEvent;

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
