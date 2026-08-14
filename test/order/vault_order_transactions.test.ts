import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    buildVaultOrderOperation,
    type ContractExecutionPolicy,
} from '../../src/trading/order/transactions.js';
import { Status } from '../../src/contracts/trading/trading_types.js';
import type { TradingConfig } from '../../src/contracts/trading/trading_types.js';
import {
    quoteVaultOrderCreation,
    type ExactVaultRestingOrderCreationQuote,
} from '../../src/trading/quote/vault.js';

const TRADING = StrKey.encodeContract(Buffer.alloc(32, 71));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 73));

function config(): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 2_000_000n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
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
    return { ...result, value: result.value };
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

    it('rejects a fill policy or retired outcome', () => {
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

});
