import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

// Factory event types. Values are the on-chain name topics: bare
// `#[contractevent]` defaults to snake_case of the struct name.
export enum FactoryEventType {
    Deploy = 'deploy',
}

// Factory Events
export interface BaseFactoryEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Factory;
    eventType: FactoryEventType;
}

/** Trading + vault pair deployed via `deploy`. Topics: trading, vault. */
export interface FactoryDeployEvent extends BaseFactoryEvent {
    eventType: FactoryEventType.Deploy;
    /** The deployed trading contract address. */
    trading: string;
    /** The deployed vault contract address. */
    vault: string;
}

export type FactoryEvent = FactoryDeployEvent;
