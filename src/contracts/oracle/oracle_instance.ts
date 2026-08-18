import { xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

export interface OracleInstanceState {
    /** Chainlink Data Streams verifier contract whose DON signatures gate every report. */
    verifier: string;
    /** Max report age for order fills, in seconds (3..=15); also the forward-skew allowance applied to close-staleness verifications. */
    tradeStaleness: bigint;
    /** Max report age for gap-closing calls (liquidation/ADL/accrual), in seconds (tradeStaleness..=120); past side only, forward allowance stays at tradeStaleness. */
    closeStaleness: bigint;
    /** Bid/ask narrowing toward the mid, SCALAR_18-scaled fraction in [0, SCALAR_18]; 0 = off, SCALAR_18 = collapse to mid. */
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
