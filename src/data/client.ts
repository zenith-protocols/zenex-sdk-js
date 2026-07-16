import type { RelayRequest as ValidatedRelayRequest } from '../relay/types.js';
import {
    decodeApiSchema,
    tryDecodeErrorEnvelope,
    ZenexDataDecodeError,
} from './codec.js';
import { streamZenexEvents, type ZenexEventStreamOptions } from './events.js';
import type {
    AccountFillQuery,
    AccountFillsResponse,
    AccountLifecycleQuery,
    AccountLifecyclesResponse,
    AccountOrderQuery,
    AccountOrdersResponse,
    AccountVaultOrderQuery,
    CandleQuery,
    CandlesResponse,
    CompetitionDetailResponse,
    CompetitionLifecyclesResponse,
    CompetitionListQuery,
    CompetitionListResponse,
    CompetitionStandingsResponse,
    FaucetClaimResponse,
    FaucetStatusResponse,
    LatestPriceResponse,
    LifecyclePageQuery,
    MarketSnapshotQuery,
    MarketSnapshotsResponse,
    MarketTradeQuery,
    MarketTradesResponse,
    PageQuery,
    PublicConfigResponse,
    ReferralCodeResponse,
    ReferralLookupResponse,
    ReferralStatsResponse,
    RelayStatusResponse,
    RelaySubmitResponse,
    RollingLifecyclesResponse,
    RollingStandingsResponse,
    RollingWindow,
    UdfConfigResponse,
    UdfHistoryResponse,
    UdfQuery,
    UdfSearchResponse,
    UdfSymbolResponse,
    VaultOrdersResponse,
    VaultPerformanceQuery,
    VaultPerformanceResponse,
} from './generated.js';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]+$/;
const REFERRAL_CODE = /^[A-Za-z0-9]{8}$/;
const UDF_SYMBOL = /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const RESOLUTIONS = new Set(['1', '5', '15', '60', '240', '1D']);
const WINDOWS = new Set(['1d', '7d', '30d', '90d', 'all']);
const SIDES = new Set(['long', 'short']);
const ORDER_STATUSES = new Set([
    'pending',
    'filled',
    'cancelled',
    'cleared',
    'expired',
]);
const VAULT_ORDER_STATUSES = new Set([
    'pending',
    'filled',
    'cancelled',
    'expired',
]);
const COMPETITION_STATES = new Set([
    'scheduled',
    'active',
    'finalized',
    'cancelled',
]);
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CONFIGURABLE_RESPONSE_BYTES = 64 * 1024 * 1024;

export type ZenexFetch = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>;

export interface ZenexDataClientOptions {
    readonly baseUrl: string | URL;
    readonly fetch?: ZenexFetch;
    /** Default finite timeout for JSON requests. Durable streams are separate. */
    readonly requestTimeoutMs?: number;
    /** Maximum decoded JSON response bytes, bounded to 64 MiB. */
    readonly maxResponseBytes?: number;
}

export interface ZenexRequestOptions {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
}

/** Structured non-success response returned by the Zenex API. */
export class ZenexApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly requestId?: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'ZenexApiError';
    }
}

/**
 * Relay submission may have reached durable storage even though no authoritative
 * response arrived. Poll `getRelayRequest(requestId)` before deciding to retry.
 */
export class RelaySubmissionAmbiguousError extends ZenexApiError {
    readonly relayRequestId: string;

    constructor(requestId: string, options?: ErrorOptions) {
        super(
            0,
            'RELAY_SUBMISSION_AMBIGUOUS',
            `Relay submission outcome is ambiguous for ${requestId}; poll the durable relay status`,
            requestId,
            options,
        );
        this.name = 'RelaySubmissionAmbiguousError';
        this.relayRequestId = requestId;
    }
}

/** A JSON route exceeded the client's configured response byte ceiling. */
export class ZenexResponseTooLargeError extends Error {
    constructor(
        readonly limitBytes: number,
        readonly observedBytes: bigint,
    ) {
        super(
            `Zenex API response exceeded ${limitBytes} bytes (observed at least ${observedBytes})`,
        );
        this.name = 'ZenexResponseTooLargeError';
    }
}

type Query = object;

function requireIdentifier(
    value: string,
    label: string,
    maximum = 256,
): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximum
    ) {
        throw new TypeError(`${label} must contain 1 to ${maximum} characters`);
    }
    return value;
}

function requireUuid(value: string, label = 'requestId'): string {
    if (typeof value !== 'string' || !UUID.test(value)) {
        throw new TypeError(`${label} must be an RFC 4122 UUID`);
    }
    return value;
}

function requireUnsigned(value: bigint, label: string): bigint {
    if (typeof value !== 'bigint' || value < 0n) {
        throw new TypeError(`${label} must be an unsigned bigint`);
    }
    return value;
}

function validateOptionalIdentifier(
    value: string | undefined,
    label: string,
    maximum = 256,
): void {
    if (value !== undefined) requireIdentifier(value, label, maximum);
}

function validateOptionalEnum(
    value: string | undefined,
    label: string,
    allowed: ReadonlySet<string>,
): void {
    if (value !== undefined && !allowed.has(value)) {
        throw new TypeError(`${label} is invalid`);
    }
}

function validateOptionalStringArray(
    value: readonly string[] | undefined,
    label: string,
    allowed: ReadonlySet<string>,
    maximum: number,
): void {
    if (value === undefined) return;
    if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > maximum ||
        value.some((item) => typeof item !== 'string' || !allowed.has(item))
    ) {
        throw new TypeError(
            `${label} must contain 1 to ${maximum} valid values`,
        );
    }
}

function requireUdfSymbol(value: string): string {
    if (typeof value !== 'string' || !UDF_SYMBOL.test(value)) {
        throw new TypeError('symbol must be a canonical UDF symbol');
    }
    return value;
}

function requireInteger(
    value: number | undefined,
    label: string,
    minimum: number,
    maximum: number,
): void {
    if (
        value !== undefined &&
        (!Number.isInteger(value) || value < minimum || value > maximum)
    ) {
        throw new TypeError(
            `${label} must be an integer from ${minimum} through ${maximum}`,
        );
    }
}

function requireTimeout(value: number, label: string): number {
    if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_REQUEST_TIMEOUT_MS
    ) {
        throw new TypeError(
            `${label} must be an integer from 1 through ${MAX_REQUEST_TIMEOUT_MS}`,
        );
    }
    return value;
}

function requireResponseLimit(value: number): number {
    if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_CONFIGURABLE_RESPONSE_BYTES
    ) {
        throw new TypeError(
            `maxResponseBytes must be an integer from 1 through ${MAX_CONFIGURABLE_RESPONSE_BYTES}`,
        );
    }
    return value;
}

function requestAbortContext(
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
): Readonly<{ signal: AbortSignal; dispose: () => void }> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
        abortFromCaller();
    } else {
        callerSignal?.addEventListener('abort', abortFromCaller, {
            once: true,
        });
    }
    const timeout = controller.signal.aborted
        ? undefined
        : setTimeout(
              () =>
                  controller.abort(
                      new DOMException(
                          `Zenex API request timed out after ${timeoutMs}ms`,
                          'TimeoutError',
                      ),
                  ),
              timeoutMs,
          );
    return {
        signal: controller.signal,
        dispose() {
            if (timeout !== undefined) clearTimeout(timeout);
            callerSignal?.removeEventListener('abort', abortFromCaller);
        },
    };
}

async function readBoundedText(
    response: Response,
    schema: Parameters<typeof decodeApiSchema>[0],
    limitBytes: number,
): Promise<string> {
    const declaredHeader = response.headers.get('content-length');
    if (declaredHeader !== null && /^(0|[1-9][0-9]*)$/.test(declaredHeader)) {
        const declaredBytes = BigInt(declaredHeader);
        if (declaredBytes > BigInt(limitBytes)) {
            if (response.body !== null) {
                await response.body.cancel().catch(() => undefined);
            }
            throw new ZenexResponseTooLargeError(limitBytes, declaredBytes);
        }
    }
    if (response.body === null) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const chunks: string[] = [];
    let observedBytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            observedBytes += chunk.value.byteLength;
            if (observedBytes > limitBytes) {
                throw new ZenexResponseTooLargeError(
                    limitBytes,
                    BigInt(observedBytes),
                );
            }
            if (chunk.value.byteLength > 0) {
                try {
                    chunks.push(decoder.decode(chunk.value, { stream: true }));
                } catch {
                    throw new ZenexDataDecodeError(
                        schema,
                        '/',
                        'response body is not valid UTF-8',
                    );
                }
            }
        }
        try {
            chunks.push(decoder.decode());
        } catch {
            throw new ZenexDataDecodeError(
                schema,
                '/',
                'response body is not valid UTF-8',
            );
        }
        return chunks.join('');
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    } finally {
        reader.releaseLock();
    }
}

function validatePage(query: PageQuery = {}): void {
    requireInteger(query.limit, 'limit', 1, 100);
    if (
        query.cursor !== undefined &&
        (typeof query.cursor !== 'string' ||
            query.cursor.length < 2 ||
            query.cursor.length > 2048 ||
            !CURSOR.test(query.cursor) ||
            query.cursor.length % 4 === 1)
    ) {
        throw new TypeError('cursor must be an unpadded base64url value');
    }
}

function pathPart(value: string, label: string, maximum = 256): string {
    const identifier = requireIdentifier(value, label, maximum);
    if (identifier === '.' || identifier === '..') {
        throw new TypeError(`${label} must not be a URL dot segment`);
    }
    return encodeURIComponent(identifier);
}

function appendQuery(url: URL, query: Query): void {
    for (const [name, value] of Object.entries(
        query as Readonly<Record<string, unknown>>,
    )) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item !== 'string') {
                    throw new TypeError(`${name} query values must be strings`);
                }
                url.searchParams.append(name, item);
            }
        } else if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'bigint'
        ) {
            url.searchParams.set(name, String(value));
        } else {
            throw new TypeError(`${name} is not a valid query value`);
        }
    }
}

function normalizeBaseUrl(value: string | URL): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError('baseUrl must use http or https');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new TypeError(
            'baseUrl must not contain credentials, query, or hash',
        );
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url;
}

function generatedRequestId(): string {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new Error(
            'crypto.randomUUID is unavailable; provide an explicit requestId',
        );
    }
    return globalThis.crypto.randomUUID();
}

export class ZenexDataClient {
    readonly #baseUrl: URL;
    readonly #fetch: ZenexFetch;
    readonly #requestTimeoutMs: number;
    readonly #maxResponseBytes: number;

    constructor(options: ZenexDataClientOptions) {
        this.#baseUrl = normalizeBaseUrl(options.baseUrl);
        const implementation = options.fetch ?? globalThis.fetch;
        if (typeof implementation !== 'function') {
            throw new TypeError(
                'A Fetch-compatible implementation is required',
            );
        }
        this.#fetch = (options.fetch ??
            implementation.bind(globalThis)) as ZenexFetch;
        this.#requestTimeoutMs = requireTimeout(
            options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
            'requestTimeoutMs',
        );
        this.#maxResponseBytes = requireResponseLimit(
            options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        );
    }

    /** Internal transport details used by the scoped SSE helper. */
    get transport(): Readonly<{ baseUrl: URL; fetch: ZenexFetch }> {
        return { baseUrl: new URL(this.#baseUrl), fetch: this.#fetch };
    }

    #url(path: string, query: Query = {}): URL {
        const url = new URL(path.replace(/^\//, ''), this.#baseUrl);
        appendQuery(url, query);
        return url;
    }

    async #request<Name extends Parameters<typeof decodeApiSchema>[0]>(
        schema: Name,
        method: 'GET' | 'POST',
        path: string,
        query: Query = {},
        body?: unknown,
        requestOptions: ZenexRequestOptions = {},
    ): Promise<ReturnType<typeof decodeApiSchema<Name>>> {
        const timeoutMs = requireTimeout(
            requestOptions.timeoutMs ?? this.#requestTimeoutMs,
            'timeoutMs',
        );
        const context = requestAbortContext(timeoutMs, requestOptions.signal);
        try {
            const response = await this.#fetch(this.#url(path, query), {
                method,
                headers:
                    body === undefined
                        ? { accept: 'application/json' }
                        : {
                              accept: 'application/json',
                              'content-type': 'application/json',
                          },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: context.signal,
            });
            let text: string;
            try {
                text = await readBoundedText(
                    response,
                    schema,
                    this.#maxResponseBytes,
                );
            } catch (error) {
                if (!response.ok && error instanceof ZenexDataDecodeError) {
                    throw new ZenexApiError(
                        response.status,
                        `HTTP_${response.status}`,
                        `Zenex API returned a malformed HTTP ${response.status} body`,
                        undefined,
                        { cause: error },
                    );
                }
                throw error;
            }
            let parsed: unknown;
            try {
                parsed = text.length === 0 ? undefined : JSON.parse(text);
            } catch {
                if (!response.ok) {
                    throw new ZenexApiError(
                        response.status,
                        `HTTP_${response.status}`,
                        `Zenex API returned non-JSON HTTP ${response.status}`,
                    );
                }
                throw new ZenexDataDecodeError(
                    schema,
                    '/',
                    'response body is not valid JSON',
                );
            }
            if (!response.ok) {
                const envelope = tryDecodeErrorEnvelope(parsed);
                throw new ZenexApiError(
                    response.status,
                    envelope?.error.code ?? `HTTP_${response.status}`,
                    envelope?.error.message ??
                        `Zenex API HTTP ${response.status}`,
                    envelope?.error.requestId,
                );
            }
            return decodeApiSchema(schema, parsed) as ReturnType<
                typeof decodeApiSchema<Name>
            >;
        } finally {
            context.dispose();
        }
    }

    async getConfig(
        options: ZenexRequestOptions = {},
    ): Promise<PublicConfigResponse> {
        return this.#request(
            'PublicConfigResponse',
            'GET',
            '/v1/config',
            {},
            undefined,
            options,
        );
    }

    async getAccountOrders(
        account: string,
        query: AccountOrderQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<AccountOrdersResponse> {
        validatePage(query);
        validateOptionalStringArray(query.status, 'status', ORDER_STATUSES, 5);
        validateOptionalIdentifier(query.market, 'market');
        return this.#request(
            'AccountOrdersResponse',
            'GET',
            `/v1/accounts/${pathPart(account, 'account', 128)}/orders`,
            query,
            undefined,
            options,
        );
    }

    /**
     * Fetch decoded account fills.
     *
     * Each fill's `pnlAtomic` is gross PnL. Use
     * `deriveAccountFillNetPnl` for complete, checked net economics.
     */
    async getAccountFills(
        account: string,
        query: AccountFillQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<AccountFillsResponse> {
        validatePage(query);
        validateOptionalIdentifier(query.market, 'market');
        validateOptionalEnum(query.side, 'side', SIDES);
        return this.#request(
            'AccountFillsResponse',
            'GET',
            `/v1/accounts/${pathPart(account, 'account', 128)}/fills`,
            query,
            undefined,
            options,
        );
    }

    async getAccountVaultOrders(
        account: string,
        query: AccountVaultOrderQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<VaultOrdersResponse> {
        validatePage(query);
        validateOptionalStringArray(
            query.status,
            'status',
            VAULT_ORDER_STATUSES,
            4,
        );
        validateOptionalIdentifier(query.market, 'market');
        validateOptionalIdentifier(query.vault, 'vault', 128);
        if (query.market !== undefined && query.vault !== undefined) {
            throw new TypeError(
                'market and vault filters are mutually exclusive',
            );
        }
        return this.#request(
            'VaultOrdersResponse',
            'GET',
            `/v1/accounts/${pathPart(account, 'account', 128)}/vault-orders`,
            query,
            undefined,
            options,
        );
    }

    async getAccountLifecycles(
        account: string,
        query: AccountLifecycleQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<AccountLifecyclesResponse> {
        validatePage(query);
        validateOptionalIdentifier(query.market, 'market');
        validateOptionalEnum(query.side, 'side', SIDES);
        return this.#request(
            'AccountLifecyclesResponse',
            'GET',
            `/v1/accounts/${pathPart(account, 'account', 128)}/lifecycles`,
            query,
            undefined,
            options,
        );
    }

    async getReferralCode(
        account: string,
        options: ZenexRequestOptions = {},
    ): Promise<ReferralCodeResponse> {
        return this.#request(
            'ReferralCodeResponse',
            'GET',
            `/v1/referrals/code/${pathPart(account, 'account', 128)}`,
            {},
            undefined,
            options,
        );
    }

    async lookupReferralCode(
        code: string,
        options: ZenexRequestOptions = {},
    ): Promise<ReferralLookupResponse> {
        if (!REFERRAL_CODE.test(code)) {
            throw new TypeError(
                'referral code must contain eight alphanumeric characters',
            );
        }
        return this.#request(
            'ReferralLookupResponse',
            'GET',
            `/v1/referrals/lookup/${encodeURIComponent(code)}`,
            {},
            undefined,
            options,
        );
    }

    async getReferralStats(
        account: string,
        options: ZenexRequestOptions = {},
    ): Promise<ReferralStatsResponse> {
        return this.#request(
            'ReferralStatsResponse',
            'GET',
            `/v1/referrals/stats/${pathPart(account, 'account', 128)}`,
            {},
            undefined,
            options,
        );
    }

    async getFaucetStatus(
        account: string,
        options: ZenexRequestOptions = {},
    ): Promise<FaucetStatusResponse> {
        return this.#request(
            'FaucetStatusResponse',
            'GET',
            `/v1/faucet/status/${pathPart(account, 'account', 128)}`,
            {},
            undefined,
            options,
        );
    }

    async claimFaucet(
        account: string,
        requestId?: string,
        options: ZenexRequestOptions = {},
    ): Promise<FaucetClaimResponse> {
        requireIdentifier(account, 'account', 128);
        const validatedRequestId = requireUuid(
            requestId ?? generatedRequestId(),
        );
        return this.#request(
            'FaucetClaimResponse',
            'POST',
            '/v1/faucet/claim',
            {},
            {
                requestId: validatedRequestId,
                account,
            },
            options,
        );
    }

    async getMarketTrades(
        market: string,
        query: MarketTradeQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<MarketTradesResponse> {
        validatePage(query);
        return this.#request(
            'MarketTradesResponse',
            'GET',
            `/v1/markets/${pathPart(market, 'market')}/trades`,
            query,
            undefined,
            options,
        );
    }

    async getMarketSnapshots(
        market: string,
        query: MarketSnapshotQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<MarketSnapshotsResponse> {
        validatePage(query);
        if (query.from !== undefined && typeof query.from !== 'bigint') {
            throw new TypeError('from must be a bigint');
        }
        if (query.to !== undefined && typeof query.to !== 'bigint') {
            throw new TypeError('to must be a bigint');
        }
        return this.#request(
            'MarketSnapshotsResponse',
            'GET',
            `/v1/markets/${pathPart(market, 'market')}/snapshots`,
            query,
            undefined,
            options,
        );
    }

    async getVaultPerformance(
        vault: string,
        query: VaultPerformanceQuery,
        options: ZenexRequestOptions = {},
    ): Promise<VaultPerformanceResponse> {
        if (!WINDOWS.has(query.window))
            throw new TypeError('window is invalid');
        return this.#request(
            'VaultPerformanceResponse',
            'GET',
            `/v1/vaults/${pathPart(vault, 'vault')}/performance`,
            query,
            undefined,
            options,
        );
    }

    async getRollingStandings(
        window: RollingWindow,
        query: PageQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<RollingStandingsResponse> {
        validatePage(query);
        if (!WINDOWS.has(window)) throw new TypeError('window is invalid');
        return this.#request(
            'RollingStandingsResponse',
            'GET',
            `/v1/leaderboards/rolling/${window}`,
            query,
            undefined,
            options,
        );
    }

    async getRollingLifecycles(
        window: RollingWindow,
        query: LifecyclePageQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<RollingLifecyclesResponse> {
        validatePage(query);
        if (!WINDOWS.has(window)) throw new TypeError('window is invalid');
        return this.#request(
            'RollingLifecyclesResponse',
            'GET',
            `/v1/leaderboards/rolling/${window}/lifecycles`,
            query,
            undefined,
            options,
        );
    }

    async listCompetitions(
        query: CompetitionListQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<CompetitionListResponse> {
        validatePage(query);
        validateOptionalStringArray(
            query.state,
            'state',
            COMPETITION_STATES,
            4,
        );
        return this.#request(
            'CompetitionListResponse',
            'GET',
            '/v1/competitions',
            query,
            undefined,
            options,
        );
    }

    async getCompetition(
        id: string,
        options: ZenexRequestOptions = {},
    ): Promise<CompetitionDetailResponse> {
        return this.#request(
            'CompetitionDetailResponse',
            'GET',
            `/v1/competitions/${pathPart(id, 'competition')}`,
            {},
            undefined,
            options,
        );
    }

    async getCompetitionStandings(
        id: string,
        query: PageQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<CompetitionStandingsResponse> {
        validatePage(query);
        return this.#request(
            'CompetitionStandingsResponse',
            'GET',
            `/v1/competitions/${pathPart(id, 'competition')}/standings`,
            query,
            undefined,
            options,
        );
    }

    async getCompetitionLifecycles(
        id: string,
        query: LifecyclePageQuery = {},
        options: ZenexRequestOptions = {},
    ): Promise<CompetitionLifecyclesResponse> {
        validatePage(query);
        return this.#request(
            'CompetitionLifecyclesResponse',
            'GET',
            `/v1/competitions/${pathPart(id, 'competition')}/lifecycles`,
            query,
            undefined,
            options,
        );
    }

    async getLatestPrice(
        feed: bigint,
        options: ZenexRequestOptions = {},
    ): Promise<LatestPriceResponse> {
        return this.#request(
            'LatestPriceResponse',
            'GET',
            `/v1/prices/${requireUnsigned(feed, 'feed')}/latest`,
            {},
            undefined,
            options,
        );
    }

    async getCandles(
        query: CandleQuery,
        options: ZenexRequestOptions = {},
    ): Promise<CandlesResponse> {
        if (!RESOLUTIONS.has(query.resolution)) {
            throw new TypeError('resolution is invalid');
        }
        if (typeof query.from !== 'bigint' || typeof query.to !== 'bigint') {
            throw new TypeError('from and to must be bigint values');
        }
        if ((query.feed === undefined) === (query.symbol === undefined)) {
            throw new TypeError('exactly one of feed or symbol is required');
        }
        if (query.feed !== undefined) requireUnsigned(query.feed, 'feed');
        if (query.symbol !== undefined) requireUdfSymbol(query.symbol);
        requireInteger(query.countback, 'countback', 1, 5000);
        return this.#request(
            'CandlesResponse',
            'GET',
            '/v1/candles',
            query,
            undefined,
            options,
        );
    }

    async getUdfConfig(
        options: ZenexRequestOptions = {},
    ): Promise<UdfConfigResponse> {
        return this.#request(
            'UdfConfigResponse',
            'GET',
            '/udf/config',
            {},
            undefined,
            options,
        );
    }

    async searchUdfSymbols(
        query: UdfQuery<'search'> = {},
        options: ZenexRequestOptions = {},
    ): Promise<UdfSearchResponse> {
        requireInteger(query.limit, 'limit', 1, 100);
        for (const [name, value] of Object.entries(query)) {
            if (
                name !== 'limit' &&
                value !== undefined &&
                typeof value !== 'string'
            ) {
                throw new TypeError(`${name} must be a string`);
            }
        }
        return this.#request(
            'UdfSearchResponse',
            'GET',
            '/udf/search',
            query,
            undefined,
            options,
        );
    }

    async getUdfSymbol(
        query: UdfQuery<'symbols'>,
        options: ZenexRequestOptions = {},
    ): Promise<UdfSymbolResponse> {
        requireUdfSymbol(query.symbol);
        return this.#request(
            'UdfSymbolResponse',
            'GET',
            '/udf/symbols',
            query,
            undefined,
            options,
        );
    }

    async getUdfHistory(
        query: UdfQuery<'history'>,
        options: ZenexRequestOptions = {},
    ): Promise<UdfHistoryResponse> {
        if (!RESOLUTIONS.has(query.resolution)) {
            throw new TypeError('resolution is invalid');
        }
        requireUdfSymbol(query.symbol);
        requireInteger(query.from, 'from', 0, 4_294_967_295);
        requireInteger(query.to, 'to', 0, 4_294_967_295);
        requireInteger(query.countback, 'countback', 1, 5000);
        return this.#request(
            'UdfHistoryResponse',
            'GET',
            '/udf/history',
            query,
            undefined,
            options,
        );
    }

    async submitRelayRequest(
        request: ValidatedRelayRequest,
        options: ZenexRequestOptions = {},
    ): Promise<RelaySubmitResponse> {
        const requestId = requireUuid(request.requestId);
        try {
            return await this.#request(
                'RelaySubmitResponse',
                'POST',
                '/v1/relay/submit',
                {},
                request,
                options,
            );
        } catch (error) {
            if (
                error instanceof ZenexApiError &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 408
            ) {
                throw error;
            }
            throw new RelaySubmissionAmbiguousError(requestId, {
                cause: error,
            });
        }
    }

    async getRelayRequest(
        requestId: string,
        options: ZenexRequestOptions = {},
    ): Promise<RelayStatusResponse> {
        return this.#request(
            'RelayStatusResponse',
            'GET',
            `/v1/relay/requests/${requireUuid(requestId)}`,
            {},
            undefined,
            options,
        );
    }

    stream(options: ZenexEventStreamOptions) {
        return streamZenexEvents(this, options);
    }
}
