import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { instanceOwner, instanceStorage, requireKey } from '../instance.js';

// =============================================================================
// Governance contract-instance storage.
//
// `Delay` and `Nonce` (governance/src/storage.rs) plus `Owner`. The queued
// calls themselves are TEMPORARY entries under `GovKey::Queued(nonce)`, one per
// nonce, so they are read separately — this is the timelock's standing config.
// =============================================================================

/** The governance contract's decoded instance storage. */
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
        delay: BigInt(scValToNative(requireKey(storage, 'Delay', 'governance'))),
        // `next_nonce` reads with `unwrap_or(0)`, so an absent key is 0.
        nonce: nonce ? Number(scValToNative(nonce)) : 0,
        owner: instanceOwner(storage),
    };
}
