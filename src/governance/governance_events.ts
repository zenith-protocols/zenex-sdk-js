import { u32, u64 } from '../index.js';
import { ZenexContractType, BaseZenexEvent, NormalizedEvent } from '../base_event.js';

// Governance event types (matches Rust events)
export enum GovernanceEventType {
    Queued = 'Queued',
    Executed = 'Executed',
    Cancelled = 'Cancelled',
    StatusSet = 'StatusSet',
    DelaySet = 'DelaySet',
}

// Governance Events
export interface BaseGovernanceEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Governance;
    eventType: GovernanceEventType;
}

export interface GovernanceQueuedEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Queued;
    nonce: u32;
    target: string;
    fnName: string;
    unlockTime: u64;
}

export interface GovernanceExecutedEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Executed;
    nonce: u32;
    target: string;
    fnName: string;
}

export interface GovernanceCancelledEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Cancelled;
    nonce: u32;
}

export interface GovernanceStatusSetEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.StatusSet;
    target: string;
    status: u32;
}

export interface GovernanceDelaySetEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.DelaySet;
    oldDelay: u64;
    newDelay: u64;
}

export type GovernanceEvent =
    | GovernanceQueuedEvent
    | GovernanceExecutedEvent
    | GovernanceCancelledEvent
    | GovernanceStatusSetEvent
    | GovernanceDelaySetEvent;

/**
 * Decode a normalized event into a typed GovernanceEvent.
 * Returns undefined if the event type is not a known governance event.
 */
export function decodeGovernanceEvent(event: NormalizedEvent): GovernanceEvent | undefined {
    const { eventType, topicArgs, data } = event;

    if (!(eventType in GovernanceEventType)) return undefined;

    const baseEvent: BaseGovernanceEvent = {
        id: event.id,
        contractId: event.contractId,
        contractType: ZenexContractType.Governance,
        eventType: eventType as GovernanceEventType,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
        txHash: event.txHash,
    };

    switch (eventType) {
        case GovernanceEventType.Queued:
            return {
                ...baseEvent,
                eventType: GovernanceEventType.Queued,
                nonce: topicArgs[0] as number ?? 0,
                target: data.target as string,
                fnName: data.fn_name as string,
                unlockTime: data.unlock_time as bigint,
            } as GovernanceQueuedEvent;

        case GovernanceEventType.Executed:
            return {
                ...baseEvent,
                eventType: GovernanceEventType.Executed,
                nonce: topicArgs[0] as number ?? 0,
                target: data.target as string,
                fnName: data.fn_name as string,
            } as GovernanceExecutedEvent;

        case GovernanceEventType.Cancelled:
            return {
                ...baseEvent,
                eventType: GovernanceEventType.Cancelled,
                nonce: topicArgs[0] as number ?? 0,
            } as GovernanceCancelledEvent;

        case GovernanceEventType.StatusSet:
            return {
                ...baseEvent,
                eventType: GovernanceEventType.StatusSet,
                target: topicArgs[0] as string ?? '',
                status: data.status as number,
            } as GovernanceStatusSetEvent;

        case GovernanceEventType.DelaySet:
            return {
                ...baseEvent,
                eventType: GovernanceEventType.DelaySet,
                oldDelay: data.old_delay as bigint,
                newDelay: data.new_delay as bigint,
            } as GovernanceDelaySetEvent;

        default:
            return undefined;
    }
}
