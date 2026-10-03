import { u32 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

/**
 * Discriminates a decoded {@link OwnableEvent}. The market, factory, oracle,
 * treasury and governance contracts raise these.
 */
export enum OwnableEventType {
    /** `transferOwnership` started, refreshed or cancelled a transfer. */
    OwnershipTransfer = 'ownership_transfer',
    /** `acceptOwnership` completed a transfer. */
    OwnershipTransferCompleted = 'ownership_transfer_completed',
    /** `renounceOwnership` removed the owner. */
    OwnershipRenounced = 'ownership_renounced',
}

/** The contracts that raise ownership events. */
export type OwnableContractType =
    | ZenexContractType.Market
    | ZenexContractType.Factory
    | ZenexContractType.Oracle
    | ZenexContractType.Treasury
    | ZenexContractType.Governance;

/** Base shape shared by every ownership event. `C` is the contract that raised it. */
export interface BaseOwnableEvent<C extends OwnableContractType = OwnableContractType>
    extends BaseZenexEvent {
    /** The contract type that raised the event. */
    contractType: C;
    /** The event name. */
    eventType: OwnableEventType;
}

/** The owner started, refreshed or cancelled a two-step transfer through `transferOwnership`. */
export interface OwnershipTransferEvent<C extends OwnableContractType = OwnableContractType>
    extends BaseOwnableEvent<C> {
    eventType: OwnableEventType.OwnershipTransfer;
    /** The current owner, who stays owner until `newOwner` accepts. */
    oldOwner: string;
    /** The proposed owner. */
    newOwner: string;
    /** Last ledger sequence `newOwner` can accept by. `0` marks a cancel of the pending transfer to `newOwner`. */
    liveUntilLedger: u32;
}

/** The pending owner accepted through `acceptOwnership` and is now the owner. */
export interface OwnershipTransferCompletedEvent<C extends OwnableContractType = OwnableContractType>
    extends BaseOwnableEvent<C> {
    eventType: OwnableEventType.OwnershipTransferCompleted;
    /** The new owner. */
    newOwner: string;
}

/** The owner renounced ownership through `renounceOwnership`. Every owner-only method is disabled for good. */
export interface OwnershipRenouncedEvent<C extends OwnableContractType = OwnableContractType>
    extends BaseOwnableEvent<C> {
    eventType: OwnableEventType.OwnershipRenounced;
    /** The owner that renounced. */
    oldOwner: string;
}

/** A decoded ownership event raised by a contract of type `C`. Narrow on `eventType` for the concrete shape. */
export type OwnableEvent<C extends OwnableContractType = OwnableContractType> =
    | OwnershipTransferEvent<C>
    | OwnershipTransferCompletedEvent<C>
    | OwnershipRenouncedEvent<C>;
