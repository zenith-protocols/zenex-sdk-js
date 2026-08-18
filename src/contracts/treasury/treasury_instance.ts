import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

// =============================================================================
// Treasury contract-instance storage.
//
// Two slots with different key shapes: the fee rate under a BARE
// `Symbol("Rate")` (treasury/src/storage.rs: `set::<Symbol, i128>`), not a
// `#[contracttype]` enum variant, and `Owner` from `stellar_access::ownable`.
// The contract reads the rate with `.unwrap_or(0)`, so an absent key is the
// SCALAR_18 rate `0`.
// =============================================================================

/** The treasury contract's decoded instance storage. */
export interface TreasuryInstanceState {
    /** Protocol fee rate (SCALAR_18 fraction); `0n` when unset. */
    rate: bigint;
    /** Rate/withdrawal admin; absent once ownership has been renounced. */
    owner?: string;
}

/**
 * Walk a treasury contract-instance value into its decoded state.
 *
 * @throws If the value is not a contract instance.
 */
export function parseTreasuryInstance(
    instanceVal: xdr.ScVal,
): TreasuryInstanceState {
    const storage = instanceStorage(instanceVal, 'treasury');
    const rate = storage.get('Rate');
    return {
        rate: rate ? scValToBigInt(rate) : 0n,
        owner: storage.optionalAddress('Owner'),
    };
}

/**
 * The protocol fee rate alone — the only field the quote math needs, and what
 * `loadTreasuryRate` returns.
 */
export function parseTreasuryRate(instanceVal: xdr.ScVal): bigint {
    return parseTreasuryInstance(instanceVal).rate;
}
