import { Address, xdr } from '@stellar/stellar-sdk';
import { persistentLedgerKey, temporaryLedgerKey } from '../keys.js';

// =============================================================================
// Trading contract `DataKey` mirror
//
// `DataKey` carries data on several variants (Position, VaultOrder, etc.), so
// soroban-sdk encodes every variant - including the zero-field ones - as a Vec
// whose first element is the variant's Symbol, followed by any fields. This
// module builds those keys for direct ledger reads, without going through a
// contract call/simulation.
// =============================================================================

function toAddressScVal(address: string | Address): xdr.ScVal {
    return (typeof address === 'string' ? Address.fromString(address) : address).toScVal();
}

// --- persistent, shared tier ---

/** `DataKey::MarketData` -> MarketData: hot per-market state, singleton, own entry (persistent, shared tier). */
export function tradingMarketDataLedgerKey(contractId: string): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('MarketData')]);
}

// --- temporary tier ---

/**
 * `DataKey::PriceCache` -> PriceData: newest verified price the market has
 * consumed (monotonic on publish_time). Temporary durability with the
 * network-minimum TTL (16 ledgers), re-extended on every write; lazy, lapses
 * harmlessly, so an absent entry just means no recent consumption.
 */
export function tradingPriceCacheLedgerKey(contractId: string): xdr.LedgerKey {
    return temporaryLedgerKey(contractId, [xdr.ScVal.scvSymbol('PriceCache')]);
}

// --- persistent, user tier ---

/** `DataKey::Position(user, is_long)` -> Position: netted position, hedge mode (persistent user tier). */
export function tradingPositionLedgerKey(
    contractId: string,
    user: string | Address,
    isLong: boolean
): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [
        xdr.ScVal.scvSymbol('Position'),
        toAddressScVal(user),
        xdr.ScVal.scvBool(isLong),
    ]);
}

/** `DataKey::VaultOrder(user, id)` -> VaultOrder: pending vault deposit or redemption (persistent user tier). */
export function tradingVaultOrderLedgerKey(
    contractId: string,
    user: string | Address,
    id: number
): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [
        xdr.ScVal.scvSymbol('VaultOrder'),
        toAddressScVal(user),
        xdr.ScVal.scvU32(id),
    ]);
}

/** `DataKey::OrderCounter(user)` -> u32: next id for trade and vault orders, allocated from 1 (persistent user tier). */
export function tradingOrderCounterLedgerKey(contractId: string, user: string | Address): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('OrderCounter'), toAddressScVal(user)]);
}

/** `DataKey::ClaimableFunding(user)` -> i128: funding owed to the user, in token-dec (persistent user tier). */
export function tradingClaimableFundingLedgerKey(contractId: string, user: string | Address): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('ClaimableFunding'), toAddressScVal(user)]);
}

/** `DataKey::Order(user, id)` -> Order: pending keeper order (persistent user tier, 100/120-day TTL). */
export function tradingOrderLedgerKey(contractId: string, user: string | Address, id: number): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [
        xdr.ScVal.scvSymbol('Order'),
        toAddressScVal(user),
        xdr.ScVal.scvU32(id),
    ]);
}
