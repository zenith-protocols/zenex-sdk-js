import { xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

export interface OracleInstanceState {
    /** Chainlink Data Streams verifier the reports are checked against. */
    verifier: string;
    /** Strict staleness window for fills, in seconds (3..=15). */
    tradeStaleness: bigint;
    /** Wider staleness window for gap-closing calls, in seconds (..=120). */
    closeStaleness: bigint;
    /** Bid/ask spread reduction factor (SCALAR_18). */
    spreadReductionFactor: bigint;
    /** Config admin; absent once ownership has been renounced. */
    owner?: string;
}

/** Throws unless `Verifier`, both staleness windows and the spread factor are set. */
export function parseOracleInstance(
    instanceVal: xdr.ScVal,
): OracleInstanceState {
    const storage = instanceStorage(instanceVal, 'oracle');
    return {
        verifier: storage.address('Verifier'),
        tradeStaleness: BigInt(scValToNative(storage.require('TradeStaleness'))),
        closeStaleness: BigInt(scValToNative(storage.require('CloseStaleness'))),
        spreadReductionFactor: scValToBigInt(
            storage.require('SpreadReductionFactor'),
        ),
        owner: storage.optionalAddress('Owner'),
    };
}
