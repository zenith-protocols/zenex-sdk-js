import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, nativeToScVal, StrKey } from '@stellar/stellar-sdk';
import { OracleContract, OracleConstructorArgs } from '../../src/contracts/oracle/contract.js';

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

    it('verifyPrice sends report bytes, a 32-byte feed_id, and the class flag (matches verify_price(report, feed_id, protective))', () => {
        const report = Buffer.alloc(4, 9);
        const { fn, args } = decodeInvoke(oracle.verifyPrice(report, FEED_ID));
        expect(fn).toBe('verify_price');
        // Strict trade window by default: a fill must never silently borrow
        // the wider gap-closing allowance.
        expect(args).toEqual([report, FEED_ID, false]);
    });

    it('verifyPrice sets protective for the wider gap-closing staleness window', () => {
        const report = Buffer.alloc(4, 9);
        const { args } = decodeInvoke(oracle.verifyPrice(report, FEED_ID, true));
        expect(args).toEqual([report, FEED_ID, true]);
    });

    it('verifyPrice rejects a feed_id that is not exactly 32 bytes', () => {
        expect(() => oracle.verifyPrice(Buffer.alloc(4), Buffer.alloc(31))).toThrow(/32 bytes/);
        expect(() => oracle.verifyPrice(Buffer.alloc(4), Buffer.alloc(33))).toThrow(/32 bytes/);
    });

    it('static deploy encodes (owner, verifier, trade_staleness, close_staleness, spread_reduction_factor)', () => {
        const args: OracleConstructorArgs = {
            owner: OWNER,
            verifier: VERIFIER,
            trade_staleness: 10n,
            close_staleness: 120n,
            spread_reduction_factor: 500_000_000_000_000_000n,
        };
        const op = OracleContract.deploy(OWNER, Buffer.alloc(32, 9), args, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const ctorArgs = createContract.constructorArgs();
        const native = ctorArgs.map((a) => scValToNative(a));
        // Order matters: the two u64 windows are adjacent and indistinguishable
        // on the wire, so a swapped pair would deploy an oracle whose fills
        // accept 120s-old reports.
        expect(native).toEqual([OWNER, VERIFIER, 10n, 120n, 500_000_000_000_000_000n]);
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

    it('parsers.verifyPrice decodes ask/bid/publish_time (no feed_id echo, no exponent)', () => {
        const entry = (key: string, val: xdr.ScVal) =>
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
        const priceData = xdr.ScVal.scvMap([
            entry('ask', nativeToScVal(200n, { type: 'i128' })),
            entry('bid', nativeToScVal(100n, { type: 'i128' })),
            entry('publish_time', nativeToScVal(1234n, { type: 'u64' })),
        ]);
        const result = OracleContract.parsers.verifyPrice(priceData.toXDR('base64'));
        expect(result).toEqual({
            ask: 200n,
            bid: 100n,
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
        expect(names).toContain('update_staleness');
        expect(names).toContain('trade_staleness');
        expect(names).toContain('close_staleness');
        // The single-window surface is gone, not aliased.
        expect(names).not.toContain('update_max_staleness');
        expect(names).not.toContain('max_staleness');
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
        expect(fields).toEqual(['ask', 'bid', 'publish_time']);
    });

    it('upgrade builds with the wasm hash first, then the operator', () => {
        const oracle = new OracleContract(CONTRACT_ID);
        const { fn, args } = decodeInvoke(oracle.upgrade(Buffer.alloc(32, 7), OWNER));
        expect(fn).toBe('upgrade');
        expect(Buffer.from(args[0])).toEqual(Buffer.alloc(32, 7));
        expect(args[1]).toBe(OWNER);
    });
});
