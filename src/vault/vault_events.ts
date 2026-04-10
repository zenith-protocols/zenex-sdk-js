import { i128 } from '../index.js';
import { ZenexContractType, BaseZenexEvent, NormalizedEvent } from '../base_event.js';

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
 * Decode a normalized event into a typed VaultEvent.
 * Returns undefined if the event type is not a known vault event.
 */
export function decodeVaultEvent(event: NormalizedEvent): VaultEvent | undefined {
    const { eventType, topicArgs, data } = event;

    if (!(eventType in VaultEventType)) return undefined;

    const baseEvent: BaseVaultEvent = {
        id: event.id,
        contractId: event.contractId,
        contractType: ZenexContractType.Vault,
        eventType: eventType as VaultEventType,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
        txHash: event.txHash,
    };

    switch (eventType) {
        case VaultEventType.StrategyWithdraw:
            return {
                ...baseEvent,
                eventType: VaultEventType.StrategyWithdraw,
                strategy: topicArgs[0] as string ?? '',
                amount: data.amount,
            } as VaultStrategyWithdrawEvent;

        default:
            return undefined;
    }
}
