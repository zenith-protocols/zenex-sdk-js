import { xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

// =============================================================================
// Oracle contract-instance storage.
//
// Four `DataKey` variants plus `Owner`, all in one ledger entry
// (oracle/src/storage.rs). Reading them as an entry replaces four separate
// `get_verifier` / `trade_staleness` / `close_staleness` /
// `spread_reduction_factor` simulations with a single key.
// =============================================================================

/** The oracle contract's decoded instance storage. */
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

/**
 * Walk an oracle contract-instance value into its decoded state.
 *
 * @throws If the value is not a contract instance, or a required key is absent.
 */
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
