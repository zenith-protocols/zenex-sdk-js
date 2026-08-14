import { i128 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

// Vault event types
export enum VaultEventType {
    StrategyWithdraw = 'StrategyWithdraw',
}

// Vault Events
export interface BaseVaultEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Vault;
    eventType: VaultEventType;
}

export interface VaultStrategyWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.StrategyWithdraw;
    strategy: string;
    amount: i128;
}

export type VaultEvent = VaultStrategyWithdrawEvent;
