import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';
import type { OwnableEvent } from '../ownable/events.js';
import type { FactoryInitMeta } from './contract.js';

/** Factory event types, keyed by the event's on-chain name. */
export enum FactoryEventType {
    /** `deployMarket` deployed a market and vault pair. */
    Deploy = 'deploy',
    /** `setInitMeta` replaced the inputs future deploys use. */
    InitMetaUpdate = 'init_meta_update',
}

/** Base shape shared by every factory event. Narrow on `eventType` to access an event's own fields. */
export interface BaseFactoryEvent extends BaseZenexEvent {
    /** Always `ZenexContractType.Factory`. */
    contractType: ZenexContractType.Factory;
    /** The event name. */
    eventType: FactoryEventType;
}

/** Market and vault pair deployed via `deploy`. Both addresses are topics. */
export interface FactoryDeployEvent extends BaseFactoryEvent {
    eventType: FactoryEventType.Deploy;
    /** The deployed market contract address. On the wire this topic is named `trading`. */
    market: string;
    /** The deployed vault contract address. */
    vault: string;
}

/** The owner replaced the WASM hashes and treasury future deploys use, via `set_init_meta`. */
export interface FactoryInitMetaUpdateEvent extends BaseFactoryEvent {
    eventType: FactoryEventType.InitMetaUpdate;
    /** The replacement metadata, with its fields under their wire names. */
    initMeta: FactoryInitMeta;
}

/** Discriminated union of all factory contract events, including its ownership events. */
export type FactoryEvent =
    | FactoryDeployEvent
    | FactoryInitMetaUpdateEvent
    | OwnableEvent<ZenexContractType.Factory>;
