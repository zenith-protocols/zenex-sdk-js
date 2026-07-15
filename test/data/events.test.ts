import { describe, expect, it, vi } from 'vitest';
import { ZenexDataClient } from '../../src/data/client.js';
import {
    buildZenexStreamScopes,
    streamZenexEvents,
    ZenexResyncRequiredError,
    ZenexStreamProtocolError,
} from '../../src/data/events.js';

const NOW = '2026-07-15T12:00:00.000Z';

function streamResponse(events: readonly string[]): Response {
    return new Response(events.join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
}

function chunkedStreamResponse(chunks: readonly string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            },
        }),
        {
            status: 200,
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        },
    );
}

function sse(event: Record<string, unknown>, split = false): string {
    const data = JSON.stringify(event);
    const payload = split
        ? `data: ${data.slice(0, data.indexOf(',') + 1)}\ndata: ${data.slice(
              data.indexOf(',') + 1,
          )}`
        : `data: ${data}`;
    return `id: ${String(event.id)}\nevent: ${String(event.type)}\n${payload}\n\n`;
}

function invalidation(id: string) {
    return {
        id,
        type: 'account.lifecycles.changed',
        occurredAt: NOW,
        scope: 'account:GACCOUNT',
        resourcePath: '/v1/accounts/GACCOUNT/lifecycles',
        data: { resourcePath: '/v1/accounts/GACCOUNT/lifecycles' },
    };
}

function priceTick(id: string) {
    return {
        id,
        type: 'price.tick',
        occurredAt: NOW,
        scope: 'price:23',
        resourcePath: '/v1/prices/23/latest',
        data: {
            resourcePath: '/v1/prices/23/latest',
            feedId: '23',
            price: '900719925474099312345',
            confidence: '7',
            exponent: -8,
            publishTime: '1721044800000000',
            sourceUpdateId: 'update-1',
            freshness: 'fresh',
        },
    };
}

function resyncEvent(id: string) {
    return {
        id,
        type: 'resync-required',
        occurredAt: NOW,
        scope: 'price:23',
        resourcePath: '/v1/stream',
        data: { resourcePath: '/v1/stream', reason: 'retention_gap' },
    };
}

function latestPriceResponse(): Response {
    return new Response(
        JSON.stringify({
            data: {
                feedId: '23',
                signedUpdate: 'AAAA',
                price: '100',
                exponent: -8,
                confidence: '1',
                publishTime: '10',
                receivedTime: '11',
                ageMilliseconds: '1',
                sourceUpdateId: 'update-1',
                freshness: 'fresh',
            },
            meta: {
                apiVersion: 'v1',
                asOf: NOW,
                source: 'pyth-lazer',
                sourcePublishTime: '10',
                receivedAt: NOW,
                freshness: 'fresh',
                sourceUpdateId: 'update-1',
            },
        }),
        { headers: { 'content-type': 'application/json' } },
    );
}

describe('Zenex scoped event stream', () => {
    it('builds unique bounded repeated scopes', () => {
        expect(
            buildZenexStreamScopes({
                accounts: ['GACCOUNT', 'GACCOUNT'],
                markets: ['xlm-usd'],
                prices: [23n],
                leaderboards: ['7d'],
                competitions: ['competition-1'],
                config: true,
            }),
        ).toEqual([
            'account:GACCOUNT',
            'market:xlm-usd',
            'price:23',
            'leaderboard:7d',
            'competition:competition-1',
            'config:public',
        ]);
        expect(() => buildZenexStreamScopes({})).toThrow('1 through 32');
        expect(() =>
            buildZenexStreamScopes({
                accounts: Array.from({ length: 33 }, (_, index) => `G${index}`),
            }),
        ).toThrow('1 through 32');
    });

    it('parses multiline invalidations without adding financial state', async () => {
        const abort = new AbortController();
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => streamResponse([sse(invalidation('1'), true)]),
        });
        const iterator = streamZenexEvents(client, {
            scopes: ['account:GACCOUNT'],
            signal: abort.signal,
            reconnectDelayMs: 0,
        });
        const message = await iterator.next();
        expect(message.value).toEqual(invalidation('1'));
        expect(message.value?.data).toEqual({
            resourcePath: '/v1/accounts/GACCOUNT/lifecycles',
        });
        abort.abort();
        await iterator.return();
    });

    it('preserves split CRLF framing and discards truncated EOF events', async () => {
        const crlf = sse(invalidation('1')).replaceAll('\n', '\r\n');
        const split = crlf.indexOf('\r\n') + 1;
        const crlfClient = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () =>
                chunkedStreamResponse([
                    crlf.slice(0, split),
                    crlf.slice(split),
                ]),
        });
        const crlfIterator = crlfClient.stream({
            scopes: ['account:GACCOUNT'],
            reconnectDelayMs: 0,
        });
        expect((await crlfIterator.next()).value).toEqual(invalidation('1'));
        await crlfIterator.return();

        let requests = 0;
        const truncatedClient = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => {
                requests += 1;
                return streamResponse([
                    requests === 1
                        ? sse(invalidation('1')).slice(0, -2)
                        : sse(invalidation('2')),
                ]);
            },
        });
        const truncatedIterator = truncatedClient.stream({
            scopes: ['account:GACCOUNT'],
            reconnectDelayMs: 0,
        });
        expect((await truncatedIterator.next()).value?.id).toBe('2');
        expect(requests).toBe(2);
        await truncatedIterator.return();
    });

    it('decodes only price.tick financial fields to bigint', async () => {
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => streamResponse([sse(priceTick('1'))]),
        });
        const iterator = client.stream({
            scopes: ['price:23'],
            reconnectDelayMs: 0,
        });
        const message = await iterator.next();
        expect(message.value).toMatchObject({
            type: 'price.tick',
            data: {
                feedId: 23n,
                price: 900_719_925_474_099_312_345n,
                confidence: 7n,
                publishTime: 1_721_044_800_000_000n,
            },
        });
        await iterator.return();
    });

    it('reconnects after transport end using Last-Event-ID', async () => {
        const headers: (HeadersInit | undefined)[] = [];
        let calls = 0;
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async (_url, init) => {
                headers.push(init?.headers);
                calls += 1;
                return streamResponse([sse(invalidation(String(calls)))]);
            },
        });
        const iterator = client.stream({
            scopes: ['account:GACCOUNT'],
            reconnectDelayMs: 0,
        });
        expect((await iterator.next()).value?.id).toBe('1');
        expect((await iterator.next()).value?.id).toBe('2');
        expect(new Headers(headers[0]).get('last-event-id')).toBe('0');
        expect(new Headers(headers[1]).get('last-event-id')).toBe('1');
        await iterator.return();
    });

    it('closes the authoritative query-to-connect gap from cursor zero', async () => {
        const requests: { path: string; lastEventId: string | null }[] = [];
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async (input, init) => {
                const url = new URL(String(input));
                requests.push({
                    path: url.pathname,
                    lastEventId: new Headers(init?.headers).get(
                        'last-event-id',
                    ),
                });
                return url.pathname === '/v1/prices/23/latest'
                    ? latestPriceResponse()
                    : streamResponse([sse(priceTick('1'))]);
            },
        });

        await expect(client.getLatestPrice(23n)).resolves.toMatchObject({
            data: { price: 100n },
        });
        const iterator = client.stream({
            scopes: ['price:23'],
            reconnectDelayMs: 0,
        });
        await expect(iterator.next()).resolves.toMatchObject({
            value: { id: '1', type: 'price.tick' },
        });

        expect(requests).toEqual([
            { path: '/v1/prices/23/latest', lastEventId: null },
            { path: '/v1/stream', lastEventId: '0' },
        ]);
        await iterator.return();
    });

    it('fails closed when SSE fields or payloads are malformed', async () => {
        const event = invalidation('2');
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () =>
                streamResponse([
                    `id: 1\nevent: account.lifecycles.changed\ndata: ${JSON.stringify(
                        event,
                    )}\n\n`,
                ]),
        });
        const iterator = client.stream({
            scopes: ['account:GACCOUNT'],
            reconnectDelayMs: 0,
        });
        await expect(iterator.next()).rejects.toBeInstanceOf(
            ZenexStreamProtocolError,
        );

        const invalidSchema = {
            ...invalidation('1'),
            data: {
                resourcePath: '/v1/accounts/GACCOUNT/lifecycles',
                price: '100',
            },
        };
        const schemaClient = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => streamResponse([sse(invalidSchema)]),
        });
        await expect(
            schemaClient
                .stream({
                    scopes: ['account:GACCOUNT'],
                    reconnectDelayMs: 0,
                })
                .next(),
        ).rejects.toBeInstanceOf(ZenexStreamProtocolError);
    });

    it('bounds non-data SSE fields and unterminated lines', async () => {
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () =>
                streamResponse([
                    `: ${'x'.repeat(2 * 1024 * 1024 + 65 * 1024)}\n`,
                ]),
        });
        await expect(
            client
                .stream({
                    scopes: ['account:GACCOUNT'],
                    reconnectDelayMs: 0,
                })
                .next(),
        ).rejects.toBeInstanceOf(ZenexStreamProtocolError);
    });

    it('requires an explicit authoritative plan for resync-required', async () => {
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: async () => streamResponse([sse(resyncEvent('5'))]),
        });
        const iterator = client.stream({
            scopes: ['price:23'],
            lastEventId: '1',
            reconnectDelayMs: 0,
        });
        await expect(iterator.next()).rejects.toBeInstanceOf(
            ZenexResyncRequiredError,
        );
    });

    it('reconnects from the resync high-water event after state replacement', async () => {
        const streamHeaders: Headers[] = [];
        let streams = 0;
        const fetch = vi.fn(
            async (input: string | URL | Request, init?: RequestInit) => {
                const url = new URL(String(input));
                if (url.pathname === '/v1/prices/23/latest')
                    return latestPriceResponse();
                streamHeaders.push(new Headers(init?.headers));
                streams += 1;
                return streamResponse([
                    sse(streams === 1 ? resyncEvent('5') : priceTick('6')),
                ]);
            },
        );
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch,
        });
        const onResult = vi.fn();
        const iterator = client.stream({
            scopes: ['price:23'],
            lastEventId: '1',
            reconnectDelayMs: 0,
            resync: {
                plan: { prices: [23n] },
                onResult,
            },
        });

        expect((await iterator.next()).value?.type).toBe('resync-required');
        expect(onResult).toHaveBeenCalledOnce();
        expect(onResult.mock.calls[0]?.[0].prices[0].data.price).toBe(100n);
        expect((await iterator.next()).value?.type).toBe('price.tick');
        expect(streamHeaders[0]?.get('last-event-id')).toBe('1');
        expect(streamHeaders[1]?.get('last-event-id')).toBe('5');
        await iterator.return();
    });

    it('rejects automatic resync plans that do not cover every active scope', async () => {
        const client = new ZenexDataClient({
            baseUrl: 'https://api.example',
            fetch: vi.fn(),
        });
        const iterator = client.stream({
            scopes: ['account:GACCOUNT'],
            resync: { plan: { prices: [23n] }, onResult: vi.fn() },
        });
        await expect(iterator.next()).rejects.toThrow('does not cover');
    });
});
