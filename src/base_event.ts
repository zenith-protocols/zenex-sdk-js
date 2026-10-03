import type { MarketEvent } from './contracts/market/events.js';
import type { VaultEvent } from './contracts/vault/events.js';
import type { GovernanceEvent } from './contracts/governance/events.js';
import type { FactoryEvent } from './contracts/factory/events.js';
import type { OracleEvent } from './contracts/oracle/events.js';
import type { TreasuryEvent } from './contracts/treasury/events.js';
import type { FeeForwarderEvent } from './contracts/fee_forwarder/events.js';

/** Identifies which Zenex contract raised an event, discriminating `ZenexEvent`. */
export enum ZenexContractType {
    /** A market's strategy vault (LP share token). */
    Vault = 'vault',
    /** A market. */
    Market = 'market',
    /** The factory that deploys market and vault pairs. */
    Factory = 'factory',
    /** The governance timelock. */
    Governance = 'governance',
    /** The Chainlink Data Streams oracle. */
    Oracle = 'oracle',
    /** The treasury, the protocol fee sink. */
    Treasury = 'treasury',
    /** The fee forwarder that relays router calls. */
    FeeForwarder = 'fee_forwarder',
}

/** Fields common to every Zenex contract event. */
export interface BaseZenexEvent {
    /** The event id `getEvents` returns, unique per event. */
    id: string;
    /** The address (`C...`) of the contract that raised the event. */
    contractId: string;
    /** Which kind of contract `contractId` is. */
    contractType: ZenexContractType;
    /** Ledger sequence number the event was emitted in. */
    ledger: number;
    /** Close time of the ledger `ledger` refers to, as returned by `getEvents`. */
    ledgerClosedAt: string;
    /** Hash (hex) of the transaction that raised the event. */
    txHash: string;
}

/**
 * Every event the contracts this SDK binds can raise, discriminated on
 * `contractType` and each event's own `eventType`. The market router raises
 * none. These are types only: decode a raw event yourself from the values
 * `getEvents` returns.
 *
 * `eventType` is the event's name topic. The other fields are the event's
 * topic and data fields with snake_case names in camelCase, such as
 * `net_pnl` as `netPnl`. A field doc names any other rename, and any field
 * derived rather than read from the wire.
 */
export type ZenexEvent =
    | MarketEvent
    | VaultEvent
    | GovernanceEvent
    | FactoryEvent
    | OracleEvent
    | TreasuryEvent
    | FeeForwarderEvent;
