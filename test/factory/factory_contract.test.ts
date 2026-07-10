import { describe, it, expect } from 'vitest';
import { xdr, scValToNative, StrKey, Address } from '@stellar/stellar-sdk';
import { FactoryContract, FactoryConstructorArgs } from '../../src/factory/factory_contract.js';
import { TradingConfig } from '../../src/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const ADMIN = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const PRICE_VERIFIER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 6));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 7));

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
        rawArgs: invoke.args(),
    };
}

// Every field gets a distinct value so a key mix-up in the encoder cannot
// cancel out. The values 1..34 are assigned in the contract Config's
// alphabetical snake_case field order.
function makeConfig(): TradingConfig {
    return {
        adlClearTarget: 1n,
        adlMaxPnl: 2n,
        borrowRate: 3n,
        depositFee: 4n,
        execFee: 5n,
        feeDom: 6n,
        feeNonDom: 7n,
        fundingDecrease: 8n,
        fundingIncrease: 9n,
        fundingMax: 10n,
        fundingMin: 11n,
        impactScalar: 12n,
        increasedBorrowRate: 13n,
        initMargin: 14n,
        keeperRate: 15n,
        liqFee: 16n,
        maintenanceMargin: 17n,
        maxOpenInterest: 18n,
        maxPnlTrader: 19n,
        maxPnlWithdraw: 20n,
        maxPositionNotional: 21n,
        maxUtilOpen: 22n,
        maxUtilWithdraw: 23n,
        maxVaultBalance: 24n,
        minDeposit: 25n,
        minOrderCollateral: 26n,
        minOrderNotional: 27n,
        minPositionNotional: 28n,
        notionalLock: 29n,
        redeemFee: 30n,
        redeemLock: 31n,
        targetUtil: 32n,
        thresholdDecreaseFunding: 33n,
        thresholdStableFunding: 34n,
    };
}

// The 34 Config keys in the contract's alphabetical snake_case order,
// paired with the distinct values assigned in makeConfig.
const EXPECTED_CONFIG_ENTRIES: [string, bigint][] = [
    ['adl_clear_target', 1n],
    ['adl_max_pnl', 2n],
    ['borrow_rate', 3n],
    ['deposit_fee', 4n],
    ['exec_fee', 5n],
    ['fee_dom', 6n],
    ['fee_non_dom', 7n],
    ['funding_decrease', 8n],
    ['funding_increase', 9n],
    ['funding_max', 10n],
    ['funding_min', 11n],
    ['impact_scalar', 12n],
    ['increased_borrow_rate', 13n],
    ['init_margin', 14n],
    ['keeper_rate', 15n],
    ['liq_fee', 16n],
    ['maintenance_margin', 17n],
    ['max_open_interest', 18n],
    ['max_pnl_trader', 19n],
    ['max_pnl_withdraw', 20n],
    ['max_position_notional', 21n],
    ['max_util_open', 22n],
    ['max_util_withdraw', 23n],
    ['max_vault_balance', 24n],
    ['min_deposit', 25n],
    ['min_order_collateral', 26n],
    ['min_order_notional', 27n],
    ['min_position_notional', 28n],
    ['notional_lock', 29n],
    ['redeem_fee', 30n],
    ['redeem_lock', 31n],
    ['target_util', 32n],
    ['threshold_decrease_funding', 33n],
    ['threshold_stable_funding', 34n],
];

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
        expect(args).toHaveLength(10);
        expect(args[0]).toBe(ADMIN);
        expect(args[1]).toEqual(salt);
        expect(args[2]).toBe(TOKEN);
        expect(args[3]).toBe(PRICE_VERIFIER);
        expect(args[4]).toBe(42);
        expect(args[5]).toBe(-8);
        expect(args[7]).toBe('Vault Shares');
        expect(args[8]).toBe('vTKN');
        expect(args[9]).toBe(0);
    });

    it('encodes the 34-field config map in alphabetical key order with the right values', () => {
        const op = contract.deployMarket(
            ADMIN, Buffer.alloc(32, 7), TOKEN, PRICE_VERIFIER, 42, -8,
            makeConfig(), 'Vault Shares', 'vTKN', 0,
        );
        const { rawArgs } = decodeInvoke(op);

        const configMap = rawArgs[6].map();
        expect(configMap).toBeDefined();
        // XDR map entry order is the on-chain contract's alphabetical order.
        const encodedKeys = configMap!.map((entry) => entry.key().sym().toString());
        expect(encodedKeys).toEqual(EXPECTED_CONFIG_ENTRIES.map(([key]) => key));

        const native = scValToNative(rawArgs[6]) as Record<string, bigint>;
        for (const [key, value] of EXPECTED_CONFIG_ENTRIES) {
            expect(native[key], `config field ${key}`).toBe(value);
        }

        // The two u64 duration fields encode as scvU64, everything else as i128.
        for (const entry of configMap!) {
            const key = entry.key().sym().toString();
            const expectedType = key === 'notional_lock' || key === 'redeem_lock' ? 'scvU64' : 'scvI128';
            expect(entry.val().switch().name, `config field ${key}`).toBe(expectedType);
        }
    });

    it('parsers.deployMarket decodes the (trading, vault) address tuple', () => {
        const tuple = xdr.ScVal.scvVec([
            Address.fromString(TRADING).toScVal(),
            Address.fromString(VAULT).toScVal(),
        ]);
        const [trading, vault] = FactoryContract.parsers.deployMarket(tuple.toXDR('base64'));
        expect(String(trading)).toBe(TRADING);
        expect(String(vault)).toBe(VAULT);
    });

    it('isDeployed builds is_deployed with the trading address and parses the bool', () => {
        const op = contract.isDeployed(TRADING);
        const { fn, args } = decodeInvoke(op);
        expect(fn).toBe('is_deployed');
        expect(args).toEqual([TRADING]);
        expect(FactoryContract.parsers.isDeployed(xdr.ScVal.scvBool(true).toXDR('base64'))).toBe(true);
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
