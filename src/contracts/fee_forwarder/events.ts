import { i128 } from '../../index.js';
import { ZenexContractType, BaseZenexEvent } from '../../base_event.js';

/** Discriminates a decoded {@link FeeForwarderEvent}. */
export enum FeeForwarderEventType {
    /** A relayed call paid its fee. */
    FeeCollected = 'fee_collected',
}

/** Base shape shared by every fee forwarder event. Fields are the wire names in camelCase. */
export interface BaseFeeForwarderEvent extends BaseZenexEvent {
    /** Always `ZenexContractType.FeeForwarder`. */
    contractType: ZenexContractType.FeeForwarder;
    /** The event name. */
    eventType: FeeForwarderEventType;
}

/** A relayed call paid its fee to the signed recipient, once per `forward` or `forward_dynamic`. */
export interface FeeForwarderFeeCollectedEvent extends BaseFeeForwarderEvent {
    eventType: FeeForwarderEventType.FeeCollected;
    /** The account that paid the fee. */
    user: string;
    /** The account the fee was paid to. */
    recipient: string;
    /** The fee token. */
    token: string;
    /** Fee paid, token-dec. The unused rest of the signed cap returns to `user` in the same call. */
    amount: i128;
}

/** A decoded fee forwarder event. Narrow on `eventType` for the concrete shape. */
export type FeeForwarderEvent = FeeForwarderFeeCollectedEvent;
