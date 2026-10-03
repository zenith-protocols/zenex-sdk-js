import { i128, u32, u64 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

/** Discriminates a decoded {@link VaultEvent}. */
export enum VaultEventType {
    /** A strategy deposit minted shares. */
    Deposit = 'deposit',
    /** A strategy redemption burned shares. */
    Withdraw = 'withdraw',
    /** The strategy withdrew assets to pay winning positions. */
    StrategyWithdraw = 'strategy_withdraw',
    /** Shares moved between holders. */
    Transfer = 'transfer',
    /** A holder set a share allowance. */
    Approve = 'approve',
}

/** Common shape decoded from every vault contract event. Fields are the wire names in camelCase. */
export interface BaseVaultEvent extends BaseZenexEvent {
    /** Always `ZenexContractType.Vault`. */
    contractType: ZenexContractType.Vault;
    /** The event name. */
    eventType: VaultEventType;
}

/** Underlying assets deposited for shares, emitted by `strategyDeposit`. */
export interface VaultDepositEvent extends BaseVaultEvent {
    eventType: VaultEventType.Deposit;
    /** The registered strategy (market contract) that drove the deposit. */
    operator: string;
    /** The account the assets were pulled from. On a keeper deposit fill, the market, which holds the escrow. */
    from: string;
    /** The account the shares were minted to. */
    receiver: string;
    /** Assets taken, token-dec. */
    assets: i128;
    /** Shares minted, share-dec (asset decimals plus the vault's decimals offset). */
    shares: i128;
}

/**
 * Shares redeemed for underlying assets, emitted by `strategyRedeem`. On a
 * keeper redeem fill, `receiver` and `owner` are both the market, which held
 * the escrowed shares. The user's receipt is the market's `redeem_fill`.
 */
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

/**
 * Shares moved through `transfer` or `transferFrom`. The market moves a
 * user's shares this way into a redeem order's escrow, back on a cancel or a
 * reject, and in a retired market's instant redeem.
 */
export interface VaultTransferEvent extends BaseVaultEvent {
    eventType: VaultEventType.Transfer;
    /** The sender. */
    from: string;
    /** The recipient. */
    to: string;
    /** Shares moved, share-dec. On the wire this is the whole event data, unless `toMuxedId` is set. */
    amount: i128;
    /** The recipient's muxed id. Set only for a muxed recipient, whose event data is the map `{ to_muxed_id, amount }`. */
    toMuxedId?: u64;
}

/** A holder set the share allowance of a spender through `approve`. */
export interface VaultApproveEvent extends BaseVaultEvent {
    eventType: VaultEventType.Approve;
    /** The share holder. */
    owner: string;
    /** The account allowed to spend the shares. */
    spender: string;
    /** The new allowance, share-dec. */
    amount: i128;
    /** Last ledger sequence the allowance is valid for. */
    liveUntilLedger: u32;
}

/** Discriminated union of all vault contract events; narrow on `eventType` for the concrete shape. */
export type VaultEvent =
    | VaultDepositEvent
    | VaultWithdrawEvent
    | VaultStrategyWithdrawEvent
    | VaultTransferEvent
    | VaultApproveEvent;
