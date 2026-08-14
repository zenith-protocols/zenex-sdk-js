import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, nativeToScVal, StrKey } from '@stellar/stellar-sdk';
import { PriceVerifierContract, PriceVerifierConstructorArgs } from '../../src/contracts/price-verifier/price_verifier_contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const LAZER = StrKey.encodeContract(Buffer.alloc(32, 3));
const NEW_LAZER = StrKey.encodeContract(Buffer.alloc(32, 4));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

describe('PriceVerifierContract', () => {
    const contract = new PriceVerifierContract(CONTRACT_ID);

    it('verifyPrice sends update_data, feed_id, and exponent (matches verify_price(update_data, feed_id, exponent))', () => {
        const updateData = Buffer.alloc(4, 9);
        const op = contract.verifyPrice(updateData, 42, -8);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('verify_price');
        expect(args).toEqual([updateData, 42, -8]);
    });

    it('static deploy encodes lazer as an Address in constructor args (not trusted_signer bytes)', () => {
        const args: PriceVerifierConstructorArgs = {
            owner: OWNER,
            lazer: LAZER,
            max_confidence_bps: 100,
            max_staleness: 15n,
        };
        const op = PriceVerifierContract.deploy(OWNER, Buffer.alloc(32, 9), args, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const ctorArgs = createContract.constructorArgs();
        const native = ctorArgs.map((a) => scValToNative(a));
        expect(native).toEqual([OWNER, LAZER, 100, 15n]);
    });

    it('updateLazer builds update_lazer with the new lazer address (replaces update_trusted_signer)', () => {
        const op = contract.updateLazer(NEW_LAZER);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('update_lazer');
        expect(args).toEqual([NEW_LAZER]);
    });

    it('has no updateTrustedSigner method (removed; v2 delegates to a Lazer contract address, not a raw signer key)', () => {
        expect((contract as unknown as Record<string, unknown>).updateTrustedSigner).toBeUndefined();
    });

    it('lazer getter builds a lazer call', () => {
        const op = contract.lazer();
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('lazer');
        expect(args).toEqual([]);
    });

    it('parsers.verifyPrice decodes ask/bid/exponent/feed_id/publish_time', () => {
        const entry = (key: string, val: xdr.ScVal) =>
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
        const priceData = xdr.ScVal.scvMap([
            entry('ask', nativeToScVal(200n, { type: 'i128' })),
            entry('bid', nativeToScVal(100n, { type: 'i128' })),
            entry('exponent', xdr.ScVal.scvI32(-8)),
            entry('feed_id', xdr.ScVal.scvU32(7)),
            entry('publish_time', nativeToScVal(1234n, { type: 'u64' })),
        ]);
        const result = PriceVerifierContract.parsers.verifyPrice(priceData.toXDR('base64'));
        expect(result).toEqual({
            ask: 200n,
            bid: 100n,
            exponent: -8,
            feed_id: 7,
            publish_time: 1234n,
        });
    });

    it('contract spec exposes lazer/update_lazer functions and PriceData has ask/bid fields', () => {
        const spec = PriceVerifierContract.spec;
        const names = spec.funcs().map((f) => f.name().toString());
        expect(names).toContain('lazer');
        expect(names).toContain('update_lazer');
        expect(names).not.toContain('update_trusted_signer');

        const structEntry = spec.entries.find(
            (e) => e.switch().name === 'scSpecEntryUdtStructV0' && e.udtStructV0().name().toString() === 'PriceData',
        );
        expect(structEntry).toBeDefined();
        const fields = structEntry!.udtStructV0().fields().map((f) => f.name().toString());
        expect(fields).toEqual(['ask', 'bid', 'exponent', 'feed_id', 'publish_time']);
    });
});
