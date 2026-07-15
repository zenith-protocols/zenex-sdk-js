// Classes
export { VaultContract } from './vault_contract.js';
export { VaultState } from './vault_state.js';

// Contract types
export type { VaultConstructorArgs } from './vault_contract.js';

// State types
export type { VaultStateData } from './vault_state.js';

// Events
export { VaultEventType, decodeVaultEvent } from './vault_events.js';

export type {
    BaseVaultEvent,
    VaultStrategyWithdrawEvent,
    VaultEvent,
} from './vault_events.js';

// Exact transaction quote math
export { quoteVaultDeposit, quoteVaultRedeem } from './quote.js';

export type {
    VaultAtomicState,
    VaultQuoteOutcome,
    VaultQuoteContext,
    VaultDepositQuoteInput,
    VaultRedeemQuoteInput,
    VaultGateInput,
} from './quote.js';

export { checkVaultWithdrawGates } from './gates.js';
export type { VaultWithdrawHeadroom } from './gates.js';
