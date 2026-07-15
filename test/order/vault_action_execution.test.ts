import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    buildVaultActionExecution,
    type ExactRelayFeeToken,
} from '../../src/order/transactions.js';
import { Status } from '../../src/trading/trading_types.js';
import type { TradingConfig } from '../../src/trading/trading_types.js';
import { quoteVaultOrderCreation } from '../../src/vault/quote.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 80));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 81));
const FEE_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 82));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 83));

function config(): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 2_000_000n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        execFee: 25n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000n,
        maxUtilOpen: 10n ** 18n,
        maxUtilWithdraw: 10n ** 18n,
        initMargin: 10n ** 17n,
        maintenanceMargin: 5n * 10n ** 16n,
        liqFee: 0n,
        notionalLock: 0n,
        targetUtil: 8n * 10n ** 17n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: 5n * 10n ** 17n,
        adlClearTarget: 4n * 10n ** 17n,
        maxPnlTrader: 9n * 10n ** 17n,
        maxPnlWithdraw: 15n * 10n ** 16n,
        redeemLock: 60n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 100n,
        maxVaultBalance: 10_000_000n,
    };
}

function exactQuote(
    status: Status,
    action: 'deposit' | 'redeem',
) {
    const result = quoteVaultOrderCreation({
        ledger: 20_000,
        now: 30_000n,
        status,
        config: config(),
        action,
        amount: action === 'deposit' ? 1_000n : 250n,
        minOut: 999_999n,
        vault:
            status === Status.Retired
                ? {
                      totalAssets: 1_000n,
                      totalSupply: 1_000n,
                      decimalsOffset: 0,
                  }
                : undefined,
    });
    if (result.kind !== 'exact') {
        throw new Error('expected exact vault creation quote');
    }
    return result;
}

function decodeInvoke(operationXdr: string) {
    const invoke = xdr.Operation.fromXDR(operationXdr, 'base64')
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract();
    return {
        contract: Address.fromScAddress(invoke.contractAddress()).toString(),
        fn: invoke.functionName().toString(),
        args: invoke.args().map((argument) => scValToNative(argument)),
    };
}

const feeToken: ExactRelayFeeToken = {
    collateralAssetId: 'usdc',
    contractId: FEE_TOKEN,
    decimals: 7,
    pricing: { kind: 'usdPeg', numerator: '1', denominator: '1' },
    minForwardChargeAtomic: 1n,
    maxSignedFeeAtomic: 10_000n,
};

describe('buildVaultActionExecution', () => {
    it('prepares an Active deposit as a direct resting action', () => {
        const result = buildVaultActionExecution({
            tradingAddress: TRADING,
            user: USER,
            quote: exactQuote(Status.Active, 'deposit'),
            policy: { kind: 'restOnly', transport: 'direct' },
        });

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.ledger).toBe(20_000);
        expect(result.priceTime).toBe(30_000n);
        expect(result.value).toMatchObject({
            action: 'resting',
            vaultAction: 'deposit',
            policy: 'restOnly',
            transport: 'direct',
        });
        expect(decodeInvoke(result.value.operationXdr)).toEqual({
            contract: TRADING,
            fn: 'create_vault_order',
            args: [USER, 0, 1_000n, 999_999n],
        });
    });

    it('prepares a Delisted redeem through the existing relay rest-only route', () => {
        const result = buildVaultActionExecution({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            quote: exactQuote(Status.Delisted, 'redeem'),
            policy: {
                kind: 'restOnly',
                transport: 'relay',
                feeToken,
                maxFeeAmount: 1_000n,
                feeExpiration: 20_100,
            },
        });

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value).toMatchObject({
            action: 'resting',
            vaultAction: 'redeem',
            policy: 'restOnly',
            transport: 'relay',
        });
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('multicall_with_fee');
        expect(invoke.args[0]).toEqual([
            {
                args: [USER, 1, 250n, 999_999n],
                contract: TRADING,
                func: 'create_vault_order',
            },
        ]);
    });

    it('prepares a Retired redeem only as the direct immediate action', () => {
        const quote = exactQuote(Status.Retired, 'redeem');
        const result = buildVaultActionExecution({
            tradingAddress: TRADING,
            user: USER,
            quote,
        });

        expect(quote.value).toMatchObject({
            kind: 'retiredImmediateRedeem',
            assets: 250n,
            executionFee: 0n,
            minOutApplied: false,
        });
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value).toMatchObject({
            action: 'retiredImmediateRedeem',
            policy: 'retiredImmediateRedeem',
            transport: 'direct',
        });
        expect(result.value).not.toHaveProperty('assets');
        expect(result.value).not.toHaveProperty('executionFee');
        expect(result.value).not.toHaveProperty('minOut');
        expect(decodeInvoke(result.value.operationXdr)).toEqual({
            contract: TRADING,
            fn: 'create_vault_order',
            args: [USER, 1, 250n, 0n],
        });
    });

    it('rejects relay or rest-only configuration on a Retired redeem', () => {
        const base = {
            tradingAddress: TRADING,
            user: USER,
            quote: exactQuote(Status.Retired, 'redeem'),
        };

        for (const input of [
            {
                ...base,
                policy: { kind: 'restOnly', transport: 'direct' },
            },
            { ...base, routerAddress: ROUTER },
        ]) {
            expect(
                buildVaultActionExecution(
                    input as Parameters<typeof buildVaultActionExecution>[0],
                ),
            ).toMatchObject({
                kind: 'unavailable',
                code: 'INVALID_INPUT',
            });
        }
    });

    it('requires an explicit rest-only policy for a resting quote', () => {
        expect(
            buildVaultActionExecution({
                tradingAddress: TRADING,
                user: USER,
                quote: exactQuote(Status.Active, 'deposit'),
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });

    it('rejects a Router identity on direct resting execution', () => {
        expect(
            buildVaultActionExecution({
                tradingAddress: TRADING,
                routerAddress: ROUTER,
                user: USER,
                quote: exactQuote(Status.Active, 'deposit'),
                policy: { kind: 'restOnly', transport: 'direct' },
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('relayed resting'),
        });
    });

    it.each([
        ['nonpositive shares', { shares: 0n }],
        ['nonzero execution fee', { executionFee: 1n }],
        ['applied minimum output', { minOutApplied: true }],
        ['rest-only policy', { policy: 'restOnly' }],
        ['deposit action', { action: 'deposit' }],
    ] as const)('rejects a forged Retired quote with %s', (_label, change) => {
        const quote = exactQuote(Status.Retired, 'redeem');
        const forged = {
            ...quote,
            value: { ...quote.value, ...change },
        };
        expect(
            buildVaultActionExecution({
                tradingAddress: TRADING,
                user: USER,
                quote: forged,
            } as Parameters<typeof buildVaultActionExecution>[0]),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });
});
