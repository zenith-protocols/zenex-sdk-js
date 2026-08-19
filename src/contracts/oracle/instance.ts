import { xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

export interface OracleInstanceState {
    /** Chainlink Data Streams verifier contract address. */
    verifier: string;
    /** Max report age for order fills (seconds); in [3, 15]. */
    tradeStaleness: bigint;
    /** Max report age for gap-closing calls (seconds); in [tradeStaleness, 120]. */
    closeStaleness: bigint;
    /** Bid/ask narrowing toward the mid (SCALAR_18-scaled); in [0, SCALAR_18]. 0 = off, SCALAR_18 = collapse to the mid. */
    spreadReductionFactor: bigint;
    /** Config admin address. Absent once ownership is renounced. */
    owner?: string;
}

/** Parse the oracle's on-chain config. Throws if the verifier, either staleness window, or the spread factor is missing. */
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
