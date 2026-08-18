import { i128 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

/**
 * Discriminates a decoded {@link VaultEvent}; each value is the contract's
 * snake_case `#[contractevent]` name. `Deposit`/`Withdraw` are the
 * OpenZeppelin stellar-tokens ERC-4626 vault events (`emit_deposit`/
 * `emit_withdraw`); `StrategyWithdraw` is Zenex's own strategy-gate receipt.
 */
export enum VaultEventType {
    Deposit = 'deposit',
    Withdraw = 'withdraw',
    StrategyWithdraw = 'strategy_withdraw',
}

/**
 * Common shape decoded from every vault contract `#[contractevent]`. Topics
 * are `[<snake_case event name>, ...#[topic] fields in declaration order]`;
 * every other field lands in the data map.
 */
export interface BaseVaultEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Vault;
    eventType: VaultEventType;
}

/**
 * Underlying assets deposited in exchange for shares — OpenZeppelin's
 * ERC-4626 `emit_deposit`, raised by the strategy-driven `strategy_deposit`.
 * Topics: operator, from, receiver.
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
    /** Shares minted, share-dec (asset decimals plus the vault's decimals offset). */
    shares: i128;
}

/**
 * Shares exchanged back for underlying assets — OpenZeppelin's ERC-4626
 * `emit_withdraw`, raised by the strategy-driven `strategy_redeem`. Topics:
 * operator, receiver, owner.
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
    /** Shares burned, share-dec (asset decimals plus the vault's decimals offset). */
    shares: i128;
}

/**
 * Underlying assets pulled out to the registered strategy — Zenex's own
 * receipt (not an OZ vault event), raised by `strategy_withdraw` when the
 * market pays winning positions. Topic: strategy.
 */
export interface VaultStrategyWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.StrategyWithdraw;
    /** The registered strategy (market contract) that received the assets. */
    strategy: string;
    /** Assets moved, token-dec. */
    amount: i128;
}

/** Discriminated union of all vault contract events; narrow on `eventType` for the concrete shape. */
export type VaultEvent =
    | VaultDepositEvent
    | VaultWithdrawEvent
    | VaultStrategyWithdrawEvent;
