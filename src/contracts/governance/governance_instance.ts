import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

/**
 * The governance contract's decoded instance storage — the timelock's standing
 * config. Queued calls are TEMPORARY entries under `GovKey::Queued(nonce)`, one
 * per nonce, and are not part of this read.
 */
export interface GovernanceInstanceState {
    /** Current timelock delay, in seconds. */
    delay: bigint;
    /** Next queue nonce; `0` until the first call is queued. */
    nonce: number;
    /** Proposer/admin; absent once ownership has been renounced. */
    owner?: string;
}

/**
 * Walk a governance contract-instance value into its decoded state.
 *
 * @throws If the value is not a contract instance, or `Delay` is absent.
 */
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
