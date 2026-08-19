import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { TreasuryContract } from '../../src/contracts/treasury/contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const TO = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

describe('TreasuryContract surface', () => {
    const treasury = new TreasuryContract(CONTRACT_ID);

    it('deploy builds the constructor op', () => {
        const op = TreasuryContract.deploy(OWNER, Buffer.alloc(32, 9), { owner: OWNER, rate: 5n });
        const create = xdr.Operation.fromXDR(op, 'base64').body()
            .invokeHostFunctionOp().hostFunction().createContractV2();
        expect(scValToNative(create.constructorArgs()[0])).toBe(OWNER);
        expect(scValToNative(create.constructorArgs()[1])).toBe(5n);

        const opHex = TreasuryContract.deploy(OWNER, Buffer.alloc(32, 9).toString('hex'), { owner: OWNER, rate: 5n });
        expect(opHex).toBeTypeOf('string');
    });

    it('builds admin, ownable, and view ops', () => {
        const sr = decodeInvoke(treasury.setRate(7n));
        expect(sr.fn).toBe('set_rate');
        expect(sr.args).toEqual([7n]);

        const w = decodeInvoke(treasury.withdraw(TOKEN, TO, 100n));
        expect(w.fn).toBe('withdraw');
        expect(w.args).toEqual([TOKEN, TO, 100n]);

        expect(decodeInvoke(treasury.getOwner()).fn).toBe('get_owner');
        expect(decodeInvoke(treasury.transferOwnership(OWNER, 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(treasury.transferOwnership(Address.fromString(OWNER), 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(treasury.acceptOwnership()).fn).toBe('accept_ownership');
        expect(decodeInvoke(treasury.renounceOwnership()).fn).toBe('renounce_ownership');
        expect(decodeInvoke(treasury.getRate()).fn).toBe('get_rate');
    });

    it('parses results', () => {
        const p = TreasuryContract.parsers;
        expect(p.getRate(nativeToScVal(9n, { type: 'i128' }).toXDR('base64'))).toBe(9n);
        expect(p.setRate()).toBeUndefined();
        expect(p.withdraw()).toBeUndefined();
        expect(p.getOwner(Address.fromString(OWNER).toScVal().toXDR('base64'))).toBe(OWNER);
        expect(p.transferOwnership()).toBeUndefined();
        expect(p.acceptOwnership()).toBeUndefined();
        expect(p.renounceOwnership()).toBeUndefined();
    });
});
