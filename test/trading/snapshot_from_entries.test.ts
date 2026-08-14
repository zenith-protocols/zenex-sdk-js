import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { snapshotFromEntries } from '../../src/trading/snapshot.js';
import type { TradingSnapshotPrice } from '../../src/trading/snapshot.js';
import type { TradingEntriesSnapshot } from '../../src/contracts/trading/trading_entries.js';
import { Status } from '../../src/contracts/trading/trading_types.js';
import type { Position } from '../../src/contracts/trading/trading_types.js';
import { makeConfig } from '../helpers/trading_state.js';

const TRADING = StrKey.encodeContract(Buffer.alloc(32, 1));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 3));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 5));
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 6));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

const position: Position = {
    margin: 100n,
    notional: 1_000n,
    tokens: 10n,
    fundingIdx: 0n,
    borrowingIdx: 0n,
    lockedNotional: 0n,
    unlocksAt: 0n,
    pricedAt: 0n,
    decreaseOrders: [],
};

function makeEntries(
    overrides: Partial<TradingEntriesSnapshot['instance']> = {},
): TradingEntriesSnapshot {
    return {
        ledger: 500,
        trading: TRADING,
        subject: { user: USER, isLong: true },
        instance: {
            config: makeConfig(),
            feedId: 9,
            exponent: -8,
            status: Status.Active,
            vault: VAULT,
            token: TOKEN,
            priceVerifier: VERIFIER,
            treasury: TREASURY,
            adl: { long: false, short: true },
            ...overrides,
        },
        market: {
            notional: { long: 0n, short: 0n },
            margin: { long: 0n, short: 0n },
            tokens: { long: 0n, short: 0n },
            fundingIdx: { long: 0n, short: 0n },
            borrowingIdx: { long: 0n, short: 0n },
            fundingRate: 0n,
            fundingPool: 0n,
            fundingOwed: 0n,
            fundingUpdate: 0n,
            borrowingUpdate: 0n,
            lastPriceTime: 0n,
        },
        position,
        vault: {
            asset: TOKEN,
            totalSharesAtomic: 7_000n,
            decimalsOffset: 3,
            shareDecimals: 10,
            assetDecimals: 7,
            strategy: TRADING,
        },
        vaultBalanceAtomic: 9_000n,
        treasuryRate: 42n,
        vaultAtomic: {
            totalAssets: 9_000n,
            totalSupply: 7_000n,
            decimalsOffset: 3,
        },
    };
}

const numericPrice: TradingSnapshotPrice = {
    feedId: 9,
    exponent: -8,
    price: 100n,
    bid: 99n,
    ask: 101n,
    confidence: 1n,
    publishTime: 1_700_000_000n,
    freshness: 'fresh',
};

describe('snapshotFromEntries', () => {
    it('projects a live-market entries read onto TradingSnapshot', () => {
        const snapshot = snapshotFromEntries({
            entries: makeEntries(),
            router: ROUTER,
            ledgerTime: 1_700_000_005n,
            price: numericPrice,
        });

        expect(snapshot.ledger).toBe(500);
        expect(snapshot.ledgerTime).toBe(1_700_000_005n);
        expect(snapshot.subject).toEqual({ user: USER, isLong: true });
        expect(snapshot.adl).toEqual({ long: false, short: true });
        expect(snapshot.collateralToken).toBe(TOKEN);
        expect(snapshot.deployment).toEqual({
            trading: TRADING,
            router: ROUTER,
            vault: VAULT,
            priceVerifier: VERIFIER,
            treasury: TREASURY,
            feedId: 9,
            exponent: -8,
            vaultDecimalsOffset: 3,
            vaultShareDecimals: 10,
        });
        expect(snapshot.status).toBe(Status.Active);
        expect(snapshot.retirement).toBeUndefined();
        expect(snapshot.config).toEqual(makeConfig());
        expect(snapshot.position).toEqual(position);
        expect(snapshot.price).toEqual({
            feedId: 9,
            exponent: -8,
            bid: 99n,
            ask: 101n,
        });
        expect(snapshot.priceUpdate).toEqual(new Uint8Array(0));
        expect(snapshot.vault).toEqual({
            totalAssets: 9_000n,
            totalSupply: 7_000n,
            decimalsOffset: 3,
        });
        expect(snapshot.treasuryRate).toBe(42n);
    });

    it('mirrors get_retirement: delisted without terminal price keeps the numeric mark', () => {
        const snapshot = snapshotFromEntries({
            entries: makeEntries({ delistedAt: 1_600_000_000n }),
            router: ROUTER,
            ledgerTime: 1_700_000_005n,
            price: numericPrice,
        });
        expect(snapshot.retirement).toEqual([0n, 1_600_000_000n]);
        expect(snapshot.price.bid).toBe(99n);
        expect(snapshot.price.ask).toBe(101n);
    });

    it('marks a retired market flat at its terminal price', () => {
        const snapshot = snapshotFromEntries({
            entries: makeEntries({
                delistedAt: 1_600_000_000n,
                terminalPrice: 12_345n,
            }),
            router: ROUTER,
            ledgerTime: 1_700_000_005n,
            price: numericPrice,
        });
        expect(snapshot.retirement).toEqual([12_345n, 1_600_000_000n]);
        expect(snapshot.price).toEqual({
            feedId: 9,
            exponent: -8,
            bid: 12_345n,
            ask: 12_345n,
        });
    });

    it('copies the supplied price update and rejects an invalid ledger time', () => {
        const update = Uint8Array.from([1, 2, 3]);
        const snapshot = snapshotFromEntries({
            entries: makeEntries(),
            router: ROUTER,
            ledgerTime: 0n,
            price: numericPrice,
            priceUpdate: update,
        });
        expect(snapshot.priceUpdate).toEqual(update);
        expect(snapshot.priceUpdate).not.toBe(update);

        expect(() =>
            snapshotFromEntries({
                entries: makeEntries(),
                router: ROUTER,
                ledgerTime: -1n,
                price: numericPrice,
            }),
        ).toThrow(/u64/);
    });
});
