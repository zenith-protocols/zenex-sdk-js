import { describe, it, expect } from 'vitest';
import { StrKey, xdr } from '@stellar/stellar-sdk';
import { parseTradingInstance } from '../../src/contracts/trading/trading_instance.js';
import { Status } from '../../src/contracts/trading/trading_types.js';
import {
    makeConfig,
    tradingInstanceScVal,
    contractInstance,
    unitKey,
} from '../helpers/trading_state.js';

const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const PRICE_VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

const wiring = {
    vault: VAULT,
    token: TOKEN,
    priceVerifier: PRICE_VERIFIER,
    treasury: TREASURY,
};

describe('parseTradingInstance', () => {
    it('walks a full instance: config, anchors, addresses, status', () => {
        const instance = parseTradingInstance(
            tradingInstanceScVal({ ...wiring, feedId: 23, exponent: -8, status: 1, withOwner: OWNER }),
        );
        expect(instance.config).toEqual(makeConfig());
        expect(instance.feedId).toBe(23);
        expect(instance.exponent).toBe(-8);
        expect(instance.status).toBe(Status.OnIce);
        expect(instance.vault).toBe(VAULT);
        expect(instance.token).toBe(TOKEN);
        expect(instance.priceVerifier).toBe(PRICE_VERIFIER);
        expect(instance.treasury).toBe(TREASURY);
    });

    it('lazy keys default when absent (DelistedAt/TerminalPrice undefined, Adl zeroed)', () => {
        const instance = parseTradingInstance(tradingInstanceScVal(wiring));
        expect(instance.delistedAt).toBeUndefined();
        expect(instance.terminalPrice).toBeUndefined();
        expect(instance.adl).toEqual({ long: false, short: false });
    });

    it('reads lazy keys when present', () => {
        const instance = parseTradingInstance(
            tradingInstanceScVal({
                ...wiring,
                delistedAt: 1_751_000_000n,
                terminalPrice: 9_100_000_000n,
                adl: [true, false],
            }),
        );
        expect(instance.delistedAt).toBe(1_751_000_000n);
        expect(instance.terminalPrice).toBe(9_100_000_000n);
        expect(instance.adl).toEqual({ long: true, short: false });
    });

    it('skips a foreign (OZ Owner) instance key', () => {
        // Present in the fixture via withOwner; a clean parse proves it is skipped.
        expect(() =>
            parseTradingInstance(tradingInstanceScVal({ ...wiring, withOwner: OWNER })),
        ).not.toThrow();
    });

    it('throws when a required key is missing', () => {
        // Build an instance missing Treasury.
        const partial = contractInstance([
            new xdr.ScMapEntry({ key: unitKey('FeedId'), val: xdr.ScVal.scvU32(1) }),
        ]);
        expect(() => parseTradingInstance(partial)).toThrow(/missing/);
    });

    it('rejects a non-instance value', () => {
        expect(() => parseTradingInstance(xdr.ScVal.scvU32(1))).toThrow(
            /contract-instance/,
        );
    });
});
