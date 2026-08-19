import type { TradingEvent } from './contracts/market/events.js';
import type { VaultEvent } from './contracts/vault/events.js';
import type { GovernanceEvent } from './contracts/governance/events.js';
import type { FactoryEvent } from './contracts/factory/events.js';

/** Identifies which Zenex contract raised an event, discriminating `ZenexEvent`. */
export enum ZenexContractType {
    Vault = 'vault',
    Trading = 'trading',
    Factory = 'factory',
    Governance = 'governance',
}

/** Fields common to every Zenex contract event. */
export interface BaseZenexEvent {
    id: string;
    contractId: string;
    contractType: ZenexContractType;
    /** Ledger sequence number the event was emitted in. */
    ledger: number;
    /** Close time of the ledger `ledger` refers to, as returned by `getEvents`. */
    ledgerClosedAt: string;
    txHash: string;
}

/**
 * Every event a Zenex contract can raise, discriminated on `contractType` and
 * each event's own `eventType`. These are types only. Decode a raw event
 * yourself from the values `getEvents` returns; the SDK ships no decoder.
 */
export type ZenexEvent = TradingEvent | VaultEvent | GovernanceEvent | FactoryEvent;
