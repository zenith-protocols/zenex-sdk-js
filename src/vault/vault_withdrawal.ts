import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { descale } from '../utils/scaling.js';

export class VaultWithdrawal {
    constructor(
        /** Number of shares to be withdrawn */
        public shares: number,
        /** Timestamp when the withdrawal was queued (seconds) */
        public queuedAt: number
    ) { }

    static fromScVal(val: xdr.ScVal): VaultWithdrawal {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid withdrawal structure: expected map');
        }

        let shares: bigint | undefined;
        let queuedAt: bigint | undefined;

        map.forEach((entry) => {
            const key = entry.key().sym().toString();
            switch (key) {
                case 'shares':
                    shares = scValToBigInt(entry.val());
                    break;
                case 'queued_at':
                    queuedAt = scValToBigInt(entry.val());
                    break;
            }
        });

        if (shares === undefined || queuedAt === undefined) {
            throw new Error('Missing required withdrawal fields');
        }

        return new VaultWithdrawal(
            descale(shares, 7),
            Number(queuedAt) // Already in seconds
        );
    }

    /**
     * Get time remaining until withdrawal can be processed
     * @param currentTime - Current timestamp in seconds
     * @param processingTime - Processing time required in seconds
     * @returns Seconds remaining, or 0 if ready
     */
    timeRemaining(currentTime: number, processingTime: number): number {
        const readyTime = this.queuedAt + processingTime;
        return currentTime >= readyTime ? 0 : readyTime - currentTime;
    }
}
