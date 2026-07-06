import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import { TradingContract, DeployArgs } from '../../src/trading/trading_contract.js';
import { OrderKind, VaultOrderKind, FULL_CLOSE, TradingConfig } from '../../src/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

function makeConfig(): TradingConfig {
    return {
        keeperRate: 1n,
        minPositionNotional: 1n,
        maxPositionNotional: 1n,
        maxOpenInterest: 1n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        feeDom: 1n,
        feeNonDom: 1n,
        impactDivisor: 1n,
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
        redeemLock: 60n,
        depositLock: 60n,
        instantDepositPnl: 1n,
        vaultFee: 1n,
        minDeposit: 1n,
        maxPnlDeposit: 1n,
        maxPnlWithdraw: 1n,
        maxVaultBalance: 1n,
    };
}

describe('TradingContract', () => {
    const contract = new TradingContract(CONTRACT_ID);

    it('createOrder builds create_order with the exact arg order and types', () => {
        const op = contract.createOrder(USER, true, OrderKind.Increase, 100n, 10n, 5n, true, 200n, 12345);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_order');
        expect(args).toEqual([USER, true, ['Increase'], 100n, 10n, 5n, true, 200n, 12345]);
    });

    it('closePosition emits Decrease + FULL_CLOSE + zero collateral', () => {
        const op = contract.closePosition({ user: USER, isLong: true, priceBound: 0n, expiration: 0 });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_order');
        expect(args[2]).toEqual(['Decrease']);
        expect(args[3]).toBe(FULL_CLOSE);
        expect(args[4]).toBe(0n);
    });

    it('placeStopLoss on a long sets trigger_above = false', () => {
        const op = contract.placeStopLoss({ user: USER, isLong: true, triggerPrice: 50n, priceBound: 0n, expiration: 0 });
        const { args } = decodeInvoke(op);
        expect(args[6]).toBe(false);
    });

    it('placeStopLoss on a short sets trigger_above = true', () => {
        const op = contract.placeStopLoss({ user: USER, isLong: false, triggerPrice: 50n, priceBound: 0n, expiration: 0 });
        const { args } = decodeInvoke(op);
        expect(args[6]).toBe(true);
    });

    it('placeTakeProfit inverts placeStopLoss\'s trigger_above', () => {
        const longTp = decodeInvoke(
            contract.placeTakeProfit({ user: USER, isLong: true, triggerPrice: 50n, priceBound: 0n, expiration: 0 }),
        );
        const shortTp = decodeInvoke(
            contract.placeTakeProfit({ user: USER, isLong: false, triggerPrice: 50n, priceBound: 0n, expiration: 0 }),
        );
        expect(longTp.args[6]).toBe(true);
        expect(shortTp.args[6]).toBe(false);
    });

    it('openLimit on a long sets trigger_above = false', () => {
        const op = contract.openLimit({
            user: USER, isLong: true, notional: 100n, collateral: 10n, triggerPrice: 50n, priceBound: 0n, expiration: 0,
        });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_order');
        expect(args[2]).toEqual(['Increase']);
        expect(args[6]).toBe(false);
    });

    it('withdrawCollateral emits Decrease with notional 0', () => {
        const op = contract.withdrawCollateral({ user: USER, isLong: true, amount: 25n, expiration: 0 });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_order');
        expect(args[2]).toEqual(['Decrease']);
        expect(args[3]).toBe(0n);
        expect(args[4]).toBe(25n);
    });

    it('executeOrder carries the price bytes', () => {
        const price = Buffer.from([1, 2, 3, 4]);
        const op = contract.executeOrder(KEEPER, USER, 7, price);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('execute_order');
        expect(args[0]).toBe(KEEPER);
        expect(args[1]).toBe(USER);
        expect(args[2]).toBe(7);
        expect(Buffer.from(args[3] as Uint8Array)).toEqual(price);
    });

    it('setConfig embeds the alphabetical config map', () => {
        const op = contract.setConfig(makeConfig());
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('set_config');
        const map = args[0] as Record<string, unknown>;
        const keys = Object.keys(map);
        expect(keys).toEqual([...keys].sort());
        expect(keys[0]).toBe('adl_clear_target');
    });

    it('depositVault builds create_vault_order with Deposit kind', () => {
        const op = contract.depositVault({ user: USER, amount: 1000n, maxAdversePnl: 0n });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_vault_order');
        expect(args).toEqual([USER, ['Deposit'], 1000n, 0n]);
    });

    it('redeemVault builds create_vault_order with Redeem kind', () => {
        const op = contract.redeemVault({ user: USER, shares: 500n, maxAdversePnl: 1n });
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('create_vault_order');
        expect(args).toEqual([USER, ['Redeem'], 500n, 1n]);
    });

    it('parsers.createOrder decodes a u32 ScVal', () => {
        const raw = xdr.ScVal.scvU32(42).toXDR('base64');
        expect(TradingContract.parsers.createOrder(raw)).toBe(42);
    });

    it('parsers.getPosition returns camelCase fields', () => {
        const fields = [
            'collateral', 'notional', 'tokens', 'funding_idx', 'borrowing_idx',
            'locked_notional', 'unlocks_at', 'updated_at',
        ];
        const entries = fields.map((key, i) =>
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol(key),
                val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString('0'), lo: xdr.Uint64.fromString(String(i)) })),
            }),
        );
        const positionScVal = xdr.ScVal.scvMap(entries);
        const raw = positionScVal.toXDR('base64');
        const parsed = TradingContract.parsers.getPosition(raw);
        expect(parsed).toEqual({
            collateral: 0n,
            notional: 1n,
            tokens: 2n,
            fundingIdx: 3n,
            borrowingIdx: 4n,
            lockedNotional: 5n,
            unlocksAt: 6n,
            updatedAt: 7n,
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
        const op = TradingContract.deploy(USER, Buffer.alloc(32, 9), deployArgs, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const ctorArgs = createContract.constructorArgs().map((a) => scValToNative(a));
        expect(ctorArgs[5]).toBe(1);
        expect(ctorArgs[6]).toBe(-8);
    });
});
