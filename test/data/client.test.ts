import { describe, expect, it, vi } from 'vitest';
import {
    RelaySubmissionAmbiguousError,
    ZenexApiError,
    ZenexDataClient,
    ZenexResponseTooLargeError,
} from '../../src/data/client.js';
import { ZenexDataDecodeError } from '../../src/data/codec.js';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = '2026-07-15T12:00:00.000Z';

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function indexedMeta() {
    return {
        apiVersion: 'v1',
        asOf: NOW,
        completeness: 'complete',
        indexedFromLedger: '9007199254740993',
        throughLedger: '9007199254740999',
    };
}

function relayMeta() {
    return {
        apiVersion: 'v1',
        asOf: NOW,
        source: 'transaction-relay',
        relayVersion: 'relay-v1',
        serviceStatus: 'ready',
    };
}

function relayStatus(state = 'preparing') {
    return {
        requestId: REQUEST_ID,
        policy: 'priceFree',
        state,
        fingerprint: null,
        hash: null,
        retryable: false,
        error: null,
        createdAt: NOW,
        updatedAt: NOW,
    };
}

describe('ZenexDataClient', () => {
    it('requests filtered account resources and decodes exact metadata', async () => {
        const fetch = vi.fn(async () =>
            json({
                data: { items: [], nextCursor: null },
                meta: indexedMeta(),
            }),
        );
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example/base',
            fetch,
        });

        const response = await client.getAccountOrders('GACCOUNT', {
            status: ['pending', 'filled'],
            market: 'xlm-usd',
            limit: 25,
            cursor: 'YWJj',
        });

        expect(response.data.items).toEqual([]);
        expect(response.meta.indexedFromLedger).toBe(9_007_199_254_740_993n);
        expect(response.meta.throughLedger).toBe(9_007_199_254_740_999n);
        const url = new URL(String(fetch.mock.calls[0]?.[0]));
        expect(url.pathname).toBe('/base/v1/accounts/GACCOUNT/orders');
        expect(url.searchParams.getAll('status')).toEqual([
            'pending',
            'filled',
        ]);
        expect(url.searchParams.get('market')).toBe('xlm-usd');
        expect(url.searchParams.get('limit')).toBe('25');
    });

    it('fails closed for missing or invented route metadata', async () => {
        const missing = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () =>
                json({
                    data: { items: [], nextCursor: null },
                    meta: {
                        apiVersion: 'v1',
                        asOf: NOW,
                        completeness: 'complete',
                        indexedFromLedger: '1',
                    },
                }),
        });
        await expect(
            missing.getAccountFills('GACCOUNT'),
        ).rejects.toBeInstanceOf(ZenexDataDecodeError);

        const invented = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () =>
                json({
                    data: {
                        supported_resolutions: ['1'],
                        supports_group_request: false,
                        supports_marks: false,
                        supports_search: true,
                        supports_time: true,
                        supports_timescale_marks: false,
                    },
                    throughLedger: '1',
                }),
        });
        await expect(invented.getUdfConfig()).rejects.toBeInstanceOf(
            ZenexDataDecodeError,
        );
    });

    it('throws typed API and malformed-success errors without fallback data', async () => {
        const api = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () =>
                json(
                    {
                        error: {
                            code: 'INVALID_CURSOR',
                            message: 'Cursor expired',
                            requestId: 'api-request-1',
                        },
                    },
                    400,
                ),
        });
        await expect(api.getMarketTrades('xlm-usd')).rejects.toMatchObject({
            name: 'ZenexApiError',
            status: 400,
            code: 'INVALID_CURSOR',
            requestId: 'api-request-1',
        });

        const malformed = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => new Response('{', { status: 200 }),
        });
        await expect(malformed.getConfig()).rejects.toMatchObject({
            name: 'ZenexDataDecodeError',
            path: '/',
            message: expect.stringContaining('response body is not valid JSON'),
        } satisfies Partial<ZenexDataDecodeError>);

        const malformedError = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () =>
                new Response(new Uint8Array([0xff]), { status: 400 }),
        });
        await expect(malformedError.getConfig()).rejects.toMatchObject({
            name: 'ZenexApiError',
            status: 400,
            code: 'HTTP_400',
            cause: expect.objectContaining({
                name: 'ZenexDataDecodeError',
            }),
        });
    });

    it('accepts explicitly undefined optional UDF search values', async () => {
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => json([]),
        });
        await expect(
            client.searchUdfSymbols({ query: undefined }),
        ).resolves.toEqual([]);
    });

    it('rejects URL dot segments before route resolution', async () => {
        const fetch = vi.fn();
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example/base/',
            fetch,
        });
        await expect(client.getAccountOrders('..')).rejects.toThrow(
            /dot segment/,
        );
        await expect(client.getCompetition('.')).rejects.toThrow(/dot segment/);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('decodes latest price, candle metadata, and UDF data by route', async () => {
        const responses = [
            json({
                data: {
                    feedId: '23',
                    signedUpdate: 'AAAA',
                    price: '900719925474099312345',
                    exponent: -8,
                    confidence: '45',
                    publishTime: '1721044800000000',
                    receivedTime: '1721044800001000',
                    ageMilliseconds: '1',
                    sourceUpdateId: 'update-1',
                    freshness: 'fresh',
                },
                meta: {
                    apiVersion: 'v1',
                    asOf: NOW,
                    source: 'pyth-lazer',
                    sourcePublishTime: '1721044800000000',
                    receivedAt: NOW,
                    freshness: 'fresh',
                    sourceUpdateId: 'update-1',
                },
            }),
            json({
                data: [],
                meta: {
                    apiVersion: 'v1',
                    asOf: NOW,
                    source: 'pyth-benchmarks',
                    canonicalStatus: 'gapped',
                    gaps: [{ from: '10', to: '20' }],
                },
            }),
            json({ s: 'ok', t: [1], o: [1], h: [2], l: [1], c: [2] }),
        ];
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => responses.shift()!,
        });

        const latest = await client.getLatestPrice(23n);
        expect(latest.data.price).toBe(900_719_925_474_099_312_345n);
        expect(latest.meta.sourcePublishTime).toBe(1_721_044_800_000_000n);
        const candles = await client.getCandles({
            feed: 23n,
            resolution: '1',
            from: 10n,
            to: 20n,
        });
        expect(candles.meta.gaps).toEqual([{ from: 10n, to: 20n }]);
        expect(
            await client.getUdfHistory({
                symbol: 'ZENEX.XLM/USD',
                resolution: '1',
                from: 1,
                to: 2,
            }),
        ).toMatchObject({ s: 'ok', t: [1] });
    });

    it('enforces mutually exclusive and bounded queries before fetching', async () => {
        const fetch = vi.fn();
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch,
        });
        await expect(
            client.getAccountVaultOrders('GACCOUNT', {
                market: 'xlm-usd',
                vault: 'CVAULT',
            }),
        ).rejects.toThrow('mutually exclusive');
        await expect(
            client.getAccountOrders('GACCOUNT', { limit: 101 }),
        ).rejects.toThrow('limit');
        await expect(
            client.getCandles({
                feed: 23n,
                symbol: 'ZENEX.XLM/USD',
                resolution: '1',
                from: 1n,
                to: 2n,
            }),
        ).rejects.toThrow('exactly one');
        await expect(
            client.getAccountOrders('GACCOUNT', { status: [] }),
        ).rejects.toThrow('status');
        await expect(
            client.listCompetitions({
                state: [
                    'active',
                    'scheduled',
                    'finalized',
                    'cancelled',
                    'active',
                ] as never,
            }),
        ).rejects.toThrow('state');
        await expect(
            client.getUdfSymbol({ symbol: 'not-a-udf-symbol' }),
        ).rejects.toThrow('symbol');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('applies a finite request timeout and allows per-call cancellation', async () => {
        const signals: AbortSignal[] = [];
        const fetch = vi.fn(
            async (_input: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    const signal = init?.signal;
                    if (signal === undefined || signal === null) {
                        reject(new Error('missing request signal'));
                        return;
                    }
                    signals.push(signal);
                    signal.addEventListener(
                        'abort',
                        () => reject(signal.reason),
                        { once: true },
                    );
                }),
        );
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch,
            requestTimeoutMs: 10,
        });

        await expect(client.getConfig()).rejects.toMatchObject({
            name: 'TimeoutError',
        });
        const controller = new AbortController();
        const cancelled = client.getConfig({ signal: controller.signal });
        controller.abort(new DOMException('cancelled', 'AbortError'));
        await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        expect(signals).toHaveLength(2);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
    });

    it('bounds JSON bodies by declared and streamed byte length', async () => {
        const declared = new ZenexDataClient({
            baseUrl: 'https://api.example',
            maxResponseBytes: 64,
            fetch: async () =>
                new Response('{}', {
                    headers: { 'content-length': '65' },
                }),
        });
        await expect(declared.getConfig()).rejects.toBeInstanceOf(
            ZenexResponseTooLargeError,
        );

        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(40));
                controller.enqueue(new Uint8Array(25));
                controller.close();
            },
        });
        const streamed = new ZenexDataClient({
            baseUrl: 'https://api.example',
            maxResponseBytes: 64,
            fetch: async () => new Response(body),
        });
        await expect(streamed.getConfig()).rejects.toBeInstanceOf(
            ZenexResponseTooLargeError,
        );
    });

    it('matches optional UDF history bounds and the vault path contract', async () => {
        const responses = [
            json({ s: 'no_data' }),
            json({
                data: {
                    vaultId: 'CVAULT',
                    marketId: 'xlm-usd',
                    window: '1d',
                    returnRate: null,
                    samples: [],
                },
                meta: indexedMeta(),
            }),
        ];
        const fetch = vi.fn(async () => responses.shift()!);
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch,
        });

        await client.getUdfHistory({
            symbol: 'ZENEX.XLM/USD',
            resolution: '1',
        });
        const longVault = 'v'.repeat(256);
        await client.getVaultPerformance(longVault, { window: '1d' });

        const historyUrl = new URL(String(fetch.mock.calls[0]?.[0]));
        expect(historyUrl.searchParams.has('from')).toBe(false);
        expect(historyUrl.searchParams.has('to')).toBe(false);
        expect(new URL(String(fetch.mock.calls[1]?.[0])).pathname).toBe(
            `/v1/vaults/${longVault}/performance`,
        );
    });

    it('never retries an ambiguous relay POST and preserves its request ID', async () => {
        const fetch = vi.fn(async () => {
            throw new TypeError('connection reset');
        });
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch,
        });
        const request = {
            requestId: REQUEST_ID,
            policy: 'priceFree',
            func: 'AAAA',
            auth: ['AAAA'],
        } as never;

        const error = await client
            .submitRelayRequest(request)
            .catch((caught) => caught);
        expect(error).toBeInstanceOf(RelaySubmissionAmbiguousError);
        expect(error).toMatchObject({ requestId: REQUEST_ID });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps an idempotency conflict structured and reads durable relay status', async () => {
        const responses = [
            json(
                {
                    error: {
                        code: 'IDEMPOTENCY_CONFLICT',
                        message: 'Request ID has different input',
                        requestId: 'api-request-2',
                    },
                },
                409,
            ),
            json({ data: relayStatus('unknown'), meta: relayMeta() }),
        ];
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => responses.shift()!,
        });
        const request = {
            requestId: REQUEST_ID,
            policy: 'priceFree',
            func: 'AAAA',
            auth: ['AAAA'],
        } as never;

        await expect(client.submitRelayRequest(request)).rejects.toBeInstanceOf(
            ZenexApiError,
        );
        const status = await client.getRelayRequest(REQUEST_ID);
        expect(status.data.state).toBe('unknown');
    });

    it('exposes all route-specific public operations', () => {
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: vi.fn(),
        });
        for (const method of [
            'getConfig',
            'getAccountOrders',
            'getAccountFills',
            'getAccountVaultOrders',
            'getAccountLifecycles',
            'getReferralCode',
            'lookupReferralCode',
            'getReferralStats',
            'getFaucetStatus',
            'claimFaucet',
            'getMarketTrades',
            'getMarketSnapshots',
            'getVaultPerformance',
            'getRollingStandings',
            'getRollingLifecycles',
            'listCompetitions',
            'getCompetition',
            'getCompetitionStandings',
            'getCompetitionLifecycles',
            'getLatestPrice',
            'getCandles',
            'getUdfConfig',
            'searchUdfSymbols',
            'getUdfSymbol',
            'getUdfHistory',
            'submitRelayRequest',
            'getRelayRequest',
            'stream',
        ]) {
            expect(client[method as keyof ZenexDataClient]).toBeTypeOf(
                'function',
            );
        }
        expect(
            (client as unknown as Record<string, unknown>).submit,
        ).toBeUndefined();
        expect(
            (client as unknown as Record<string, unknown>).restore,
        ).toBeUndefined();
    });
});
