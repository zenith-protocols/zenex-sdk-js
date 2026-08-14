import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { PriceVerifierContract } from '../../src/contracts/price-verifier/price_verifier_contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const LAZER = StrKey.encodeContract(Buffer.alloc(32, 3));

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
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('exponent'), val: xdr.ScVal.scvI32(-8) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('feed_id'), val: xdr.ScVal.scvU32(1) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('price'), val: nativeToScVal(100n, { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('publish_time'), val: nativeToScVal(1234n, { type: 'u64' }) }),
]);

describe('PriceVerifierContract surface', () => {
    const pv = new PriceVerifierContract(CONTRACT_ID);

    it('deploy builds the constructor op', () => {
        const op = PriceVerifierContract.deploy(OWNER, Buffer.alloc(32, 9), {
            owner: OWNER, lazer: LAZER, max_confidence_bps: 100, max_staleness: 15n,
        });
        const create = xdr.Operation.fromXDR(op, 'base64').body()
            .invokeHostFunctionOp().hostFunction().createContractV2();
        expect(scValToNative(create.constructorArgs()[0])).toBe(OWNER);
        expect(scValToNative(create.constructorArgs()[1])).toBe(LAZER);
        expect(scValToNative(create.constructorArgs()[2])).toBe(100);
        expect(scValToNative(create.constructorArgs()[3])).toBe(15n);
    });

    it('builds verification ops from Buffer and Uint8Array payloads', () => {
        const update = Buffer.from('cafebabe', 'hex');
        const vp = decodeInvoke(pv.verifyPrice(update, 6, -8));
        expect(vp.fn).toBe('verify_price');
        expect(vp.args).toEqual([update, 6, -8]);

        const vpU8 = decodeInvoke(pv.verifyPrice(new Uint8Array([1, 2]), 6, -8));
        expect(vpU8.args[0]).toEqual(Buffer.from([1, 2]));

        const vps = decodeInvoke(pv.verifyPrices(update));
        expect(vps.fn).toBe('verify_prices');
        expect(decodeInvoke(pv.verifyPrices(new Uint8Array([3]))).args[0]).toEqual(Buffer.from([3]));
    });

    it('builds admin, ownable, and view ops', () => {
        expect(decodeInvoke(pv.updateLazer(LAZER)).args).toEqual([LAZER]);
        expect(decodeInvoke(pv.updateLazer(Address.fromString(LAZER))).args).toEqual([LAZER]);
        expect(decodeInvoke(pv.updateMaxConfidenceBps(50)).args).toEqual([50]);
        expect(decodeInvoke(pv.updateMaxStaleness(10n)).args).toEqual([10n]);
        expect(decodeInvoke(pv.getOwner()).fn).toBe('get_owner');
        expect(decodeInvoke(pv.transferOwnership(OWNER, 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(pv.transferOwnership(Address.fromString(OWNER), 100)).args).toEqual([OWNER, 100]);
        expect(decodeInvoke(pv.acceptOwnership()).fn).toBe('accept_ownership');
        expect(decodeInvoke(pv.renounceOwnership()).fn).toBe('renounce_ownership');
        expect(decodeInvoke(pv.maxConfidenceBps()).fn).toBe('max_confidence_bps');
        expect(decodeInvoke(pv.maxStaleness()).fn).toBe('max_staleness');
        expect(decodeInvoke(pv.lazer()).fn).toBe('lazer');
    });

    it('parses results', () => {
        const p = PriceVerifierContract.parsers;
        const pd = p.verifyPrice(priceDataScVal().toXDR('base64'));
        expect(pd.price).toBe(100n);
        expect(pd.bid).toBe(99n);
        expect(pd.ask).toBe(101n);
        expect(pd.publish_time).toBe(1234n);

        const pds = p.verifyPrices(xdr.ScVal.scvVec([priceDataScVal()]).toXDR('base64'));
        expect(pds).toHaveLength(1);
        expect(pds[0].feed_id).toBe(1);

        expect(p.updateLazer()).toBeUndefined();
        expect(p.updateMaxConfidenceBps()).toBeUndefined();
        expect(p.updateMaxStaleness()).toBeUndefined();
        expect(p.lazer(Address.fromString(LAZER).toScVal().toXDR('base64'))).toBe(LAZER);
        expect(p.maxConfidenceBps(xdr.ScVal.scvU32(100).toXDR('base64'))).toBe(100);
        expect(p.maxStaleness(nativeToScVal(15n, { type: 'u64' }).toXDR('base64'))).toBe(15n);
        expect(p.getOwner(Address.fromString(OWNER).toScVal().toXDR('base64'))).toBe(OWNER);
        expect(p.transferOwnership()).toBeUndefined();
        expect(p.acceptOwnership()).toBeUndefined();
        expect(p.renounceOwnership()).toBeUndefined();
    });
});
