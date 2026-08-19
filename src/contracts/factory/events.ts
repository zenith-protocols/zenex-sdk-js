import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

/** Factory event types, keyed by the event's on-chain name. */
export enum FactoryEventType {
    Deploy = 'deploy',
}

/** Base shape shared by every factory event. Narrow on `eventType` to access an event's own fields. */
export interface BaseFactoryEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Factory;
    eventType: FactoryEventType;
}

/** Market and vault pair deployed via `deploy`. */
export interface FactoryDeployEvent extends BaseFactoryEvent {
    eventType: FactoryEventType.Deploy;
    /** The deployed market contract address. */
    market: string;
    /** The deployed vault contract address. */
    vault: string;
}

/** Discriminated union of all factory contract events. */
export type FactoryEvent = FactoryDeployEvent;
