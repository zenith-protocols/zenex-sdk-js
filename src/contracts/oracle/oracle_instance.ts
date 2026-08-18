import { Address, xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceOwner, instanceStorage, requireKey } from '../instance.js';

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
    /** Chainlink Data Streams verifier contract the reports are checked against. */
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
 * @throws If the value is not a contract instance, or a required key
 *   (`Verifier`, `TradeStaleness`, `CloseStaleness`, `SpreadReductionFactor`)
 *   is absent.
 */
export function parseOracleInstance(
    instanceVal: xdr.ScVal,
): OracleInstanceState {
    const storage = instanceStorage(instanceVal, 'oracle');
    return {
        verifier: Address.fromScVal(
            requireKey(storage, 'Verifier', 'oracle'),
        ).toString(),
        tradeStaleness: BigInt(
            scValToNative(requireKey(storage, 'TradeStaleness', 'oracle')),
        ),
        closeStaleness: BigInt(
            scValToNative(requireKey(storage, 'CloseStaleness', 'oracle')),
        ),
        spreadReductionFactor: scValToBigInt(
            requireKey(storage, 'SpreadReductionFactor', 'oracle'),
        ),
        owner: instanceOwner(storage),
    };
}
