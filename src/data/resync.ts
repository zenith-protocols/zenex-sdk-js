import type { ZenexDataClient } from './client.js';
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
    LatestPriceResponse,
    LifecyclePageQuery,
    MarketSnapshotQuery,
    MarketSnapshotsResponse,
    MarketTradeQuery,
    MarketTradesResponse,
    PageQuery,
    PublicConfigResponse,
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

export interface AccountResyncTarget {
    readonly account: string;
    readonly orders?: AccountOrderQuery;
    readonly fills?: AccountFillQuery;
    readonly vaultOrders?: AccountVaultOrderQuery;
    readonly lifecycles?: AccountLifecycleQuery;
}

export interface MarketResyncTarget {
    readonly market: string;
    readonly trades?: MarketTradeQuery;
    readonly snapshots?: MarketSnapshotQuery;
}

export interface VaultResyncTarget {
    readonly vault: string;
    readonly performance: VaultPerformanceQuery;
}

export interface LeaderboardResyncTarget {
    readonly window: RollingWindow;
    readonly standings?: PageQuery;
    readonly lifecycles?: LifecyclePageQuery;
}

export interface CompetitionResyncTarget {
    readonly id: string;
    readonly standings?: PageQuery;
    readonly lifecycles?: LifecyclePageQuery;
}

export interface UdfResyncPlan {
    readonly config?: boolean;
    readonly searches?: readonly UdfQuery<'search'>[];
    readonly symbols?: readonly UdfQuery<'symbols'>[];
    readonly histories?: readonly UdfQuery<'history'>[];
}

/**
 * Exact authoritative reads to execute when a durable stream cursor is lost.
 * Entity targets intentionally refresh every related resource, using the
 * supplied query as that resource's active view.
 */
export interface ZenexResyncPlan {
    readonly config?: boolean;
    readonly accounts?: readonly AccountResyncTarget[];
    readonly markets?: readonly MarketResyncTarget[];
    readonly vaults?: readonly VaultResyncTarget[];
    readonly leaderboards?: readonly LeaderboardResyncTarget[];
    readonly competitionLists?: readonly CompetitionListQuery[];
    readonly competitions?: readonly CompetitionResyncTarget[];
    readonly prices?: readonly bigint[];
    readonly candles?: readonly CandleQuery[];
    readonly udf?: UdfResyncPlan;
}

export interface AccountResyncResult {
    readonly target: AccountResyncTarget;
    readonly orders: AccountOrdersResponse;
    readonly fills: AccountFillsResponse;
    readonly vaultOrders: VaultOrdersResponse;
    readonly lifecycles: AccountLifecyclesResponse;
}

export interface MarketResyncResult {
    readonly target: MarketResyncTarget;
    readonly trades: MarketTradesResponse;
    readonly snapshots: MarketSnapshotsResponse;
}

export interface LeaderboardResyncResult {
    readonly target: LeaderboardResyncTarget;
    readonly standings: RollingStandingsResponse;
    readonly lifecycles: RollingLifecyclesResponse;
}

export interface CompetitionResyncResult {
    readonly target: CompetitionResyncTarget;
    readonly detail: CompetitionDetailResponse;
    readonly standings: CompetitionStandingsResponse;
    readonly lifecycles: CompetitionLifecyclesResponse;
}

export interface UdfResyncResult {
    readonly config?: UdfConfigResponse;
    readonly searches: readonly UdfSearchResponse[];
    readonly symbols: readonly UdfSymbolResponse[];
    readonly histories: readonly UdfHistoryResponse[];
}

export interface ZenexResyncResult {
    readonly config?: PublicConfigResponse;
    readonly accounts: readonly AccountResyncResult[];
    readonly markets: readonly MarketResyncResult[];
    readonly vaults: readonly {
        readonly target: VaultResyncTarget;
        readonly performance: VaultPerformanceResponse;
    }[];
    readonly leaderboards: readonly LeaderboardResyncResult[];
    readonly competitionLists: readonly CompetitionListResponse[];
    readonly competitions: readonly CompetitionResyncResult[];
    readonly prices: readonly LatestPriceResponse[];
    readonly candles: readonly CandlesResponse[];
    readonly udf: UdfResyncResult;
}

const MAX_RESYNC_READS = 512;
const MAX_CONCURRENT_RESYNC_READS = 8;

function plannedArrayLength(value: unknown, label: string): number {
    if (value === undefined) return 0;
    if (!Array.isArray(value)) {
        throw new TypeError(`${label} must be an array`);
    }
    return value.length;
}

function plannedReadCount(plan: ZenexResyncPlan): number {
    if (!plan || typeof plan !== 'object') {
        throw new TypeError('resync plan must be an object');
    }
    if (plan.udf !== undefined && (!plan.udf || typeof plan.udf !== 'object')) {
        throw new TypeError('resync udf plan must be an object');
    }
    const udf = plan.udf ?? {};
    return (
        (plan.config ? 1 : 0) +
        plannedArrayLength(plan.accounts, 'accounts') * 4 +
        plannedArrayLength(plan.markets, 'markets') * 2 +
        plannedArrayLength(plan.vaults, 'vaults') +
        plannedArrayLength(plan.leaderboards, 'leaderboards') * 2 +
        plannedArrayLength(plan.competitionLists, 'competitionLists') +
        plannedArrayLength(plan.competitions, 'competitions') * 3 +
        plannedArrayLength(plan.prices, 'prices') +
        plannedArrayLength(plan.candles, 'candles') +
        (udf.config ? 1 : 0) +
        plannedArrayLength(udf.searches, 'udf.searches') +
        plannedArrayLength(udf.symbols, 'udf.symbols') +
        plannedArrayLength(udf.histories, 'udf.histories')
    );
}

function createReadScheduler(): <Value>(
    read: () => Promise<Value>,
) => Promise<Value> {
    type QueuedRead = {
        readonly read: () => Promise<unknown>;
        readonly resolve: (value: unknown) => void;
        readonly reject: (reason: unknown) => void;
    };
    const queue: QueuedRead[] = [];
    let active = 0;
    let stopped = false;
    let failure: unknown;

    const rejectQueue = () => {
        let queued: QueuedRead | undefined;
        while ((queued = queue.shift()) !== undefined) {
            queued.reject(failure);
        }
    };
    const pump = () => {
        while (
            !stopped &&
            active < MAX_CONCURRENT_RESYNC_READS &&
            queue.length > 0
        ) {
            const queued = queue.shift();
            if (queued === undefined) return;
            active += 1;
            void Promise.resolve()
                .then(queued.read)
                .then(queued.resolve)
                .catch((error: unknown) => {
                    if (!stopped) {
                        stopped = true;
                        failure = error;
                        rejectQueue();
                    }
                    queued.reject(error);
                })
                .finally(() => {
                    active -= 1;
                    pump();
                });
        }
    };

    return <Value>(read: () => Promise<Value>) =>
        new Promise<Value>((resolve, reject) => {
            if (stopped) {
                reject(failure);
                return;
            }
            queue.push({
                read,
                resolve: (value) => resolve(value as Value),
                reject,
            });
            pump();
        });
}

/**
 * Fetch all active authoritative views and return them without mutating any
 * application cache. The caller commits the result atomically in `onResync`.
 */
export async function executeZenexResync(
    client: ZenexDataClient,
    plan: ZenexResyncPlan,
): Promise<ZenexResyncResult> {
    const readCount = plannedReadCount(plan);
    if (readCount > MAX_RESYNC_READS) {
        throw new TypeError(
            `resync plan exceeds the ${MAX_RESYNC_READS}-read limit`,
        );
    }
    const schedule = createReadScheduler();
    const udfPlan = plan.udf ?? {};
    const [
        config,
        accounts,
        markets,
        vaults,
        leaderboards,
        competitionLists,
        competitions,
        prices,
        candles,
        udfConfig,
        udfSearches,
        udfSymbols,
        udfHistories,
    ] = await Promise.all([
        plan.config
            ? schedule(() => client.getConfig())
            : Promise.resolve(undefined),
        Promise.all(
            (plan.accounts ?? []).map(async (target) => {
                const [orders, fills, vaultOrders, lifecycles] =
                    await Promise.all([
                        schedule(() =>
                            client.getAccountOrders(
                                target.account,
                                target.orders ?? {},
                            ),
                        ),
                        schedule(() =>
                            client.getAccountFills(
                                target.account,
                                target.fills ?? {},
                            ),
                        ),
                        schedule(() =>
                            client.getAccountVaultOrders(
                                target.account,
                                target.vaultOrders ?? {},
                            ),
                        ),
                        schedule(() =>
                            client.getAccountLifecycles(
                                target.account,
                                target.lifecycles ?? {},
                            ),
                        ),
                    ]);
                return { target, orders, fills, vaultOrders, lifecycles };
            }),
        ),
        Promise.all(
            (plan.markets ?? []).map(async (target) => {
                const [trades, snapshots] = await Promise.all([
                    schedule(() =>
                        client.getMarketTrades(
                            target.market,
                            target.trades ?? {},
                        ),
                    ),
                    schedule(() =>
                        client.getMarketSnapshots(
                            target.market,
                            target.snapshots ?? {},
                        ),
                    ),
                ]);
                return { target, trades, snapshots };
            }),
        ),
        Promise.all(
            (plan.vaults ?? []).map(async (target) => ({
                target,
                performance: await schedule(() =>
                    client.getVaultPerformance(
                        target.vault,
                        target.performance,
                    ),
                ),
            })),
        ),
        Promise.all(
            (plan.leaderboards ?? []).map(async (target) => {
                const [standings, lifecycles] = await Promise.all([
                    schedule(() =>
                        client.getRollingStandings(
                            target.window,
                            target.standings ?? {},
                        ),
                    ),
                    schedule(() =>
                        client.getRollingLifecycles(
                            target.window,
                            target.lifecycles ?? {},
                        ),
                    ),
                ]);
                return { target, standings, lifecycles };
            }),
        ),
        Promise.all(
            (plan.competitionLists ?? []).map((query) =>
                schedule(() => client.listCompetitions(query)),
            ),
        ),
        Promise.all(
            (plan.competitions ?? []).map(async (target) => {
                const [detail, standings, lifecycles] = await Promise.all([
                    schedule(() => client.getCompetition(target.id)),
                    schedule(() =>
                        client.getCompetitionStandings(
                            target.id,
                            target.standings ?? {},
                        ),
                    ),
                    schedule(() =>
                        client.getCompetitionLifecycles(
                            target.id,
                            target.lifecycles ?? {},
                        ),
                    ),
                ]);
                return { target, detail, standings, lifecycles };
            }),
        ),
        Promise.all(
            (plan.prices ?? []).map((feed) =>
                schedule(() => client.getLatestPrice(feed)),
            ),
        ),
        Promise.all(
            (plan.candles ?? []).map((query) =>
                schedule(() => client.getCandles(query)),
            ),
        ),
        udfPlan.config
            ? schedule(() => client.getUdfConfig())
            : Promise.resolve(undefined),
        Promise.all(
            (udfPlan.searches ?? []).map((query) =>
                schedule(() => client.searchUdfSymbols(query)),
            ),
        ),
        Promise.all(
            (udfPlan.symbols ?? []).map((query) =>
                schedule(() => client.getUdfSymbol(query)),
            ),
        ),
        Promise.all(
            (udfPlan.histories ?? []).map((query) =>
                schedule(() => client.getUdfHistory(query)),
            ),
        ),
    ]);

    return {
        config,
        accounts,
        markets,
        vaults,
        leaderboards,
        competitionLists,
        competitions,
        prices,
        candles,
        udf: {
            config: udfConfig,
            searches: udfSearches,
            symbols: udfSymbols,
            histories: udfHistories,
        },
    };
}
