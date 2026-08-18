import { u32, u64 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

/** Governance event topic values, matched against decoded event names. */
export enum GovernanceEventType {
    Queued = 'queued',
    Executed = 'executed',
    Cancelled = 'cancelled',
    StatusSet = 'status_set',
    DelaySet = 'delay_set',
}

/** Fields shared by every governance event. */
export interface BaseGovernanceEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Governance;
    eventType: GovernanceEventType;
}

/**
 * Emitted by `queue` when a call is queued. Also emitted by `setDelay`
 * when a delay change is queued, with nonce `u32::MAX`, target this
 * governance contract, and fnName `set_delay`. Topics: nonce.
 */
export interface GovernanceQueuedEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Queued;
    /** Queue id. Ties a later Executed or Cancelled event to this one. */
    nonce: u32;
    /** Contract address the queued call will invoke. */
    target: string;
    /** Function name to invoke on `target`. */
    fnName: string;
    /** Unix timestamp, in seconds, at or after which the call becomes executable. */
    unlockTime: u64;
}

/** Emitted by `execute` after a queued call runs. Topics: nonce. */
export interface GovernanceExecutedEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Executed;
    /** Nonce of the Queued event this execution corresponds to. */
    nonce: u32;
    /** Contract address that was invoked. */
    target: string;
    /** Function name that was invoked on `target`. */
    fnName: string;
}

/** Emitted by `cancel` when the owner cancels a queued call. Topics: nonce. */
export interface GovernanceCancelledEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Cancelled;
    /** Nonce of the Queued event this cancellation corresponds to. */
    nonce: u32;
}

/** Emitted by `setStatus`, bypassing the timelock delay. Topics: target. */
export interface GovernanceStatusSetEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.StatusSet;
    /** Market contract address that received the status update. */
    target: string;
    /** Market `Status` enum discriminant forwarded to `target`. */
    status: u32;
}

/** Emitted by `applyDelay` when a pending delay change takes effect. */
export interface GovernanceDelaySetEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.DelaySet;
    /** Previous timelock delay, in seconds. */
    oldDelay: u64;
    /** New timelock delay now in effect, in seconds. */
    newDelay: u64;
}

/** Union of every governance contract event. */
export type GovernanceEvent =
    | GovernanceQueuedEvent
    | GovernanceExecutedEvent
    | GovernanceCancelledEvent
    | GovernanceStatusSetEvent
    | GovernanceDelaySetEvent;
