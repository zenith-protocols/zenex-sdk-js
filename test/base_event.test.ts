import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, Address, StrKey, Contract } from '@stellar/stellar-sdk';
import {
    normalizeRpc,
    normalizeMercury,
    normalizeGoldsky,
    decodeEvent,
    GoldskyWebhookEvent,
    MercuryWebhookEvent,
} from '../src/base_event.js';
import { TradingEventType, TradingCancelOrderEvent, TradingIncreaseFillEvent } from '../src/trading/trading_events.js';
import { GovernanceEventType, GovernanceCancelledEvent } from '../src/governance/governance_events.js';
import { VaultEventType, VaultStrategyWithdrawEvent } from '../src/vault/vault_events.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const STRATEGY = StrKey.encodeContract(Buffer.alloc(32, 3));

const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const mapEntry = (k: string, v: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: sym(k), val: v });

function rawRpcEvent(topics: xdr.ScVal[], value: xdr.ScVal) {
    return {
        type: 'contract' as const,
        contractId: CONTRACT_ID,
        id: '0001-1',
        ledger: 100,
        ledgerClosedAt: '2026-07-06T00:00:00Z',
        txHash: 'abc123',
        topic: topics.map(b64),
        value: b64(value),
        pagingToken: '1',
        inSuccessfulContractCall: true,
    };
}

describe('normalizeRpc', () => {
    it('normalizes a raw JSON-RPC event (base64 topics)', () => {
        const ev = rawRpcEvent(
            [sym('cancel_order'), Address.fromString(USER).toScVal(), xdr.ScVal.scvU32(7)],
            xdr.ScVal.scvMap([]),
        );
        const n = normalizeRpc(ev as never);
        expect(n).toBeDefined();
        expect(n!.eventType).toBe('cancel_order');
        expect(n!.topicArgs).toEqual([USER, 7]);
        expect(n!.contractId).toBe(CONTRACT_ID);
        expect(n!.ledger).toBe(100);
        expect(n!.data).toEqual({});
    });

    it('normalizes an SDK-normalized event (ScVal topics, Contract id)', () => {
        const ev = {
            type: 'contract' as const,
            contractId: new Contract(CONTRACT_ID),
            id: '0001-2',
            ledger: 101,
            ledgerClosedAt: '2026-07-06T00:00:01Z',
            txHash: 'def456',
            topic: [sym('claim_funding'), Address.fromString(USER).toScVal()],
            value: xdr.ScVal.scvMap([mapEntry('amount', nativeToScVal(5n, { type: 'i128' }))]),
        };
        const n = normalizeRpc(ev as never);
        expect(n).toBeDefined();
        expect(n!.eventType).toBe('claim_funding');
        expect(n!.topicArgs).toEqual([USER]);
        expect(n!.contractId).toBe(CONTRACT_ID);
        expect(n!.data).toEqual({ amount: 5n });
    });

    it('returns undefined for non-contract events and empty topics', () => {
        expect(normalizeRpc({ type: 'system', topic: ['x'], contractId: CONTRACT_ID } as never)).toBeUndefined();
        expect(normalizeRpc({ type: 'contract', topic: [], contractId: CONTRACT_ID } as never)).toBeUndefined();
        expect(normalizeRpc({ type: 'contract', topic: ['y'], contractId: undefined } as never)).toBeUndefined();
    });

    it('returns undefined on malformed base64 topics', () => {
        const ev = rawRpcEvent([sym('x')], xdr.ScVal.scvMap([]));
        (ev as { topic: string[] }).topic = ['not-valid-xdr!!!'];
        expect(normalizeRpc(ev as never)).toBeUndefined();
    });
});

describe('normalizeGoldsky', () => {
    function goldsky(topics: unknown[], data: unknown): GoldskyWebhookEvent {
        return {
            id: 'g-1',
            type: 'contract',
            contract_id: CONTRACT_ID,
            topics: JSON.stringify(topics),
            data: JSON.stringify(data),
            in_successful_contract_call: true,
            transaction_hash: 'txh',
            transaction_successful: true,
            ledger_sequence: 55,
            ledger_closed_at: '2026-07-06T00:00:02Z',
        };
    }

    it('normalizes tagged values across every MercuryScVal shape', () => {
        const ev = goldsky(
            [{ symbol: 'increase_fill' }, { address: USER }, { u32: 3 }, { bool: true }],
            {
                map: [
                    { key: { symbol: 'notional' }, val: { i128: '1000' } },
                    { key: { symbol: 'tokens' }, val: { u128: '2000' } },
                    { key: { symbol: 'collateral' }, val: { i64: '30' } },
                    { key: { symbol: 'base_fee' }, val: { u64: '4' } },
                    { key: { symbol: 'impact_fee' }, val: { i32: -1 } },
                    { key: { symbol: 'funding' }, val: { bytes: 'ff00' } },
                    { key: { symbol: 'borrowing' }, val: { vec: [{ u32: 9 }] } },
                ],
            },
        );
        const n = normalizeGoldsky(ev);
        expect(n).toBeDefined();
        expect(n!.eventType).toBe('increase_fill');
        expect(n!.topicArgs).toEqual([USER, 3, true]);
        expect(n!.data.notional).toBe(1000n);
        expect(n!.data.tokens).toBe(2000n);
        expect(n!.data.collateral).toBe(30n);
        expect(n!.data.base_fee).toBe(4n);
        expect(n!.data.impact_fee).toBe(-1);
        expect(n!.data.funding).toBe('ff00');
        expect(n!.data.borrowing).toEqual([9]);
        expect(n!.ledger).toBe(55);
        expect(n!.txHash).toBe('txh');
    });

    it('filters non-contract, failed, and malformed events', () => {
        const ok = goldsky([{ symbol: 'x' }], {});
        expect(normalizeGoldsky({ ...ok, type: 'system' })).toBeUndefined();
        expect(normalizeGoldsky({ ...ok, in_successful_contract_call: false })).toBeUndefined();
        expect(normalizeGoldsky({ ...ok, transaction_successful: false })).toBeUndefined();
        expect(normalizeGoldsky({ ...ok, topics: '' })).toBeUndefined();
        expect(normalizeGoldsky({ ...ok, topics: 'not json' })).toBeUndefined();
        expect(normalizeGoldsky({ ...ok, topics: '[]' })).toBeUndefined();
    });
});

describe('normalizeMercury', () => {
    it('normalizes a Mercury webhook payload', () => {
        const payload: MercuryWebhookEvent = {
            event: {
                contract_id: CONTRACT_ID,
                body: {
                    v0: {
                        topics: [{ symbol: 'cancelled' }, { u32: 12 }],
                        data: { map: [{ key: { symbol: 'x' }, val: { u32: 1 } }] },
                    },
                },
            },
            tx_hash: 'merc-tx',
            ledger: 77,
            ledger_closed_at: '2026-07-06T00:00:03Z',
        };
        const n = normalizeMercury(payload);
        expect(n).toBeDefined();
        expect(n!.eventType).toBe('cancelled');
        expect(n!.topicArgs).toEqual([12]);
        expect(n!.data).toEqual({ x: 1 });
        expect(n!.ledger).toBe(77);
    });

    it('returns undefined for empty topics or missing contract id', () => {
        expect(normalizeMercury({ event: { contract_id: '', body: { v0: { topics: [], data: {} } } } } as never)).toBeUndefined();
        expect(normalizeMercury({} as never)).toBeUndefined();
    });
});

describe('decodeEvent', () => {
    it('decodes a trading event from a raw RPC shape', () => {
        const ev = rawRpcEvent(
            [sym('cancel_order'), Address.fromString(USER).toScVal(), xdr.ScVal.scvU32(4)],
            xdr.ScVal.scvMap([]),
        );
        const decoded = decodeEvent(ev as never) as TradingCancelOrderEvent;
        expect(decoded).toBeDefined();
        expect(decoded.eventType).toBe(TradingEventType.CancelOrder);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(4);
    });

    it('decodes a trading fill event from a Goldsky shape', () => {
        const ev: GoldskyWebhookEvent = {
            id: 'g-2',
            type: 'contract',
            contract_id: CONTRACT_ID,
            topics: JSON.stringify([
                { symbol: 'increase_fill' }, { address: USER }, { u32: 8 }, { bool: true },
            ]),
            data: JSON.stringify({
                map: [
                    { key: { symbol: 'notional' }, val: { i128: '100' } },
                    { key: { symbol: 'tokens' }, val: { i128: '50' } },
                    { key: { symbol: 'collateral' }, val: { i128: '10' } },
                    { key: { symbol: 'base_fee' }, val: { i128: '1' } },
                    { key: { symbol: 'impact_fee' }, val: { i128: '2' } },
                    { key: { symbol: 'funding' }, val: { i128: '3' } },
                    { key: { symbol: 'borrowing' }, val: { i128: '4' } },
                ],
            }),
            in_successful_contract_call: true,
            transaction_hash: 'txh2',
            transaction_successful: true,
            ledger_sequence: 60,
            ledger_closed_at: '2026-07-06T00:00:04Z',
        };
        const decoded = decodeEvent(ev) as TradingIncreaseFillEvent;
        expect(decoded.eventType).toBe(TradingEventType.IncreaseFill);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(8);
        expect(decoded.isLong).toBe(true);
        expect(decoded.notional).toBe(100n);
        expect(decoded.borrowing).toBe(4n);
    });

    it('decodes a governance event from a Mercury shape', () => {
        const payload: MercuryWebhookEvent = {
            event: {
                contract_id: CONTRACT_ID,
                body: { v0: { topics: [{ symbol: 'Cancelled' }, { u32: 3 }], data: { map: [] } } },
            },
            tx_hash: 'merc-tx2',
            ledger: 78,
            ledger_closed_at: '2026-07-06T00:00:05Z',
        };
        const decoded = decodeEvent(payload) as GovernanceCancelledEvent;
        expect(decoded.eventType).toBe(GovernanceEventType.Cancelled);
        expect(decoded.nonce).toBe(3);
    });

    it('decodes a vault event', () => {
        const ev = rawRpcEvent(
            [sym('StrategyWithdraw'), Address.fromString(STRATEGY).toScVal()],
            xdr.ScVal.scvMap([mapEntry('amount', nativeToScVal(9n, { type: 'i128' }))]),
        );
        const decoded = decodeEvent(ev as never) as VaultStrategyWithdrawEvent;
        expect(decoded.eventType).toBe(VaultEventType.StrategyWithdraw);
        expect(decoded.strategy).toBe(STRATEGY);
        expect(decoded.amount).toBe(9n);
    });

    it('returns undefined for unknown event types and unnormalizable events', () => {
        const unknown = rawRpcEvent([sym('not_a_zenex_event')], xdr.ScVal.scvMap([]));
        expect(decodeEvent(unknown as never)).toBeUndefined();
        expect(decodeEvent({ type: 'system', topic: ['x'] } as never)).toBeUndefined();
    });
});
