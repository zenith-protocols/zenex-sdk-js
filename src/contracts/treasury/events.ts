import { i128 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';
import type { OwnableEvent } from '../ownable/events.js';

/**
 * Discriminates a decoded {@link TreasuryEvent}. The `withdraw` name is
 * shared with the vault's withdraw event, so match on `contractType` first.
 */
export enum TreasuryEventType {
    /** `withdraw` moved collected fees out. */
    Withdraw = 'withdraw',
    /** `setRate` replaced the protocol fee rate. */
    RateUpdate = 'rate_update',
}

/** Base shape shared by every treasury event. Fields are the wire names in camelCase. */
export interface BaseTreasuryEvent extends BaseZenexEvent {
    /** Always `ZenexContractType.Treasury`. */
    contractType: ZenexContractType.Treasury;
    /** The event name. */
    eventType: TreasuryEventType;
}

/** The owner withdrew collected fees through `withdraw`. */
export interface TreasuryWithdrawEvent extends BaseTreasuryEvent {
    eventType: TreasuryEventType.Withdraw;
    /** The token withdrawn. */
    token: string;
    /** The recipient. */
    to: string;
    /** Amount moved, token-dec. */
    amount: i128;
}

/** The owner replaced the protocol fee rate through `setRate`. */
export interface TreasuryRateUpdateEvent extends BaseTreasuryEvent {
    eventType: TreasuryEventType.RateUpdate;
    /** The new fee rate (SCALAR_18 fraction), in [0, SCALAR_18 / 2]. */
    rate: i128;
}

/** A decoded treasury event, including its ownership events. Narrow on `eventType` for the concrete shape. */
export type TreasuryEvent =
    | TreasuryWithdrawEvent
    | TreasuryRateUpdateEvent
    | OwnableEvent<ZenexContractType.Treasury>;
