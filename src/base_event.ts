import { TradingEventType } from "./trading";
import { VaultEventType } from "./vault";

export enum ZenexContractType {
    Vault = 'vault',
    Trading = 'trading',
}

export interface BaseZenexEvent {
    id: string;
    contractId: string;
    contractType: ZenexContractType;
    eventType: VaultEventType | TradingEventType;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
}