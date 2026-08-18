import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

export interface GovernanceInstanceState {
    /** Current timelock delay, in seconds. */
    delay: bigint;
    /** Next queue nonce; `0` until the first call is queued. */
    nonce: number;
    /** Proposer/admin; absent once ownership has been renounced. */
    owner?: string;
}

/** Throws when `Delay` is absent — the constructor always sets it. */
export function parseGovernanceInstance(
    instanceVal: xdr.ScVal,
): GovernanceInstanceState {
    const storage = instanceStorage(instanceVal, 'governance');
    const nonce = storage.get('Nonce');
    return {
        delay: BigInt(scValToNative(storage.require('Delay'))),
        // `next_nonce` reads with `unwrap_or(0)`, so an absent key is 0.
        nonce: nonce ? Number(scValToNative(nonce)) : 0,
        owner: storage.optionalAddress('Owner'),
    };
}
