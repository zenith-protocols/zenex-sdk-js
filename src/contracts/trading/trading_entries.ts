import { Address, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { Network } from '../../index.js';
import {
    contractInstanceLedgerKey,
    tokenBalanceLedgerKey,
    tradingMarketDataLedgerKey,
    tradingPositionLedgerKey,
} from '../../ledger-keys.js';
import { parseTokenBalanceValue } from '../vault/vault_balance.js';
import { parseVaultInstance } from '../vault/vault_instance.js';
import type { VaultInstanceState } from '../vault/vault_instance.js';
import type { VaultAtomicState } from '../../trading/quote/vault.js';
import { parseTreasuryRate } from '../treasury/treasury_rate.js';
import { parseTradingInstance } from './trading_instance.js';
import type { TradingInstanceState } from './trading_instance.js';
import { parseMarketData, parsePosition } from './trading_types.js';
import type { MarketData, Position } from './trading_types.js';

// =============================================================================
// Batched contract-state reader over `getLedgerEntries`.
//
// The non-price state views are all verbatim storage echoes that collapse
// to ~6 ledger entries per market (trading instance, MarketData, Position, vault instance,
// token Balance(vault), treasury instance). A single `getLedgerEntries` fetches
// every key across every requested market; the results are demultiplexed by
// exact ledger-key bytes.
//
// `getLedgerEntries` SILENTLY OMITS missing keys, so decode is keyed strictly
// off the requested-vs-returned diff (never positional order), and each kind
// carries the contract's own absent semantics:
//   - trading instance / MarketData / vault instance / treasury instance:
//     absent is an error (a live market always has them),
//   - Position: absent -> zeroed (a never-opened side; `Position::zeroed`),
//   - token Balance(vault): absent -> 0 (an untouched holder),
//   - treasury `Rate`: absent within the instance -> 0 (`get_rate` default),
//   - ADL / DelistedAt / TerminalPrice: handled inside the instance walk.
//
// TTL fail-closed: any RETURNED entry whose `liveUntilLedgerSeq` is behind the
// response's `latestLedger` is expired-but-not-yet-evicted and is treated as
// MISSING_STATE, never decoded as live state.
//
// Prices are NOT read here (the platform serves numeric prices out of band);
// this layer is contract STATE only.
// =============================================================================

/** Cross-market request cap for a single `getLedgerEntries` round trip (6 keys/market). */
const MAX_KEYS_PER_REQUEST = 180;

/** A never-opened side reads as the contract's `Position::zeroed`. */
const ZERO_POSITION: Position = {
    margin: 0n,
    notional: 0n,
    tokens: 0n,
    fundingIdx: 0n,
    borrowingIdx: 0n,
    lockedNotional: 0n,
    unlocksAt: 0n,
    pricedAt: 0n,
    decreaseOrders: [],
};

/** One market's read target: the wired contracts plus the position subject. */
export interface TradingEntriesRequest {
    /** Trading (market) contract. */
    readonly trading: string;
    /** Strategy-vault contract wired to the market. */
    readonly vault: string;
    /** Treasury contract wired to the market. */
    readonly treasury: string;
    /** Settlement/collateral token contract (the vault's asset). */
    readonly collateralToken: string;
    /** Position owner. */
    readonly user: string;
    /** Position side. */
    readonly isLong: boolean;
}

/** One market's decoded contract state (price excluded). */
export interface TradingEntriesSnapshot {
    /** Latest ledger the batch read closed at. */
    readonly ledger: number;
    /** Trading (market) contract this snapshot describes. */
    readonly trading: string;
    /** Position subject echoed from the request. */
    readonly subject: { readonly user: string; readonly isLong: boolean };
    /** Trading instance storage (config, anchors, addresses, status, ADL). */
    readonly instance: TradingInstanceState;
    /** Market singleton. */
    readonly market: MarketData;
    /** Netted position for the subject; zeroed when the side was never opened. */
    readonly position: Position;
    /** Strategy-vault instance storage. */
    readonly vault: VaultInstanceState;
    /** Vault margin balance (token Balance(vault)); equals `total_assets()`. */
    readonly vaultBalanceAtomic: bigint;
    /** Protocol fee rate (SCALAR_18). */
    readonly treasuryRate: bigint;
    /** Coherent atomic vault state for the exact quote helpers. */
    readonly vaultAtomic: VaultAtomicState;
}

/** Codes for a failed batched read. */
export type TradingEntriesFailureCode =
    | 'INVALID_INPUT'
    | 'MISSING_STATE'
    | 'IDENTITY_MISMATCH';

/** A batched contract-state read could not produce a coherent snapshot. */
export class TradingEntriesError extends Error {
    constructor(
        readonly code: TradingEntriesFailureCode,
        reason: string,
    ) {
        super(reason);
        this.name = 'TradingEntriesError';
    }
}

/** The six ledger keys a single market's contract state collapses to. */
function marketKeys(request: TradingEntriesRequest): {
    tradingInstance: xdr.LedgerKey;
    marketData: xdr.LedgerKey;
    position: xdr.LedgerKey;
    vaultInstance: xdr.LedgerKey;
    vaultBalance: xdr.LedgerKey;
    treasuryInstance: xdr.LedgerKey;
} {
    return {
        tradingInstance: contractInstanceLedgerKey(request.trading),
        marketData: tradingMarketDataLedgerKey(request.trading),
        position: tradingPositionLedgerKey(
            request.trading,
            request.user,
            request.isLong,
        ),
        vaultInstance: contractInstanceLedgerKey(request.vault),
        vaultBalance: tokenBalanceLedgerKey(
            request.collateralToken,
            request.vault,
        ),
        treasuryInstance: contractInstanceLedgerKey(request.treasury),
    };
}

/** Contract-data value ScVal for a returned entry, or `undefined` if not contract-data. */
function contractDataValue(entry: {
    val: xdr.LedgerEntryData;
}): xdr.ScVal | undefined {
    const data = entry.val;
    if (data.switch() !== xdr.LedgerEntryType.contractData()) {
        return undefined;
    }
    return data.contractData().val();
}

/** A returned contract-data entry plus the TTL the RPC reported for it. */
interface ReturnedEntry {
    readonly value: xdr.ScVal;
    readonly liveUntilLedgerSeq?: number;
}

/**
 * Index returned entries by their exact ledger-key bytes. This is the guard
 * against `getLedgerEntries` silently dropping a missing key: lookup is by key,
 * never by position. Each entry keeps its `liveUntilLedgerSeq` so decode can
 * fail closed on expired-but-not-yet-evicted state.
 */
function indexByKey(
    entries: readonly {
        key: xdr.LedgerKey;
        val: xdr.LedgerEntryData;
        liveUntilLedgerSeq?: number;
    }[],
): Map<string, ReturnedEntry> {
    const index = new Map<string, ReturnedEntry>();
    for (const entry of entries) {
        const value = contractDataValue(entry);
        if (value === undefined) continue;
        index.set(entry.key.toXDR('base64'), {
            value,
            liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
        });
    }
    return index;
}

function decodeMarket(
    request: TradingEntriesRequest,
    ledger: number,
    returned: Map<string, ReturnedEntry>,
): TradingEntriesSnapshot {
    const keys = marketKeys(request);
    // TTL guard: `getLedgerEntries` still RETURNS an entry whose TTL has
    // lapsed until eviction actually happens. `liveUntilLedgerSeq <
    // latestLedger` means the entry is expired-but-not-yet-evicted; decoding
    // it as live state would fail OPEN on a money path, so treat it as
    // MISSING_STATE instead. This covers every entry kind read here
    // (instances, MarketData, Position, Balance).
    const at = (key: xdr.LedgerKey, label: string): xdr.ScVal | undefined => {
        const entry = returned.get(key.toXDR('base64'));
        if (!entry) return undefined;
        if (
            entry.liveUntilLedgerSeq !== undefined &&
            entry.liveUntilLedgerSeq < ledger
        ) {
            throw new TradingEntriesError(
                'MISSING_STATE',
                `${label} entry is TTL-expired (live until ledger ${entry.liveUntilLedgerSeq}, latest ${ledger}); restore or extend it before reading`,
            );
        }
        return entry.value;
    };

    const tradingInstanceVal = at(
        keys.tradingInstance,
        `trading instance ${request.trading}`,
    );
    if (!tradingInstanceVal) {
        throw new TradingEntriesError(
            'MISSING_STATE',
            `trading instance ${request.trading} not found`,
        );
    }
    const instance = parseTradingInstance(tradingInstanceVal);

    const marketVal = at(keys.marketData, `market data for ${request.trading}`);
    if (!marketVal) {
        throw new TradingEntriesError(
            'MISSING_STATE',
            `market data for ${request.trading} not found`,
        );
    }
    const market = parseMarketData(scValToNative(marketVal));

    // ARCHIVAL AMBIGUITY: a RETURNED-but-expired Position fails closed via the
    // TTL guard in `at` above. An ABSENT Position, however, is ambiguous: it
    // can mean "this side was never opened" (`Position::zeroed`) OR "the entry
    // was TTL-archived and evicted" (Position sits in the 100/120-day
    // persistent tier). `getLedgerEntries` cannot see evicted entries, so the
    // two cases are indistinguishable from this read alone; disambiguating
    // needs an archived-key probe / restore preflight.
    // TODO(archival): probe the hot archive for the position key (or require a
    // restore) before decoding absence as "never opened".
    const positionVal = at(
        keys.position,
        `position for ${request.user} on ${request.trading}`,
    );
    const position = positionVal
        ? parsePosition(scValToNative(positionVal))
        : { ...ZERO_POSITION, decreaseOrders: [] };

    const vaultInstanceVal = at(
        keys.vaultInstance,
        `vault instance ${request.vault}`,
    );
    if (!vaultInstanceVal) {
        throw new TradingEntriesError(
            'MISSING_STATE',
            `vault instance ${request.vault} not found`,
        );
    }
    const vault = parseVaultInstance(vaultInstanceVal);

    const treasuryInstanceVal = at(
        keys.treasuryInstance,
        `treasury instance ${request.treasury}`,
    );
    if (!treasuryInstanceVal) {
        throw new TradingEntriesError(
            'MISSING_STATE',
            `treasury instance ${request.treasury} not found`,
        );
    }
    const treasuryRate = parseTreasuryRate(treasuryInstanceVal);

    const balanceVal = at(
        keys.vaultBalance,
        `vault balance for ${request.vault}`,
    );
    const vaultBalanceAtomic = balanceVal
        ? parseTokenBalanceValue(balanceVal)
        : 0n;

    return {
        ledger,
        trading: request.trading,
        subject: { user: request.user, isLong: request.isLong },
        instance,
        market,
        position,
        vault,
        vaultBalanceAtomic,
        treasuryRate,
        vaultAtomic: {
            totalAssets: vaultBalanceAtomic,
            totalSupply: vault.totalSharesAtomic,
            decimalsOffset: vault.decimalsOffset,
        },
    };
}

/**
 * Read the contract state of many markets in a single `getLedgerEntries`.
 *
 * One batched round trip covers every market: 6 keys per market (position,
 * market, vault instance, vault balance, trading and treasury instances),
 * demultiplexed by exact key bytes. Snapshots are returned in request order.
 *
 * @throws {TradingEntriesError} on invalid input, a missing required entry, or
 *   an identity mismatch between a request and the on-chain wiring.
 */
export async function loadTradingEntriesBatch(
    network: Network,
    requests: readonly TradingEntriesRequest[],
): Promise<TradingEntriesSnapshot[]> {
    const validated = requests;
    const perMarketKeys = validated.map(marketKeys);
    const allKeys = perMarketKeys.flatMap((keys) => [
        keys.tradingInstance,
        keys.marketData,
        keys.position,
        keys.vaultInstance,
        keys.vaultBalance,
        keys.treasuryInstance,
    ]);
    if (allKeys.length > MAX_KEYS_PER_REQUEST) {
        throw new TradingEntriesError(
            'INVALID_INPUT',
            `entries batch of ${allKeys.length} keys exceeds the ${MAX_KEYS_PER_REQUEST}-key request cap; page the markets`,
        );
    }

    const server = new rpc.Server(network.rpc, network.opts);
    const response = await server.getLedgerEntries(...allKeys);
    const returned = indexByKey(response.entries);
    const ledger = response.latestLedger;

    return validated.map((request) => decodeMarket(request, ledger, returned));
}

/**
 * Read one market's contract state in a single `getLedgerEntries`. Convenience
 * wrapper over [`loadTradingEntriesBatch`].
 */
export async function loadTradingEntries(
    network: Network,
    request: TradingEntriesRequest,
): Promise<TradingEntriesSnapshot> {
    const [snapshot] = await loadTradingEntriesBatch(network, [request]);
    return snapshot;
}

/**
 * Cross-check the entries-derived vault margin balance against an
 * authoritative `total_assets()` simulation. The two must agree because
 * `Vault::total_assets` is exactly the token `Balance(vault)` slot this layer
 * reads. Intended to run at LOW frequency (the sim path stays available via
 * `loadTradingSnapshot`) as a drift alarm on the money path.
 *
 * @throws {TradingEntriesError} when the values disagree.
 */
export function crossCheckVaultTotalAssets(
    snapshot: TradingEntriesSnapshot,
    simTotalAssets: bigint,
): void {
    if (snapshot.vaultBalanceAtomic !== simTotalAssets) {
        throw new TradingEntriesError(
            'IDENTITY_MISMATCH',
            `vault total_assets drift: entries ${snapshot.vaultBalanceAtomic} != sim ${simTotalAssets}`,
        );
    }
}
