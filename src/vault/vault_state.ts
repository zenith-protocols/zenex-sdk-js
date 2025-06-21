import { Address, xdr, scValToBigInt, rpc } from '@stellar/stellar-sdk';
import { getTokenBalance, i128, Network } from '../index.js';
import { contractInstanceLedgerKey } from '../ledger_entry_helper.js';
import { decodeEntryKey } from '../ledger_entry_helper.js';
import { descale } from '../utils/scaling.js';

/**
 * VaultState contains all vault configuration and state data
 * All monetary values are automatically descaled to JavaScript numbers
 */
export class VaultState {
    constructor(
        /** Underlying token address */
        public token: string,
        /** Share token address */
        public shareToken: string,
        /** Strategy contract addresses */
        public strategies: string[],
        /** Lock time in seconds for withdrawals */
        public lockTime: number,
        /** Penalty rate for early withdrawals (0-1, e.g., 0.1 = 10%) */
        public penaltyRate: number,
        /** Total shares issued by the vault */
        public totalShares: number,
        /** Vault's token balance */
        public balance: number
    ) { }

    /**
     * Load vault state including configuration and current balance
     * @param network - The Stellar network to connect to
     * @param vaultId - The vault contract address
     * @param tokenId - The token contract address
     * @returns A new VaultState instance with current data
     */
    public static async load(
        network: Network,
        vaultId: string,
        tokenId: string
    ): Promise<VaultState> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        // Load vault instance storage
        const instanceKey = contractInstanceLedgerKey(vaultId);
        const response = await stellarRpc.getLedgerEntries(instanceKey);

        if (response.entries.length === 0) {
            throw new Error('Vault not found');
        }

        const contractData = response.entries[0].val.contractData();
        const contractInstance = contractData.val().instance();
        const storage = contractInstance.storage();
        if (!storage) {
            throw new Error('Vault instance storage is empty');
        }

        // Get token balance using simulation
        const balance = await getTokenBalance(network, tokenId, vaultId);

        return VaultState.fromInstanceStorageAndBalance(storage, balance || 0);
    }

    /**
     * Create a VaultState from raw storage entries and balance
     * @internal
     */
    static fromInstanceStorageAndBalance(storage: xdr.ScMapEntry[], balance: number): VaultState {
        let token: string | undefined;
        let shareToken: string | undefined;
        let strategies: string[] = [];
        let lockTime: bigint | undefined;
        let penaltyRate: bigint | undefined;
        let totalShares: bigint | undefined;

        storage.map((storageEntry) => {
            const instanceKey = decodeEntryKey(storageEntry.key());
            switch (instanceKey) {
                case 'Token':
                    token = Address.fromScVal(storageEntry.val()).toString();
                    break;
                case 'ShareToken':
                    shareToken = Address.fromScVal(storageEntry.val()).toString();
                    break;
                case 'LockTime':
                    lockTime = scValToBigInt(storageEntry.val());
                    break;
                case 'PenaltyRate':
                    penaltyRate = scValToBigInt(storageEntry.val());
                    break;
                case 'Strategies':
                    const vec = storageEntry.val().vec();
                    if (vec) {
                        strategies = vec.map(v => Address.fromScVal(v).toString());
                    }
                    break;
                case 'TotalShares':
                    totalShares = scValToBigInt(storageEntry.val());
                    break;
            }
        });

        if (!token || !shareToken || lockTime === undefined || penaltyRate === undefined || totalShares === undefined) {
            throw new Error('Missing required vault fields');
        }

        return new VaultState(
            token,
            shareToken,
            strategies,
            Number(lockTime), // Already in seconds
            descale(penaltyRate, 7),
            descale(totalShares, 7),
            balance
        );
    }
}