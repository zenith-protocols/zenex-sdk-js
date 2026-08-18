// Classes
export { VaultContract } from './vault_contract.js';

// Contract types
export type { VaultConstructorArgs } from './vault_contract.js';

// Ledger-entry walkers (getLedgerEntries reads)
export { parseVaultInstance } from './vault_instance.js';
export type { VaultInstanceState } from './vault_instance.js';

// Events
export { VaultEventType } from './vault_events.js';

export type {
    BaseVaultEvent,
    VaultDepositEvent,
    VaultWithdrawEvent,
    VaultStrategyWithdrawEvent,
    VaultEvent,
} from './vault_events.js';

// Exact transaction quote math
export {
    quoteVaultDeposit,
    quoteVaultDepositFill,
    quoteVaultOrderCreation,
    quoteVaultRedeem,
    quoteVaultRedeemFill,
    deriveVaultMinimumOutput,
} from '../../trading/quote/vault.js';

export type {
    DeriveVaultMinimumOutputInput,
    ExactVaultOrderCreationQuote,
    ExactVaultRestingOrderCreationQuote,
    VaultAtomicState,
    VaultEstimatedOutputReference,
    VaultMinimumOutput,
    VaultOrderCreationOutcome,
    VaultOrderCreationQuoteInput,
    VaultRestingOrderCreation,
    VaultRetiredImmediateRedeem,
    VaultQuoteOutcome,
    VaultQuoteContext,
    VaultDepositQuoteInput,
    VaultRedeemQuoteInput,
    VaultGateInput,
} from '../../trading/quote/vault.js';

export { checkVaultWithdrawGates } from '../../trading/quote/vault_gates.js';
export type { VaultWithdrawHeadroom } from '../../trading/quote/vault_gates.js';
