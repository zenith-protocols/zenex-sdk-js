import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

/** The treasury contract's decoded instance storage. */
export interface TreasuryInstanceState {
    /** Protocol fee rate (SCALAR_18 fraction); `0n` when unset. */
    rate: bigint;
    /** Rate/withdrawal admin; absent once ownership has been renounced. */
    owner?: string;
}

/**
 * Walk a treasury contract-instance value into its decoded state.
 *
 * @throws If the value is not a contract instance.
 */
export function parseTreasuryInstance(
    instanceVal: xdr.ScVal,
): TreasuryInstanceState {
    const storage = instanceStorage(instanceVal, 'treasury');
    const rate = storage.get('Rate');
    return {
        rate: rate ? scValToBigInt(rate) : 0n,
        owner: storage.optionalAddress('Owner'),
    };
}

/**
 * The protocol fee rate alone — the only field the quote math needs, and what
 * `loadTreasuryRate` returns.
 */
export function parseTreasuryRate(instanceVal: xdr.ScVal): bigint {
    return parseTreasuryInstance(instanceVal).rate;
}
