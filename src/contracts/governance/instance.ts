import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

/**
 * The governance contract's instance storage, as `parseGovernanceInstance`
 * decodes it. Queued calls and a pending delay change live in persistent
 * entries outside the instance.
 */
export interface GovernanceInstanceState {
    /** Current timelock delay, in seconds. */
    delay: bigint;
    /** Next queue nonce. Is `0` until the first call is queued. */
    nonce: number;
    /** Contract owner. Absent once ownership has been renounced. */
    owner?: string;
}

/**
 * Decode a governance contract-instance value. Throws unless `Delay` is set.
 * It is a constructor invariant.
 */
export function parseGovernanceInstance(
    instanceVal: xdr.ScVal,
): GovernanceInstanceState {
    const storage = instanceStorage(instanceVal, 'governance');
    const nonce = storage.get('Nonce');
    return {
        delay: BigInt(scValToNative(storage.require('Delay'))),
        nonce: nonce ? Number(scValToNative(nonce)) : 0,
        owner: storage.optionalAddress('Owner'),
    };
}
