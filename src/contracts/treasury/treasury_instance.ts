import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

export interface TreasuryInstanceState {
    /** Protocol fee rate (SCALAR_18 fraction); `0n` when unset. */
    rate: bigint;
    /** Rate/withdrawal admin; absent once ownership has been renounced. */
    owner?: string;
}

/** Never throws on a treasury instance: both slots have defaults. */
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

/** The `rate` field alone, for callers that only feed the quote math. */
export function parseTreasuryRate(instanceVal: xdr.ScVal): bigint {
    return parseTreasuryInstance(instanceVal).rate;
}
