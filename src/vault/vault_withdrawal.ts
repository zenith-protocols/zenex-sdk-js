import { xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { descale } from '../utils/scaling.js';

export class VaultWithdrawal {
    constructor(
        /** Number of shares to be withdrawn */
        public shares: number,
        /** Timestamp when the withdrawal was queued (seconds) */
        public unlockTime: number
    ) { }

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
}
