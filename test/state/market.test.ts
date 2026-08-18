import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, xdr, StrKey } from '@stellar/stellar-sdk';
import { Market, type MarketContracts } from '../../src/state/market.js';
import { MarketStateError } from '../../src/state/entries.js';
import {
    contractInstanceLedgerKey,
    tokenBalanceLedgerKey,
    tradingMarketDataLedgerKey,
} from '../../src/ledger-keys.js';
import { Status } from '../../src/contracts/trading/trading_types.js';
import type { Network } from '../../src/index.js';
import {
    makeConfig,
    marketDataScVal,
    tradingInstanceScVal,
    vaultInstanceScVal,
    balanceMapScVal,
    ledgerEntryFor,
    TEST_FEED_ID,
} from '../helpers/trading_state.js';

const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));
const MARKET_B = StrKey.encodeContract(Buffer.alloc(32, 9));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const VAULT_B = StrKey.encodeContract(Buffer.alloc(32, 10));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const BALANCE = 50_000_000n;
const SUPPLY = 10_000_000_00n;

const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};

const contracts: MarketContracts = { market: MARKET, vault: VAULT, token: TOKEN };
const contractsB: MarketContracts = { market: MARKET_B, vault: VAULT_B, token: TOKEN };

function marketEntries(
    where: MarketContracts,
    overrides: {
        omitBalance?: boolean;
        omitData?: boolean;
        instance?: xdr.ScVal;
        liveUntil?: number;
    } = {},
) {
    const instance =
        overrides.instance ??
        tradingInstanceScVal({
            vault: where.vault,
            token: where.token,
            oracle: ORACLE,
            treasury: TREASURY,
            adl: [true, false],
        });
    const entries = [
        ledgerEntryFor(contractInstanceLedgerKey(where.market), instance, overrides.liveUntil),
        ledgerEntryFor(
            contractInstanceLedgerKey(where.vault),
            vaultInstanceScVal({
                asset: where.token,
                strategy: where.market,
                totalSupply: SUPPLY,
                decimalsOffset: 1,
                shareDecimals: 8,
            }),
        ),
    ];
    if (!overrides.omitData) {
        entries.push(
            ledgerEntryFor(tradingMarketDataLedgerKey(where.market), marketDataScVal()),
        );
    }
    if (!overrides.omitBalance) {
        entries.push(
            ledgerEntryFor(
                tokenBalanceLedgerKey(where.token, where.vault),
                balanceMapScVal(BALANCE),
            ),
        );
    }
    return entries;
}

function mockEntries(entries: unknown[], latestLedger = 4242) {
    return vi
        .spyOn(rpc.Server.prototype, 'getLedgerEntries')
        .mockResolvedValue({ entries, latestLedger } as never);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Market.load', () => {
    it('decodes a market from one getLedgerEntries of exactly four keys', async () => {
        const spy = mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toHaveLength(4);

        expect(market.ledger).toBe(4242);
        expect(market.contracts).toEqual(contracts);
        expect(market.config).toEqual(makeConfig());
        expect(market.status).toBe(Status.Active);
        expect(market.adl).toEqual({ long: true, short: false });
        expect(market.oracle).toBe(ORACLE);
        expect(market.treasury).toBe(TREASURY);
        expect(market.data.notional).toEqual({ long: 1000n, short: 500n });
        expect(market.vaultAtomic).toEqual({
            totalAssets: BALANCE,
            totalSupply: SUPPLY,
            decimalsOffset: 1,
        });
    });

    it('does not read a price — that is a caller input, never a ledger entry', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        expect(market).not.toHaveProperty('price');
        expect(market.state).not.toHaveProperty('price');
    });

    it('reads an absent vault Balance as zero, not as an error', async () => {
        mockEntries(marketEntries(contracts, { omitBalance: true }));
        const market = await Market.load(network, contracts);
        expect(market.vaultAtomic.totalAssets).toBe(0n);
    });

    it('fails closed on a required entry the RPC omitted', async () => {
        mockEntries(marketEntries(contracts, { omitData: true }));
        await expect(Market.load(network, contracts)).rejects.toMatchObject({
            code: 'MISSING_STATE',
            message: expect.stringContaining('market data'),
        });
    });

    it('fails closed on an entry whose TTL has lapsed', async () => {
        // Returned, but expired-but-not-yet-evicted: liveUntil < latestLedger.
        mockEntries(marketEntries(contracts, { liveUntil: 4241 }), 4242);
        await expect(Market.load(network, contracts)).rejects.toThrow(
            /TTL-expired.*restore or extend/,
        );
    });

    it('rejects contracts the market itself disagrees with', async () => {
        // Instance says VAULT_B; the caller asked with VAULT.
        const instance = tradingInstanceScVal({
            vault: VAULT_B,
            token: TOKEN,
            oracle: ORACLE,
            treasury: TREASURY,
            adl: [false, false],
        });
        mockEntries(marketEntries(contracts, { instance }));
        await expect(Market.load(network, contracts)).rejects.toMatchObject({
            code: 'IDENTITY_MISMATCH',
        });
    });

    it('round-trips through plain data for a rehydrated cache', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        const rebuilt = Market.fromData(network, structuredClone(market.state));
        expect(rebuilt.config).toEqual(market.config);
        expect(rebuilt.vaultAtomic).toEqual(market.vaultAtomic);
    });
});

describe('Market.loadMany', () => {
    it('collapses keys shared between markets, which the RPC would reject', async () => {
        // Both markets settle in TOKEN, so `Balance(TOKEN, vault)` differs but a
        // shared token/treasury address would repeat. Force a genuine duplicate
        // by asking for the same market twice.
        const spy = mockEntries([
            ...marketEntries(contracts),
            ...marketEntries(contractsB),
        ]);
        const markets = await Market.loadMany(network, [
            contracts,
            contractsB,
            contracts,
        ]);

        expect(spy).toHaveBeenCalledTimes(1);
        // 3 requests x 4 keys = 12 naive, but the repeat contributes nothing new.
        expect(spy.mock.calls[0]).toHaveLength(8);
        const sent = spy.mock.calls[0].map((k) => (k as xdr.LedgerKey).toXDR('base64'));
        expect(new Set(sent).size).toBe(sent.length);

        // Still one result per request, in request order.
        expect(markets).toHaveLength(3);
        expect(markets.map((m) => m.contracts.market)).toEqual([
            MARKET,
            MARKET_B,
            MARKET,
        ]);
    });

    it('returns nothing without a round trip for an empty request', async () => {
        const spy = mockEntries([]);
        expect(await Market.loadMany(network, [])).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
    });

    it('refuses a batch past the request cap rather than letting the RPC fail', async () => {
        const many = Array.from({ length: 46 }, (_, i) => ({
            market: StrKey.encodeContract(Buffer.alloc(32, (i % 200) + 20)),
            vault: StrKey.encodeContract(Buffer.alloc(32, ((i + 100) % 200) + 20)),
            token: TOKEN,
        }));
        const spy = mockEntries([]);
        await expect(Market.loadMany(network, many)).rejects.toMatchObject({
            code: 'INVALID_INPUT',
            message: expect.stringContaining('exceeds'),
        });
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('Market.crossCheckTotalAssets', () => {
    it('passes when the entry read agrees with a total_assets simulation', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        expect(() => market.crossCheckTotalAssets(BALANCE)).not.toThrow();
    });

    it('flags drift on the money path', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        expect(() => market.crossCheckTotalAssets(BALANCE + 1n)).toThrow(
            MarketStateError,
        );
    });
});

describe('Market accessors', () => {
    it('reports no retirement while the market is live', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        expect(market.retirement).toBeUndefined();
        expect(market.assetDecimals).toBe(7);
        expect(market.feedId).toEqual(TEST_FEED_ID);
    });

    it('reports (terminalPrice, delistedAt) once retired — the get_retirement shape', async () => {
        const instance = tradingInstanceScVal({
            vault: VAULT,
            token: TOKEN,
            oracle: ORACLE,
            treasury: TREASURY,
            delistedAt: 1_700n,
            terminalPrice: 99n,
        });
        mockEntries(marketEntries(contracts, { instance }));
        const market = await Market.load(network, contracts);
        expect(market.retirement).toEqual([99n, 1_700n]);
    });

    it('reloads against the same contracts', async () => {
        mockEntries(marketEntries(contracts), 5000);
        const market = await Market.load(network, contracts);
        mockEntries(marketEntries(contracts), 5001);
        const fresh = await market.reload();
        expect(fresh.ledger).toBe(5001);
        expect(fresh.contracts).toEqual(contracts);
    });
});
