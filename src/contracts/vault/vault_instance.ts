import { Address, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { decodeEntryKey } from '../../ledger-keys.js';

// =============================================================================
// Strategy-vault instance-storage walker for `getLedgerEntries` reads.
//
// The vault's instance storage carries the OZ stellar-tokens keys
// (`Meta`, `TotalSupply`, `AssetAddress`, `VirtualDecimalsOffset`) plus the
// vault's own `StrategyStorageKey::Strategy` (strategy-vault/src/storage.rs).
// Every key is matched by variant name against the entry map, mirroring the
// contract's own `#[contracttype]` encodings; unknown keys are skipped.
// =============================================================================

/** Decoded strategy-vault instance storage. */
export interface VaultInstanceState {
    /** Underlying asset token contract (`AssetAddress`). */
    asset: string;
    /** Total shares in circulation, share-dec atomic (`TotalSupply`). */
    totalSharesAtomic: bigint;
    /** Virtual-share decimals offset (inflation-attack protection). */
    decimalsOffset: number;
    /** Share-token decimals (asset decimals + offset), from `Meta`. */
    shareDecimals: number;
    /** Underlying asset decimals, derived as `shareDecimals - decimalsOffset`. */
    assetDecimals: number;
    /** Strategy (market) bound to this vault (`Strategy`), absent until set. */
    strategy?: string;
}

/**
 * Extract the `decimals` field from the OZ `Meta` (`Metadata { decimals, name,
 * symbol }`) instance-storage map value.
 */
function extractMetaDecimals(val: xdr.ScVal): number | undefined {
    if (val.switch() !== xdr.ScValType.scvMap()) return undefined;
    const map = val.map();
    if (!map) return undefined;
    for (const item of map) {
        const key = item.key();
        if (
            key.switch() === xdr.ScValType.scvSymbol() &&
            key.sym().toString() === 'decimals'
        ) {
            return Number(scValToBigInt(item.val()));
        }
    }
    return undefined;
}

/** Safely decode a storage entry key to its variant name, `undefined` if not a key shape. */
function entryKeyName(key: xdr.ScVal): string | undefined {
    try {
        return decodeEntryKey(key);
    } catch {
        return undefined;
    }
}

/**
 * Walk a vault contract-instance value (`ScVal::ContractInstance`) into its
 * decoded [`VaultInstanceState`].
 *
 * @param instanceVal - The `.val()` of the vault instance `ContractDataEntry`
 *   (an `scvContractInstance`).
 * @throws If the value is not a contract instance, or the asset address or
 *   share metadata is missing (both are constructor-set invariants).
 */
export function parseVaultInstance(instanceVal: xdr.ScVal): VaultInstanceState {
    if (instanceVal.switch() !== xdr.ScValType.scvContractInstance()) {
        throw new Error('expected a vault contract-instance value');
    }
    const storage = instanceVal.instance().storage();
    if (!storage) {
        throw new Error('Vault instance storage is empty');
    }

    let asset: string | undefined;
    let totalSharesAtomic = 0n;
    let decimalsOffset = 0;
    let shareDecimals: number | undefined;
    let strategy: string | undefined;

    storage.forEach((item) => {
        switch (entryKeyName(item.key())) {
            case 'AssetAddress':
                asset = Address.fromScVal(item.val()).toString();
                break;
            case 'TotalSupply':
                totalSharesAtomic = scValToBigInt(item.val());
                break;
            case 'VirtualDecimalsOffset':
                decimalsOffset = Number(scValToBigInt(item.val()));
                break;
            case 'Meta':
                shareDecimals = extractMetaDecimals(item.val());
                break;
            case 'Strategy':
                strategy = Address.fromScVal(item.val()).toString();
                break;
        }
    });

    if (!asset) {
        throw new Error('Vault asset address not found in instance storage');
    }
    if (shareDecimals === undefined) {
        throw new Error('Vault share metadata not found in instance storage');
    }

    return {
        asset,
        totalSharesAtomic,
        decimalsOffset,
        shareDecimals,
        // The constructor sets the share token's metadata decimals to
        // asset.decimals() + decimals_offset, so the asset decimals derive
        // from the same instance read.
        assetDecimals: shareDecimals - decimalsOffset,
        strategy,
    };
}
