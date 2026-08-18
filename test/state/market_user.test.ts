import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, xdr, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { MarketUser } from '../../src/state/market_user.js';
import { Market } from '../../src/state/market.js';
import { marketContext } from '../../src/state/context.js';
import { loadTokenBalance, loadTokenBalances } from '../../src/state/balance.js';
import { loadTreasuryRate } from '../../src/state/treasury.js';
import {
    contractInstanceLedgerKey,
    tokenBalanceLedgerKey,
    tradingClaimableFundingLedgerKey,
    tradingMarketDataLedgerKey,
    tradingOrderCounterLedgerKey,
    tradingPositionLedgerKey,
} from '../../src/ledger-keys.js';
import type { Network } from '../../src/index.js';
import type { PriceData } from '../../src/trading/market/types.js';
import {
    marketDataScVal,
    positionScVal,
    tradingInstanceScVal,
    vaultInstanceScVal,
    treasuryInstanceScVal,
    balanceMapScVal,
    ledgerEntryFor,
} from '../helpers/trading_state.js';

const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER_MARKET = StrKey.encodeContract(Buffer.alloc(32, 9));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const USER_B = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));
const RATE = 5n * 10n ** 16n;

const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};
const contracts = { market: MARKET, vault: VAULT, token: TOKEN };

function mockEntries(entries: unknown[], latestLedger = 4242) {
    return vi
        .spyOn(rpc.Server.prototype, 'getLedgerEntries')
        .mockResolvedValue({ entries, latestLedger } as never);
}

function userEntries(
    user: string,
    opts: { long?: boolean; short?: boolean; counter?: number; funding?: bigint } = {},
) {
    const entries = [];
    if (opts.long !== false) {
        entries.push(
            ledgerEntryFor(tradingPositionLedgerKey(MARKET, user, true), positionScVal()),
        );
    }
    if (opts.short) {
        entries.push(
            ledgerEntryFor(tradingPositionLedgerKey(MARKET, user, false), positionScVal()),
        );
    }
    if (opts.counter !== undefined) {
        entries.push(
            ledgerEntryFor(
                tradingOrderCounterLedgerKey(MARKET, user),
                nativeToScVal(opts.counter, { type: 'u32' }),
            ),
        );
    }
    if (opts.funding !== undefined) {
        entries.push(
            ledgerEntryFor(
                tradingClaimableFundingLedgerKey(MARKET, user),
                nativeToScVal(opts.funding, { type: 'i128' }),
            ),
        );
    }
    return entries;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('MarketUser.load', () => {
    it('reads both sides, the counter and claimable funding in one call', async () => {
        const spy = mockEntries(
            userEntries(USER, { short: true, counter: 7, funding: 250n }),
        );
        const user = await MarketUser.load(network, contracts, USER);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toHaveLength(4);
        expect(user.user).toBe(USER);
        expect(user.ledger).toBe(4242);
        expect(user.orderCounter).toBe(7);
        expect(user.claimableFunding).toBe(250n);
        expect(user.hasPosition(true)).toBe(true);
        expect(user.hasPosition(false)).toBe(true);
    });

    it('reads a never-opened side as Position::zeroed rather than an error', async () => {
        mockEntries(userEntries(USER, { short: false }));
        const user = await MarketUser.load(network, contracts, USER);

        const short = user.position(false);
        expect(short.notional).toBe(0n);
        expect(short.margin).toBe(0n);
        expect(short.decreaseOrders).toEqual([]);
        expect(user.hasPosition(false)).toBe(false);
    });

    it('gives each zeroed side its own decreaseOrders array', async () => {
        mockEntries([]);
        const user = await MarketUser.load(network, contracts, USER);
        expect(user.position(true).decreaseOrders).not.toBe(
            user.position(false).decreaseOrders,
        );
    });

    it('defaults an absent counter to 0, since the contract allocates from 1', async () => {
        mockEntries(userEntries(USER));
        const user = await MarketUser.load(network, contracts, USER);
        expect(user.orderCounter).toBe(0);
        expect(user.claimableFunding).toBe(0n);
    });

    it('batches many subjects on one market, in request order', async () => {
        const spy = mockEntries([
            ...userEntries(USER, { counter: 1 }),
            ...userEntries(USER_B, { counter: 2 }),
        ]);
        const users = await MarketUser.loadMany(network, contracts, [
            USER,
            USER_B,
            USER,
        ]);

        expect(spy).toHaveBeenCalledTimes(1);
        // The repeated subject contributes no new keys.
        const sent = spy.mock.calls[0].map((k) => (k as xdr.LedgerKey).toXDR('base64'));
        expect(new Set(sent).size).toBe(sent.length);
        expect(sent).toHaveLength(8);
        expect(users.map((u) => u.user)).toEqual([USER, USER_B, USER]);
        expect(users.map((u) => u.orderCounter)).toEqual([1, 2, 1]);
    });

    it('returns nothing without a round trip for no subjects', async () => {
        const spy = mockEntries([]);
        expect(await MarketUser.loadMany(network, contracts, [])).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('round-trips through plain data for a rehydrated cache', async () => {
        mockEntries(userEntries(USER, { counter: 3, funding: 9n }));
        const user = await MarketUser.load(network, contracts, USER);
        const rebuilt = MarketUser.fromData(structuredClone(user.state));
        expect(rebuilt.orderCounter).toBe(3);
        expect(rebuilt.claimableFunding).toBe(9n);
        expect(rebuilt.hasPosition(true)).toBe(true);
    });

    it('rejects pairing a user with a market it was not read against', async () => {
        mockEntries(userEntries(USER));
        const user = await MarketUser.load(network, contracts, USER);
        const foreign = Market.fromData(network, {
            ledger: 1,
            contracts: { market: OTHER_MARKET, vault: VAULT, token: TOKEN },
        } as never);
        expect(() => user.openSides(foreign)).toThrow(/market mismatch/);
    });
});

describe('marketContext', () => {
    const price: PriceData = {
        feedId: Buffer.alloc(32, 1),
        bid: 100n,
        ask: 101n,
        publishTime: 1_000n,
    };

    async function loadPair() {
        mockEntries([
            ledgerEntryFor(
                contractInstanceLedgerKey(MARKET),
                tradingInstanceScVal({
                    vault: VAULT,
                    token: TOKEN,
                    oracle: ORACLE,
                    treasury: TREASURY,
                    adl: [false, true],
                }),
            ),
            ledgerEntryFor(tradingMarketDataLedgerKey(MARKET), marketDataScVal()),
            ledgerEntryFor(
                contractInstanceLedgerKey(VAULT),
                vaultInstanceScVal({
                    asset: TOKEN,
                    strategy: MARKET,
                    totalSupply: 1_000n,
                    decimalsOffset: 1,
                    shareDecimals: 8,
                }),
            ),
            ledgerEntryFor(tokenBalanceLedgerKey(TOKEN, VAULT), balanceMapScVal(500n)),
            ...userEntries(USER),
        ]);
        const market = await Market.load(network, contracts);
        const user = await MarketUser.load(network, contracts, USER);
        return { market, user };
    }

    it('composes market, user and a caller-supplied price', async () => {
        const { market, user } = await loadPair();
        const context = marketContext(market, user, {
            isLong: true,
            price,
            now: 1_500n,
            treasuryRate: RATE,
        });

        expect(context.subject).toEqual({ user: USER, isLong: true });
        expect(context.ledger).toBe(4242);
        expect(context.ledgerTime).toBe(1_500n);
        expect(context.config).toEqual(market.config);
        expect(context.market).toBe(market.data);
        expect(context.position).toBe(user.position(true));
        expect(context.price).toBe(price);
        expect(context.vault).toEqual(market.vaultAtomic);
        expect(context.treasuryRate).toBe(RATE);
        expect(context.adl).toEqual({ long: false, short: true });
        expect(context.collateralToken).toBe(TOKEN);
    });

    it('falls back to the wall clock, which the entries read cannot supply', async () => {
        const { market, user } = await loadPair();
        const before = BigInt(Math.floor(Date.now() / 1000));
        const context = marketContext(market, user, { isLong: true, price });
        expect(context.ledgerTime).toBeGreaterThanOrEqual(before);
    });

    it('defaults the treasury rate to zero — it is loaded separately, if at all', async () => {
        const { market, user } = await loadPair();
        expect(marketContext(market, user, { isLong: true, price }).treasuryRate).toBe(0n);
    });

    it('refuses to pair a user with the wrong market', async () => {
        const { user } = await loadPair();
        const foreign = Market.fromData(network, {
            ledger: 1,
            contracts: { market: OTHER_MARKET, vault: VAULT, token: TOKEN },
            instance: {},
            vault: {},
            data: {},
            vaultAssetsAtomic: 0n,
        } as never);
        expect(() => marketContext(foreign, user, { isLong: true, price })).toThrow(
            /not CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM|IDENTITY|market/,
        );
    });
});

describe('standalone token balance', () => {
    it('reads one holder in a single key', async () => {
        const spy = mockEntries([
            ledgerEntryFor(tokenBalanceLedgerKey(TOKEN, USER), balanceMapScVal(42n)),
        ]);
        expect(await loadTokenBalance(network, TOKEN, USER)).toBe(42n);
        expect(spy.mock.calls[0]).toHaveLength(1);
    });

    it('reads an uncredited holder as zero', async () => {
        mockEntries([]);
        expect(await loadTokenBalance(network, TOKEN, USER)).toBe(0n);
    });

    it('returns nothing without a round trip for no tokens', async () => {
        const spy = mockEntries([]);
        expect(await loadTokenBalances(network, [], USER)).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('reads several tokens for one holder in one round trip, in order', async () => {
        const other = StrKey.encodeContract(Buffer.alloc(32, 11));
        const spy = mockEntries([
            ledgerEntryFor(tokenBalanceLedgerKey(other, USER), balanceMapScVal(7n)),
            ledgerEntryFor(tokenBalanceLedgerKey(TOKEN, USER), balanceMapScVal(42n)),
        ]);
        expect(await loadTokenBalances(network, [TOKEN, other], USER)).toEqual([42n, 7n]);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('loadTreasuryRate', () => {
    it('reads the rate from the treasury instance', async () => {
        const spy = mockEntries([
            ledgerEntryFor(contractInstanceLedgerKey(TREASURY), treasuryInstanceScVal(RATE)),
        ]);
        expect(await loadTreasuryRate(network, TREASURY)).toBe(RATE);
        expect(spy.mock.calls[0]).toHaveLength(1);
    });

    it('reads an absent Rate key as the contract default of zero', async () => {
        mockEntries([
            ledgerEntryFor(contractInstanceLedgerKey(TREASURY), treasuryInstanceScVal()),
        ]);
        expect(await loadTreasuryRate(network, TREASURY)).toBe(0n);
    });

    it('fails closed when the treasury instance is absent', async () => {
        mockEntries([]);
        await expect(loadTreasuryRate(network, TREASURY)).rejects.toMatchObject({
            code: 'MISSING_STATE',
        });
    });
});
