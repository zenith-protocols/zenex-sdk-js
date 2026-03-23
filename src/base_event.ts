// Contract type enum
export enum ZenexContractType {
    Vault = 'vault',
    Trading = 'trading',
    Factory = 'factory',
    Governance = 'governance',
}

// Base event interface
export interface BaseZenexEvent {
    id: string;
    contractId: string;
    contractType: ZenexContractType;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
}
