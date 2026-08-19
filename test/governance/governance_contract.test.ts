import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import { GovernanceContract } from '../../src/contracts/governance/contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TARGET = StrKey.encodeContract(Buffer.alloc(32, 2));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

describe('GovernanceContract', () => {
    const contract = new GovernanceContract(CONTRACT_ID);

    it('has no upgrade method (governance/src/lib.rs has no Upgradeable impl or upgrade entrypoint)', () => {
        expect((contract as unknown as Record<string, unknown>).upgrade).toBeUndefined();
    });

    it('parsers has no upgrade entry', () => {
        expect((GovernanceContract.parsers as unknown as Record<string, unknown>).upgrade).toBeUndefined();
    });

    it('contract spec has no upgrade function (matches the extracted v2 governance bindings)', () => {
        const names = GovernanceContract.spec.funcs().map((f) => f.name().toString());
        expect(names).not.toContain('upgrade');
        expect(names).toContain('queue');
        expect(names).toContain('set_status');
    });

    it('setStatus still targets the correct contract and status', () => {
        const op = contract.setStatus(TARGET, 2);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('set_status');
        expect(args).toEqual([TARGET, 2]);
    });
});
