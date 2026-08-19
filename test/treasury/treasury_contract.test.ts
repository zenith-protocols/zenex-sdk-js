import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import { TreasuryContract, TreasuryConstructorArgs } from '../../src/contracts/treasury/contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const TO = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

describe('TreasuryContract', () => {
    const contract = new TreasuryContract(CONTRACT_ID);

    it('getRate/setRate/withdraw match the treasury/src/lib.rs Treasury trait exactly', () => {
        expect(decodeInvoke(contract.getRate())).toEqual({ fn: 'get_rate', args: [] });
        expect(decodeInvoke(contract.setRate(5n))).toEqual({ fn: 'set_rate', args: [5n] });
        expect(decodeInvoke(contract.withdraw(TOKEN, TO, 100n))).toEqual({
            fn: 'withdraw',
            args: [TOKEN, TO, 100n],
        });
    });

    it('static deploy builds __constructor(owner, rate)', () => {
        const args: TreasuryConstructorArgs = { owner: OWNER, rate: 100_000_000_000_000_000n };
        const op = TreasuryContract.deploy(OWNER, Buffer.alloc(32, 9), args, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const native = createContract.constructorArgs().map((a) => scValToNative(a));
        expect(native).toEqual([OWNER, 100_000_000_000_000_000n]);
    });

    it('contract spec constructor doc references SCALAR_18 (rate is an 18-decimal fraction, not SCALAR_7)', () => {
        const spec = TreasuryContract.spec;
        const ctor = spec.funcs().find((f) => f.name().toString() === '__constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.doc().toString()).toContain('SCALAR_18');
        expect(ctor!.doc().toString()).not.toContain('SCALAR_7');
    });
});
