import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Create a storage key for an enum variant with an Address.
 * E.g., StorageKey::Balance(Address) or StrategyStorageKey::LastDepositTime(Address)
 * @param variant - The enum variant name
 * @param address - The address value
 * @returns ScVal representing the enum key with address
 */
export function enumStorageKeyWithAddress(variant: string, address: string | Address): xdr.ScVal {
    const addr = typeof address === 'string' ? Address.fromString(address) : address;
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), addr.toScVal()]);
}

/**
 * Create a ledger key for reading a token balance from persistent storage.
 * Uses StorageKey::Balance(Address) format from stellar_tokens.
 * @param tokenContractId - The token contract address
 * @param accountAddress - The account to get balance for
 * @returns Ledger key for the balance entry
 */
export function tokenBalanceLedgerKey(tokenContractId: string, accountAddress: string): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(tokenContractId).toScAddress(),
            key: enumStorageKeyWithAddress('Balance', accountAddress),
            durability: xdr.ContractDataDurability.persistent(),
        })
    );
}

/**
 * Decode entry key from ScVal
 */
export function decodeEntryKey(entryKey: xdr.ScVal): string {
    switch (entryKey.switch()) {
        case xdr.ScValType.scvVec():
            const vec = entryKey.vec();
            if (!vec || !vec.at(0)) {
                throw Error('Invalid ledger entry key: vec or its first element is null or undefined');
            }
            return vec.at(0)!.sym().toString();
        case xdr.ScValType.scvSymbol():
            return entryKey.sym().toString();
        case xdr.ScValType.scvLedgerKeyContractInstance():
            return 'ContractInstance';
        default:
            throw Error(`Invalid ledger entry key type: should not contain type ${entryKey.switch()}`);
    }
}

/**
 * Create a ledger key for a contract instance.
 * This is used to access the contract's instance storage.
 * @param contractId - The contract address.
 * @returns The ledger key for the contract instance.
 */
export function contractInstanceLedgerKey(contractId: string): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent(),
        })
    );
}

/**
 * Create a ledger key for persistent contract storage.
 * This is used for data that persists beyond the contract instance.
 * @param contractId - The contract address.
 * @param keyVec - Array of ScVal items that make up the storage key.
 * @returns The ledger key for the persistent storage entry.
 */
export function persistentLedgerKey(contractId: string, keyVec: xdr.ScVal[]): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: xdr.ScVal.scvVec(keyVec),
            durability: xdr.ContractDataDurability.persistent(),
        })
    );
}

/**
 * Create a ledger key for temporary contract storage.
 * Used for data with a fixed TTL that auto-expires (e.g. the trading
 * contract's keeper `Order` entries, sized to their `expiration` ledger).
 * @param contractId - The contract address.
 * @param keyVec - Array of ScVal items that make up the storage key.
 * @returns The ledger key for the temporary storage entry.
 */
export function temporaryLedgerKey(contractId: string, keyVec: xdr.ScVal[]): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: xdr.ScVal.scvVec(keyVec),
            durability: xdr.ContractDataDurability.temporary(),
        })
    );
}

// =============================================================================
// Trading contract `DataKey` mirror (trading/src/storage.rs)
//
// `DataKey` carries data on several variants (Position, VaultOrder, etc.), so
// soroban-sdk encodes every variant - including the zero-field ones - as a Vec
// whose first element is the variant's Symbol, followed by any fields. This
// section builds those keys for direct ledger reads, without going through a
// contract call/simulation.
// =============================================================================

/** Build the raw `DataKey` ScVal for a zero-field variant, e.g. `Config`. */
function tradingUnitDataKey(variant: string): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
}

function toAddressScVal(address: string | Address): xdr.ScVal {
    return (typeof address === 'string' ? Address.fromString(address) : address).toScVal();
}

// --- instance tier (small read-mostly state, bumped every tx) ---
// These are not separate ledger entries: read the contract instance itself
// (`contractInstanceLedgerKey`) and match this ScVal against its storage map.

/** `DataKey::Config` -> Config: global trading parameters; mutable singleton. */
export function tradingConfigKey(): xdr.ScVal {
    return tradingUnitDataKey('Config');
}

/** `DataKey::FeedId` -> u32: price feed id; immutable, constructor-set. */
export function tradingFeedIdKey(): xdr.ScVal {
    return tradingUnitDataKey('FeedId');
}

/** `DataKey::Exponent` -> i32: oracle exponent; immutable, constructor-set. */
export function tradingExponentKey(): xdr.ScVal {
    return tradingUnitDataKey('Exponent');
}

/** `DataKey::Status` -> u32: operational status (Status discriminant). */
export function tradingStatusKey(): xdr.ScVal {
    return tradingUnitDataKey('Status');
}

/** `DataKey::Vault` -> Address: strategy-vault contract. */
export function tradingVaultKey(): xdr.ScVal {
    return tradingUnitDataKey('Vault');
}

/** `DataKey::Token` -> Address: settlement token (collateral asset). */
export function tradingTokenKey(): xdr.ScVal {
    return tradingUnitDataKey('Token');
}

/** `DataKey::PriceVerifier` -> Address: price-verifier contract. */
export function tradingPriceVerifierKey(): xdr.ScVal {
    return tradingUnitDataKey('PriceVerifier');
}

/** `DataKey::Treasury` -> Address: treasury contract (protocol fee sink). */
export function tradingTreasuryKey(): xdr.ScVal {
    return tradingUnitDataKey('Treasury');
}

/** `DataKey::DelistedAt` -> u64: first-delist timestamp; lazy (absent unless delisted). */
export function tradingDelistedAtKey(): xdr.ScVal {
    return tradingUnitDataKey('DelistedAt');
}

/** `DataKey::TerminalPrice` -> i128: flat settlement price; lazy (absent until set). */
export function tradingTerminalPriceKey(): xdr.ScVal {
    return tradingUnitDataKey('TerminalPrice');
}

/** `DataKey::Adl` -> AdlState: ADL flags + freshness anchor; zeroed default until first written. */
export function tradingAdlKey(): xdr.ScVal {
    return tradingUnitDataKey('Adl');
}

// --- persistent, shared tier ---

/** `DataKey::MarketData` -> MarketData: hot per-market state; singleton, own entry. */
export function tradingMarketDataLedgerKey(contractId: string): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('MarketData')]);
}

// --- persistent, user tier ---

/** `DataKey::Position(user, is_long)` -> Position: netted position (hedge mode). */
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

/** `DataKey::VaultOrder(user, id)` -> VaultOrder: pending vault deposit or redemption. */
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

/** `DataKey::OrderCounter(user)` -> u32: next order id (trade + vault), allocated from 1. */
export function tradingOrderCounterLedgerKey(contractId: string, user: string | Address): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('OrderCounter'), toAddressScVal(user)]);
}

/** `DataKey::ClaimableFunding(user)` -> i128: funding owed to the user (token-dec). */
export function tradingClaimableFundingLedgerKey(contractId: string, user: string | Address): xdr.LedgerKey {
    return persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('ClaimableFunding'), toAddressScVal(user)]);
}

// --- temporary (auto-GC around expiry) ---

/** `DataKey::Order(user, id)` -> Order: keeper order; TTL sized to expiry. */
export function tradingOrderLedgerKey(contractId: string, user: string | Address, id: number): xdr.LedgerKey {
    return temporaryLedgerKey(contractId, [
        xdr.ScVal.scvSymbol('Order'),
        toAddressScVal(user),
        xdr.ScVal.scvU32(id),
    ]);
}

