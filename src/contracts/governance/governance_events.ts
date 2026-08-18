import { u32, u64 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

// Governance event types (matches Rust events). Values are the on-chain
// name topics: bare `#[contractevent]` defaults to snake_case of the
// struct name.
export enum GovernanceEventType {
    Queued = 'queued',
    Executed = 'executed',
    Cancelled = 'cancelled',
    StatusSet = 'status_set',
    DelaySet = 'delay_set',
}

export interface BaseGovernanceEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Governance;
    eventType: GovernanceEventType;
}

/**
 * Call queued via `queue`, or a pending delay change queued via `set_delay`
 * (nonce `u32::MAX`, target the governance contract itself, fnName `set_delay`).
 * Topics: nonce.
 */
export interface GovernanceQueuedEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Queued;
    /** Monotonically increasing id for this queued call; ties an Executed/Cancelled event back to it. */
    nonce: u32;
    /** Contract address the queued call will invoke. */
    target: string;
    /** Function name to invoke on `target`. */
    fnName: string;
    /** Unix timestamp (seconds) after which the call becomes executable. */
    unlockTime: u64;
}

/** Queued call executed via `execute` after its delay passed. Topics: nonce. */
export interface GovernanceExecutedEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Executed;
    /** Nonce of the Queued event this execution corresponds to. */
    nonce: u32;
    /** Contract address that was invoked. */
    target: string;
    /** Function name that was invoked on `target`. */
    fnName: string;
}

/** Queued call cancelled by the owner via `cancel`. Topics: nonce. */
export interface GovernanceCancelledEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.Cancelled;
    /** Nonce of the Queued event this cancellation corresponds to. */
    nonce: u32;
}

/** Immediate `set_status` forwarded to `target`, bypassing the timelock delay. Topics: target. */
export interface GovernanceStatusSetEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.StatusSet;
    /** Market contract address that received the status update. */
    target: string;
    /** Market `Status` enum discriminant forwarded to `target`. */
    status: u32;
}

/** Pending delay change applied via `apply_delay` once its own timelock elapsed. */
export interface GovernanceDelaySetEvent extends BaseGovernanceEvent {
    eventType: GovernanceEventType.DelaySet;
    /** Previous timelock delay, in seconds. */
    oldDelay: u64;
    /** New timelock delay now in effect, in seconds. */
    newDelay: u64;
}

export type GovernanceEvent =
    | GovernanceQueuedEvent
    | GovernanceExecutedEvent
    | GovernanceCancelledEvent
    | GovernanceStatusSetEvent
    | GovernanceDelaySetEvent;
