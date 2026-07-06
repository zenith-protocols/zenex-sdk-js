import { Address, xdr, scValToBigInt, rpc } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { toFloat } from '../math.js';
import {
    contractInstanceLedgerKey,
    decodeEntryKey,
    tokenBalanceLedgerKey,
} from '../ledger-keys.js';

// Vault state data (ERC-4626 style)
//
// Deposit/redeem locking is no longer tracked on the vault: `lock_time` moved
// to trading `Config.depositLock`/`Config.redeemLock` and per-order unlock
// timestamps live on trading `VaultOrder.unlocksAt` (see trading_types.ts).
// The vault contract itself has no `LockTime` or `LastDepositTime` storage.
export interface VaultStateData {
    /** Underlying asset token address */
    asset: string;
    /** Total shares in circulation */
    totalShares: number;
    /** Total assets in the vault */
    totalAssets: number;
    /** Decimals offset for virtual shares (inflation attack protection) */
    decimalsOffset: number;
}

/**
 * Extract the balance amount from a token balance storage value.
 * Handles both direct i128 values and SEP-41 map format with 'amount' field.
 * @param val - The ScVal from the balance storage entry
 * @returns The balance as bigint
 */
function extractBalanceAmount(val: xdr.ScVal): bigint {
    // Check if it's a map (SEP-41 format: { amount: i128, authorized: bool, clawback: bool })
    if (val.switch() === xdr.ScValType.scvMap()) {
        const map = val.map();
        if (map) {
            for (const entry of map) {
                const key = entry.key();
                // Check for 'amount' key (stored as symbol)
                if (key.switch() === xdr.ScValType.scvSymbol() && key.sym().toString() === 'amount') {
                    return scValToBigInt(entry.val());
                }
            }
        }
        // If no 'amount' key found in map, return 0
        return 0n;
    }

    // Direct i128 value (simpler token implementations)
    return scValToBigInt(val);
}

/**
 * VaultState - Loader class for vault state data
 *
 * ERC-4626 compliant vault state with computed properties for share price calculations.
 * Reads directly from contract instance storage.
 */
export class VaultState implements VaultStateData {
    /** Underlying asset token address */
    asset: string;
    /** Total shares in circulation */
    totalShares: number;
    /** Total assets in the vault */
    totalAssets: number;
    /** Decimals offset for virtual shares (inflation attack protection) */
    decimalsOffset: number;
    /** Network configuration (stored for instance methods) */
    private network: Network;
    /** Vault contract address (stored for instance methods) */
    private contractId: string;

    constructor(data: VaultStateData, network: Network, contractId: string) {
        this.asset = data.asset;
        this.totalShares = data.totalShares;
        this.totalAssets = data.totalAssets;
        this.decimalsOffset = data.decimalsOffset;
        this.network = network;
        this.contractId = contractId;
    }

    /**
     * Load vault state from the blockchain by reading instance storage
     * @param network - The Stellar network to connect to
     * @param contractId - The vault contract address
     * @returns A new VaultState instance with current data
     */
    public static async load(
        network: Network,
        contractId: string
    ): Promise<VaultState> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        // Read the vault's instance storage
        const instanceKey = contractInstanceLedgerKey(contractId);
        const instanceResponse = await stellarRpc.getLedgerEntries(instanceKey);

        if (instanceResponse.entries.length === 0) {
            throw new Error('Vault contract not found');
        }

        const contractData = instanceResponse.entries[0].val.contractData();
        const contractInstance = contractData.val().instance();
        const storage = contractInstance.storage();
        if (!storage) {
            throw new Error('Vault instance storage is empty');
        }

        // Parse instance storage
        let asset: string | undefined;
        let totalShares: bigint = 0n;
        let decimalsOffset: number = 0;

        storage.forEach((storageEntry) => {
            const entryKey = decodeEntryKey(storageEntry.key());

            switch (entryKey) {
                case 'AssetAddress':
                    asset = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'TotalSupply':
                    totalShares = scValToBigInt(storageEntry.val());
                    break;

                case 'VirtualDecimalsOffset':
                    decimalsOffset = Number(scValToBigInt(storageEntry.val()));
                    break;
            }
        });


        if (!asset) {
            throw new Error('Vault asset address not found in instance storage');
        }

        // Read the vault's token balance from the underlying token contract
        // This is how total_assets() is calculated in the vault contract
        const balanceKey = tokenBalanceLedgerKey(asset, contractId);
        let totalAssets: bigint = 0n;

        try {
            const balanceResponse = await stellarRpc.getLedgerEntries(balanceKey);
            if (balanceResponse.entries.length > 0) {
                const val = balanceResponse.entries[0].val.contractData().val();
                totalAssets = extractBalanceAmount(val);
            }
        } catch {
            // Balance entry doesn't exist, vault has 0 assets
        }

        // Shares have extra precision: 7 (asset decimals) + decimalsOffset
        // Assets are always descaled by 7 (standard Stellar token decimals)
        const shareDecimals = 7 + decimalsOffset;

        return new VaultState(
            {
                asset,
                totalShares: toFloat(totalShares, shareDecimals),
                totalAssets: toFloat(totalAssets, 7),
                decimalsOffset,
            },
            network,
            contractId
        );
    }

    // === Computed Properties ===

    /**
     * Calculate the current share price (assets per share)
     * This returns the simple ratio for display purposes.
     * The contract's preview functions handle virtual offset internally.
     * @returns Share price as a number
     */
    sharePrice(): number {
        if (this.totalShares === 0) return 1;
        return this.totalAssets / this.totalShares;
    }

    /**
     * Convert asset amount to shares (simple ratio for estimates)
     * For accurate values, use the contract's preview_deposit simulation
     * @param assets - Amount of assets
     * @returns Equivalent shares
     */
    assetsToShares(assets: number): number {
        if (this.totalAssets === 0) return assets;
        return (assets * this.totalShares) / this.totalAssets;
    }

    /**
     * Convert shares to asset amount (simple ratio for estimates)
     * For accurate values, use the contract's preview_redeem simulation
     * @param shares - Amount of shares
     * @returns Equivalent assets
     */
    sharesToAssets(shares: number): number {
        if (this.totalShares === 0) return shares;
        return (shares * this.totalAssets) / this.totalShares;
    }
}
