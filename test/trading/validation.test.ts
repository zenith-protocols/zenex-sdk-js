import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { validateOrder } from '../../src/trading/internal/order.js';
import { OrderKind, Status } from '../../src/contracts/market/types.js';
import type {
    Position,
    TradingConfig,
} from '../../src/contracts/market/types.js';
import type { OrderParams } from '../../src/contracts/router/types.js';

const TRADING = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 100n,
        maxPositionNotional: 1_000_000n,
        maxOpenInterest: 10_000_000n,
        minOrderNotional: 10n,
        minOrderMargin: 5n,
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
        margin: 20n,
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
            feedId: Buffer.alloc(32, 1),
            bid: 100n,
            ask: 105n,
            publishTime: 1n,
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
    it('mirrors negative, dust, no-op, trigger, maximum, and expiry gates', () => {
        expect(issueCodes(order({ notional: -1n }))).toContain(710);
        expect(issueCodes(order({ notional: 1n }))).toContain(732);
        expect(issueCodes(order({ notional: 0n, margin: 0n }))).toContain(
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
    });

    it('caps pending decrease orders per side at MAX_ORDERS_PER_SIDE', () => {
        const parked: Position = {
            margin: 100n,
            notional: 1_000n,
            tokens: 1_000n,
            fundingIdx: 0n,
            borrowingIdx: 0n,
            lockedNotional: 0n,
            unlocksAt: 0n,
            pricedAt: 0n,
            decreaseOrders: [1, 2, 3, 4, 5, 6, 7, 8],
        };
        const decrease = order({
            kind: OrderKind.MarketDecrease,
            notional: 100n,
            margin: 0n,
            priceBound: 0n,
        });

        expect(issueCodes(decrease, { position: parked })).toContain(733);
        expect(
            issueCodes(decrease, {
                position: { ...parked, decreaseOrders: [1, 2, 3, 4, 5, 6, 7] },
            }),
        ).toEqual([]);
        // Increases never join the decrease list, so the cap does not apply.
        expect(issueCodes(order(), { position: parked })).toEqual([]);
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

    it('fails closed for a malformed market price', () => {
        expect(
            issueCodes(order(), {
                price: { ...context().price, bid: 106n, ask: 105n },
            }),
        ).toContain(740);
    });
});
