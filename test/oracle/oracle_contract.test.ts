import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, nativeToScVal, StrKey } from '@stellar/stellar-sdk';
import { OracleContract, OracleConstructorArgs } from '../../src/contracts/oracle/oracle_contract.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 3));
const FEED_ID = Buffer.concat([Buffer.from([0x00, 0x03]), Buffer.alloc(30, 7)]);

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

describe('OracleContract', () => {
    const oracle = new OracleContract(CONTRACT_ID);

    it('verifyPrice sends report bytes and a 32-byte feed_id (matches verify_price(report, feed_id))', () => {
        const report = Buffer.alloc(4, 9);
        const op = oracle.verifyPrice(report, FEED_ID);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('verify_price');
        expect(args).toEqual([report, FEED_ID]);
    });

    it('verifyPrice rejects a feed_id that is not exactly 32 bytes', () => {
        expect(() => oracle.verifyPrice(Buffer.alloc(4), Buffer.alloc(31))).toThrow(/32 bytes/);
        expect(() => oracle.verifyPrice(Buffer.alloc(4), Buffer.alloc(33))).toThrow(/32 bytes/);
    });

    it('static deploy encodes (owner, verifier, max_staleness, spread_reduction_factor)', () => {
        const args: OracleConstructorArgs = {
            owner: OWNER,
            verifier: VERIFIER,
            max_staleness: 15n,
            spread_reduction_factor: 500_000_000_000_000_000n,
        };
        const op = OracleContract.deploy(OWNER, Buffer.alloc(32, 9), args, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const ctorArgs = createContract.constructorArgs();
        const native = ctorArgs.map((a) => scValToNative(a));
        expect(native).toEqual([OWNER, VERIFIER, 15n, 500_000_000_000_000_000n]);
    });

    it('has no Pyth Lazer surface (verify_prices/update_lazer/max_confidence_bps removed)', () => {
        const o = oracle as unknown as Record<string, unknown>;
        expect(o.verifyPrices).toBeUndefined();
        expect(o.updateLazer).toBeUndefined();
        expect(o.updateMaxConfidenceBps).toBeUndefined();
        expect(o.lazer).toBeUndefined();
        expect(o.maxConfidenceBps).toBeUndefined();
    });

    it('updateSpreadReductionFactor builds update_spread_reduction_factor with an i128 factor', () => {
        const op = oracle.updateSpreadReductionFactor(250_000_000_000_000_000n);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('update_spread_reduction_factor');
        expect(args).toEqual([250_000_000_000_000_000n]);
    });

    it('verifier getter builds a verifier call (the pinned Chainlink verifier address)', () => {
        const op = oracle.verifier();
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('verifier');
        expect(args).toEqual([]);
    });

    it('parsers.verifyPrice decodes ask/bid/feed_id/publish_time (no exponent)', () => {
        const entry = (key: string, val: xdr.ScVal) =>
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
        const priceData = xdr.ScVal.scvMap([
            entry('ask', nativeToScVal(200n, { type: 'i128' })),
            entry('bid', nativeToScVal(100n, { type: 'i128' })),
            entry('feed_id', xdr.ScVal.scvBytes(FEED_ID)),
            entry('publish_time', nativeToScVal(1234n, { type: 'u64' })),
        ]);
        const result = OracleContract.parsers.verifyPrice(priceData.toXDR('base64'));
        expect(result).toEqual({
            ask: 200n,
            bid: 100n,
            feed_id: FEED_ID,
            publish_time: 1234n,
        });
    });

    it('contract spec exposes verifier/spread_reduction_factor functions and PriceData has no exponent', () => {
        const spec = OracleContract.spec;
        const names = spec.funcs().map((f) => f.name().toString());
        expect(names).toContain('verify_price');
        expect(names).toContain('verifier');
        expect(names).toContain('spread_reduction_factor');
        expect(names).toContain('update_spread_reduction_factor');
        expect(names).toContain('update_max_staleness');
        expect(names).toContain('max_staleness');
        expect(names).not.toContain('verify_prices');
        expect(names).not.toContain('lazer');
        expect(names).not.toContain('update_lazer');
        expect(names).not.toContain('max_confidence_bps');
        expect(names).not.toContain('update_max_confidence_bps');

        const structEntry = spec.entries.find(
            (e) => e.switch().name === 'scSpecEntryUdtStructV0' && e.udtStructV0().name().toString() === 'PriceData',
        );
        expect(structEntry).toBeDefined();
        const fields = structEntry!.udtStructV0().fields().map((f) => f.name().toString());
        expect(fields).toEqual(['ask', 'bid', 'feed_id', 'publish_time']);
    });
});
