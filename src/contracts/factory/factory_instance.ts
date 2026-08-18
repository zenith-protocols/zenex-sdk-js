import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';
import type { FactoryInitMeta } from './factory_contract.js';

// =============================================================================
// Factory contract-instance storage.
//
// `InitMeta` under a bare `Symbol` plus `Owner`. The
// deployed markets live in PERSISTENT storage under
// `FactoryDataKey::Pools(address)`, one entry each, so they are not part of
// this read.
// =============================================================================

/** The factory contract's decoded instance storage. */
export interface FactoryInstanceState {
    /** WASM hashes and wiring every market this factory deploys is given. */
    initMeta: FactoryInitMeta;
    /** Owner allowed to replace `initMeta`; absent once renounced. */
    owner?: string;
}

/**
 * Walk a factory contract-instance value into its decoded state.
 *
 * @throws If the value is not a contract instance, or `InitMeta` is absent.
 */
export function parseFactoryInstance(
    instanceVal: xdr.ScVal,
): FactoryInstanceState {
    const storage = instanceStorage(instanceVal, 'factory');
    return {
        initMeta: scValToNative(storage.require('InitMeta')) as FactoryInitMeta,
        owner: storage.optionalAddress('Owner'),
    };
}
