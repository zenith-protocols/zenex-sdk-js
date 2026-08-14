import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { GovernanceContract } from '../../src/contracts/governance/governance_contract.js';
import { decodeGovernanceEvent, GovernanceEventType } from '../../src/contracts/governance/governance_events.js';
import { NormalizedEvent } from '../../src/base_event.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const TARGET = StrKey.encodeContract(Buffer.alloc(32, 3));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

function normalized(eventType: string, topicArgs: unknown[], data: Record<string, unknown>): NormalizedEvent {
    return {
        contractId: CONTRACT_ID, txHash: 't', ledger: 1,
        ledgerClosedAt: '2026-07-06T00:00:00Z', id: 'e-1',
        eventType, topicArgs, data,
    };
}

describe('GovernanceContract surface', () => {
    const gov = new GovernanceContract(CONTRACT_ID);

    it('deploy builds the constructor op', () => {
        const op = GovernanceContract.deploy(OWNER, Buffer.alloc(32, 9), { owner: OWNER, delay: 3600n });
        const create = xdr.Operation.fromXDR(op, 'base64').body()
            .invokeHostFunctionOp().hostFunction().createContractV2();
        expect(scValToNative(create.constructorArgs()[0])).toBe(OWNER);
        expect(scValToNative(create.constructorArgs()[1])).toBe(3600n);
    });

    it('builds timelock ops', () => {
        const q = decodeInvoke(gov.queue(TARGET, 'set_status', [xdr.ScVal.scvU32(1)]));
        expect(q.fn).toBe('queue');
        expect(q.args).toEqual([TARGET, 'set_status', [1]]);

        expect(decodeInvoke(gov.cancel(2)).args).toEqual([2]);
        expect(decodeInvoke(gov.execute(3)).args).toEqual([3]);
    });

    it('builds admin and view ops', () => {
        const s = decodeInvoke(gov.setStatus(TARGET, 4));
        expect(s.fn).toBe('set_status');
        expect(s.args).toEqual([TARGET, 4]);
        expect(decodeInvoke(gov.setDelay(120n)).args).toEqual([120n]);
        expect(decodeInvoke(gov.applyDelay()).fn).toBe('apply_delay');
        expect(decodeInvoke(gov.getDelay()).fn).toBe('get_delay');
        expect(decodeInvoke(gov.getQueued(5)).args).toEqual([5]);
    });

    it('builds ownable ops (string and Address forms)', () => {
        expect(decodeInvoke(gov.getOwner()).fn).toBe('get_owner');
        expect(decodeInvoke(gov.transferOwnership(OWNER, 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(gov.transferOwnership(Address.fromString(OWNER), 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(gov.acceptOwnership()).fn).toBe('accept_ownership');
        expect(decodeInvoke(gov.renounceOwnership()).fn).toBe('renounce_ownership');
    });

    it('parses results', () => {
        const p = GovernanceContract.parsers;
        expect(p.queue(xdr.ScVal.scvU32(7).toXDR('base64'))).toBe(7);
        expect(p.cancel()).toBeUndefined();
        expect(p.execute()).toBeUndefined();
        expect(p.setStatus()).toBeUndefined();
        expect(p.setDelay()).toBeUndefined();
        expect(p.applyDelay()).toBeUndefined();
        expect(p.getDelay(nativeToScVal(60n, { type: 'u64' }).toXDR('base64'))).toBe(60n);
        expect(p.getOwner(Address.fromString(OWNER).toScVal().toXDR('base64'))).toBe(OWNER);
        expect(p.transferOwnership()).toBeUndefined();
        expect(p.acceptOwnership()).toBeUndefined();
        expect(p.renounceOwnership()).toBeUndefined();

        const queued = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('args'), val: xdr.ScVal.scvVec([]) }),
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('fn_name'), val: xdr.ScVal.scvSymbol('set_rate') }),
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('target'), val: Address.fromString(TARGET).toScVal() }),
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('unlock_time'), val: nativeToScVal(99n, { type: 'u64' }) }),
        ]).toXDR('base64');
        const qc = p.getQueued(queued);
        expect(qc.target).toBe(TARGET);
        expect(qc.fn_name).toBe('set_rate');
        expect(qc.unlock_time).toBe(99n);
    });
});
