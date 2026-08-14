import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { mulDivFloor, SCALAR_18 } from '../../src/math/fixed.js';
import {
    applyOrder,
    maxWithdrawableMargin,
    orderPriceBound,
} from '../../src/trading/position/apply.js';
import { quotePositionAction } from '../../src/trading/position/quote.js';
import type {
    PositionAction,
    PositionActionInput,
} from '../../src/trading/position/quote.js';
import { orderExecutionPrice } from '../../src/trading/order/validation.js';
import type { PriceData } from '../../src/trading/market/types.js';
import type { TradingSnapshot } from '../../src/trading/snapshot.js';
import {
    FULL_CLOSE,
    OrderKind,
    Status,
} from '../../src/contracts/trading/trading_types.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../src/contracts/trading/trading_types.js';
import type { OrderParams } from '../../src/contracts/router/router_types.js';

const TRADING = StrKey.encodeContract(Buffer.alloc(32, 1));
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 2));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
const FEED_ID = Buffer.alloc(32, 7);

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function position(overrides: Partial<Position> = {}): Position {
    return {
        margin: 0n,
        notional: 0n,
        tokens: 0n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        pricedAt: 0n,
        decreaseOrders: [],
        ...overrides,
    };
}

// Reuses the contract-derived empty-book increase scale from
// test/position/quote.test.ts: 600 notional at price 1.0 under 10% initial
// margin requires 60_000_000n, so 70_000_000n leaves 10_000_000n headroom.
function openPosition(overrides: Partial<Position> = {}): Position {
    return position({
        margin: 70_000_000n,
        notional: 600_000_000n,
        tokens: 600_000_000_000_000_000n,
        ...overrides,
    });
}

function marketFor(open: Position, isLong = true): MarketData {
    return {
        notional: isLong ? pair(open.notional, 0n) : pair(0n, open.notional),
        margin: isLong ? pair(open.margin, 0n) : pair(0n, open.margin),
        tokens: isLong ? pair(open.tokens, 0n) : pair(0n, open.tokens),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        fundingUpdate: 1n,
        borrowingUpdate: 1n,
        fundingPool: 0n,
        fundingOwed: 0n,
    };
}

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
        execFee: 0n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18,
        initMargin: 100_000_000_000_000_000n,
        maintenanceMargin: 50_000_000_000_000_000n,
        liqFee: 0n,
        notionalLock: 15n,
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
        maxVaultBalance: 10_000_000_000_000n,
        ...overrides,
    };
}

function price(overrides: Partial<PriceData> = {}): PriceData {
    return {
        feedId: FEED_ID,
        bid: 1_000_000_000n,
        ask: 1_000_000_000n,
        publishTime: 1n,
        ...overrides,
    };
}

function snapshot(overrides: Partial<TradingSnapshot> = {}): TradingSnapshot {
    const open = overrides.position ?? position();
    return {
        subject: { user: USER, isLong: true },
        ledger: 1_000,
        ledgerTime: 1n,
        deployment: {
            trading: TRADING,
            router: ROUTER,
            vault: VAULT,
            oracle: ORACLE,
            treasury: TREASURY,
            feedId: FEED_ID,
            vaultDecimalsOffset: 0,
            vaultShareDecimals: 7,
        },
        status: Status.Active,
        retirement: undefined,
        config: config(),
        market: marketFor(open),
        position: open,
        price: price(),
        priceUpdate: new Uint8Array([1, 2, 3]),
        vault: {
            totalAssets: 100_000_000_000n,
            totalSupply: 100_000_000_000n,
            decimalsOffset: 0,
        },
        treasuryRate: 0n,
        ...overrides,
    };
}

function order(overrides: Partial<OrderParams> = {}): OrderParams {
    return {
        trading: TRADING,
        user: USER,
        isLong: true,
        kind: OrderKind.MarketIncrease,
        notional: 600_000_000n,
        margin: 250_000_000n,
        triggerPrice: 0n,
        priceBound: 0n,
        expiration: 2_000,
        ...overrides,
    };
}

function directInput(
    snap: TradingSnapshot,
    action: PositionAction,
    overrides: Partial<PositionActionInput> = {},
): PositionActionInput {
    return {
        ledger: snap.ledger,
        now: snap.ledgerTime,
        isLong: true,
        position: snap.position,
        market: snap.market,
        config: snap.config,
        price: snap.price,
        vaultAssets: snap.vault.totalAssets,
        treasuryRate: snap.treasuryRate,
        action,
        executionFee: snap.config.execFee,
        relayFee: 0n,
        ...overrides,
    };
}

describe('applyOrder market fills', () => {
    it('fills a market increase identically to the equivalent direct quote', () => {
        const snap = snapshot({
            config: config({
                feeDom: 5_000_000_000_000_000n,
                feeNonDom: 3_000_000_000_000_000n,
            }),
        });
        const result = applyOrder(snap, order());
        const direct = quotePositionAction(
            directInput(snap, {
                kind: 'increase',
                notional: 600_000_000n,
                margin: 250_000_000n,
            }),
        );

        expect(result.kind).toBe('fills');
        expect(direct.kind).toBe('exact');
        if (result.kind !== 'fills' || direct.kind !== 'exact') return;
        expect(result.outcome).toEqual(direct.value);
        expect(result.ledger).toBe(1_000);
        // Anchors from the contract-derived empty-book increase vector.
        expect(result.outcome.executionPrice).toBe(1_000_000_000n);
        expect(result.outcome.postPosition).toMatchObject({
            notional: 600_000_000n,
            tokens: 600_000_000_000_000_000n,
            margin: 246_640_000n,
        });
        expect(result.outcome.fees).toMatchObject({
            base: 3_000_000n,
            impact: 360_000n,
        });
    });

    it('maps FULL_CLOSE to the close action and pays out the wallet leg', () => {
        const open = position({
            margin: 100_000_000n,
            notional: 1_000_000_000n,
            tokens: 1_000_000_000_000_000_000n,
        });
        const snap = snapshot({
            config: config({
                feeDom: 5_000_000_000_000_000n,
                feeNonDom: 3_000_000_000_000_000n,
            }),
            position: open,
            market: marketFor(open),
        });
        const result = applyOrder(
            snap,
            order({
                kind: OrderKind.MarketDecrease,
                notional: FULL_CLOSE,
                margin: 0n,
            }),
        );
        const direct = quotePositionAction(directInput(snap, { kind: 'close' }));

        expect(result.kind).toBe('fills');
        expect(direct.kind).toBe('exact');
        if (result.kind !== 'fills' || direct.kind !== 'exact') return;
        expect(result.outcome).toEqual(direct.value);
        expect(result.outcome.action).toEqual({ kind: 'close' });
        // Contract-derived flat full close: 100_000_000n gross less 4_000_000n fees.
        expect(result.outcome.walletPayout).toBe(96_000_000n);
        expect(result.outcome.postPosition).toEqual(position());
    });

    it('maps zero-notional orders to margin adjustments in both directions', () => {
        const snap = snapshot({ position: openPosition() });
        const added = applyOrder(
            snap,
            order({ notional: 0n, margin: 5_000_000n }),
        );
        const withdrawn = applyOrder(
            snap,
            order({
                kind: OrderKind.MarketDecrease,
                notional: 0n,
                margin: 5_000_000n,
            }),
        );

        expect(added.kind).toBe('fills');
        if (added.kind !== 'fills') return;
        expect(added.outcome.action).toEqual({
            kind: 'adjustMargin',
            direction: 'add',
            amount: 5_000_000n,
        });
        expect(added.outcome.postPosition.margin).toBe(75_000_000n);
        expect(added.outcome.walletPayout).toBe(0n);

        expect(withdrawn.kind).toBe('fills');
        if (withdrawn.kind !== 'fills') return;
        expect(withdrawn.outcome.action).toEqual({
            kind: 'adjustMargin',
            direction: 'withdraw',
            amount: 5_000_000n,
        });
        expect(withdrawn.outcome.postPosition.margin).toBe(65_000_000n);
        expect(withdrawn.outcome.walletPayout).toBe(5_000_000n);
    });

    it('evaluates the what-if price override instead of the snapshot price', () => {
        const snap = snapshot();
        const atSnapshot = applyOrder(snap, order());
        const atOverride = applyOrder(snap, order(), {
            price: price({ bid: 2_000_000_000n, ask: 2_000_000_000n }),
        });

        expect(atSnapshot.kind).toBe('fills');
        expect(atOverride.kind).toBe('fills');
        if (atSnapshot.kind !== 'fills' || atOverride.kind !== 'fills') return;
        expect(atSnapshot.outcome.executionPrice).toBe(1_000_000_000n);
        expect(atOverride.outcome.executionPrice).toBe(2_000_000_000n);
        expect(atSnapshot.outcome.postPosition.tokens).toBe(
            600_000_000_000_000_000n,
        );
        expect(atOverride.outcome.postPosition.tokens).toBe(
            300_000_000_000_000_000n,
        );
    });
});

describe('applyOrder gates and rests', () => {
    it('gates a margin withdrawal that breaks initial margin with code 713', () => {
        const snap = snapshot({ position: openPosition() });
        const result = applyOrder(
            snap,
            order({
                kind: OrderKind.MarketDecrease,
                notional: 0n,
                margin: 20_000_000n,
            }),
        );

        expect(result).toEqual({
            kind: 'gate',
            code: 713,
            reason: 'contract error #713: insufficient margin',
            ledger: 1_000,
        });
    });

    it('gates a notional below the order dust floor with code 732', () => {
        const snap = snapshot({
            config: config({ minOrderNotional: 1_000_000n }),
        });
        const result = applyOrder(snap, order({ notional: 500_000n }));

        expect(result).toMatchObject({
            kind: 'gate',
            code: 732,
            reason: 'notional is below the order dust floor',
        });
    });

    it('gates a size-growing increase while opens are halted with code 705', () => {
        const onIce = applyOrder(snapshot({ status: Status.OnIce }), order());
        const delisted = applyOrder(
            snapshot({ status: Status.Delisted }),
            order(),
        );
        const adlHalted = applyOrder(
            snapshot({ adl: { long: true, short: false } }),
            order(),
        );
        const otherSideAdl = applyOrder(
            snapshot({ adl: { long: false, short: true } }),
            order(),
        );
        const marginOnly = applyOrder(
            snapshot({
                status: Status.OnIce,
                position: openPosition(),
            }),
            order({ notional: 0n, margin: 5_000_000n }),
        );

        const halted = {
            kind: 'gate',
            code: 705,
            reason: 'contract error #705: increase halted',
            ledger: 1_000,
        };
        expect(onIce).toEqual(halted);
        expect(delisted).toEqual(halted);
        expect(adlHalted).toEqual(halted);
        expect(otherSideAdl.kind).toBe('fills');
        // A zero-notional increase adds only margin and stays available for
        // margin defense when opens are halted.
        expect(marginOnly.kind).toBe('fills');
    });

    it('gates a ninth pending decrease with code 733', () => {
        const open = openPosition({
            decreaseOrders: [1, 2, 3, 4, 5, 6, 7, 8],
        });
        const snap = snapshot({ position: open, market: marketFor(open) });
        const result = applyOrder(
            snap,
            order({
                kind: OrderKind.MarketDecrease,
                notional: 100_000_000n,
                margin: 0n,
            }),
        );
        const increaseUncapped = applyOrder(snap, order());

        expect(result).toMatchObject({
            kind: 'gate',
            code: 733,
            reason: 'side already holds the maximum pending decrease orders',
        });
        expect(increaseUncapped.kind).toBe('fills');
    });

    it('rests a market order whose price bound is not crossed', () => {
        const snap = snapshot();
        const notCrossed = applyOrder(
            snap,
            order({ priceBound: 900_000_000n }),
        );
        const crossed = applyOrder(
            snap,
            order({ priceBound: 1_000_000_000n }),
        );

        expect(notCrossed).toEqual({
            kind: 'rests',
            reason: 'market execution price exceeds price bound',
            ledger: 1_000,
        });
        expect(crossed.kind).toBe('fills');
    });

    it('rests trigger orders until their trigger price crosses', () => {
        const snap = snapshot({ position: openPosition() });
        const limit = applyOrder(
            snap,
            order({
                kind: OrderKind.LimitDecrease,
                notional: 100_000_000n,
                margin: 0n,
                triggerPrice: 1_200_000_000n,
            }),
        );
        const stop = applyOrder(
            snap,
            order({
                kind: OrderKind.StopIncrease,
                triggerPrice: 900_000_000n,
            }),
        );

        expect(limit).toEqual({
            kind: 'rests',
            reason: 'trigger orders rest until their trigger price crosses',
            ledger: 1_000,
        });
        expect(stop).toMatchObject({ kind: 'rests' });
    });

    it('gates an order whose side mismatches the snapshot subject with code 0', () => {
        const result = applyOrder(snapshot(), order({ isLong: false }));

        expect(result).toEqual({
            kind: 'gate',
            code: 0,
            reason: 'order side does not match the snapshot subject',
            ledger: 1_000,
        });
    });
});

describe('orderPriceBound', () => {
    const quoted = price({ bid: 990_000_000n, ask: 1_010_000_000n });
    const slippageBps = 100n; // 1%

    it.each([
        [OrderKind.MarketIncrease, true, 1_020_100_000n],
        [OrderKind.MarketIncrease, false, 980_100_000n],
        [OrderKind.MarketDecrease, true, 980_100_000n],
        [OrderKind.MarketDecrease, false, 1_020_100_000n],
        [OrderKind.LimitIncrease, true, 1_020_100_000n],
        [OrderKind.StopDecrease, false, 1_020_100_000n],
    ])(
        'bounds kind %i isLong %s at executionPrice plus or minus the floored slippage',
        (kind, isLong, expected) => {
            const executionPrice = orderExecutionPrice(kind, isLong, quoted);
            const adverse = mulDivFloor(executionPrice, slippageBps, 10_000n);
            const increases =
                kind === OrderKind.MarketIncrease ||
                kind === OrderKind.LimitIncrease ||
                kind === OrderKind.StopIncrease;
            const bound = orderPriceBound(quoted, isLong, kind, slippageBps);

            expect(bound).toBe(
                increases === isLong
                    ? executionPrice + adverse
                    : executionPrice - adverse,
            );
            expect(bound).toBe(expected);
        },
    );

    it('accepts full slippage and rejects out-of-range basis points', () => {
        const executionPrice = orderExecutionPrice(
            OrderKind.MarketIncrease,
            true,
            quoted,
        );
        expect(
            orderPriceBound(quoted, true, OrderKind.MarketIncrease, 10_000n),
        ).toBe(executionPrice * 2n);
        expect(() =>
            orderPriceBound(quoted, true, OrderKind.MarketIncrease, -1n),
        ).toThrow('basis points must be between 0 and 10000');
        expect(() =>
            orderPriceBound(quoted, true, OrderKind.MarketIncrease, 10_001n),
        ).toThrow('basis points must be between 0 and 10000');
    });
});

describe('maxWithdrawableMargin', () => {
    it('returns the largest withdrawal that still quotes exact', () => {
        const snap = snapshot({ position: openPosition() });
        const amount = maxWithdrawableMargin(snap);

        // 70_000_000n margin against a 60_000_000n initial requirement.
        expect(amount).toBe(10_000_000n);
        const probe = (value: bigint) =>
            quotePositionAction(
                directInput(snap, {
                    kind: 'adjustMargin',
                    direction: 'withdraw',
                    amount: value,
                }),
            );
        expect(probe(amount).kind).toBe('exact');
        expect(probe(amount + 1n)).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('713'),
        });
    });

    it('returns 0n when even the minimum order margin gates', () => {
        const snap = snapshot({
            position: openPosition({ margin: 60_000_000n }),
        });

        expect(maxWithdrawableMargin(snap)).toBe(0n);
    });
});
