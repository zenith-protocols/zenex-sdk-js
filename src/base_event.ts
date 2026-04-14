import { rpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';
import { decodeTradingEvent } from './trading/trading_events.js';
import type { TradingEvent } from './trading/trading_events.js';
import { decodeVaultEvent } from './vault/vault_events.js';
import type { VaultEvent } from './vault/vault_events.js';
import { decodeGovernanceEvent } from './governance/governance_events.js';
import type { GovernanceEvent } from './governance/governance_events.js';

// Contract type enum
export enum ZenexContractType {
    Vault = 'vault',
    Trading = 'trading',
    Factory = 'factory',
    Governance = 'governance',
}

// Base event interface (typed event base)
export interface BaseZenexEvent {
    id: string;
    contractId: string;
    contractType: ZenexContractType;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
}

/**
 * Source-agnostic normalized event — the intermediate representation
 * that both RPC and Mercury normalizers produce before domain decoding.
 */
export interface NormalizedEvent {
    contractId: string;
    txHash: string;
    ledger: number;
    ledgerClosedAt: string;
    id: string;
    eventType: string;
    topicArgs: unknown[];
    data: Record<string, unknown>;
}

/**
 * Mercury webhook event payload shape.
 */
export interface MercuryWebhookEvent {
    event: {
        contract_id: string;
        body: {
            v0: {
                topics: MercuryScVal[];
                data: MercuryScVal;
            };
        };
    };
    tx_hash?: string;
    ledger?: number;
    ledger_closed_at?: string;
}

/**
 * Mercury JSON-decoded ScVal — the shape Mercury sends in webhook payloads.
 */
export type MercuryScVal =
    | { symbol: string }
    | { address: string }
    | { u32: number }
    | { i32: number }
    | { u64: string }
    | { i64: string }
    | { u128: string }
    | { i128: string }
    | { bool: boolean }
    | { bytes: string }
    | { map: Array<{ key: MercuryScVal; val: MercuryScVal }> }
    | { vec: MercuryScVal[] }
    | Record<string, unknown>;

// ============================================================
// Normalizers (raw source → NormalizedEvent)
// ============================================================

/**
 * Normalize an RPC event response into the source-agnostic intermediate.
 *
 * Accepts both shapes emitted by `@stellar/stellar-sdk`:
 *   - `rpc.Api.RawEventResponse` — base64 strings in `topic`/`value`, strkey
 *     `contractId`. Returned by JSON-RPC directly and by the internal
 *     `_getEvents` path.
 *   - `rpc.Api.EventResponse` (SDK ≥15) — `topic`/`value` are already
 *     `xdr.ScVal` objects and `contractId` is a `Contract` instance.
 *     Returned by `rpc.Server.getEvents()` after its built-in normalization.
 *
 * Previously this function assumed only the raw shape and silently dropped
 * SDK-normalized events (base64 decode threw, caught, returned undefined).
 */
export function normalizeRpc(
    eventResponse: rpc.Api.RawEventResponse | rpc.Api.EventResponse
): NormalizedEvent | undefined {
    if (
        eventResponse.type !== 'contract' ||
        !eventResponse.topic ||
        eventResponse.topic.length === 0 ||
        eventResponse.contractId === undefined
    ) {
        return undefined;
    }

    try {
        const topic = eventResponse.topic as (string | xdr.ScVal)[];
        const toScVal = (v: string | xdr.ScVal): xdr.ScVal =>
            typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v;

        const eventType = scValToNative(toScVal(topic[0])) as string;

        const topicArgs: unknown[] = [];
        for (let i = 1; i < topic.length; i++) {
            const scVal = toScVal(topic[i]);
            if (scVal.switch().name === 'scvAddress') {
                topicArgs.push(Address.fromScVal(scVal).toString());
            } else {
                topicArgs.push(scValToNative(scVal));
            }
        }

        const rawValue = eventResponse.value as string | xdr.ScVal;
        const data = scValToNative(toScVal(rawValue)) as Record<string, unknown>;

        // `contractId` is either a strkey string (raw JSON-RPC) or a
        // `Contract` instance whose toString() returns the strkey.
        const cid = eventResponse.contractId as unknown;
        const contractId = typeof cid === 'string' ? cid : String(cid);

        return {
            contractId,
            txHash: eventResponse.txHash || '',
            ledger: eventResponse.ledger,
            ledgerClosedAt: eventResponse.ledgerClosedAt,
            id: eventResponse.id,
            eventType,
            topicArgs,
            data: data ?? {},
        };
    } catch {
        return undefined;
    }
}

/**
 * Convert a Mercury JSON-decoded ScVal to a native JS value.
 */
function mercuryScValToNative(val: MercuryScVal): unknown {
    if ('symbol' in val) return (val as { symbol: string }).symbol;
    if ('address' in val) return (val as { address: string }).address;
    if ('u32' in val) return (val as { u32: number }).u32;
    if ('i32' in val) return (val as { i32: number }).i32;
    if ('u64' in val) return BigInt((val as { u64: string }).u64);
    if ('i64' in val) return BigInt((val as { i64: string }).i64);
    if ('u128' in val) return BigInt((val as { u128: string }).u128);
    if ('i128' in val) return BigInt((val as { i128: string }).i128);
    if ('bool' in val) return (val as { bool: boolean }).bool;
    if ('bytes' in val) return (val as { bytes: string }).bytes;
    if ('vec' in val) {
        return ((val as { vec: MercuryScVal[] }).vec).map(mercuryScValToNative);
    }
    if ('map' in val) {
        const map = (val as { map: Array<{ key: MercuryScVal; val: MercuryScVal }> }).map;
        const result: Record<string, unknown> = {};
        for (const entry of map) {
            const key = mercuryScValToNative(entry.key);
            result[String(key)] = mercuryScValToNative(entry.val);
        }
        return result;
    }
    return val;
}

/**
 * Normalize a Mercury webhook event payload into the source-agnostic intermediate.
 */
export function normalizeMercury(
    payload: MercuryWebhookEvent
): NormalizedEvent | undefined {
    const topics = payload.event?.body?.v0?.topics;
    const data = payload.event?.body?.v0?.data;

    if (!topics || topics.length === 0 || !payload.event?.contract_id) {
        return undefined;
    }

    try {
        const eventType = mercuryScValToNative(topics[0]) as string;

        const topicArgs: unknown[] = [];
        for (let i = 1; i < topics.length; i++) {
            topicArgs.push(mercuryScValToNative(topics[i]));
        }

        const eventData = data
            ? mercuryScValToNative(data) as Record<string, unknown>
            : {};

        return {
            contractId: payload.event.contract_id,
            txHash: payload.tx_hash ?? '',
            ledger: payload.ledger ?? 0,
            ledgerClosedAt: payload.ledger_closed_at ?? '',
            id: '',
            eventType,
            topicArgs,
            data: eventData,
        };
    } catch {
        return undefined;
    }
}

// ============================================================
// Unified decoder
// ============================================================

export type ZenexEvent = TradingEvent | VaultEvent | GovernanceEvent;

/**
 * Decode a Zenex event from any source (RPC or Mercury webhook).
 * Normalizes the input, then tries trading and vault decoders.
 */
export function decodeEvent(
    raw: rpc.Api.RawEventResponse | rpc.Api.EventResponse | MercuryWebhookEvent
): ZenexEvent | undefined {
    const normalized = ('type' in raw && 'topic' in raw)
        ? normalizeRpc(raw as rpc.Api.RawEventResponse | rpc.Api.EventResponse)
        : normalizeMercury(raw as MercuryWebhookEvent);

    if (!normalized) return undefined;

    return decodeTradingEvent(normalized) ?? decodeVaultEvent(normalized) ?? decodeGovernanceEvent(normalized);
}
