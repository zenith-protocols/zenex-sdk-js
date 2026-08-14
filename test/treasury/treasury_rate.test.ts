import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { parseTreasuryRate } from '../../src/contracts/treasury/treasury_rate.js';
import { TreasuryContract } from '../../src/contracts/treasury/treasury_contract.js';
import { treasuryInstanceScVal, contractInstance } from '../helpers/trading_state.js';

describe('parseTreasuryRate', () => {
    it('reads the bare Symbol("Rate") i128 from instance storage', () => {
        const rate = 5n * 10n ** 16n;
        expect(parseTreasuryRate(treasuryInstanceScVal(rate))).toBe(rate);
    });

    it('defaults to 0 when the Rate key is absent (contract get_rate default)', () => {
        expect(parseTreasuryRate(treasuryInstanceScVal())).toBe(0n);
        expect(parseTreasuryRate(contractInstance([]))).toBe(0n);
    });

    it('rejects a non-instance value', () => {
        expect(() => parseTreasuryRate(xdr.ScVal.scvU32(1))).toThrow(
            /contract-instance/,
        );
    });

    it('agrees with the simulated get_rate parser on the same value', () => {
        const rate = 42n * 10n ** 15n;
        // The sim path decodes the i128 retval directly; the entries path reads
        // the same i128 out of instance storage. Both must yield the same rate.
        const viaSim = TreasuryContract.parsers.getRate(
            nativeToScVal(rate, { type: 'i128' }).toXDR('base64'),
        );
        const viaEntries = parseTreasuryRate(treasuryInstanceScVal(rate));
        expect(viaEntries).toBe(viaSim);
    });
});
