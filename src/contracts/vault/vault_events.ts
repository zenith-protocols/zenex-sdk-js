import { i128 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

// Vault event types. Values are the on-chain name topics: bare
// `#[contractevent]` defaults to snake_case of the struct name. `deposit`
// and `withdraw` are the OpenZeppelin stellar-tokens ERC-4626 vault events
// (vault/mod.rs `emit_deposit`/`emit_withdraw`); `strategy_withdraw` is the
// Zenex strategy gate's own receipt (strategy-vault/src/strategy.rs).
export enum VaultEventType {
    Deposit = 'deposit',
    Withdraw = 'withdraw',
    StrategyWithdraw = 'strategy_withdraw',
}

// Vault Events
export interface BaseVaultEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Vault;
    eventType: VaultEventType;
}

/**
 * Underlying assets deposited in exchange for shares (OZ ERC-4626 receipt),
 * emitted by the strategy-driven `strategy_deposit`. Topics: operator, from,
 * receiver.
 */
export interface VaultDepositEvent extends BaseVaultEvent {
    eventType: VaultEventType.Deposit;
    /** The registered strategy (trading contract) that drove the deposit. */
    operator: string;
    /** The account the assets were pulled from. */
    from: string;
    /** The account the shares were minted to. */
    receiver: string;
    /** Assets taken, token-dec. */
    assets: i128;
    /** Shares minted. */
    shares: i128;
}

/**
 * Shares exchanged back for underlying assets (OZ ERC-4626 receipt),
 * emitted by the strategy-driven `strategy_redeem`. Topics: operator,
 * receiver, owner.
 */
export interface VaultWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.Withdraw;
    /** The registered strategy (trading contract) that drove the redeem. */
    operator: string;
    /** The account the assets were paid to. */
    receiver: string;
    /** The account the shares were burned from. */
    owner: string;
    /** Assets paid, token-dec. */
    assets: i128;
    /** Shares burned. */
    shares: i128;
}

/** Underlying assets transferred out to the registered strategy via `strategy_withdraw`. */
export interface VaultStrategyWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.StrategyWithdraw;
    strategy: string;
    amount: i128;
}

export type VaultEvent =
    | VaultDepositEvent
    | VaultWithdrawEvent
    | VaultStrategyWithdrawEvent;
