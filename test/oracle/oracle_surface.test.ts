import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { OracleContract } from '../../src/contracts/oracle/oracle_contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 3));
const FEED_ID = Buffer.concat([Buffer.from([0x00, 0x03]), Buffer.alloc(30, 6)]);

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

const priceDataScVal = () => xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('ask'), val: nativeToScVal(101n, { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('bid'), val: nativeToScVal(99n, { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('feed_id'), val: xdr.ScVal.scvBytes(FEED_ID) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('publish_time'), val: nativeToScVal(1234n, { type: 'u64' }) }),
]);

describe('OracleContract surface', () => {
    const oracle = new OracleContract(CONTRACT_ID);

    it('deploy builds the constructor op', () => {
        const op = OracleContract.deploy(OWNER, Buffer.alloc(32, 9), {
            owner: OWNER, verifier: VERIFIER, max_staleness: 15n, spread_reduction_factor: 0n,
        });
        const create = xdr.Operation.fromXDR(op, 'base64').body()
            .invokeHostFunctionOp().hostFunction().createContractV2();
        expect(scValToNative(create.constructorArgs()[0])).toBe(OWNER);
        expect(scValToNative(create.constructorArgs()[1])).toBe(VERIFIER);
        expect(scValToNative(create.constructorArgs()[2])).toBe(15n);
        expect(scValToNative(create.constructorArgs()[3])).toBe(0n);
    });

    it('builds verification ops from Buffer and Uint8Array payloads', () => {
        const report = Buffer.from('cafebabe', 'hex');
        const vp = decodeInvoke(oracle.verifyPrice(report, FEED_ID));
        expect(vp.fn).toBe('verify_price');
        expect(vp.args).toEqual([report, FEED_ID]);

        const vpU8 = decodeInvoke(oracle.verifyPrice(new Uint8Array([1, 2]), new Uint8Array(FEED_ID)));
        expect(vpU8.args[0]).toEqual(Buffer.from([1, 2]));
        expect(vpU8.args[1]).toEqual(FEED_ID);
    });

    it('builds admin, ownable, and view ops', () => {
        expect(decodeInvoke(oracle.updateMaxStaleness(10n)).args).toEqual([10n]);
        expect(decodeInvoke(oracle.updateSpreadReductionFactor(1_000_000_000_000_000_000n)).args)
            .toEqual([1_000_000_000_000_000_000n]);
        expect(decodeInvoke(oracle.getOwner()).fn).toBe('get_owner');
        expect(decodeInvoke(oracle.transferOwnership(OWNER, 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(oracle.transferOwnership(Address.fromString(OWNER), 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(oracle.acceptOwnership()).fn).toBe('accept_ownership');
        expect(decodeInvoke(oracle.renounceOwnership()).fn).toBe('renounce_ownership');
        expect(decodeInvoke(oracle.verifier()).fn).toBe('verifier');
        expect(decodeInvoke(oracle.maxStaleness()).fn).toBe('max_staleness');
        expect(decodeInvoke(oracle.spreadReductionFactor()).fn).toBe('spread_reduction_factor');
    });

    it('parses results', () => {
        const p = OracleContract.parsers;
        const pd = p.verifyPrice(priceDataScVal().toXDR('base64'));
        expect(pd.feed_id).toEqual(FEED_ID);
        expect(pd.bid).toBe(99n);
        expect(pd.ask).toBe(101n);
        expect(pd.publish_time).toBe(1234n);

        expect(p.updateMaxStaleness()).toBeUndefined();
        expect(p.updateSpreadReductionFactor()).toBeUndefined();
        expect(p.verifier(Address.fromString(VERIFIER).toScVal().toXDR('base64'))).toBe(VERIFIER);
        expect(p.maxStaleness(nativeToScVal(15n, { type: 'u64' }).toXDR('base64'))).toBe(15n);
        expect(p.spreadReductionFactor(nativeToScVal(0n, { type: 'i128' }).toXDR('base64'))).toBe(0n);
        expect(p.getOwner(Address.fromString(OWNER).toScVal().toXDR('base64'))).toBe(OWNER);
        expect(p.transferOwnership()).toBeUndefined();
        expect(p.acceptOwnership()).toBeUndefined();
        expect(p.renounceOwnership()).toBeUndefined();
    });
});
