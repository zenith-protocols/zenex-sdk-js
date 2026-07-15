import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    buildVaultOrderOperation,
    type ContractExecutionPolicy,
    type ExactRelayFeeToken,
} from '../../src/order/transactions.js';
import { Status } from '../../src/trading/trading_types.js';
import type { TradingConfig } from '../../src/trading/trading_types.js';
import {
    quoteVaultOrderCreation,
    type ExactVaultRestingOrderCreationQuote,
} from '../../src/vault/quote.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 70));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 71));
const FEE_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 72));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 73));

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

function quote(
    action: 'deposit' | 'redeem' = 'deposit',
): ExactVaultRestingOrderCreationQuote {
    const result = quoteVaultOrderCreation({
        ledger: 20_000,
        now: 30_000n,
        status: Status.Active,
        config: config(),
        action,
        amount: action === 'deposit' ? 1_000n : 400n,
        minOut: action === 'deposit' ? 900n : 350n,
    });
    if (result.kind !== 'exact' || result.value.kind !== 'resting') {
        throw new Error('expected an exact resting creation quote');
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

const relayPolicy = {
    kind: 'restOnly' as const,
    transport: 'relay' as const,
    feeToken,
    maxFeeAmount: 1_000n,
    feeExpiration: 20_100,
};

describe('buildVaultOrderOperation', () => {
    it.each(['deposit', 'redeem'] as const)(
        'maps an exact %s quote directly to create_vault_order',
        (action) => {
            const creation = quote(action);
            const result = buildVaultOrderOperation({
                tradingAddress: TRADING,
                user: USER,
                quote: creation,
                policy: { kind: 'restOnly', transport: 'direct' },
            });

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.ledger).toBe(20_000);
            expect(result.priceTime).toBe(30_000n);
            expect(result.value.policy).toBe('restOnly');
            expect(result.value.transport).toBe('direct');
            expect(decodeInvoke(result.value.operationXdr)).toEqual({
                contract: TRADING,
                fn: 'create_vault_order',
                args: [
                    USER,
                    action === 'deposit' ? 0 : 1,
                    creation.value.amount,
                    creation.value.minOut,
                ],
            });
        },
    );

    it('maps one exact vault order to a relayed multicall fee envelope', () => {
        const creation = quote('redeem');
        const result = buildVaultOrderOperation({
            tradingAddress: TRADING,
            routerAddress: ROUTER,
            user: USER,
            quote: creation,
            policy: relayPolicy,
        });

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.transport).toBe('relay');
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('multicall_with_fee');
        expect(invoke.args).toHaveLength(7);
        expect(invoke.args[0]).toEqual([
            {
                args: [USER, 1, 400n, 350n],
                contract: TRADING,
                func: 'create_vault_order',
            },
        ]);
        expect(invoke.args.slice(1)).toEqual([
            USER,
            FEE_TOKEN,
            1_000n,
            20_100,
            1n,
            USER,
        ]);
    });

    it('rejects a fill policy, retired outcome, or forged exact quote', () => {
        const creation = quote();
        const fillPolicy = {
            kind: 'fillOrKill',
            transport: 'direct',
            keeper: USER,
            price: new Uint8Array([1]),
        } as ContractExecutionPolicy;
        const retired = quoteVaultOrderCreation({
            ledger: 20_000,
            now: 30_000n,
            status: Status.Retired,
            config: config(),
            action: 'redeem',
            amount: 100n,
            minOut: 0n,
            vault: {
                totalAssets: 1_000n,
                totalSupply: 1_000n,
                decimalsOffset: 0,
            },
        });

        for (const [candidate, policy] of [
            [creation, fillPolicy],
            [retired, { kind: 'restOnly', transport: 'direct' }],
            [
                { ...creation, priceTime: creation.priceTime + 1n },
                { kind: 'restOnly', transport: 'direct' },
            ],
        ] as const) {
            const result = buildVaultOrderOperation({
                tradingAddress: TRADING,
                user: USER,
                quote: candidate as ExactVaultRestingOrderCreationQuote,
                policy: policy as Extract<
                    ContractExecutionPolicy,
                    { kind: 'restOnly' }
                >,
            });
            expect(result).toMatchObject({
                kind: 'unavailable',
                code: 'INVALID_INPUT',
            });
        }
    });

    it('rejects an attempted arbitrary call batch instead of ignoring it', () => {
        const result = buildVaultOrderOperation({
            tradingAddress: TRADING,
            user: USER,
            quote: quote(),
            policy: { kind: 'restOnly', transport: 'direct' },
            calls: [],
        } as Parameters<typeof buildVaultOrderOperation>[0]);

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });
});
