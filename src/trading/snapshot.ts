import {
    Account,
    Address,
    BASE_FEE,
    rpc,
    TimeoutInfinite,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { checkedI128 } from '../math/fixed.js';
import type { PriceData } from './market/types.js';
import { exact, unavailable } from './quote/result.js';
import type { QuoteResult, QuoteUnavailableCode } from './quote/result.js';
import { TradingRouterContract } from '../contracts/router/router_contract.js';
import type { Call } from '../contracts/router/router_types.js';
import { TreasuryContract } from '../contracts/treasury/treasury_contract.js';
import { VaultContract } from '../contracts/vault/vault_contract.js';
import type { VaultAtomicState } from './quote/vault.js';
import type { Network } from '../index.js';
import { TradingContract } from '../contracts/trading/trading_contract.js';
import type { TradingEntriesSnapshot } from '../contracts/trading/trading_entries.js';
import { Status } from '../contracts/trading/trading_types.js';
import type {
    AdlState,
    MarketData,
    Position,
    TradingConfig,
} from '../contracts/trading/trading_types.js';

const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;
const PRICE_FRESHNESS = ['fresh', 'stale', 'unavailable'] as const;
const EXPECTED_RESULT_COUNT = 16;
const SIMULATION_ACCOUNT =
    'GDMVSPSKEUOTRFSJH2SXVUNB2JGORKDTWBMOP5OZJZP4GKRQUQWFJO4Y';
const SIMULATION_SEQUENCE = '123';

export interface TradingDeployment {
    readonly trading: string;
    readonly router: string;
    readonly vault: string;
    readonly oracle: string;
    readonly treasury: string;
    /** 32-byte price stream id (`BytesN<32>`). */
    readonly feedId: Buffer | Uint8Array;
    readonly vaultDecimalsOffset: number;
    readonly vaultShareDecimals: number;
}

export interface TradingSnapshotSubject {
    readonly user: string;
    readonly isLong: boolean;
}

export interface TradingSnapshot {
    readonly subject?: TradingSnapshotSubject;
    /** Present on snapshots loaded by `loadTradingSnapshot`. */
    readonly adl?: AdlState;
    /** Canonical settlement-token contract returned by the trading market. */
    readonly collateralToken?: string;
    ledger: number;
    ledgerTime: bigint;
    deployment: TradingDeployment;
    status: Status;
    retirement: [bigint, bigint] | undefined;
    config: TradingConfig;
    market: MarketData;
    position: Position;
    price: PriceData;
    /**
     * Exact serialized update submitted in this snapshot simulation.
     * Live markets verify it on-chain at fill; terminal markets carry it
     * unchanged because their oracle path ignores the update payload.
     */
    priceUpdate: Uint8Array;
    vault: VaultAtomicState;
    treasuryRate: bigint;
}

export type SubjectBoundTradingSnapshot = TradingSnapshot & {
    readonly subject: TradingSnapshotSubject;
    readonly adl: AdlState;
    readonly collateralToken: string;
};

/**
 * The price provider's liveness verdict on a feed.
 *
 * This is a provider label, not an oracle gate: the SDK never computes it and
 * the chain never reads it. Since contracts #169 the oracle runs two staleness
 * windows — the strict `trade_staleness` (<=15s, order fills) and the wider
 * `close_staleness` (<=120s, gap-closing calls: liquidation, ADL, accrual) —
 * so `'stale'` is only meaningful against a chosen class.
 *
 * Read `'stale'` as *stale for a fill*. It does NOT imply the chain would
 * reject a protective call at that price: between the two windows a report is
 * simultaneously too old to trade on and perfectly valid to liquidate,
 * deleverage, or accrue on. Gating keeper submission on this label alone will
 * suppress exactly the calls that protect vault solvency during a feed gap,
 * which is the failure mode the two-tier split exists to prevent.
 */
export type PriceFreshness = (typeof PRICE_FRESHNESS)[number];

/**
 * The platform's numeric price surface for one feed. Signed Chainlink Data
 * Streams reports are license-restricted and never reach a browser; the
 * snapshot synthesizes a {@link PriceData} from these numeric fields,
 * mirroring the on-chain oracle's decoded V3 report (bid/ask, fixed 18-dec,
 * publish time in seconds) client-side.
 */
export interface TradingSnapshotPrice {
    /** 32-byte price stream id (`BytesN<32>`). */
    readonly feedId: Buffer | Uint8Array;
    /** Best bid (18-dec, after spread reduction). */
    readonly bid: bigint;
    /** Best ask (18-dec, after spread reduction). */
    readonly ask: bigint;
    /** Feed observation time in whole seconds. */
    readonly publishTime: bigint;
    /** Provider liveness verdict; `'stale'` means stale *for a fill*. See {@link PriceFreshness}. */
    readonly freshness: PriceFreshness;
}

export interface TradingSnapshotRequest {
    network: Network;
    deployment: TradingDeployment;
    user: string;
    isLong: boolean;
    /**
     * Numeric price from the platform API. Used to synthesize the verified
     * mark for a live (non-terminal) market; ignored for a retired market,
     * which marks against its terminal price.
     */
    price: TradingSnapshotPrice;
    /**
     * Opaque execution price payload carried onto the built snapshot and
     * spliced at fill time. In the relay fill path the relay supplies its own
     * signed update, so this is a caller placeholder and is never verified for
     * pricing here.
     */
    priceUpdate: Uint8Array;
}

class SnapshotUnavailableError extends Error {
    constructor(
        readonly code: QuoteUnavailableCode,
        reason: string,
    ) {
        super(reason);
    }
}

function viewCall(
    contract: string,
    func: string,
    args: xdr.ScVal[] = [],
): Call {
    return { contract, func, args };
}

function checkedU32(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `${label} must be a u32 safe integer`,
        );
    }
    return value;
}

function checkedU64(value: bigint, label: string): bigint {
    if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `${label} must be a u64 bigint`,
        );
    }
    return value;
}

function checkedI128Field(value: unknown, label: string): bigint {
    try {
        return checkedI128(value as bigint);
    } catch {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `${label} must be an i128`,
        );
    }
}

function checkedFreshness(value: unknown): PriceFreshness {
    if (
        typeof value !== 'string' ||
        !(PRICE_FRESHNESS as readonly string[]).includes(value)
    ) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'price freshness must be fresh, stale, or unavailable',
        );
    }
    return value as PriceFreshness;
}

function checkedFeedId(value: unknown, label: string): Buffer {
    if (!(value instanceof Uint8Array) || value.length !== 32) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `${label} must be a 32-byte Uint8Array`,
        );
    }
    return Buffer.from(value);
}

function checkedNumericPrice(value: unknown): TradingSnapshotPrice {
    if (!value || typeof value !== 'object') {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'numeric price must be an object',
        );
    }
    const source = value as Record<keyof TradingSnapshotPrice, unknown>;
    return {
        feedId: checkedFeedId(source.feedId, 'numeric feed id'),
        bid: checkedI128Field(source.bid, 'numeric bid'),
        ask: checkedI128Field(source.ask, 'numeric ask'),
        publishTime: checkedU64(
            source.publishTime as bigint,
            'numeric publish time',
        ),
        freshness: checkedFreshness(source.freshness),
    };
}

function validateRequest(request: TradingSnapshotRequest): {
    deployment: TradingDeployment;
    user: string;
    isLong: boolean;
    price: TradingSnapshotPrice;
    priceUpdate: Uint8Array;
} {
    return {
        deployment: {
            ...request.deployment,
            feedId: checkedFeedId(
                request.deployment.feedId,
                'deployment feed id',
            ),
        },
        user: request.user,
        isLong: request.isLong,
        price: checkedNumericPrice(request.price),
        priceUpdate: Uint8Array.from(request.priceUpdate),
    };
}

// The market's price is not read on-chain: signed Chainlink Data Streams
// reports are license-restricted and must not reach a browser, so the mark is
// synthesized from the platform's numeric price surface (see
// `synthesizeNumericPrice`). The multicall carries only the 16 verbatim state
// views.
function snapshotCalls(
    deployment: TradingDeployment,
    user: string,
    isLong: boolean,
): Call[] {
    return [
        viewCall(deployment.trading, 'get_config'),
        viewCall(deployment.trading, 'get_market_data'),
        viewCall(deployment.trading, 'get_position', [
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
        ]),
        viewCall(deployment.trading, 'get_status'),
        viewCall(deployment.trading, 'get_retirement'),
        viewCall(deployment.trading, 'get_feed'),
        viewCall(deployment.trading, 'get_token'),
        viewCall(deployment.trading, 'get_vault'),
        viewCall(deployment.trading, 'get_treasury'),
        viewCall(deployment.trading, 'get_oracle'),
        viewCall(deployment.vault, 'total_assets'),
        viewCall(deployment.vault, 'total_supply'),
        viewCall(deployment.vault, 'query_asset'),
        viewCall(deployment.vault, 'get_strategy'),
        viewCall(deployment.treasury, 'get_rate'),
        viewCall(deployment.trading, 'get_adl'),
    ];
}

function simulationTransaction(
    network: Network,
    router: string,
    calls: Call[],
) {
    const operation = new TradingRouterContract(router).multicallTry(calls);
    return new TransactionBuilder(
        new Account(SIMULATION_ACCOUNT, SIMULATION_SEQUENCE),
        {
            networkPassphrase: network.passphrase,
            fee: BASE_FEE,
            timebounds: { maxTime: TimeoutInfinite, minTime: 0 },
        },
    )
        .addOperation(xdr.Operation.fromXDR(operation, 'base64'))
        .build();
}

function simulationValues(
    simulation: rpc.Api.SimulateTransactionResponse,
): xdr.ScVal[] {
    if (
        rpc.Api.isSimulationRestore(simulation) ||
        !rpc.Api.isSimulationSuccess(simulation) ||
        !simulation.result?.retval
    ) {
        const reason = rpc.Api.isSimulationError(simulation)
            ? simulation.error
            : 'snapshot simulation did not return a value';
        throw new SnapshotUnavailableError('MISSING_STATE', reason);
    }
    const values = simulation.result.retval.vec();
    if (!values || values.length !== EXPECTED_RESULT_COUNT) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            `snapshot multicall must return ${EXPECTED_RESULT_COUNT} results`,
        );
    }
    return values;
}

function resultXdr(values: xdr.ScVal[], index: number): string {
    return values[index].toXDR('base64');
}

function requireSuccessfulCall(value: xdr.ScVal, label: string): void {
    if (value.switch() !== xdr.ScValType.scvError()) return;
    const error = value.error();
    const detail =
        error.switch() === xdr.ScErrorType.sceContract()
            ? ` with contract error #${error.contractCode()}`
            : '';
    throw new SnapshotUnavailableError(
        'MISSING_STATE',
        `${label} call failed${detail}`,
    );
}

function parseLedgerTime(value: string): bigint {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            'latest ledger close time is not a canonical integer',
        );
    }
    const timestamp = BigInt(value);
    if (timestamp > U64_MAX) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            'latest ledger close time exceeds u64',
        );
    }
    return timestamp;
}

/** Project the platform's numeric price surface onto {@link PriceData}. */
function synthesizeNumericPrice(price: TradingSnapshotPrice): PriceData {
    return {
        feedId: Buffer.from(price.feedId),
        bid: price.bid,
        ask: price.ask,
        publishTime: price.publishTime,
    };
}

/**
 * The flat terminal mark of a retired market. The terminal price has no feed
 * observation behind it, so its `publishTime` is the snapshot's ledger close
 * time (it is "current" as of the read).
 */
function terminalPrice(
    feedId: Buffer | Uint8Array,
    terminal: bigint,
    ledgerTime: bigint,
): PriceData {
    return {
        feedId: Buffer.from(feedId),
        bid: terminal,
        ask: terminal,
        publishTime: ledgerTime,
    };
}

function decodeSnapshot(
    values: xdr.ScVal[],
    deployment: TradingDeployment,
    subject: TradingSnapshotSubject,
    ledger: number,
    ledgerTime: bigint,
    numericPrice: TradingSnapshotPrice,
    priceUpdate: Uint8Array,
): SubjectBoundTradingSnapshot {
    for (let index = 0; index < 16; index += 1) {
        requireSuccessfulCall(values[index], `snapshot state ${index}`);
    }
    const config = TradingContract.parsers.getConfig(resultXdr(values, 0));
    const market = TradingContract.parsers.getMarketData(resultXdr(values, 1));
    const position = TradingContract.parsers.getPosition(resultXdr(values, 2));
    const status = TradingContract.parsers.getStatus(
        resultXdr(values, 3),
    ) as Status;
    const retirement = TradingContract.parsers.getRetirement(
        resultXdr(values, 4),
    );
    const feed = TradingContract.parsers.getFeed(resultXdr(values, 5));
    const collateral = TradingContract.parsers.getToken(resultXdr(values, 6));
    const vaultAddress = TradingContract.parsers.getVault(resultXdr(values, 7));
    const treasuryAddress = TradingContract.parsers.getTreasury(
        resultXdr(values, 8),
    );
    const oracleAddress = TradingContract.parsers.getOracle(
        resultXdr(values, 9),
    );
    const totalAssets = checkedI128(
        VaultContract.parsers.totalAssets(resultXdr(values, 10)),
    );
    const totalSupply = checkedI128(
        VaultContract.parsers.totalSupply(resultXdr(values, 11)),
    );
    const vaultAsset = VaultContract.parsers.queryAsset(resultXdr(values, 12));
    const vaultStrategy = VaultContract.parsers.getStrategy(
        resultXdr(values, 13),
    );
    const treasuryRate = checkedI128(
        TreasuryContract.parsers.getRate(resultXdr(values, 14)),
    );
    const adl = TradingContract.parsers.getAdl(resultXdr(values, 15));

    let price: PriceData;
    if (retirement && retirement[0] !== 0n) {
        price = terminalPrice(
            deployment.feedId,
            checkedI128(retirement[0]),
            ledgerTime,
        );
    } else {
        price = synthesizeNumericPrice(numericPrice);
    }

    return {
        subject: { ...subject },
        adl,
        collateralToken: collateral,
        ledger,
        ledgerTime,
        deployment: { ...deployment },
        status,
        retirement,
        config,
        market,
        position,
        price,
        priceUpdate: Uint8Array.from(priceUpdate),
        vault: {
            totalAssets,
            totalSupply,
            decimalsOffset: deployment.vaultDecimalsOffset,
        },
        treasuryRate,
    };
}

export interface SnapshotFromEntriesInput {
    /** Batched contract-state read to project. */
    entries: TradingEntriesSnapshot;
    /** Router contract for the deployment (not stored on the trading contract). */
    router: string;
    /**
     * Ledger close time (unix seconds) coherent with the read, for accrual
     * extrapolation and lock checks.
     */
    ledgerTime: bigint;
    /**
     * Numeric price from the platform API; ignored for a retired market,
     * which marks against its terminal price.
     */
    price: TradingSnapshotPrice;
    /** Opaque execution price payload; defaults to empty. */
    priceUpdate?: Uint8Array;
}

/**
 * Project a batched `getLedgerEntries` read (`loadTradingEntries`) onto the
 * quote layer's `TradingSnapshot`. The ledger-read counterpart of
 * `loadTradingSnapshot`: same shape, no simulation, so `applyOrder` and the
 * exact quote helpers run off pure storage reads. The retirement projection
 * mirrors the contract's `get_retirement` exactly (present iff `DelistedAt`
 * is set; terminal price `0` until `set_terminal_price`).
 */
export function snapshotFromEntries(
    input: SnapshotFromEntriesInput,
): SubjectBoundTradingSnapshot {
    const entries = input.entries;
    const instance = entries.instance;
    const numericPrice = checkedNumericPrice(input.price);
    const ledgerTime = checkedU64(input.ledgerTime, 'ledger time');
    const retirement: [bigint, bigint] | undefined =
        instance.delistedAt === undefined
            ? undefined
            : [instance.terminalPrice ?? 0n, instance.delistedAt];

    let price: PriceData;
    if (retirement && retirement[0] !== 0n) {
        price = terminalPrice(
            instance.feedId,
            checkedI128(retirement[0]),
            ledgerTime,
        );
    } else {
        price = synthesizeNumericPrice(numericPrice);
    }

    return {
        subject: { ...entries.subject },
        adl: instance.adl,
        collateralToken: instance.token,
        ledger: entries.ledger,
        ledgerTime,
        deployment: {
            trading: entries.trading,
            router: input.router,
            vault: instance.vault,
            oracle: instance.oracle,
            treasury: instance.treasury,
            feedId: instance.feedId,
            vaultDecimalsOffset: entries.vault.decimalsOffset,
            vaultShareDecimals: entries.vault.shareDecimals,
        },
        status: instance.status,
        retirement,
        config: instance.config,
        market: entries.market,
        position: entries.position,
        price,
        priceUpdate: Uint8Array.from(input.priceUpdate ?? []),
        vault: { ...entries.vaultAtomic },
        treasuryRate: entries.treasuryRate,
    };
}

export async function loadTradingSnapshot(
    request: TradingSnapshotRequest,
): Promise<QuoteResult<SubjectBoundTradingSnapshot>> {
    try {
        const validated = validateRequest(request);
        const server = new rpc.Server(
            request.network.rpc,
            request.network.opts,
        );
        const calls = snapshotCalls(
            validated.deployment,
            validated.user,
            validated.isLong,
        );

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const header = await server.getLatestLedger();
            const simulation = await server.simulateTransaction(
                simulationTransaction(
                    request.network,
                    validated.deployment.router,
                    calls,
                ),
            );
            if (header.sequence !== simulation.latestLedger) {
                if (attempt === 0) continue;
                throw new SnapshotUnavailableError(
                    'INCONSISTENT_LEDGER',
                    `header ledger ${header.sequence} differs from simulation ledger ${simulation.latestLedger}`,
                );
            }
            const ledger = checkedU32(
                simulation.latestLedger,
                'simulation ledger',
            );
            const snapshot = decodeSnapshot(
                simulationValues(simulation),
                validated.deployment,
                { user: validated.user, isLong: validated.isLong },
                ledger,
                parseLedgerTime(header.closeTime),
                validated.price,
                validated.priceUpdate,
            );
            return exact(snapshot, ledger);
        }

        throw new SnapshotUnavailableError(
            'INCONSISTENT_LEDGER',
            'snapshot ledgers remained inconsistent',
        );
    } catch (error) {
        if (error instanceof SnapshotUnavailableError) {
            return unavailable(error.code, error.message);
        }
        return unavailable(
            'MISSING_STATE',
            error instanceof Error ? error.message : 'snapshot load failed',
        );
    }
}
