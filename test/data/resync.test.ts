import { describe, expect, it, vi } from 'vitest';
import type { ZenexDataClient } from '../../src/data/client.js';
import { executeZenexResync } from '../../src/data/resync.js';

function fakeClient() {
    return {
        getConfig: vi.fn(async () => ({ route: 'config' })),
        getAccountOrders: vi.fn(async () => ({ route: 'orders' })),
        getAccountFills: vi.fn(async () => ({ route: 'fills' })),
        getAccountVaultOrders: vi.fn(async () => ({ route: 'vault-orders' })),
        getAccountLifecycles: vi.fn(async () => ({ route: 'lifecycles' })),
        getMarketTrades: vi.fn(async () => ({ route: 'trades' })),
        getMarketSnapshots: vi.fn(async () => ({ route: 'snapshots' })),
        getVaultPerformance: vi.fn(async () => ({ route: 'performance' })),
        getRollingStandings: vi.fn(async () => ({ route: 'rolling' })),
        getRollingLifecycles: vi.fn(async () => ({
            route: 'rolling-lifecycles',
        })),
        listCompetitions: vi.fn(async () => ({ route: 'competitions' })),
        getCompetition: vi.fn(async () => ({ route: 'competition' })),
        getCompetitionStandings: vi.fn(async () => ({ route: 'standings' })),
        getCompetitionLifecycles: vi.fn(async () => ({
            route: 'competition-lifecycles',
        })),
        getLatestPrice: vi.fn(async () => ({ route: 'price' })),
        getCandles: vi.fn(async () => ({ route: 'candles' })),
        getUdfConfig: vi.fn(async () => ({ route: 'udf-config' })),
        searchUdfSymbols: vi.fn(async () => ({ route: 'udf-search' })),
        getUdfSymbol: vi.fn(async () => ({ route: 'udf-symbol' })),
        getUdfHistory: vi.fn(async () => ({ route: 'udf-history' })),
    };
}

describe('executeZenexResync', () => {
    it('completes the entire declared authoritative read set', async () => {
        const client = fakeClient();
        const result = await executeZenexResync(client as never, {
            config: true,
            accounts: [{ account: 'GACCOUNT' }],
            markets: [{ market: 'xlm-usd' }],
            vaults: [{ vault: 'CVAULT', performance: { window: '7d' } }],
            leaderboards: [{ window: '7d' }],
            competitionLists: [{}],
            competitions: [{ id: 'competition-1' }],
            prices: [23n],
            candles: [
                {
                    feed: 23n,
                    resolution: '1',
                    from: 1n,
                    to: 2n,
                },
            ],
            udf: {
                config: true,
                searches: [{ query: 'XLM' }],
                symbols: [{ symbol: 'ZENEX.XLM/USD' }],
                histories: [
                    {
                        symbol: 'ZENEX.XLM/USD',
                        resolution: '1',
                        from: 1,
                        to: 2,
                    },
                ],
            },
        });

        expect(client.getAccountOrders).toHaveBeenCalledWith('GACCOUNT', {});
        expect(client.getAccountFills).toHaveBeenCalledWith('GACCOUNT', {});
        expect(client.getAccountVaultOrders).toHaveBeenCalledWith(
            'GACCOUNT',
            {},
        );
        expect(client.getAccountLifecycles).toHaveBeenCalledWith(
            'GACCOUNT',
            {},
        );
        expect(client.getMarketTrades).toHaveBeenCalledWith('xlm-usd', {});
        expect(client.getMarketSnapshots).toHaveBeenCalledWith('xlm-usd', {});
        expect(client.getRollingStandings).toHaveBeenCalledWith('7d', {});
        expect(client.getRollingLifecycles).toHaveBeenCalledWith('7d', {});
        expect(client.getCompetition).toHaveBeenCalledWith('competition-1');
        expect(client.getCompetitionStandings).toHaveBeenCalledWith(
            'competition-1',
            {},
        );
        expect(client.getCompetitionLifecycles).toHaveBeenCalledWith(
            'competition-1',
            {},
        );
        expect(client.getLatestPrice).toHaveBeenCalledWith(23n);
        expect(result.accounts[0]).toMatchObject({
            orders: { route: 'orders' },
            fills: { route: 'fills' },
            vaultOrders: { route: 'vault-orders' },
            lifecycles: { route: 'lifecycles' },
        });
        expect(result.udf).toMatchObject({
            config: { route: 'udf-config' },
            searches: [{ route: 'udf-search' }],
            symbols: [{ route: 'udf-symbol' }],
            histories: [{ route: 'udf-history' }],
        });
    });

    it('does not reach into or mutate caller cache state', async () => {
        const cache = Object.freeze({ stale: true });
        const client = fakeClient();
        const result = await executeZenexResync(client as never, {
            prices: [23n],
        });
        expect(cache).toEqual({ stale: true });
        expect(result.prices).toEqual([{ route: 'price' }]);
        expect(result.accounts).toEqual([]);
    });

    it('rejects no data internally when an authoritative read fails', async () => {
        const client = fakeClient();
        client.getMarketSnapshots.mockRejectedValueOnce(
            new Error('database unavailable'),
        );
        await expect(
            executeZenexResync(client as unknown as ZenexDataClient, {
                markets: [{ market: 'xlm-usd' }],
            }),
        ).rejects.toThrow('database unavailable');
    });

    it('bounds aggregate plan size and global request concurrency', async () => {
        const client = fakeClient();
        let inFlight = 0;
        let maximumInFlight = 0;
        const boundedRead = async () => {
            inFlight += 1;
            maximumInFlight = Math.max(maximumInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 2));
            inFlight -= 1;
            return { route: 'bounded' };
        };
        for (const method of Object.values(client) as unknown as {
            mockImplementation(implementation: () => Promise<unknown>): void;
        }[]) {
            method.mockImplementation(boundedRead);
        }

        const result = await executeZenexResync(client as never, {
            accounts: Array.from({ length: 10 }, (_, index) => ({
                account: `GACCOUNT${index}`,
            })),
            prices: Array.from({ length: 24 }, (_, index) => BigInt(index)),
        });
        expect(result.accounts).toHaveLength(10);
        expect(result.prices).toHaveLength(24);
        expect(maximumInFlight).toBeGreaterThan(1);
        expect(maximumInFlight).toBeLessThanOrEqual(8);

        const oversized = fakeClient();
        await expect(
            executeZenexResync(oversized as never, {
                prices: Array.from({ length: 513 }, (_, index) =>
                    BigInt(index),
                ),
            }),
        ).rejects.toThrow(/512-read limit/);
        expect(oversized.getLatestPrice).not.toHaveBeenCalled();
    });
});
