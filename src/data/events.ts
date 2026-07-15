import type { ZenexDataClient, ZenexFetch } from './client.js';
import { decodeApiSchema } from './codec.js';
import type { RollingWindow, StreamEvent } from './generated.js';
import {
    executeZenexResync,
    type ZenexResyncPlan,
    type ZenexResyncResult,
} from './resync.js';

const STREAM_SCOPE =
    /^(account|market|price|leaderboard|competition|config):[A-Za-z0-9._~:-]+$/;
const EVENT_ID = /^[1-9][0-9]*$/;
const CURSOR = /^(0|[1-9][0-9]*)$/;
const MAX_STREAM_SCOPES = 32;
const MAX_EVENT_DATA_LENGTH = 2 * 1024 * 1024;
const MAX_EVENT_WIRE_LENGTH = MAX_EVENT_DATA_LENGTH + 64 * 1024;

export type ZenexStreamScope =
    | `account:${string}`
    | `market:${string}`
    | `price:${string}`
    | `leaderboard:${string}`
    | `competition:${string}`
    | `config:${string}`;

export interface ZenexActiveScopes {
    readonly accounts?: readonly string[];
    readonly markets?: readonly string[];
    readonly prices?: readonly bigint[];
    readonly leaderboards?: readonly RollingWindow[];
    readonly competitions?: readonly string[];
    readonly config?: boolean;
}

export interface ZenexAutomaticResync {
    readonly plan: ZenexResyncPlan;
    /** Atomically replace application state from this complete read set. */
    readonly onResult: (
        result: ZenexResyncResult,
        event: Extract<StreamEvent, { type: 'resync-required' }>,
    ) => void | Promise<void>;
}

export interface ZenexEventStreamOptions {
    readonly scopes: readonly ZenexStreamScope[];
    readonly lastEventId?: string | bigint;
    readonly signal?: AbortSignal;
    readonly reconnectDelayMs?: number;
    readonly resync?: ZenexAutomaticResync;
}

/** The server required an authoritative reread and no automatic plan was supplied. */
export class ZenexResyncRequiredError extends Error {
    constructor(
        readonly event: Extract<StreamEvent, { type: 'resync-required' }>,
    ) {
        super(`Zenex stream requires resync: ${event.data.reason}`);
        this.name = 'ZenexResyncRequiredError';
    }
}

/** The SSE wire representation violated the exact durable-stream protocol. */
export class ZenexStreamProtocolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ZenexStreamProtocolError';
    }
}

export class ZenexStreamHttpError extends Error {
    constructor(
        readonly status: number,
        readonly retryable: boolean,
    ) {
        super(`Zenex event stream returned HTTP ${status}`);
        this.name = 'ZenexStreamHttpError';
    }
}

interface RawSseEvent {
    readonly id?: string;
    readonly event?: string;
    readonly data: string;
}

function requireScope(scope: string): ZenexStreamScope {
    if (!STREAM_SCOPE.test(scope) || scope.length > 512) {
        throw new TypeError(`Invalid Zenex stream scope: ${scope}`);
    }
    if (scope.startsWith('config:') && scope !== 'config:public') {
        throw new TypeError('The only public config scope is config:public');
    }
    return scope as ZenexStreamScope;
}

/** Build unique, bounded durable stream scopes from active application views. */
export function buildZenexStreamScopes(
    active: ZenexActiveScopes,
): readonly ZenexStreamScope[] {
    const scopes = [
        ...(active.accounts ?? []).map((value) => `account:${value}`),
        ...(active.markets ?? []).map((value) => `market:${value}`),
        ...(active.prices ?? []).map((value) => {
            if (typeof value !== 'bigint' || value < 0n) {
                throw new TypeError(
                    'price scope feed IDs must be unsigned bigint values',
                );
            }
            return `price:${value}`;
        }),
        ...(active.leaderboards ?? []).map((value) => `leaderboard:${value}`),
        ...(active.competitions ?? []).map((value) => `competition:${value}`),
        ...(active.config ? ['config:public'] : []),
    ].map(requireScope);
    const unique = [...new Set(scopes)];
    if (unique.length === 0 || unique.length > MAX_STREAM_SCOPES) {
        throw new TypeError('A stream requires 1 through 32 unique scopes');
    }
    return unique;
}

function validateScopes(
    scopes: readonly ZenexStreamScope[],
): readonly ZenexStreamScope[] {
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > 32) {
        throw new TypeError('A stream requires 1 through 32 scopes');
    }
    const validated = scopes.map(requireScope);
    if (new Set(validated).size !== validated.length) {
        throw new TypeError('Stream scopes must be unique');
    }
    return validated;
}

function scopeParts(scope: ZenexStreamScope): readonly [string, string] {
    const separator = scope.indexOf(':');
    return [scope.slice(0, separator), scope.slice(separator + 1)];
}

function assertResyncCoverage(
    scopes: readonly ZenexStreamScope[],
    plan: ZenexResyncPlan,
): void {
    for (const scope of scopes) {
        const [kind, key] = scopeParts(scope);
        const covered =
            (kind === 'account' &&
                plan.accounts?.some((target) => target.account === key)) ||
            (kind === 'market' &&
                plan.markets?.some((target) => target.market === key)) ||
            (kind === 'price' &&
                CURSOR.test(key) &&
                plan.prices?.some((feed) => feed === BigInt(key))) ||
            (kind === 'leaderboard' &&
                plan.leaderboards?.some((target) => target.window === key)) ||
            (kind === 'competition' &&
                plan.competitions?.some((target) => target.id === key)) ||
            (kind === 'config' && key === 'public' && plan.config === true);
        if (!covered) {
            throw new TypeError(
                `Automatic resync plan does not cover ${scope}`,
            );
        }
    }
}

function cursorString(value: string | bigint | undefined): string | undefined {
    if (value === undefined) return undefined;
    const encoded = String(value);
    if (!CURSOR.test(encoded)) {
        throw new TypeError('lastEventId must be a canonical unsigned integer');
    }
    return encoded;
}

function streamUrl(baseUrl: URL, scopes: readonly ZenexStreamScope[]): URL {
    const url = new URL('v1/stream', baseUrl);
    for (const scope of scopes) url.searchParams.append('scope', scope);
    return url;
}

function dispatch(lines: readonly string[]): RawSseEvent | undefined {
    let id: string | undefined;
    let event: string | undefined;
    const data: string[] = [];
    for (const line of lines) {
        if (line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const raw = separator < 0 ? '' : line.slice(separator + 1);
        const value = raw.startsWith(' ') ? raw.slice(1) : raw;
        if (field === 'data') data.push(value);
        if (field === 'event') event = value;
        if (field === 'id' && !value.includes('\0')) id = value;
    }
    if (data.length === 0) return undefined;
    return { id, event, data: data.join('\n') };
}

async function* readSse(
    response: Response,
): AsyncGenerator<RawSseEvent, void, undefined> {
    if (response.body === null) {
        throw new ZenexStreamProtocolError('SSE response has no body');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let lines: string[] = [];
    let dataLength = 0;
    let wireLength = 0;
    const processLine = (line: string): RawSseEvent | undefined => {
        if (line.length === 0) {
            const event = dispatch(lines);
            lines = [];
            dataLength = 0;
            wireLength = 0;
            return event;
        }
        wireLength += line.length + 1;
        if (wireLength > MAX_EVENT_WIRE_LENGTH) {
            throw new ZenexStreamProtocolError('SSE event is too large');
        }
        lines.push(line);
        if (line.startsWith('data:')) dataLength += line.length;
        if (dataLength > MAX_EVENT_DATA_LENGTH) {
            throw new ZenexStreamProtocolError('SSE event data is too large');
        }
        return undefined;
    };
    const drainLines = function* (
        atEof: boolean,
    ): Generator<RawSseEvent, void, undefined> {
        while (true) {
            const match = /\r\n|\r|\n/.exec(buffer);
            if (match === null || match.index === undefined) return;
            if (
                !atEof &&
                match[0] === '\r' &&
                match.index + 1 === buffer.length
            ) {
                return;
            }
            const event = processLine(buffer.slice(0, match.index));
            buffer = buffer.slice(match.index + match[0].length);
            if (event !== undefined) yield event;
        }
    };

    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            try {
                buffer += decoder.decode(chunk.value, { stream: true });
            } catch {
                throw new ZenexStreamProtocolError(
                    'SSE body is not valid UTF-8',
                );
            }
            for (const event of drainLines(false)) yield event;
            if (buffer.length > MAX_EVENT_WIRE_LENGTH) {
                throw new ZenexStreamProtocolError(
                    'SSE contains an oversized unterminated line',
                );
            }
        }
        try {
            buffer += decoder.decode();
        } catch {
            throw new ZenexStreamProtocolError('SSE body is not valid UTF-8');
        }
        for (const event of drainLines(true)) yield event;
        // A remaining buffer or event without a blank-line delimiter is
        // incomplete. Discard it so a truncated cursor cannot be committed.
    } finally {
        await reader.cancel().catch(() => undefined);
    }
}

function validateEvent(
    raw: RawSseEvent,
    requestedScopes: ReadonlySet<string>,
): StreamEvent {
    if (raw.id === undefined || !EVENT_ID.test(raw.id)) {
        throw new ZenexStreamProtocolError(
            'SSE event ID is missing or invalid',
        );
    }
    if (raw.event === undefined || raw.event.length === 0) {
        throw new ZenexStreamProtocolError('SSE event name is missing');
    }
    let json: unknown;
    try {
        json = JSON.parse(raw.data);
    } catch {
        throw new ZenexStreamProtocolError('SSE data is not valid JSON');
    }
    let event: StreamEvent;
    try {
        event = decodeApiSchema('StreamEvent', json);
    } catch {
        throw new ZenexStreamProtocolError(
            'SSE data does not match the StreamEvent schema',
        );
    }
    if (event.id !== raw.id || event.type !== raw.event) {
        throw new ZenexStreamProtocolError(
            'SSE fields do not match the event envelope',
        );
    }
    if (!requestedScopes.has(event.scope)) {
        throw new ZenexStreamProtocolError(
            'SSE event belongs to an unrequested scope',
        );
    }
    if (
        !event.resourcePath.startsWith('/') ||
        !event.data.resourcePath.startsWith('/') ||
        event.resourcePath !== event.data.resourcePath
    ) {
        throw new ZenexStreamProtocolError(
            'SSE resource paths are inconsistent',
        );
    }
    const family = event.type.split('.')[0];
    if (
        (family === 'account' && !event.scope.startsWith('account:')) ||
        (family === 'market' && !event.scope.startsWith('market:')) ||
        (family === 'leaderboard' && !event.scope.startsWith('leaderboard:')) ||
        (family === 'competition' && !event.scope.startsWith('competition:')) ||
        (family === 'config' && event.scope !== 'config:public')
    ) {
        throw new ZenexStreamProtocolError('SSE type does not match its scope');
    }
    const [, scopeKey] = scopeParts(event.scope as ZenexStreamScope);
    const encodedKey = encodeURIComponent(scopeKey);
    const expectedPaths: Partial<
        Record<StreamEvent['type'], readonly string[]>
    > = {
        'account.orders.changed': [
            `/v1/accounts/${scopeKey}/orders`,
            `/v1/accounts/${encodedKey}/orders`,
        ],
        'account.fills.changed': [
            `/v1/accounts/${scopeKey}/fills`,
            `/v1/accounts/${encodedKey}/fills`,
        ],
        'account.vaultOrders.changed': [
            `/v1/accounts/${scopeKey}/vault-orders`,
            `/v1/accounts/${encodedKey}/vault-orders`,
        ],
        'account.lifecycles.changed': [
            `/v1/accounts/${scopeKey}/lifecycles`,
            `/v1/accounts/${encodedKey}/lifecycles`,
        ],
        'market.trades.changed': [
            `/v1/markets/${scopeKey}/trades`,
            `/v1/markets/${encodedKey}/trades`,
        ],
        'market.snapshots.changed': [
            `/v1/markets/${scopeKey}/snapshots`,
            `/v1/markets/${encodedKey}/snapshots`,
        ],
        'leaderboard.snapshot.changed': [
            `/v1/leaderboards/rolling/${scopeKey}`,
            `/v1/leaderboards/rolling/${encodedKey}`,
        ],
        'competition.snapshot.changed': [
            `/v1/competitions/${scopeKey}/standings`,
            `/v1/competitions/${encodedKey}/standings`,
        ],
        'config.changed': ['/v1/config'],
        'price.tick': [
            `/v1/prices/${scopeKey}/latest`,
            `/v1/prices/${encodedKey}/latest`,
        ],
        'resync-required': ['/v1/stream'],
    };
    if (!expectedPaths[event.type]?.includes(event.resourcePath)) {
        throw new ZenexStreamProtocolError(
            'SSE resource path does not match its scoped event type',
        );
    }
    if (
        event.type === 'price.tick' &&
        event.scope !== `price:${event.data.feedId}`
    ) {
        throw new ZenexStreamProtocolError(
            'Price event feed does not match its scope',
        );
    }
    return event;
}

function retryDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (milliseconds === 0 || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        const finish = () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', finish);
            resolve();
        };
        const timeout = setTimeout(finish, milliseconds);
        signal?.addEventListener('abort', finish, { once: true });
    });
}

async function openStream(
    fetch: ZenexFetch,
    url: URL,
    cursor: string | undefined,
    signal: AbortSignal | undefined,
): Promise<Response> {
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (cursor !== undefined) headers['last-event-id'] = cursor;
    const response = await fetch(url, { method: 'GET', headers, signal });
    if (!response.ok) {
        throw new ZenexStreamHttpError(
            response.status,
            response.status === 408 ||
                response.status === 429 ||
                response.status >= 500,
        );
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new ZenexStreamProtocolError(
            'Stream response content type is not text/event-stream',
        );
    }
    return response;
}

/**
 * Consume durable scoped SSE events. Invalidation events never mutate SDK or
 * application state. A resync either runs the complete supplied read plan and
 * retains the resync event as its high-water cursor, or fails with
 * `ZenexResyncRequiredError`.
 */
export async function* streamZenexEvents(
    client: ZenexDataClient,
    options: ZenexEventStreamOptions,
): AsyncGenerator<StreamEvent, void, undefined> {
    const scopes = validateScopes(options.scopes);
    if (options.resync !== undefined) {
        assertResyncCoverage(scopes, options.resync.plan);
    }
    const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    if (
        !Number.isInteger(reconnectDelayMs) ||
        reconnectDelayMs < 0 ||
        reconnectDelayMs > 60_000
    ) {
        throw new TypeError(
            'reconnectDelayMs must be an integer from 0 through 60000',
        );
    }
    const requestedScopes = new Set<string>(scopes);
    const { baseUrl, fetch } = client.transport;
    const url = streamUrl(baseUrl, scopes);
    let cursor = cursorString(options.lastEventId ?? 0n);

    while (!options.signal?.aborted) {
        let response: Response;
        try {
            response = await openStream(fetch, url, cursor, options.signal);
        } catch (error) {
            if (options.signal?.aborted) return;
            if (
                error instanceof ZenexStreamProtocolError ||
                (error instanceof ZenexStreamHttpError && !error.retryable)
            ) {
                throw error;
            }
            await retryDelay(reconnectDelayMs, options.signal);
            continue;
        }

        let resynced = false;
        let resyncing = false;
        try {
            for await (const raw of readSse(response)) {
                const event = validateEvent(raw, requestedScopes);
                if (
                    cursor !== undefined &&
                    BigInt(event.id) <= BigInt(cursor)
                ) {
                    throw new ZenexStreamProtocolError(
                        'SSE event IDs must increase beyond the durable cursor',
                    );
                }
                cursor = event.id;
                if (event.type === 'resync-required') {
                    if (options.resync === undefined) {
                        throw new ZenexResyncRequiredError(event);
                    }
                    resyncing = true;
                    const result = await executeZenexResync(
                        client,
                        options.resync.plan,
                    );
                    await options.resync.onResult(result, event);
                    resyncing = false;
                    cursor = event.id;
                    resynced = true;
                    yield event;
                    break;
                }
                yield event;
            }
        } catch (error) {
            if (options.signal?.aborted) return;
            if (
                error instanceof ZenexStreamProtocolError ||
                error instanceof ZenexResyncRequiredError ||
                resyncing
            ) {
                throw error;
            }
        }
        if (!resynced) await retryDelay(reconnectDelayMs, options.signal);
    }
}
