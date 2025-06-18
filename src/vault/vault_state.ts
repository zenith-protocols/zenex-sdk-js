import { Address, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { decodeEntryKey } from '../ledger_entry_helper.js';
import { descale } from '../utils/scaling.js';
import { i128 } from '../index.js';

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

    static fromInstanceStorageAndBalance(storage: xdr.ScMapEntry[], balance: i128): VaultState {
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
            descale(balance, 7)
        );
    }
}