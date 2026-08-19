import { i128 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

/** Discriminates a decoded {@link VaultEvent}. */
export enum VaultEventType {
    /** A strategy deposit minted shares. */
    Deposit = 'deposit',
    /** A strategy redemption burned shares. */
    Withdraw = 'withdraw',
    /** The strategy withdrew assets to pay winning positions. */
    StrategyWithdraw = 'strategy_withdraw',
}

/** Common shape decoded from every vault contract event. */
export interface BaseVaultEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Vault;
    eventType: VaultEventType;
}

/** Underlying assets deposited for shares, emitted by `strategyDeposit`. */
export interface VaultDepositEvent extends BaseVaultEvent {
    eventType: VaultEventType.Deposit;
    /** The registered strategy (market contract) that drove the deposit. */
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

/** Shares redeemed for underlying assets, emitted by `strategyRedeem`. */
export interface VaultWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.Withdraw;
    /** The registered strategy (market contract) that drove the redeem. */
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

/** Assets pulled to the strategy, emitted by `strategyWithdraw` to pay winning positions. */
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
