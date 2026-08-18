import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';
import type { FactoryInitMeta } from './factory_contract.js';

export interface FactoryInstanceState {
    /** WASM hashes and wiring every market this factory deploys is given. */
    initMeta: FactoryInitMeta;
    /** Owner allowed to replace `initMeta`; absent once renounced. */
    owner?: string;
}

/** Throws when `InitMeta` is absent — the constructor always sets it. */
export function parseFactoryInstance(
    instanceVal: xdr.ScVal,
): FactoryInstanceState {
    const storage = instanceStorage(instanceVal, 'factory');
    return {
        initMeta: scValToNative(storage.require('InitMeta')) as FactoryInitMeta,
        owner: storage.optionalAddress('Owner'),
    };
}
