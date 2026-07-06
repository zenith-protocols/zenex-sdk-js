import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey } from '@stellar/stellar-sdk';
import { FactoryContract, FactoryConstructorArgs } from '../../src/factory/factory_contract.js';
import { TradingConfig } from '../../src/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const ADMIN = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const PRICE_VERIFIER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 6));

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

describe('FactoryContract', () => {
    const contract = new FactoryContract(CONTRACT_ID);

    it('deployMarket builds deploy with the exact 10-arg order and config as a map', () => {
        const salt = Buffer.alloc(32, 7);
        const op = contract.deployMarket(
            ADMIN,
            salt,
            TOKEN,
            PRICE_VERIFIER,
            42,
            -8,
            makeConfig(),
            'Vault Shares',
            'vTKN',
            0,
        );
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('deploy');
        expect(args[0]).toBe(ADMIN);
        expect(args[1]).toEqual(salt);
        expect(args[2]).toBe(TOKEN);
        expect(args[3]).toBe(PRICE_VERIFIER);
        expect(args[4]).toBe(42);
        expect(args[5]).toBe(-8);
        // config lands as a plain object (native-decoded map), not an array
        expect(args[6]).toMatchObject({ keeper_rate: 1n });
        expect(args[7]).toBe('Vault Shares');
        expect(args[8]).toBe('vTKN');
        expect(args[9]).toBe(0);
    });

    it('isDeployed builds is_deployed with the trading address', () => {
        const op = contract.isDeployed(TRADING);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('is_deployed');
        expect(args).toEqual([TRADING]);
    });

    it('static deploy builds __constructor with init_meta map keys in alphabetical order', () => {
        const args: FactoryConstructorArgs = {
            init_meta: {
                trading_hash: Buffer.alloc(32, 1),
                treasury: TREASURY,
                vault_hash: Buffer.alloc(32, 2),
            },
        };
        const op = FactoryContract.deploy(ADMIN, Buffer.alloc(32, 9), args, undefined, 'hex');
        const decoded = xdr.Operation.fromXDR(op, 'base64');
        const createContract = decoded.body().invokeHostFunctionOp().hostFunction().createContractV2();
        const ctorArgs = createContract.constructorArgs();
        expect(ctorArgs).toHaveLength(1);

        const initMetaMap = ctorArgs[0].map();
        expect(initMetaMap).toBeDefined();
        const keys = initMetaMap!.map((entry) => entry.key().sym().toString());
        expect(keys).toEqual(['trading_hash', 'treasury', 'vault_hash']);

        const native = scValToNative(ctorArgs[0]);
        expect(native.treasury).toBe(TREASURY);
        expect(Buffer.from(native.trading_hash)).toEqual(Buffer.alloc(32, 1));
        expect(Buffer.from(native.vault_hash)).toEqual(Buffer.alloc(32, 2));
    });
});
