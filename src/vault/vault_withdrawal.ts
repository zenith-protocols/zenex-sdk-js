import { Address, xdr, scValToBigInt, rpc } from '@stellar/stellar-sdk';
import { Network } from '../index.ts';
import { persistentLedgerKey } from '../ledger_entry_helper.js';
import { descale } from '../utils/scaling.js';

export class VaultWithdrawal {
    constructor(
        /** Number of shares to be withdrawn */
        public shares: number,
        /** Timestamp when the withdrawal can be executed (seconds) */
        public unlockTime: number
    ) { }

    /**
     * Load vault withdrawal request for a user
     * @param network - The Stellar network to connect to
     * @param vaultId - The vault contract address
     * @param userId - The user's address
     * @returns A new VaultWithdrawal instance, or null if no withdrawal found
     */
    public static async load(
        network: Network,
        vaultId: string,
        userId: string
    ): Promise<VaultWithdrawal | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const key = persistentLedgerKey(vaultId, [
            xdr.ScVal.scvSymbol('WithdrawalRequest'),
            Address.fromString(userId).toScVal()
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return null;

            return VaultWithdrawal.fromScVal(response.entries[0].val.contractData().val());
        } catch {
            return null;
        }
    }

    /**
     * Load withdrawal requests for multiple users in a single RPC call
     * @param network - The Stellar network to connect to
     * @param vaultId - The vault contract address
     * @param userIds - Array of user addresses
     * @returns Array of objects with userId and withdrawal (if found)
     */
    public static async loadMultiple(
        network: Network,
        vaultId: string,
        userIds: string[]
    ): Promise<Array<{ userId: string; withdrawal: VaultWithdrawal | null }>> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const results: Array<{ userId: string; withdrawal: VaultWithdrawal | null }> = [];

        // Build keys for all users
        const keys = userIds.map(userId =>
            persistentLedgerKey(vaultId, [
                xdr.ScVal.scvSymbol('WithdrawalRequest'),
                Address.fromString(userId).toScVal()
            ])
        );

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            userIds.forEach((userId, index) => {
                try {
                    if (index < response.entries.length) {
                        const withdrawal = VaultWithdrawal.fromScVal(
                            response.entries[index].val.contractData().val()
                        );
                        results.push({ userId, withdrawal });
                    } else {
                        results.push({ userId, withdrawal: null });
                    }
                } catch {
                    results.push({ userId, withdrawal: null });
                }
            });
        } catch (error) {
            console.error('Failed to load withdrawals:', error);
            // Return all nulls on complete failure
            userIds.forEach(userId => {
                results.push({ userId, withdrawal: null });
            });
        }

        return results;
    }

    /**
     * Parse VaultWithdrawal from ScVal
     * @internal
     * @param val - The ScVal containing withdrawal data
     * @returns Parsed VaultWithdrawal
     */
    static fromScVal(val: xdr.ScVal): VaultWithdrawal {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid withdrawal structure: expected map');
        }

        let shares: bigint | undefined;
        let unlockTime: bigint | undefined;

        map.forEach((entry) => {
            const key = entry.key().sym().toString();
            switch (key) {
                case 'shares':
                    shares = scValToBigInt(entry.val());
                    break;
                case 'unlock_time':
                    unlockTime = scValToBigInt(entry.val());
                    break;
            }
        });

        if (shares === undefined || unlockTime === undefined) {
            throw new Error('Missing required withdrawal fields');
        }

        return new VaultWithdrawal(
            descale(shares, 7),
            Number(unlockTime) // Already in seconds
        );
    }

    /**
     * Check if the withdrawal can be executed now
     * @returns true if the unlock time has passed
     */
    canExecute(): boolean {
        const now = Math.floor(Date.now() / 1000);
        return now >= this.unlockTime;
    }

    /**
     * Get the remaining time until the withdrawal can be executed
     * @returns Remaining seconds, or 0 if can execute now
     */
    getRemainingLockTime(): number {
        const now = Math.floor(Date.now() / 1000);
        return Math.max(0, this.unlockTime - now);
    }

    /**
     * Get a human-readable string for the remaining lock time
     * @returns Formatted string like "2h 30m" or "Ready"
     */
    getRemainingTimeString(): string {
        const remaining = this.getRemainingLockTime();
        if (remaining === 0) return 'Ready';

        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }
}