import { describe, expect, it } from 'vitest';
import { StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { MarketContract } from '../../src/contracts/market/contract.js';
import {
    FULL_CLOSE,
    OrderKind,
    VaultOrderKind,
} from '../../src/contracts/market/types.js';
import type { OrderParams } from '../../src/contracts/router/types.js';
import {
    addMarginParams,
    closePositionParams,
    decreasePositionParams,
    openLimitParams,
    openMarketParams,
    stopLossParams,
    takeProfitParams,
    vaultDepositParams,
    vaultRedeemParams,
    withdrawMarginParams,
} from '../../src/trading/internal/order.js';

const TRADING = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));

const contract = new MarketContract(TRADING);
const base = { market: TRADING, user: USER, isLong: true, expiration: 99 };

/** Decode the `create_order` an intent produces, as native argument values. */
function encoded(params: OrderParams): unknown[] {
    const operation = contract.createOrder(
        params.user,
        params.isLong,
        params.kind,
        params.notional,
        params.margin,
        params.triggerPrice,
        params.priceBound,
        params.expiration,
    );
    const invoke = xdr.Operation.fromXDR(operation, 'base64')
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract();
    return invoke.args().map((arg) => scValToNative(arg));
}

describe('order intents', () => {
    it('carries the target contract so the params are self-describing', () => {
        // `trading` is the field `buildOrderOperation` routes on; an intent is
        // useless without it, which is why it is not defaulted.
        expect(openMarketParams({ ...base, notional: 100n, margin: 10n, priceBound: 5n }).market)
            .toBe(TRADING);
    });

    it('opens at market with an unused trigger of 0', () => {
        const params = openMarketParams({ ...base, notional: 100n, margin: 10n, priceBound: 5n });
        expect(params.kind).toBe(OrderKind.MarketIncrease);
        expect(params.triggerPrice).toBe(0n);
        expect(encoded(params)).toEqual([USER, true, OrderKind.MarketIncrease, 100n, 10n, 0n, 5n, 99]);
    });

    it('opens a limit carrying the trigger price', () => {
        const params = openLimitParams({
            ...base, notional: 100n, margin: 10n, triggerPrice: 42n, priceBound: 5n,
        });
        expect(encoded(params)).toEqual([USER, true, OrderKind.LimitIncrease, 100n, 10n, 42n, 5n, 99]);
    });

    it('closes fully with the FULL_CLOSE sentinel and no margin withdrawal', () => {
        const params = closePositionParams({ ...base, priceBound: 6n, expiration: 4 });
        expect(params.notional).toBe(FULL_CLOSE);
        expect(params.margin).toBe(0n);
        expect(encoded(params))
            .toEqual([USER, true, OrderKind.MarketDecrease, FULL_CLOSE, 0n, 0n, 6n, 4]);
    });

    it('decreases partially, optionally withdrawing margin', () => {
        const params = decreasePositionParams({
            ...base, isLong: false, notional: 40n, margin: 4n, priceBound: 0n, expiration: 1,
        });
        expect(encoded(params)).toEqual([USER, false, OrderKind.MarketDecrease, 40n, 4n, 0n, 0n, 1]);
    });

    it('encodes a margin-only change as notional 0 on either side', () => {
        const add = addMarginParams({ ...base, amount: 7n, expiration: 2 });
        expect(encoded(add)).toEqual([USER, true, OrderKind.MarketIncrease, 0n, 7n, 0n, 0n, 2]);

        const withdraw = withdrawMarginParams({ ...base, amount: 7n, expiration: 2 });
        expect(encoded(withdraw)).toEqual([USER, true, OrderKind.MarketDecrease, 0n, 7n, 0n, 0n, 2]);
    });

    it('splits the two trigger kinds by which way the price must cross', () => {
        const takeProfit = takeProfitParams({
            ...base, triggerPrice: 200n, notional: 50n, priceBound: 0n, expiration: 3,
        });
        expect(encoded(takeProfit))
            .toEqual([USER, true, OrderKind.LimitDecrease, 50n, 0n, 200n, 0n, 3]);

        const stopLoss = stopLossParams({
            ...base, isLong: false, triggerPrice: 90n, notional: 40n, priceBound: 0n, expiration: 3,
        });
        expect(encoded(stopLoss))
            .toEqual([USER, false, OrderKind.StopDecrease, 40n, 0n, 90n, 0n, 3]);
    });

    it('defaults a trigger order to a full close', () => {
        const args = { ...base, triggerPrice: 200n, priceBound: 0n, expiration: 3 };
        expect(takeProfitParams(args).notional).toBe(FULL_CLOSE);
        expect(stopLossParams(args).notional).toBe(FULL_CLOSE);
        // An explicit 0 is a real notional, not an absent one.
        expect(takeProfitParams({ ...args, notional: 0n }).notional).toBe(0n);
    });

    it('maps the vault actions onto the two kind discriminants', () => {
        expect(vaultDepositParams({ market: TRADING, user: USER, amount: 10n, minOut: 1n }))
            .toEqual({
                market: TRADING, user: USER, kind: VaultOrderKind.Deposit, amount: 10n, minOut: 1n,
            });
        // A redemption's SHARE count travels in the same `amount` argument a
        // deposit uses for assets -- the encoding a caller would get wrong.
        expect(vaultRedeemParams({ market: TRADING, user: USER, shares: 20n, minOut: 2n }))
            .toEqual({
                market: TRADING, user: USER, kind: VaultOrderKind.Redeem, amount: 20n, minOut: 2n,
            });
    });

    it('returns data, never XDR, so the validated build path cannot be skipped', () => {
        const params = openMarketParams({ ...base, notional: 100n, margin: 10n, priceBound: 5n });
        expect(typeof params).toBe('object');
        for (const value of Object.values(params)) {
            expect(typeof value).not.toBe('function');
        }
    });
});
