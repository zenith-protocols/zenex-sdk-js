import { rpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';
import { i128, u64 } from '../index.js';

export enum VaultEventType {
    Deposit = 'deposit',
    QueueWithdraw = 'queue_withdraw',
    Withdraw = 'withdraw',
    EmergencyWithdraw = 'emergency_withdraw',
    CancelWithdraw = 'cancel_withdraw',
    TransferTo = 'transfer_to',
    TransferFrom = 'transfer_from'
}

export interface BaseVaultEvent {
    id: string;
    contractId: string;
    eventType: VaultEventType;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
}

export interface VaultDepositEvent extends BaseVaultEvent {
    eventType: VaultEventType.Deposit;
    receiver: string;
    tokens: i128;
    shares: i128;
}

export interface VaultQueueWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.QueueWithdraw;
    owner: string;
    shares: i128;
    unlockTime: u64;
}

export interface VaultWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.Withdraw;
    owner: string;
    shares: i128;
    tokens: i128;
}

export interface VaultEmergencyWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.EmergencyWithdraw;
    owner: string;
    shares: i128;
    tokens: i128;
    penalty: i128;
}

export interface VaultCancelWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.CancelWithdraw;
    owner: string;
    shares: i128;
}

export interface VaultTransferToEvent extends BaseVaultEvent {
    eventType: VaultEventType.TransferTo;
    strategy: string;
    amount: i128;
    newImpact: i128;
}

export interface VaultTransferFromEvent extends BaseVaultEvent {
    eventType: VaultEventType.TransferFrom;
    strategy: string;
    amount: i128;
    newImpact: i128;
}

export type VaultEvent =
    | VaultDepositEvent
    | VaultQueueWithdrawEvent
    | VaultWithdrawEvent
    | VaultEmergencyWithdrawEvent
    | VaultCancelWithdrawEvent
    | VaultTransferToEvent
    | VaultTransferFromEvent;

/**
 * Parse vault events from RPC event responses
 */
export function vaultEventFromEventResponse(
    eventResponse: rpc.Api.RawEventResponse
): VaultEvent | undefined {
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

        const baseEvent: BaseVaultEvent = {
            id: eventResponse.id,
            contractId: eventResponse.contractId,
            eventType: eventType as VaultEventType,
            ledger: eventResponse.ledger,
            ledgerClosedAt: eventResponse.ledgerClosedAt,
            txHash: eventResponse.txHash || '',
        };

        switch (eventType) {
            case VaultEventType.Deposit:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.Deposit,
                    receiver: eventData.receiver,
                    tokens: eventData.tokens,
                    shares: eventData.shares,
                } as VaultDepositEvent;

            case VaultEventType.QueueWithdraw:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.QueueWithdraw,
                    owner: eventData.owner,
                    shares: eventData.shares,
                    unlockTime: eventData.unlock_time,
                } as VaultQueueWithdrawEvent;

            case VaultEventType.Withdraw:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.Withdraw,
                    owner: eventData.owner,
                    shares: eventData.shares,
                    tokens: eventData.tokens,
                } as VaultWithdrawEvent;

            case VaultEventType.EmergencyWithdraw:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.EmergencyWithdraw,
                    owner: eventData.owner,
                    shares: eventData.shares,
                    tokens: eventData.tokens,
                    penalty: eventData.penalty,
                } as VaultEmergencyWithdrawEvent;

            case VaultEventType.CancelWithdraw:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.CancelWithdraw,
                    owner: eventData.owner,
                    shares: eventData.shares,
                } as VaultCancelWithdrawEvent;

            case VaultEventType.TransferTo:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.TransferTo,
                    strategy: eventData.strategy,
                    amount: eventData.amount,
                    newImpact: eventData.new_impact,
                } as VaultTransferToEvent;

            case VaultEventType.TransferFrom:
                return {
                    ...baseEvent,
                    eventType: VaultEventType.TransferFrom,
                    strategy: eventData.strategy,
                    amount: eventData.amount,
                    newImpact: eventData.new_impact,
                } as VaultTransferFromEvent;

            default:
                return undefined;
        }
    } catch (error) {
        console.warn('Failed to parse vault event:', error);
        return undefined;
    }
}