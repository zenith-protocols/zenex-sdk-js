import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Create a storage key for an enum variant with an Address.
 * E.g., StorageKey::Balance(Address) or DataKey::ClaimableFunding(Address)
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
 * Decode a ledger entry key ScVal into its `DataKey` variant name, or
 * `'ContractInstance'` for the contract-instance key. Throws if `entryKey` is
 * not a symbol, a vec led by a symbol, or the contract-instance key.
 * @param entryKey - The `key` ScVal from a `LedgerKeyContractData`.
 * @returns The variant name.
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
 * Build the ledger key for a contract's instance storage: its shared config
 * and small singleton state. Instance entries use persistent durability, so
 * they can be archived past their TTL. Restore the entry before you read it
 * again.
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
 * Build the ledger key for an entry in a contract's persistent storage: data
 * that outlives the contract instance, keyed by `keyVec`. A persistent entry
 * can be archived once its TTL lapses. Restore it before you read it again.
 * @param contractId - The contract address.
 * @param keyVec - The ScVal items that make up the storage key.
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
 * Build the ledger key for an entry in a contract's temporary storage, keyed
 * by `keyVec`. A temporary entry is deleted once its TTL lapses and cannot be
 * restored. The contract must write it again.
 * @param contractId - The contract address.
 * @param keyVec - The ScVal items that make up the storage key.
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
// Trading contract `DataKey` mirror
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

/** `DataKey::Config` -> Config: global trading parameters, mutable singleton (instance tier). */
export function tradingConfigKey(): xdr.ScVal {
    return tradingUnitDataKey('Config');
}

/** `DataKey::FeedId` -> BytesN<32>: price stream id, immutable, constructor-set (instance tier). */
export function tradingFeedIdKey(): xdr.ScVal {
    return tradingUnitDataKey('FeedId');
}

/** `DataKey::Status` -> u32: operational status, the Status discriminant (instance tier). */
export function tradingStatusKey(): xdr.ScVal {
    return tradingUnitDataKey('Status');
}

/** `DataKey::Vault` -> Address: strategy-vault contract (instance tier). */
export function tradingVaultKey(): xdr.ScVal {
    return tradingUnitDataKey('Vault');
}

/** `DataKey::Token` -> Address: settlement token, the collateral asset (instance tier). */
export function tradingTokenKey(): xdr.ScVal {
    return tradingUnitDataKey('Token');
}

/** `DataKey::Oracle` -> Address: oracle contract (instance tier). */
export function tradingOracleKey(): xdr.ScVal {
    return tradingUnitDataKey('Oracle');
}

/** `DataKey::Treasury` -> Address: treasury contract, the protocol fee sink (instance tier). */
export function tradingTreasuryKey(): xdr.ScVal {
    return tradingUnitDataKey('Treasury');
}

/** `DataKey::DelistedAt` -> u64: first-delist timestamp, lazy, absent unless delisted (instance tier). */
export function tradingDelistedAtKey(): xdr.ScVal {
    return tradingUnitDataKey('DelistedAt');
}

/** `DataKey::TerminalPrice` -> i128: flat settlement price, lazy, absent until set (instance tier). */
export function tradingTerminalPriceKey(): xdr.ScVal {
    return tradingUnitDataKey('TerminalPrice');
}

/** `DataKey::Adl` -> AdlState: ADL flags and freshness anchor, zeroed default until first written (instance tier). */
export function tradingAdlKey(): xdr.ScVal {
    return tradingUnitDataKey('Adl');
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

