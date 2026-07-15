import { describe, expect, it } from 'vitest';
import { mulDivFloor, SCALAR_18 } from '../../src/math/fixed.js';
import {
    impliedEntryPrice,
    liquidationState,
    positionLeverage,
} from '../../src/position/lifecycle.js';
import type { VerifiedPrice } from '../../src/market/types.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../src/trading/trading_types.js';
import { loadGoldenCases } from '../helpers/golden.js';

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected a golden vector record');
    }
    return value as Record<string, unknown>;
}

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function emptyPosition(overrides: Partial<Position> = {}): Position {
    return {
        collateral: 0n,
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

function emptyMarket(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        collateral: pair(),
        tokens: pair(),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        fundingUpdate: 0n,
        borrowingUpdate: 0n,
        fundingPool: 0n,
        fundingOwed: 0n,
        lastPriceTime: 0n,
        ...overrides,
    };
}

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        execFee: 0n,
        feeDom: 5_000_000_000_000_000n,
        feeNonDom: 3_000_000_000_000_000n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: 800_000_000_000_000_000n,
        maxUtilWithdraw: 900_000_000_000_000_000n,
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

function price(inputs: Record<string, unknown>): VerifiedPrice {
    return {
        feedId: Number(inputs.feed_id),
        exponent: Number(inputs.exponent),
        bid: inputs.bid as bigint,
        ask: inputs.ask as bigint,
        publishTime: inputs.publish_time as bigint,
        source: 'pyth',
    };
}

const positionCases = loadGoldenCases('trading', 'position');

function vector(id: string) {
    const found = positionCases.find((entry) => entry.id === id);
    if (!found) throw new Error(`Missing position vector ${id}`);
    return found;
}

function liquidationContext(id: string) {
    const golden = vector(id);
    const inputs = record(golden.inputs);
    const open = emptyPosition({
        notional: inputs.position_notional as bigint,
        tokens: inputs.position_tokens as bigint,
        collateral: inputs.position_collateral as bigint,
    });
    return {
        ledger: 77,
        now: inputs.now as bigint,
        isLong: inputs.is_long as boolean,
        position: open,
        market: emptyMarket({
            notional: pair(open.notional, 0n),
            tokens: pair(open.tokens, 0n),
            collateral: pair(open.collateral, 0n),
            fundingUpdate: inputs.now as bigint,
            borrowingUpdate: inputs.now as bigint,
        }),
        config: config({
            feeDom: inputs.fee_dom as bigint,
            feeNonDom: inputs.fee_non_dom as bigint,
            impactScalar: inputs.impact_scalar as bigint,
            initMargin: inputs.init_margin as bigint,
            maintenanceMargin: inputs.maintenance_margin as bigint,
        }),
        price: price(inputs),
        vaultAssets: inputs.vault_balance as bigint,
        treasuryRate: 0n,
    };
}

describe('position lifecycle state', () => {
    it('derives the exact implied entry and leaves an empty position undefined', () => {
        const golden = vector('position.increase.empty_book');
        const inputs = record(golden.inputs);
        const expected = record(golden.expected);

        expect(impliedEntryPrice(emptyPosition())).toBeUndefined();
        expect(
            impliedEntryPrice(
                emptyPosition({
                    notional: expected.position_notional as bigint,
                    tokens: expected.position_tokens as bigint,
                }),
            ),
        ).toBe(inputs.ask);
    });

    it('quotes marked-equity leverage without converting financial values to number', () => {
        const golden = vector('position.increase.empty_book');
        const inputs = record(golden.inputs);
        const expected = record(golden.expected);
        const open = emptyPosition({
            notional: expected.position_notional as bigint,
            tokens: expected.position_tokens as bigint,
            collateral: expected.position_collateral as bigint,
        });
        const result = positionLeverage(open, price(inputs), true);

        expect(result).toEqual({
            kind: 'estimate',
            value: mulDivFloor(open.notional, SCALAR_18, open.collateral),
            assumptions: ['excludes unsettled funding and borrowing accruals'],
        });
        expect(
            positionLeverage(emptyPosition(), price(inputs), true),
        ).toMatchObject({
            kind: 'estimate',
            value: 0n,
        });
    });

    it('matches the healthy full-close settled equity and maintenance line', () => {
        const golden = vector('position.full_close.flat');
        const expected = record(golden.expected);
        const result = liquidationState(
            liquidationContext('position.full_close.flat').position,
            liquidationContext('position.full_close.flat'),
        );

        expect(result).toEqual({
            kind: 'exact',
            ledger: 77,
            priceTime: 1n,
            value: {
                equity: expected.returned,
                maintenanceRequired: 50_000_000n,
                liquidatable: false,
            },
        });
    });

    it('identifies the contract-derived underwater full close as liquidatable', () => {
        const result = liquidationState(
            liquidationContext(
                'position.full_close.underwater_voluntary_reject',
            ).position,
            liquidationContext(
                'position.full_close.underwater_voluntary_reject',
            ),
        );

        expect(result).toEqual({
            kind: 'exact',
            ledger: 77,
            priceTime: 1n,
            value: {
                equity: 0n,
                maintenanceRequired: 5n,
                liquidatable: true,
            },
        });
    });

    it('returns typed unavailable results for stale liquidation marks and chronology', () => {
        const stale = liquidationContext('position.full_close.flat');
        stale.position.pricedAt = 2n;
        const chronology = liquidationContext('position.full_close.flat');
        chronology.market.fundingUpdate = 2n;

        expect(liquidationState(stale.position, stale)).toEqual({
            kind: 'unavailable',
            code: 'STALE_PRICE',
            reason: 'verified price predates the position price floor',
        });
        expect(liquidationState(chronology.position, chronology)).toMatchObject(
            {
                kind: 'unavailable',
                code: 'INVALID_INPUT',
            },
        );
    });
});
