import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, xdr, StrKey } from '@stellar/stellar-sdk';
import { Market, type MarketContracts } from '../../src/trading/market.js';
import { MarketStateError } from '../../src/entries.js';
import { contractInstanceLedgerKey } from '../../src/contracts/keys.js';
import { marketDataLedgerKey } from '../../src/contracts/market/keys.js';
import { tokenBalanceLedgerKey } from '../../src/token.js';
import { Status } from '../../src/contracts/market/types.js';
import type { Network } from '../../src/index.js';
import {
    makeConfig,
    marketDataScVal,
    marketInstanceScVal,
    vaultInstanceScVal,
    balanceMapScVal,
    ledgerEntryFor,
    TEST_FEED_ID,
} from '../helpers/market_state.js';

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
        marketInstanceScVal({
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
            ledgerEntryFor(marketDataLedgerKey(where.market), marketDataScVal()),
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
        expect(market.id).toBe(MARKET);
        expect(market.vault).toBe(VAULT);
        expect(market.token).toBe(TOKEN);
        expect(market.config).toEqual(makeConfig());
        expect(market.status).toBe(Status.Active);
        expect(market.adl).toEqual({ long: true, short: false });
        expect(market.oracle).toBe(ORACLE);
        expect(market.treasury).toBe(TREASURY);
        expect(market.data.notional).toEqual({ long: 1000n, short: 500n });
        expect(market.vaultAtomic()).toEqual({
            totalAssets: BALANCE,
            totalSupply: SUPPLY,
            decimalsOffset: 1,
        });
        expect(market.assetDecimals).toBe(7);
    });

    it('does not read a price — that is a caller input, never a ledger entry', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        expect(market).not.toHaveProperty('price');
    });

    it('reads an absent vault Balance as zero, not as an error', async () => {
        mockEntries(marketEntries(contracts, { omitBalance: true }));
        const market = await Market.load(network, contracts);
        expect(market.vaultAtomic().totalAssets).toBe(0n);
    });

    it('reads the vault balance through the same key a wallet balance uses', async () => {
        const spy = mockEntries(marketEntries(contracts));
        await Market.load(network, contracts);
        const sent = spy.mock.calls[0].map((k) => (k as xdr.LedgerKey).toXDR('base64'));
        expect(sent).toContain(
            tokenBalanceLedgerKey(TOKEN, VAULT).toXDR('base64'),
        );
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
        const instance = marketInstanceScVal({
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

    it('exposes plain public fields a cache can clone', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        expect(structuredClone(market.data)).toEqual(market.data);
        expect(structuredClone(market.config)).toEqual(market.config);
    });
});

describe('Market accessors', () => {
    it('surfaces the owner from the same entry, with no extra call', async () => {
        const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 12));
        const instance = marketInstanceScVal({
            vault: VAULT,
            token: TOKEN,
            oracle: ORACLE,
            treasury: TREASURY,
            withOwner: OWNER,
        });
        const spy = mockEntries(marketEntries(contracts, { instance }));
        const market = await Market.load(network, contracts);
        expect(market.owner).toBe(OWNER);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('reports no owner once ownership has been renounced', async () => {
        mockEntries(marketEntries(contracts));
        expect((await Market.load(network, contracts)).owner).toBeUndefined();
    });

    it('reports no retirement while the market is live', async () => {
        mockEntries(marketEntries(contracts));
        const market = await Market.load(network, contracts);
        expect(market.retirement).toBeUndefined();
        expect(market.assetDecimals).toBe(7);
        expect(market.feedId).toEqual(TEST_FEED_ID);
    });

    it('reports (terminalPrice, delistedAt) once retired — the get_retirement shape', async () => {
        const instance = marketInstanceScVal({
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

    it('refreshes by loading again', async () => {
        mockEntries(marketEntries(contracts), 5000);
        const market = await Market.load(network, contracts);
        vi.restoreAllMocks();
        mockEntries(marketEntries(contracts), 5001);
        const fresh = await Market.load(network, contracts);
        expect(market.ledger).toBe(5000);
        expect(fresh.ledger).toBe(5001);
    });
});
