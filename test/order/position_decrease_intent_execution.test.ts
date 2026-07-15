import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import {
    buildPositionDecreaseIntentExecution,
    type ContractExecutionPolicy,
    type ExactRelayFeeToken,
} from '../../src/order/transactions.js';
import {
    quotePositionDecreaseIntent,
    type ExactPositionDecreaseIntentQuote,
    type QuotePositionDecreaseIntentInput,
} from '../../src/position/decrease.js';
import type {
    SubjectBoundTradingSnapshot,
    TradingSnapshot,
} from '../../src/trading/trading_snapshot.js';
import {
    FULL_CLOSE,
    OrderKind,
    Status,
    type MarketData,
    type Position,
    type SidePair,
    type TradingConfig,
} from '../../src/trading/trading_types.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 10));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 11));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 12));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 13));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 14));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 15));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 16));
const FEE_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 17));
const OTHER_TRADING = StrKey.encodeContract(Buffer.alloc(32, 18));
const OTHER_ROUTER = StrKey.encodeContract(Buffer.alloc(32, 19));
const OTHER_USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 20));

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function config(): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 10_000_000n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        execFee: 2n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000n,
        maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18,
        initMargin: SCALAR_18 / 10n,
        maintenanceMargin: SCALAR_18 / 20n,
        liqFee: 0n,
        notionalLock: 0n,
        targetUtil: (SCALAR_18 * 8n) / 10n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: SCALAR_18 / 2n,
        adlClearTarget: (SCALAR_18 * 4n) / 10n,
        maxPnlTrader: (SCALAR_18 * 9n) / 10n,
        maxPnlWithdraw: (SCALAR_18 * 15n) / 100n,
        redeemLock: 0n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 1n,
        maxVaultBalance: 10_000_000n,
    };
}

function position(overrides: Partial<Position> = {}): Position {
    return {
        collateral: 503n,
        notional: 1_001n,
        tokens: 100_100_000_000_000_000n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        pricedAt: 19_990n,
        decreaseOrders: [],
        ...overrides,
    };
}

function market(open: Position): MarketData {
    return {
        notional: pair(open.notional, 0n),
        collateral: pair(open.collateral, 0n),
        tokens: pair(open.tokens, 0n),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        fundingUpdate: 20_000n,
        borrowingUpdate: 20_000n,
        fundingPool: 0n,
        fundingOwed: 0n,
        lastPriceTime: 19_999n,
    };
}

function snapshot(
    overrides: Partial<TradingSnapshot> = {},
): SubjectBoundTradingSnapshot {
    const open = overrides.position ?? position();
    return {
        subject: { user: USER, isLong: true },
        ledger: 10_000,
        ledgerTime: 20_000n,
        deployment: {
            trading: TRADING,
            router: ROUTER,
            vault: VAULT,
            priceVerifier: VERIFIER,
            treasury: TREASURY,
            feedId: 7,
            exponent: -4,
            vaultDecimalsOffset: 11,
            vaultShareDecimals: 18,
        },
        status: Status.Active,
        retirement: undefined,
        config: config(),
        market: market(open),
        position: open,
        price: {
            feedId: 7,
            exponent: -4,
            bid: 9_901n,
            ask: 10_099n,
            publishTime: 19_999n,
            source: 'pyth',
        },
        priceUpdate: new Uint8Array([1, 2, 3]),
        vault: {
            totalAssets: 1_000_000n,
            totalSupply: 1_000_000n,
            decimalsOffset: 11,
        },
        treasuryRate: 0n,
        ...overrides,
    };
}

function exactQuote(
    source: TradingSnapshot,
    overrides: Partial<QuotePositionDecreaseIntentInput> = {},
): ExactPositionDecreaseIntentQuote {
    const candidate = {
        snapshot: source,
        isLong: true,
        size: {
            kind: 'fraction' as const,
            ratio: { numerator: 1n, denominator: 3n },
        },
        collateralReturn: { kind: 'proRata' as const },
        execution: { transport: 'direct' as const, executionFee: 2n },
        maximumSlippage: { numerator: 1n, denominator: 100n },
        validForLedgers: 60,
        ...overrides,
    } as Record<string, unknown>;
    if ((candidate.size as { kind?: string }).kind === 'full') {
        delete candidate.collateralReturn;
    }
    const input = candidate as unknown as QuotePositionDecreaseIntentInput;
    const quoted = quotePositionDecreaseIntent(input);
    if (quoted.kind !== 'exact') {
        throw new Error(`fixture quote failed: ${quoted.kind}`);
    }
    return quoted;
}

function decodeInvoke(operationXdr: string) {
    const body = xdr.Operation.fromXDR(operationXdr, 'base64')
        .body()
        .invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        contract: Address.fromScAddress(invoke.contractAddress()).toString(),
        fn: invoke.functionName().toString(),
        args: invoke.args().map((arg) => scValToNative(arg)),
    };
}

const directPolicy: ContractExecutionPolicy = {
    kind: 'fillOrKill',
    transport: 'direct',
    keeper: KEEPER,
    price: new Uint8Array([1, 2, 3]),
};

const feeToken: ExactRelayFeeToken = {
    collateralAssetId: 'usdc',
    contractId: FEE_TOKEN,
    decimals: 7,
    pricing: { kind: 'usdPeg', numerator: '1', denominator: '1' },
    minForwardChargeAtomic: 1n,
    maxSignedFeeAtomic: 10_000n,
};

const relayPolicy: ContractExecutionPolicy = {
    kind: 'fillOrKill',
    transport: 'relay',
    feeToken,
    maxFeeAmount: 100n,
    feeExpiration: 10_060,
};

describe('buildPositionDecreaseIntentExecution', () => {
    it('encodes an exact full close through direct fill-or-kill', () => {
        const source = snapshot();
        const quote = exactQuote(source, {
            size: { kind: 'full' },
            collateralReturn: undefined,
        });

        const result = buildPositionDecreaseIntentExecution({
            snapshot: source,
            user: USER,
            quote,
            policy: directPolicy,
        });

        expect(result).toMatchObject({
            kind: 'exact',
            ledger: quote.ledger,
            priceTime: quote.priceTime,
            value: { policy: 'fillOrKill', transport: 'direct' },
        });
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('create_and_fill');
        const calls = invoke.args[0] as Record<string, unknown>[];
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            contract: TRADING,
            func: 'create_order',
            args: [
                USER,
                true,
                OrderKind.MarketDecrease,
                FULL_CLOSE,
                0n,
                0n,
                quote.value.priceBound,
                quote.value.expiration,
            ],
        });
    });

    it('encodes exact partial atomics and snapshot price through relay', () => {
        const source = snapshot();
        const quote = exactQuote(source, {
            execution: {
                transport: 'relay',
                executionFee: 2n,
                relayFee: 100n,
            },
        });

        const result = buildPositionDecreaseIntentExecution({
            snapshot: source,
            user: USER,
            quote,
            policy: relayPolicy,
        });

        expect(result).toMatchObject({
            kind: 'exact',
            ledger: quote.ledger,
            priceTime: quote.priceTime,
            value: { policy: 'fillOrKill', transport: 'relay' },
        });
        if (result.kind !== 'exact') return;
        const invoke = decodeInvoke(result.value.operationXdr);
        expect(invoke.contract).toBe(ROUTER);
        expect(invoke.fn).toBe('create_and_fill_with_fee');
        const calls = invoke.args[0] as Record<string, unknown>[];
        expect(calls[0]).toMatchObject({
            contract: TRADING,
            func: 'create_order',
            args: [
                USER,
                true,
                OrderKind.MarketDecrease,
                333n,
                167n,
                0n,
                quote.value.priceBound,
                quote.value.expiration,
            ],
        });
        expect(invoke.args.slice(1, 8)).toEqual([
            USER,
            FEE_TOKEN,
            100n,
            quote.value.expiration,
            1n,
            USER,
            USER,
        ]);
        expect(invoke.args[8]).toEqual(Buffer.from(source.priceUpdate));
    });

    it('rejects an estimate where an exact intent quote is required', () => {
        const source = snapshot();
        const quote = exactQuote(source);
        const estimate = {
            kind: 'estimate',
            value: quote.value,
            assumptions: ['forged estimate'],
        } as unknown as ExactPositionDecreaseIntentQuote;

        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: USER,
                quote: estimate,
                policy: directPolicy,
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it.each([
        [
            'ledger',
            (source: TradingSnapshot) => ({ ...source, ledger: 10_001 }),
        ],
        [
            'ledger time',
            (source: TradingSnapshot) => ({
                ...source,
                ledgerTime: 20_001n,
            }),
        ],
        [
            'unused config field',
            (source: TradingSnapshot) => ({
                ...source,
                config: { ...source.config, redeemLock: 1n },
            }),
        ],
        [
            'position',
            (source: TradingSnapshot) => {
                const changed = position({ collateral: 504n });
                return {
                    ...source,
                    position: changed,
                    market: market(changed),
                };
            },
        ],
        [
            'price',
            (source: TradingSnapshot) => ({
                ...source,
                price: { ...source.price, bid: source.price.bid + 1n },
            }),
        ],
        [
            'price update',
            (source: TradingSnapshot) => ({
                ...source,
                priceUpdate: new Uint8Array([1, 2, 4]),
            }),
        ],
        [
            'trading identity',
            (source: TradingSnapshot) => ({
                ...source,
                deployment: {
                    ...source.deployment,
                    trading: OTHER_TRADING,
                },
            }),
        ],
        [
            'Router identity',
            (source: TradingSnapshot) => ({
                ...source,
                deployment: {
                    ...source.deployment,
                    router: OTHER_ROUTER,
                },
            }),
        ],
    ] as const)(
        'rejects a quote paired with a different snapshot %s',
        (_label, change) => {
            const source = snapshot();
            const quote = exactQuote(source);

            expect(
                buildPositionDecreaseIntentExecution({
                    snapshot: change(source),
                    user: USER,
                    quote,
                    policy: directPolicy,
                }),
            ).toMatchObject({
                kind: 'unavailable',
                code: 'INVALID_INPUT',
            });
        },
    );

    it.each([
        [
            'quote ledger',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.ledger += 1;
            },
        ],
        [
            'quote price time',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.priceTime += 1n;
            },
        ],
        [
            'trading identity',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.value.identity.trading = OTHER_TRADING;
            },
        ],
        [
            'Router identity',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.value.identity.router = OTHER_ROUTER;
            },
        ],
        [
            'canonical action',
            (quote: ExactPositionDecreaseIntentQuote) => {
                if (quote.value.action.kind !== 'decrease') {
                    throw new Error('expected partial fixture');
                }
                quote.value.action.notional += 1n;
            },
        ],
        [
            'resolved collateral',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.value.resolvedCollateralReturn = 168n;
            },
        ],
        [
            'price bound',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.value.priceBound -= 1n;
            },
        ],
        [
            'expiration',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.value.expiration -= 1;
            },
        ],
        [
            'nested outcome',
            (quote: ExactPositionDecreaseIntentQuote) => {
                quote.value.outcome.walletPayout += 1n;
            },
        ],
        [
            'unknown field',
            (quote: ExactPositionDecreaseIntentQuote) => {
                (quote as unknown as Record<string, unknown>).extra = true;
            },
        ],
    ] as const)('rejects tampered %s', (_label, mutate) => {
        const source = snapshot();
        const quote = structuredClone(exactQuote(source));
        mutate(quote);

        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: USER,
                quote,
                policy: directPolicy,
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it('requires fill-or-kill at runtime', () => {
        const source = snapshot();
        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: USER,
                quote: exactQuote(source),
                policy: {
                    kind: 'restOnly',
                    transport: 'direct',
                } as unknown as ContractExecutionPolicy & {
                    kind: 'fillOrKill';
                },
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it('rejects an execution user that differs from the snapshot subject', () => {
        const source = snapshot();

        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: OTHER_USER,
                quote: exactQuote(source),
                policy: directPolicy,
            }),
        ).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'execution user must match snapshot subject',
        });
    });

    it('requires direct quote and policy transport identity', () => {
        const source = snapshot();
        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: USER,
                quote: exactQuote(source),
                policy: relayPolicy,
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it('requires relay quote and policy transport identity', () => {
        const source = snapshot();
        const quote = exactQuote(source, {
            execution: {
                transport: 'relay',
                executionFee: 2n,
                relayFee: 100n,
            },
        });

        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: USER,
                quote,
                policy: directPolicy,
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it('rejects direct policy price bytes from another snapshot', () => {
        const source = snapshot();
        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: USER,
                quote: exactQuote(source),
                policy: {
                    ...directPolicy,
                    price: new Uint8Array([1, 2, 4]),
                } as ContractExecutionPolicy & { kind: 'fillOrKill' },
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it.each([99n, 101n])(
        'rejects relay fee quote %s that differs from the signed maximum',
        (relayFee) => {
            const source = snapshot();
            const quote = exactQuote(source, {
                execution: {
                    transport: 'relay',
                    executionFee: 2n,
                    relayFee,
                },
            });

            expect(
                buildPositionDecreaseIntentExecution({
                    snapshot: source,
                    user: USER,
                    quote,
                    policy: relayPolicy,
                }),
            ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        },
    );

    it('requires exact relay fee-expiration identity', () => {
        const source = snapshot();
        const quote = exactQuote(source, {
            execution: {
                transport: 'relay',
                executionFee: 2n,
                relayFee: 100n,
            },
        });

        expect(
            buildPositionDecreaseIntentExecution({
                snapshot: source,
                user: USER,
                quote,
                policy: { ...relayPolicy, feeExpiration: 10_059 },
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });
});
