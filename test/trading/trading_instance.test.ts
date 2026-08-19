import { describe, it, expect } from 'vitest';
import { StrKey, xdr } from '@stellar/stellar-sdk';
import { parseTradingInstance } from '../../src/contracts/market/instance.js';
import { Status } from '../../src/contracts/market/types.js';
import {
    makeConfig,
    tradingInstanceScVal,
    contractInstance,
    unitKey,
    TEST_FEED_ID,
} from '../helpers/trading_state.js';

const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

const wiring = {
    vault: VAULT,
    token: TOKEN,
    oracle: ORACLE,
    treasury: TREASURY,
};

describe('parseTradingInstance', () => {
    it('walks a full instance: config, anchors, addresses, status', () => {
        const instance = parseTradingInstance(
            tradingInstanceScVal({ ...wiring, feedId: TEST_FEED_ID, status: 1, withOwner: OWNER }),
        );
        expect(instance.config).toEqual(makeConfig());
        expect(instance.feedId).toEqual(TEST_FEED_ID);
        expect(instance.status).toBe(Status.OnIce);
        expect(instance.vault).toBe(VAULT);
        expect(instance.token).toBe(TOKEN);
        expect(instance.oracle).toBe(ORACLE);
        expect(instance.treasury).toBe(TREASURY);
        expect(instance.owner).toBe(OWNER);
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

    it('reads the OZ Owner slot rather than discarding it', () => {
        // Instance storage is ONE entry: Owner is already fetched and paid for,
        // and a client needs it to verify the market is governance-owned.
        expect(
            parseTradingInstance(tradingInstanceScVal({ ...wiring, withOwner: OWNER })).owner,
        ).toBe(OWNER);
    });

    it('reports no owner once ownership has been renounced', () => {
        expect(parseTradingInstance(tradingInstanceScVal(wiring)).owner).toBeUndefined();
    });

    it('still ignores a key it has no field for, rather than failing the read', () => {
        // Forward compatibility: a contract upgrade that adds a storage key must
        // not break every client reading the instance.
        const extended = contractInstance([
            ...(tradingInstanceScVal(wiring).instance().storage() ?? []),
            new xdr.ScMapEntry({ key: unitKey('SomeFutureKey'), val: xdr.ScVal.scvU32(1) }),
        ]);
        expect(() => parseTradingInstance(extended)).not.toThrow();
    });

    it('throws when a required key is missing', () => {
        // Build an instance missing Treasury.
        const partial = contractInstance([
            new xdr.ScMapEntry({ key: unitKey('FeedId'), val: xdr.ScVal.scvBytes(TEST_FEED_ID) }),
        ]);
        expect(() => parseTradingInstance(partial)).toThrow(/missing/);
    });

    it('rejects a non-instance value', () => {
        expect(() => parseTradingInstance(xdr.ScVal.scvU32(1))).toThrow(
            /contract-instance/,
        );
    });
});
