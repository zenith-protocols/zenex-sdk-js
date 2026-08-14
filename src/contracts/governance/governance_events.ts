import { u32, u64 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

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
