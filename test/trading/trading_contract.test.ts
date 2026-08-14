import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { TradingContract, DeployArgs } from '../../src/contracts/trading/trading_contract.js';
import { OrderKind, VaultOrderKind, FULL_CLOSE, TradingConfig } from '../../src/contracts/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));

function decodeInvoke(operation: string) {
    const body = xdr.Operation.fromXDR(operation, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        rawArgs: invoke.args(),
        args: invoke.args().map((arg) => scValToNative(arg)),
    };
}

function makeConfig(): TradingConfig {
    return {
        keeperRate: 1n,
        minPositionNotional: 1n,
        maxPositionNotional: 2n,
        maxOpenInterest: 2n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
        execFee: 1n,
        feeDom: 1n,
        feeNonDom: 1n,
        impactScalar: 1n,
        maxUtilOpen: 1n,
        maxUtilWithdraw: 1n,
        initMargin: 1n,
        maintenanceMargin: 1n,
        liqFee: 1n,
        notionalLock: 60n,
        targetUtil: 1n,
        borrowRate: 1n,
        increasedBorrowRate: 1n,
        fundingIncrease: 1n,
        fundingDecrease: 1n,
        thresholdStableFunding: 1n,
        thresholdDecreaseFunding: 1n,
        fundingMin: 1n,
        fundingMax: 1n,
        adlMaxPnl: 1n,
        adlClearTarget: 1n,
        maxPnlTrader: 1n,
        maxPnlWithdraw: 1n,
        redeemLock: 60n,
        depositFee: 1n,
        redeemFee: 1n,
        minDeposit: 1n,
        maxVaultBalance: 100n,
    };
}

describe('TradingContract', () => {
    const contract = new TradingContract(CONTRACT_ID);

    it('createOrder builds create_order with the exact 8-arg order and types', () => {
        const operation = contract.createOrder(
            USER, true, OrderKind.LimitIncrease, 100n, 10n, 55n, 200n, 12345,
        );
        const { fn, rawArgs, args } = decodeInvoke(operation);
        expect(fn).toBe('create_order');
        // (user, is_long, kind, notional, margin, trigger_price, price_bound, expiration)
        expect(args).toEqual([USER, true, 1, 100n, 10n, 55n, 200n, 12345]);
        expect(rawArgs).toHaveLength(8);
        expect(rawArgs[1].switch().name).toBe('scvBool');
        // kind crosses the ABI as a plain u32, matching order.rs #[repr(u32)]
        expect(rawArgs[2].switch().name).toBe('scvU32');
        expect(rawArgs[2].u32()).toBe(1);
        expect(rawArgs[3].switch().name).toBe('scvI128');
        expect(rawArgs[7].switch().name).toBe('scvU32');
    });

    it('createOrderCall encodes identically to createOrder', () => {
        const call = contract.createOrderCall(USER, false, OrderKind.StopDecrease, 1n, 2n, 3n, 4n, 5);
        expect(call.func).toBe('create_order');
        expect(call.contract).toBe(CONTRACT_ID);
        expect(call.args.map((arg) => scValToNative(arg))).toEqual([USER, false, 5, 1n, 2n, 3n, 4n, 5]);
    });

    it('every OrderKind encodes its u32 discriminant in the built XDR', () => {
        const kindByDiscriminant: Array<[OrderKind, number]> = [
            [OrderKind.MarketIncrease, 0],
            [OrderKind.LimitIncrease, 1],
            [OrderKind.StopIncrease, 2],
            [OrderKind.MarketDecrease, 3],
            [OrderKind.LimitDecrease, 4],
            [OrderKind.StopDecrease, 5],
        ];
        for (const [kind, discriminant] of kindByDiscriminant) {
            const { rawArgs } = decodeInvoke(contract.createOrder(USER, true, kind, 1n, 1n, 0n, 0n, 1));
            expect(rawArgs[2].switch().name).toBe('scvU32');
            expect(rawArgs[2].u32()).toBe(discriminant);
        }
    });

    it('closePosition emits MarketDecrease + FULL_CLOSE + zero margin', () => {
        const operation = contract.closePosition({ user: USER, isLong: true, priceBound: 0n, expiration: 0 });
        const { fn, args } = decodeInvoke(operation);
        expect(fn).toBe('create_order');
        expect(args[2]).toBe(OrderKind.MarketDecrease);
        expect(args[3]).toBe(FULL_CLOSE);
        expect(args[4]).toBe(0n);
    });

    it('openMarket emits MarketIncrease with an unused trigger of 0', () => {
        const { args } = decodeInvoke(contract.openMarket({
            user: USER, isLong: true, notional: 100n, margin: 10n, priceBound: 5n, expiration: 99,
        }));
        expect(args).toEqual([USER, true, 0, 100n, 10n, 0n, 5n, 99]);
    });

    it('openLimit emits LimitIncrease carrying the trigger price', () => {
        const { args } = decodeInvoke(contract.openLimit({
            user: USER, isLong: true, notional: 100n, margin: 10n,
            triggerPrice: 50n, priceBound: 0n, expiration: 0,
        }));
        expect(args[2]).toBe(OrderKind.LimitIncrease);
        expect(args[5]).toBe(50n);
    });

    it('placeTakeProfit emits LimitDecrease and defaults to FULL_CLOSE', () => {
        const { args } = decodeInvoke(contract.placeTakeProfit({
            user: USER, isLong: true, triggerPrice: 200n, priceBound: 0n, expiration: 3,
        }));
        expect(args[2]).toBe(OrderKind.LimitDecrease);
        expect(args[3]).toBe(FULL_CLOSE);
        expect(args[4]).toBe(0n);
        expect(args[5]).toBe(200n);
    });

    it('placeStopLoss emits StopDecrease and honours a partial notional', () => {
        const { args } = decodeInvoke(contract.placeStopLoss({
            user: USER, isLong: false, triggerPrice: 90n, notional: 40n, priceBound: 0n, expiration: 3,
        }));
        expect(args[2]).toBe(OrderKind.StopDecrease);
        expect(args[3]).toBe(40n);
        expect(args[5]).toBe(90n);
    });

    it('withdrawMargin emits MarketDecrease with notional 0', () => {
        const { fn, args } = decodeInvoke(contract.withdrawMargin({
            user: USER, isLong: true, amount: 25n, expiration: 0,
        }));
        expect(fn).toBe('create_order');
        expect(args[2]).toBe(OrderKind.MarketDecrease);
        expect(args[3]).toBe(0n);
        expect(args[4]).toBe(25n);
    });

    it('addMargin emits MarketIncrease with notional 0', () => {
        const { args } = decodeInvoke(contract.addMargin({
            user: USER, isLong: false, amount: 7n, expiration: 2,
        }));
        expect(args[2]).toBe(OrderKind.MarketIncrease);
        expect(args[3]).toBe(0n);
        expect(args[4]).toBe(7n);
    });

    it('createVaultOrder builds create_vault_order with a u32 kind and minOut', () => {
        const { fn, rawArgs, args } = decodeInvoke(
            contract.createVaultOrder(USER, VaultOrderKind.Redeem, 500n, 490n),
        );
        expect(fn).toBe('create_vault_order');
        expect(args).toEqual([USER, 1, 500n, 490n]);
        expect(rawArgs[1].switch().name).toBe('scvU32');
        expect(rawArgs[3].switch().name).toBe('scvI128');
    });

    it('depositVault and redeemVault map onto the two VaultOrderKind discriminants', () => {
        const deposit = decodeInvoke(contract.depositVault({ user: USER, amount: 1000n, minOut: 3n }));
        expect(deposit.fn).toBe('create_vault_order');
        expect(deposit.args).toEqual([USER, VaultOrderKind.Deposit, 1000n, 3n]);

        const redeem = decodeInvoke(contract.redeemVault({ user: USER, shares: 500n, minOut: 1n }));
        expect(redeem.args).toEqual([USER, VaultOrderKind.Redeem, 500n, 1n]);
    });

    it('executeOrder carries the price bytes', () => {
        const price = Buffer.from([1, 2, 3, 4]);
        const { fn, args } = decodeInvoke(contract.executeOrder(KEEPER, USER, 7, price));
        expect(fn).toBe('execute_order');
        expect(args[0]).toBe(KEEPER);
        expect(args[1]).toBe(USER);
        expect(args[2]).toBe(7);
        expect(Buffer.from(args[3] as Uint8Array)).toEqual(price);
    });

    it('executeVaultOrder takes 4 args (keeper, user, id, price)', () => {
        const price = Buffer.from([9, 9]);
        const { fn, args } = decodeInvoke(contract.executeVaultOrder(KEEPER, USER, 2, price));
        expect(fn).toBe('execute_vault_order');
        expect(args).toHaveLength(4);
        expect(args[0]).toBe(KEEPER);
        expect(args[1]).toBe(USER);
        expect(args[2]).toBe(2);
        expect(Buffer.from(args[3] as Uint8Array)).toEqual(price);
    });

    it('getOrderCounter builds the view and its parser decodes a u32', () => {
        const { fn, args } = decodeInvoke(contract.getOrderCounter(USER));
        expect(fn).toBe('get_order_counter');
        expect(args).toEqual([USER]);
        const raw = xdr.ScVal.scvU32(17).toXDR('base64');
        expect(TradingContract.parsers.getOrderCounter(raw)).toBe(17);
    });

    it('setConfig embeds the alphabetical 34-key config map', () => {
        const { fn, rawArgs } = decodeInvoke(contract.setConfig(makeConfig()));
        expect(fn).toBe('set_config');
        const keys = rawArgs[0].map()!.map((mapEntry) => mapEntry.key().sym().toString());
        expect(keys).toHaveLength(34);
        expect(keys).toEqual([...keys].sort());
        expect(keys[0]).toBe('adl_clear_target');
        expect(keys[33]).toBe('threshold_stable_funding');
    });

    it('parsers.createOrder decodes a u32 ScVal', () => {
        const raw = xdr.ScVal.scvU32(42).toXDR('base64');
        expect(TradingContract.parsers.createOrder(raw)).toBe(42);
    });

    it('parsers.cancelOrder decodes the i128 refund', () => {
        const raw = nativeToScVal(1234n, { type: 'i128' }).toXDR('base64');
        expect(TradingContract.parsers.cancelOrder(raw)).toBe(1234n);
    });

    it('parsers.getOrder returns undefined on Option None (scvVoid)', () => {
        const raw = xdr.ScVal.scvVoid().toXDR('base64');
        expect(TradingContract.parsers.getOrder(raw)).toBeUndefined();
    });

    it('parsers.getVaultOrder returns undefined on Option None (scvVoid)', () => {
        const raw = xdr.ScVal.scvVoid().toXDR('base64');
        expect(TradingContract.parsers.getVaultOrder(raw)).toBeUndefined();
    });

    it('parsers.getPosition returns camelCase fields including pricedAt and decreaseOrders', () => {
        const entry = (key: string, val: xdr.ScVal) =>
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
        const i128Val = (value: bigint) => nativeToScVal(value, { type: 'i128' });
        const u64Val = (value: bigint) => nativeToScVal(value, { type: 'u64' });
        // Alphabetical field order, matching #[contracttype] serialization.
        const positionScVal = xdr.ScVal.scvMap([
            entry('borrowing_idx', i128Val(1n)),
            entry('margin', i128Val(2n)),
            entry('decrease_orders', xdr.ScVal.scvVec([xdr.ScVal.scvU32(3), xdr.ScVal.scvU32(9)])),
            entry('funding_idx', i128Val(4n)),
            entry('locked_notional', i128Val(5n)),
            entry('notional', i128Val(6n)),
            entry('priced_at', u64Val(7n)),
            entry('tokens', i128Val(8n)),
            entry('unlocks_at', u64Val(9n)),
        ]);
        const parsed = TradingContract.parsers.getPosition(positionScVal.toXDR('base64'));
        expect(parsed).toEqual({
            borrowingIdx: 1n,
            margin: 2n,
            decreaseOrders: [3, 9],
            fundingIdx: 4n,
            lockedNotional: 5n,
            notional: 6n,
            pricedAt: 7n,
            tokens: 8n,
            unlocksAt: 9n,
        });
    });

    it('static deploy builds __constructor with 8 args in order', () => {
        const deployArgs: DeployArgs = {
            owner: USER,
            token: USER,
            vault: USER,
            priceVerifier: USER,
            treasury: USER,
            feedId: 1,
            exponent: -8,
            config: makeConfig(),
        };
        const operation = TradingContract.deploy(USER, Buffer.alloc(32, 9), deployArgs, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(operation, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const constructorArgs = createContract.constructorArgs();
        expect(constructorArgs).toHaveLength(8);
        expect(scValToNative(constructorArgs[5])).toBe(1);
        expect(scValToNative(constructorArgs[6])).toBe(-8);
        expect(constructorArgs[7].map()!).toHaveLength(34);
    });
});
