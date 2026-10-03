import { describe, it, expect } from 'vitest';
import { Address, StrKey, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import {
    FeeForwarderContract,
    type ForwardTarget,
    type RelayFee,
} from '../../src/contracts/fee_forwarder/contract.js';
import { MarketRouterContract } from '../../src/contracts/router/contract.js';
import type { Call } from '../../src/contracts/router/types.js';
import { OrderKind } from '../../src/contracts/market/types.js';

// =============================================================================
// The fee forwarder binding, checked three ways:
//   1. against the forwarder's own spec encoder (`funcArgsToScVals`), with the
//      router arguments encoded by the router's spec encoder, so neither side
//      reuses the binding's hand-built ScVals;
//   2. against the envelope zenex-trade validates (src/wallet/submit.ts:
//      forwarderFunction, forwarderTargetFunction, expectedForwarderFunction,
//      validatePreparedForwarderFunc), ported below slot for slot;
//   3. against the relayer plugin's slot table (relayer-plugin-zenex
//      src/plugin/parse.ts: ROUTES, FORWARDER_SLOT, TARGET_SLOT, signedArgs).
// =============================================================================

const FORWARDER = StrKey.encodeContract(Buffer.alloc(32, 1));
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 2));
const MARKET = StrKey.encodeContract(Buffer.alloc(32, 3));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
const RECIPIENT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const PRICE = Buffer.from('c0ffee', 'hex');

const FEE: RelayFee = {
    feeToken: TOKEN,
    feeAmount: 12_345n,
    maxFeeAmount: 10_000_000n,
    expirationLedger: 61_000_000,
    feeRecipient: RECIPIENT,
};

function openCall(): Call {
    return MarketRouterContract.createOrderCall({
        market: MARKET, user: USER, isLong: true, kind: OrderKind.MarketIncrease,
        notional: 1_000_0000000n, margin: 100_0000000n, triggerPrice: 0n,
        priceBound: 250_000_000_000_000_000n, expiration: 61_000_100,
    });
}

function takeProfitCall(): Call {
    return MarketRouterContract.createOrderCall({
        market: MARKET, user: USER, isLong: true, kind: OrderKind.LimitDecrease,
        notional: 500_0000000n, margin: 0n, triggerPrice: 300_000_000_000_000_000n,
        priceBound: 0n, expiration: 61_000_100,
    });
}

function decodeInvoke(operation: string): xdr.InvokeContractArgs {
    return xdr.Operation.fromXDR(operation, 'base64')
        .body().invokeHostFunctionOp().hostFunction().invokeContract();
}

const hex = (value: { toXDR(format: 'hex'): string }): string => value.toXDR('hex');

/** The router calls as the router spec encodes them: an independent `Call` encoding. */
function nativeCalls(calls: Call[]): { contract: string; func: string; args: xdr.ScVal[] }[] {
    return calls.map((call) => ({ contract: call.contract, func: call.func, args: call.args }));
}

function specForwardArgs(
    entry: 'forward' | 'forward_dynamic',
    target: ForwardTarget,
    targetArgs: xdr.ScVal[],
): xdr.ScVal[] {
    return FeeForwarderContract.spec.funcArgsToScVals(entry, {
        fee_token: FEE.feeToken,
        fee_amount: FEE.feeAmount,
        max_fee_amount: FEE.maxFeeAmount,
        expiration_ledger: FEE.expirationLedger,
        target_contract: ROUTER,
        target_fn: target,
        target_args: targetArgs,
        user: USER,
        fee_recipient: FEE.feeRecipient,
    });
}

describe('FeeForwarderContract encoding vs the spec encoders', () => {
    const forwarder = new FeeForwarderContract(FORWARDER);
    const calls = [openCall(), takeProfitCall()];

    it('forwardMulticall builds forward over router multicall(calls)', () => {
        const invoke = decodeInvoke(forwarder.forwardMulticall(ROUTER, calls, USER, FEE));
        expect(Address.fromScAddress(invoke.contractAddress()).toString()).toBe(FORWARDER);
        expect(invoke.functionName().toString()).toBe('forward');

        const routerArgs = MarketRouterContract.spec.funcArgsToScVals('multicall', {
            calls: nativeCalls(calls),
        });
        expect(invoke.args().map(hex))
            .toEqual(specForwardArgs('forward', 'multicall', routerArgs).map(hex));
    });

    it.each([
        ['forwardCreateAndFill', 'create_and_fill'],
        ['forwardCreateAndTryFill', 'create_and_try_fill'],
    ] as const)('%s builds forward_dynamic over router %s(calls, user, keeper, price)', (method, target) => {
        const invoke = decodeInvoke(forwarder[method](ROUTER, calls, USER, KEEPER, PRICE, FEE));
        expect(invoke.functionName().toString()).toBe('forward_dynamic');

        const routerArgs = MarketRouterContract.spec.funcArgsToScVals(target, {
            calls: nativeCalls(calls),
            user: USER,
            keeper: KEEPER,
            price: PRICE,
        });
        expect(invoke.args().map(hex))
            .toEqual(specForwardArgs('forward_dynamic', target, routerArgs).map(hex));
    });

    it('target_args is byte-identical to the router call it relays', () => {
        const router = new MarketRouterContract(ROUTER);
        const relayed = decodeInvoke(
            forwarder.forwardCreateAndFill(ROUTER, calls, USER, KEEPER, PRICE, FEE),
        ).args()[6].vec()!;
        const direct = decodeInvoke(router.createAndFill(calls, USER, KEEPER, PRICE)).args();
        expect(relayed.map(hex)).toEqual(direct.map(hex));

        const relayedBatch = decodeInvoke(
            forwarder.forwardMulticall(ROUTER, calls, USER, FEE),
        ).args()[6].vec()!;
        const directBatch = decodeInvoke(router.multicall(calls)).args();
        expect(relayedBatch.map(hex)).toEqual(directBatch.map(hex));
    });

    it('accepts a Uint8Array price update', () => {
        const fromBuffer = forwarder.forwardCreateAndFill(ROUTER, calls, USER, KEEPER, PRICE, FEE);
        const fromBytes = forwarder.forwardCreateAndFill(
            ROUTER, calls, USER, KEEPER, new Uint8Array(PRICE), FEE,
        );
        expect(fromBytes).toBe(fromBuffer);
    });

    it('every relayed target is an entry point the router spec declares', () => {
        const declared = new Set(
            MarketRouterContract.spec.funcs().map((func) => func.name().toString()),
        );
        const targets = [
            decodeInvoke(forwarder.forwardMulticall(ROUTER, calls, USER, FEE)),
            decodeInvoke(forwarder.forwardCreateAndFill(ROUTER, calls, USER, KEEPER, PRICE, FEE)),
            decodeInvoke(forwarder.forwardCreateAndTryFill(ROUTER, calls, USER, KEEPER, PRICE, FEE)),
        ].map((invoke) => invoke.args()[5].sym().toString());
        expect(targets).toEqual(['multicall', 'create_and_fill', 'create_and_try_fill']);
        expect(targets.filter((name) => !declared.has(name))).toEqual([]);
    });
});

describe('FeeForwarderContract.authorizedArgs (the require_auth_for_args payload)', () => {
    const forwarder = new FeeForwarderContract(FORWARDER);
    const calls = [openCall()];

    it('signs (fee_token, max_fee_amount, expiration_ledger, fee_recipient, target_contract, target_fn, target_args) for multicall', () => {
        const signed = FeeForwarderContract.authorizedArgs('multicall', ROUTER, calls, FEE);
        const expected = [
            Address.fromString(TOKEN).toScVal(),
            nativeToScVal(FEE.maxFeeAmount, { type: 'i128' }),
            xdr.ScVal.scvU32(FEE.expirationLedger),
            Address.fromString(RECIPIENT).toScVal(),
            Address.fromString(ROUTER).toScVal(),
            xdr.ScVal.scvSymbol('multicall'),
            xdr.ScVal.scvVec(
                MarketRouterContract.spec.funcArgsToScVals('multicall', { calls: nativeCalls(calls) }),
            ),
        ];
        expect(signed.map(hex)).toEqual(expected.map(hex));
    });

    it.each(['create_and_fill', 'create_and_try_fill'] as const)(
        'leaves target_args out for %s (forward_dynamic)',
        (target) => {
            const signed = FeeForwarderContract.authorizedArgs(target, ROUTER, calls, FEE);
            expect(signed).toHaveLength(6);
            expect(signed[5].sym().toString()).toBe(target);
        },
    );

    it('needs no feeAmount: the relayer sets it after signing', () => {
        const { feeAmount: _unsigned, ...signedTerms } = FEE;
        expect(FeeForwarderContract.authorizedArgs('multicall', ROUTER, calls, signedTerms).map(hex))
            .toEqual(FeeForwarderContract.authorizedArgs('multicall', ROUTER, calls, FEE).map(hex));
    });

    it('keeps the fee recipient at index 3, the slot the session policy pins', () => {
        const signed = FeeForwarderContract.authorizedArgs('create_and_fill', ROUTER, calls, FEE);
        expect(Address.fromScVal(signed[3]).toString()).toBe(RECIPIENT);
    });

    it("matches the relayer's signedArgs projection of the built operation", () => {
        // relayer-plugin-zenex parse.ts: SIGNED_SLOTS, plus target_args for `forward`.
        const SIGNED_SLOTS = [0, 2, 3, 8, 4, 5];
        const cases: [string, ForwardTarget, boolean][] = [
            [forwarder.forwardMulticall(ROUTER, calls, USER, FEE), 'multicall', true],
            [forwarder.forwardCreateAndFill(ROUTER, calls, USER, KEEPER, PRICE, FEE), 'create_and_fill', false],
            [forwarder.forwardCreateAndTryFill(ROUTER, calls, USER, KEEPER, PRICE, FEE), 'create_and_try_fill', false],
        ];
        for (const [operation, target, signsTargetArgs] of cases) {
            const args = decodeInvoke(operation).args();
            const slots = signsTargetArgs ? [...SIGNED_SLOTS, 6] : SIGNED_SLOTS;
            expect(slots.map((slot) => hex(args[slot])))
                .toEqual(FeeForwarderContract.authorizedArgs(target, ROUTER, calls, FEE).map(hex));
        }
    });
});

describe('FeeForwarderContract vs the zenex-trade relay envelope', () => {
    // zenex-trade src/wallet/submit.ts, ported: the route-to-entry mapping and
    // the slots validatePreparedForwarderFunc commits to.
    type Mode = 'calls' | 'fill' | 'try-fill';
    const forwarderFunction = (mode: Mode) => (mode === 'calls' ? 'forward' : 'forward_dynamic');
    const forwarderTargetFunction = (mode: Mode) =>
        mode === 'calls' ? 'multicall' : `create_and_${mode.replace('-', '_')}`;

    const forwarder = new FeeForwarderContract(FORWARDER);
    const calls = [openCall(), takeProfitCall()];
    const expectedCalls = xdr.ScVal.scvVec(calls.map((call) =>
        MarketRouterContract.spec.nativeToScVal(
            { contract: call.contract, func: call.func, args: call.args },
            xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: 'Call' })),
        )));
    const expected = {
        calls: expectedCalls,
        user: Address.fromString(USER).toScVal(),
        feeToken: Address.fromString(TOKEN).toScVal(),
        maximumFee: nativeToScVal(FEE.maxFeeAmount, { type: 'i128' }),
        feeExpiration: xdr.ScVal.scvU32(FEE.expirationLedger),
        router: Address.fromString(ROUTER).toScVal(),
        feeRecipient: Address.fromString(RECIPIENT).toScVal(),
    };

    const built: Record<Mode, string> = {
        calls: forwarder.forwardMulticall(ROUTER, calls, USER, FEE),
        fill: forwarder.forwardCreateAndFill(ROUTER, calls, USER, KEEPER, PRICE, FEE),
        'try-fill': forwarder.forwardCreateAndTryFill(ROUTER, calls, USER, KEEPER, PRICE, FEE),
    };

    it.each(['calls', 'fill', 'try-fill'] as const)('%s passes validatePreparedForwarderFunc', (mode) => {
        const invoke = decodeInvoke(built[mode]);
        expect(Address.fromScAddress(invoke.contractAddress()).toString()).toBe(FORWARDER);
        expect(invoke.functionName().toString()).toBe(forwarderFunction(mode));
        const args = invoke.args();
        expect(args).toHaveLength(9);
        const committed: [number, xdr.ScVal][] = [
            [0, expected.feeToken],
            [2, expected.maximumFee],
            [3, expected.feeExpiration],
            [4, expected.router],
            [5, xdr.ScVal.scvSymbol(forwarderTargetFunction(mode))],
            [7, expected.user],
            [8, expected.feeRecipient],
        ];
        for (const [slot, value] of committed) expect(hex(args[slot])).toBe(hex(value));
        const targetArgs = args[6];
        expect(targetArgs.switch().name).toBe('scvVec');
        if (mode === 'calls') {
            expect(hex(targetArgs)).toBe(hex(xdr.ScVal.scvVec([expected.calls])));
        } else {
            const vec = targetArgs.vec()!;
            expect(vec).toHaveLength(4);
            expect(hex(vec[0])).toBe(hex(expected.calls));
            expect(hex(vec[1])).toBe(hex(expected.user));
        }
    });

    it.each(['calls', 'fill', 'try-fill'] as const)(
        '%s signs the tuple expectedForwarderFunction expects',
        (mode) => {
            const projection = [
                expected.feeToken,
                expected.maximumFee,
                expected.feeExpiration,
                expected.feeRecipient,
                expected.router,
                xdr.ScVal.scvSymbol(forwarderTargetFunction(mode)),
            ];
            const authorized = forwarderFunction(mode) === 'forward'
                ? [...projection, xdr.ScVal.scvVec([expected.calls])]
                : projection;
            const target = forwarderTargetFunction(mode) as ForwardTarget;
            expect(FeeForwarderContract.authorizedArgs(target, ROUTER, calls, FEE).map(hex))
                .toEqual(authorized.map(hex));
        },
    );
});

describe('FeeForwarderContract vs the relayer plugin slot table', () => {
    // relayer-plugin-zenex src/plugin/parse.ts.
    const ROUTES = {
        calls: { entry: 'forward', target: 'multicall' },
        'try-fill': { entry: 'forward_dynamic', target: 'create_and_try_fill' },
        fill: { entry: 'forward_dynamic', target: 'create_and_fill' },
    } as const;
    const FORWARDER_SLOT = {
        feeToken: 0, feeAmount: 1, maximumFee: 2, feeExpiration: 3, targetContract: 4,
        targetFunction: 5, targetArgs: 6, user: 7, feeRecipient: 8,
    } as const;
    const TARGET_SLOT = { calls: 0, user: 1, keeper: 2, priceUpdate: 3 } as const;

    const forwarder = new FeeForwarderContract(FORWARDER);
    const calls = [openCall()];

    it.each([
        ['calls', forwarder.forwardMulticall(ROUTER, calls, USER, FEE)],
        ['fill', forwarder.forwardCreateAndFill(ROUTER, calls, USER, KEEPER, PRICE, FEE)],
        ['try-fill', forwarder.forwardCreateAndTryFill(ROUTER, calls, USER, KEEPER, PRICE, FEE)],
    ] as const)('%s lands every slot where the plugin reads it', (route, operation) => {
        const invoke = decodeInvoke(operation);
        expect(invoke.functionName().toString()).toBe(ROUTES[route].entry);
        const args = invoke.args().map((arg) => scValToNative(arg));
        expect(args[FORWARDER_SLOT.feeToken]).toBe(TOKEN);
        expect(args[FORWARDER_SLOT.feeAmount]).toBe(FEE.feeAmount);
        expect(args[FORWARDER_SLOT.maximumFee]).toBe(FEE.maxFeeAmount);
        expect(args[FORWARDER_SLOT.feeExpiration]).toBe(FEE.expirationLedger);
        expect(args[FORWARDER_SLOT.targetContract]).toBe(ROUTER);
        expect(args[FORWARDER_SLOT.targetFunction]).toBe(ROUTES[route].target);
        expect(args[FORWARDER_SLOT.user]).toBe(USER);
        expect(args[FORWARDER_SLOT.feeRecipient]).toBe(RECIPIENT);
        const targetArgs = args[FORWARDER_SLOT.targetArgs] as unknown[];
        expect(targetArgs).toHaveLength(route === 'calls' ? 1 : 4);
        expect((targetArgs[TARGET_SLOT.calls] as unknown[])).toHaveLength(1);
        if (route !== 'calls') {
            expect(targetArgs[TARGET_SLOT.user]).toBe(USER);
            expect(targetArgs[TARGET_SLOT.keeper]).toBe(KEEPER);
            expect(Buffer.from(targetArgs[TARGET_SLOT.priceUpdate] as Uint8Array)).toEqual(PRICE);
        }
    });
});

describe('FeeForwarderContract.parsers', () => {
    const fillResult = xdr.ScVal.scvVec([
        xdr.ScVal.scvU32(3), nativeToScVal(9n, { type: 'i128' }),
    ]).toXDR('base64');

    it('decodes the router result the forwarder returns unchanged', () => {
        const parsers = FeeForwarderContract.parsers;
        expect(parsers.forwardMulticall(fillResult))
            .toEqual(MarketRouterContract.parsers.multicall(fillResult));
        expect(parsers.forwardCreateAndFill(fillResult)).toEqual([3, 9n]);
        expect(parsers.forwardCreateAndTryFill(fillResult)).toEqual([
            { ok: true, value: 3, error: 0 },
            { ok: true, value: 9n, error: 0 },
        ]);
    });

    it('reads a failed try-fill as the last outcome', () => {
        const rested = xdr.ScVal.scvVec([
            xdr.ScVal.scvU32(3), xdr.ScVal.scvError(xdr.ScError.sceContract(741)),
        ]).toXDR('base64');
        expect(FeeForwarderContract.parsers.forwardCreateAndTryFill(rested).at(-1))
            .toEqual({ ok: false, value: undefined, error: 741 });
    });
});
