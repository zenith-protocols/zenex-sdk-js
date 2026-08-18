import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';
import type { FactoryInitMeta } from './factory_contract.js';

export interface FactoryInstanceState {
    /** The factory's current `FactoryInitMeta`. */
    initMeta: FactoryInitMeta;
    /** Owner allowed to replace `initMeta`. Absent once ownership is renounced. */
    owner?: string;
}

/** Throws unless `InitMeta` is set. It is a constructor invariant. */
export function parseFactoryInstance(
    instanceVal: xdr.ScVal,
): FactoryInstanceState {
    const storage = instanceStorage(instanceVal, 'factory');
    return {
        initMeta: scValToNative(storage.require('InitMeta')) as FactoryInitMeta,
        owner: storage.optionalAddress('Owner'),
    };
}
