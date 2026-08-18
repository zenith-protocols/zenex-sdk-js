import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';

// =============================================================================
// Strategy-vault instance-storage walker for `getLedgerEntries` reads.
//
// The vault's instance storage carries the OZ stellar-tokens keys
// (`Meta`, `TotalSupply`, `AssetAddress`, `VirtualDecimalsOffset`) plus the
// vault's own `StrategyStorageKey::Strategy`.
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
    const storage = instanceStorage(instanceVal, 'vault');
    // Asset first: it is the most informative thing to be missing, so it should
    // be the failure a malformed instance reports.
    const asset = storage.address('AssetAddress');
    const totalSupply = storage.get('TotalSupply');
    const offset = storage.get('VirtualDecimalsOffset');
    const shareDecimals = extractMetaDecimals(storage.require('Meta'));
    if (shareDecimals === undefined) {
        throw new Error('vault instance Meta is missing decimals');
    }
    const decimalsOffset = offset ? Number(scValToBigInt(offset)) : 0;

    return {
        asset,
        totalSharesAtomic: totalSupply ? scValToBigInt(totalSupply) : 0n,
        decimalsOffset,
        shareDecimals,
        // The constructor sets the share token's metadata decimals to
        // asset.decimals() + decimals_offset, so the asset decimals derive
        // from the same instance read.
        assetDecimals: shareDecimals - decimalsOffset,
        strategy: storage.optionalAddress('Strategy'),
    };
}
