import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    validateFillOrKillCalls,
    validateOrder,
} from '../../src/order/validation.js';
import { OrderKind, Status } from '../../src/trading/trading_types.js';
import type { TradingConfig } from '../../src/trading/trading_types.js';
import {
    createOrderCall,
    type Call,
    type OrderParams,
} from '../../src/trading-router/router_types.js';

const TRADING = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER_TRADING = StrKey.encodeContract(Buffer.alloc(32, 2));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const OTHER_USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 100n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 10_000_000n,
        minOrderNotional: 10n,
        minOrderCollateral: 5n,
        execFee: 2n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000n,
        maxUtilOpen: 1_000_000_000_000_000_000n,
        maxUtilWithdraw: 1_000_000_000_000_000_000n,
        initMargin: 100_000_000_000_000_000n,
        maintenanceMargin: 50_000_000_000_000_000n,
        liqFee: 0n,
        notionalLock: 0n,
        targetUtil: 800_000_000_000_000_000n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: 500_000_000_000_000_000n,
        adlClearTarget: 400_000_000_000_000_000n,
        maxPnlTrader: 900_000_000_000_000_000n,
        maxPnlWithdraw: 150_000_000_000_000_000n,
        redeemLock: 0n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 1n,
        maxVaultBalance: 10_000_000n,
        ...overrides,
    };
}

function order(overrides: Partial<OrderParams> = {}): OrderParams {
    return {
        trading: TRADING,
        user: USER,
        isLong: true,
        kind: OrderKind.MarketIncrease,
        notional: 100n,
        collateral: 20n,
        triggerPrice: 0n,
        priceBound: 110n,
        expiration: 1_100,
        ...overrides,
    };
}

function context(overrides: Record<string, unknown> = {}) {
    return {
        ledger: 1_000,
        now: 2_000n,
        status: Status.Active,
        config: config(),
        price: {
            feedId: 1,
            exponent: -8,
            bid: 100n,
            ask: 105n,
            publishTime: 1_999n,
            source: 'pyth' as const,
        },
        ...overrides,
    };
}

function issueCodes(
    params: OrderParams,
    overrides: Record<string, unknown> = {},
) {
    return validateOrder(params, context(overrides)).map((issue) => issue.code);
}

describe('validateOrder', () => {
    it('returns issues instead of throwing for non-object external input', () => {
        expect(
            validateOrder(null as unknown as OrderParams, context()),
        ).toContainEqual(
            expect.objectContaining({
                field: 'batch',
                reason: expect.any(String),
            }),
        );
        expect(
            validateOrder(
                order(),
                null as unknown as ReturnType<typeof context>,
            ),
        ).toContainEqual(
            expect.objectContaining({
                field: 'batch',
                reason: expect.any(String),
            }),
        );
    });

    it('mirrors negative, dust, no-op, trigger, maximum, and expiry gates', () => {
        expect(issueCodes(order({ notional: -1n }))).toContain(710);
        expect(issueCodes(order({ notional: 1n }))).toContain(732);
        expect(issueCodes(order({ notional: 0n, collateral: 0n }))).toContain(
            732,
        );
        expect(
            issueCodes(
                order({ kind: OrderKind.LimitDecrease, triggerPrice: 0n }),
            ),
        ).toContain(732);
        expect(issueCodes(order({ notional: 1_000_001n }))).toContain(712);
        expect(issueCodes(order({ expiration: 999 }))).toContain(731);
    });

    it('rejects frozen or retired creation and unknown order kinds', () => {
        expect(issueCodes(order(), { status: Status.Frozen })).toContain(704);
        expect(issueCodes(order(), { status: Status.Retired })).toContain(704);
        expect(issueCodes(order({ kind: 99 as OrderKind }))).toContain(734);
        expect(issueCodes(order(), { status: 99 as Status })).toContain(702);
    });

    it('fails closed for invalid configured order bounds', () => {
        expect(
            issueCodes(order(), {
                config: config({ minOrderNotional: 0n }),
            }),
        ).toContain(700);
    });

    it('checks the exact market execution side against the bound', () => {
        const issues = validateOrder(order({ priceBound: 104n }), context());
        expect(issues).toContainEqual(
            expect.objectContaining({ code: 741, field: 'priceBound' }),
        );
        expect(validateOrder(order({ priceBound: 105n }), context())).toEqual(
            [],
        );
    });

    it('fails closed for a future or malformed market price', () => {
        expect(
            issueCodes(order(), {
                price: { ...context().price, publishTime: 2_001n },
            }),
        ).toContain(740);
        expect(
            issueCodes(order(), {
                price: { ...context().price, bid: 106n, ask: 105n },
            }),
        ).toContain(740);
    });
});

describe('validateFillOrKillCalls', () => {
    const expected = { tradingAddress: TRADING, user: USER, isLong: true };
    const primary = () => createOrderCall(order());
    const exit = (overrides: Partial<OrderParams> = {}) =>
        createOrderCall(
            order({
                kind: OrderKind.LimitDecrease,
                notional: 50n,
                collateral: 0n,
                triggerPrice: 120n,
                priceBound: 0n,
                ...overrides,
            }),
        );
    const cancel = (): Call => ({
        contract: TRADING,
        func: 'cancel_order',
        args: [Address.fromString(USER).toScVal(), xdr.ScVal.scvU32(7)],
    });

    it('accepts one market primary followed by same-user exits and cancellations', () => {
        expect(
            validateFillOrKillCalls([primary(), cancel(), exit()], expected),
        ).toEqual([]);
    });

    it.each([
        ['wrong target', [{ ...primary(), contract: OTHER_TRADING }]],
        ['wrong function', [{ ...primary(), func: 'execute_order' }]],
        [
            'wrong argument count',
            [{ ...primary(), args: primary().args.slice(0, 7) }],
        ],
        [
            'mismatched embedded user',
            [
                {
                    ...primary(),
                    args: [
                        Address.fromString(OTHER_USER).toScVal(),
                        ...primary().args.slice(1),
                    ],
                },
            ],
        ],
    ])('rejects a %s in the primary call', (_name, calls) => {
        expect(validateFillOrKillCalls(calls as Call[], expected)).not.toEqual(
            [],
        );
    });

    it('rejects second primaries, cross-market exits, opposite sides, and generic calls', () => {
        expect(
            validateFillOrKillCalls([primary(), primary()], expected),
        ).not.toEqual([]);
        expect(
            validateFillOrKillCalls(
                [primary(), exit({ trading: OTHER_TRADING })],
                expected,
            ),
        ).not.toEqual([]);
        expect(
            validateFillOrKillCalls(
                [primary(), exit({ isLong: false })],
                expected,
            ),
        ).not.toEqual([]);
        expect(
            validateFillOrKillCalls(
                [primary(), { ...cancel(), func: 'set_config' }],
                expected,
            ),
        ).not.toEqual([]);
    });

    it('rejects trigger orders as the primary fill target', () => {
        expect(
            validateFillOrKillCalls(
                [exit({ kind: OrderKind.StopDecrease })],
                expected,
            ),
        ).not.toEqual([]);
    });

    it('requires the expected market identity to be a contract ID', () => {
        expect(
            validateFillOrKillCalls([primary()], {
                ...expected,
                tradingAddress: USER,
            }),
        ).toMatchObject([
            { field: 'batch', reason: 'expected market identity is invalid' },
        ]);
    });
});
