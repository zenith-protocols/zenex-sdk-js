import type { TradingEvent } from './contracts/trading/trading_events.js';
import type { VaultEvent } from './contracts/vault/vault_events.js';
import type { GovernanceEvent } from './contracts/governance/governance_events.js';
import type { FactoryEvent } from './contracts/factory/factory_events.js';

// =============================================================================
// Typed event surface (types only).
//
// The per-contract `*_events.ts` files mirror the contract event schemas as
// discriminated unions keyed on their `eventType` enums; consumers that read
// events (the platform indexer, integrators on `getEvents`) own their own
// decode path and import these types to stay in sync with the on-chain
// shapes. The SDK ships no event decoders.
// =============================================================================

// Contract type enum
export enum ZenexContractType {
    Vault = 'vault',
    Trading = 'trading',
    Factory = 'factory',
    Governance = 'governance',
}

// Base event interface (typed event base)
export interface BaseZenexEvent {
    id: string;
    contractId: string;
    contractType: ZenexContractType;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
}

export type ZenexEvent = TradingEvent | VaultEvent | GovernanceEvent | FactoryEvent;
