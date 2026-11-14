import { i128, u64 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';
import type { OwnableEvent } from '../ownable/events.js';

/** Discriminates a decoded {@link OracleEvent}. `verifyPrice` raises no event. */
export enum OracleEventType {
    /** `updateStaleness` replaced both staleness windows. */
    StalenessUpdate = 'staleness_update',
    /** `updateSpreadReductionFactor` replaced the spread reduction factor. */
    SpreadReductionUpdate = 'spread_reduction_update',
}

/** Base shape shared by every oracle event. Fields are the wire names in camelCase. */
export interface BaseOracleEvent extends BaseZenexEvent {
    /** Always `ZenexContractType.Oracle`. */
    contractType: ZenexContractType.Oracle;
    /** The event name. */
    eventType: OracleEventType;
}

/** The owner replaced the staleness windows through `updateStaleness`. */
export interface OracleStalenessUpdateEvent extends BaseOracleEvent {
    eventType: OracleEventType.StalenessUpdate;
    /** The new window for order fills, seconds. */
    tradeStaleness: u64;
    /** The new window for gap-closing calls, seconds. */
    closeStaleness: u64;
}

/** The owner replaced the spread reduction factor through `updateSpreadReductionFactor`. */
export interface OracleSpreadReductionUpdateEvent extends BaseOracleEvent {
    eventType: OracleEventType.SpreadReductionUpdate;
    /** The new bid/ask narrowing toward the mid (SCALAR_18): 0 is off, SCALAR_18 collapses to the mid. */
    spreadReductionFactor: i128;
}

/** A decoded oracle event, including its ownership events. Narrow on `eventType` for the concrete shape. */
export type OracleEvent =
    | OracleStalenessUpdateEvent
    | OracleSpreadReductionUpdateEvent
    | OwnableEvent<ZenexContractType.Oracle>;
