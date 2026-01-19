import { Address, xdr, scValToBigInt, rpc } from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';
import { VaultStateData } from '../types/vault.js';
import { descale } from '../internal/scaling.js';
import {
    contractInstanceLedgerKey,
    decodeEntryKey,
    tokenBalanceLedgerKey,
    persistentLedgerKey,
} from '../internal/ledger-keys.js';

/**
 * VaultState - Loader class for vault state data
 *
 * ERC-4626 compliant vault state with computed properties for share price calculations.
 * Reads directly from contract instance storage.
 */
export class VaultState implements VaultStateData {
    /** Underlying asset token address */
    asset: string;
    /** Lock time in seconds for withdrawals */
    lockTime: number;
    /** Total shares in circulation */
    totalShares: number;
    /** Total assets in the vault */
    totalAssets: number;
    /** Network configuration (stored for instance methods) */
    private network: Network;
    /** Vault contract address (stored for instance methods) */
    private contractId: string;

    constructor(data: VaultStateData, network: Network, contractId: string) {
        this.asset = data.asset;
        this.lockTime = data.lockTime;
        this.totalShares = data.totalShares;
        this.totalAssets = data.totalAssets;
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
        let lockTime: number = 0;
        let totalShares: bigint = 0n;

        storage.forEach((storageEntry) => {
            const entryKey = decodeEntryKey(storageEntry.key());

            switch (entryKey) {
                case 'AssetAddress':
                    asset = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'LockTime':
                    lockTime = Number(scValToBigInt(storageEntry.val()));
                    break;

                case 'TotalSupply':
                    totalShares = scValToBigInt(storageEntry.val());
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
                totalAssets = scValToBigInt(balanceResponse.entries[0].val.contractData().val());
            }
        } catch {
            // Balance entry doesn't exist, vault has 0 assets
        }

        return new VaultState(
            {
                asset,
                lockTime,
                totalShares: descale(totalShares, 7),
                totalAssets: descale(totalAssets, 7),
            },
            network,
            contractId
        );
    }

    /**
     * Check if a user's shares are locked
     * @param userId - The user address to check
     * @returns True if the user's shares are still locked
     */
    public async isLocked(userId: string): Promise<boolean> {
        const stellarRpc = new rpc.Server(this.network.rpc, this.network.opts);

        // Read both the vault instance (for LockTime) and user's LastDepositTime
        const instanceKey = contractInstanceLedgerKey(this.contractId);
        const lastDepositKey = persistentLedgerKey(this.contractId, [
            xdr.ScVal.scvSymbol('LastDepositTime'),
            Address.fromString(userId).toScVal(),
        ]);

        const response = await stellarRpc.getLedgerEntries(instanceKey, lastDepositKey);

        // Parse lock time from instance storage
        let lockTime: bigint = 0n;
        if (response.entries.length > 0) {
            const contractData = response.entries[0].val.contractData();
            const contractInstance = contractData.val().instance();
            const storage = contractInstance.storage();
            if (storage) {
                storage.forEach((storageEntry) => {
                    const entryKey = decodeEntryKey(storageEntry.key());
                    if (entryKey === 'LockTime') {
                        lockTime = scValToBigInt(storageEntry.val());
                    }
                });
            }
        }

        // If no lock time set, user is not locked
        if (lockTime === 0n) return false;

        // Check if user has a last deposit time
        let lastDepositTime: bigint = 0n;
        for (const entry of response.entries) {
            try {
                const val = entry.val.contractData().val();
                // Skip instance entries
                if (entry.val.contractData().key().switch() === xdr.ScValType.scvLedgerKeyContractInstance()) {
                    continue;
                }
                lastDepositTime = scValToBigInt(val);
            } catch {
                continue;
            }
        }

        // If no deposit time, user has no shares so not locked
        if (lastDepositTime === 0n) return false;

        // Get current ledger timestamp
        const latestLedger = await stellarRpc.getLatestLedger();
        const currentTime = BigInt(latestLedger.sequence) * 5n; // Approximate: 5 seconds per ledger

        // User is locked if current time < lastDepositTime + lockTime
        return currentTime < (lastDepositTime + lockTime);
    }

    /**
     * Get the net impact (cumulative P&L) for a strategy
     * @param strategyId - The strategy address
     * @returns Net impact value
     */
    public async getNetImpact(strategyId: string): Promise<number> {
        const stellarRpc = new rpc.Server(this.network.rpc, this.network.opts);

        // Strategy net impact is stored in persistent storage: Strategy(address)
        const key = persistentLedgerKey(this.contractId, [
            xdr.ScVal.scvSymbol('Strategy'),
            Address.fromString(strategyId).toScVal(),
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length > 0) {
                const value = scValToBigInt(response.entries[0].val.contractData().val());
                return descale(value, 7);
            }
        } catch {
            // Entry doesn't exist
        }

        return 0;
    }

    // === Computed Properties ===

    /**
     * Calculate the current share price (assets per share)
     * @returns Share price as a number
     */
    sharePrice(): number {
        if (this.totalShares === 0) return 1;
        return this.totalAssets / this.totalShares;
    }

    /**
     * Convert asset amount to shares
     * @param assets - Amount of assets
     * @returns Equivalent shares
     */
    assetsToShares(assets: number): number {
        if (this.totalAssets === 0) return assets;
        return (assets * this.totalShares) / this.totalAssets;
    }

    /**
     * Convert shares to asset amount
     * @param shares - Amount of shares
     * @returns Equivalent assets
     */
    sharesToAssets(shares: number): number {
        if (this.totalShares === 0) return shares;
        return (shares * this.totalAssets) / this.totalShares;
    }
}
