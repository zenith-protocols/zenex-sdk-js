import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import {
    entryPrice,
    exactPositionPnl,
    exitPrice,
    marketNetPnl,
    marketSidePnl,
    quoteTradeFees,
    reserveUtilization,
    sideReserved,
} from '../../src/trading/market/capacity.js';
import type { PriceData } from '../../src/trading/market/types.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../src/contracts/trading/trading_types.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function market(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        margin: pair(),
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

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
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

describe('exact market marks and capacity', () => {
    it('selects the contract entry and exit sides', () => {
        const price: PriceData = {
            feedId: 1,
            exponent: -8,
            bid: 900_000_000n,
            ask: 1_100_000_000n,
        };

        expect(entryPrice(price, true)).toBe(price.ask);
        expect(entryPrice(price, false)).toBe(price.bid);
        expect(exitPrice(price, true)).toBe(price.bid);
        expect(exitPrice(price, false)).toBe(price.ask);
    });

    it('floors a fractional long exit and ceils the mirrored short exit', () => {
        const price: PriceData = {
            feedId: 1,
            exponent: -8,
            bid: 250_000_000n,
            ask: 250_000_000n,
        };
        const open = position({
            notional: 100_000_000n,
            tokens: 333_333_333_333_333_333n,
        });

        expect(exactPositionPnl(open, price, true)).toBe(-16_666_667n);
        expect(exactPositionPnl(open, price, false)).toBe(16_666_666n);
    });

    it('rounds a long ask reserve up by one atomic unit', () => {
        const price: PriceData = {
            feedId: 1,
            exponent: 0,
            bid: 1n,
            ask: 1n,
        };

        expect(sideReserved(market({ tokens: pair(1n, 0n) }), price, true)).toBe(1n);
    });

    it('marks both side PnLs in the maximizing and minimizing directions', () => {
        const data = market({
            notional: pair(200_000_000n, 50_000_000n),
            margin: pair(100_000_000n, 30_000_000n),
            tokens: pair(2_000_000_000_000_000_000n, 500_000_000_000_000_000n),
        });
        const price: PriceData = {
            feedId: 1,
            exponent: -7,
            bid: 90_000_000n,
            ask: 110_000_000n,
        };

        expect(marketSidePnl(data, price, true, true)).toBe(20_000_000n);
        expect(marketSidePnl(data, price, false, true)).toBe(5_000_000n);
        expect(marketNetPnl(data, price, true)).toBe(25_000_000n);
        expect(marketSidePnl(data, price, true, false)).toBe(-20_000_000n);
        expect(marketSidePnl(data, price, false, false)).toBe(-5_000_000n);
        expect(marketNetPnl(data, price, false)).toBe(-25_000_000n);
    });

    it('floors a marked side loss at posted margin', () => {
        const data = market({
            notional: pair(200_000_000n, 50_000_000n),
            margin: pair(10_000_000n, 30_000_000n),
            tokens: pair(2_000_000_000_000_000_000n, 500_000_000_000_000_000n),
        });
        const price: PriceData = {
            feedId: 1,
            exponent: -7,
            bid: 90_000_000n,
            ask: 110_000_000n,
        };

        expect(marketSidePnl(data, price, true, false)).toBe(-10_000_000n);
        expect(marketNetPnl(data, price, false)).toBe(-15_000_000n);
    });

    it('ceils reserve utilization, handles zero capacity, and clamps to one', () => {
        expect(reserveUtilization(0n, 0n)).toBe(0n);
        expect(reserveUtilization(1n, 0n)).toBe(SCALAR_18);
        expect(reserveUtilization(1n, 3n)).toBe(333_333_333_333_333_334n);
        expect(reserveUtilization(4n, 3n)).toBe(SCALAR_18);
    });
});

describe('exact skew and trade fees', () => {
    it('splits a balance crossing by token skew and maps it to notional with fee ceil', () => {
        const fees = quoteTradeFees(
            market({ tokens: pair(10_000_000_000_000_000_000n, 12_000_000_000_000_000_000n) }),
            config(),
            true,
            500_000_000n,
            5_000_000_000_000_000_000n,
        );

        expect(fees).toEqual({
            worsening: 300_000_000n,
            improving: 200_000_000n,
            base: 2_100_000n,
            impact: 250_000n,
        });
    });

    it('ceils an atomic base fee and caps impact at ten percent', () => {
        const atomic = quoteTradeFees(
            market(),
            config({ feeDom: 1n, feeNonDom: 0n, impactScalar: 1_000n }),
            true,
            1n,
            1n,
        );
        const capped = quoteTradeFees(
            market(),
            config({ feeDom: 0n, feeNonDom: 0n, impactScalar: 1_000n }),
            true,
            1_000n,
            1_000n,
        );

        expect(atomic.base).toBe(1n);
        expect(capped.impact).toBe(100n);
    });
});

describe('exact market architecture', () => {
    it('contains no display or JavaScript-number conversion path', () => {
        const marketRoot = `${repoRoot}/src/trading/market`;
        const source = readdirSync(marketRoot)
            .filter((filename) => filename.endsWith('.ts'))
            .map((filename) => readFileSync(`${marketRoot}/${filename}`, 'utf8'))
            .join('\n');

        expect(source).not.toMatch(/\bNumber\s*\(/);
        expect(source).not.toMatch(/\.toFloat\s*\(/);
        expect(source).not.toMatch(/\bparseFloat\s*\(/);
        expect(source).not.toMatch(/from\s+['"][^'"]*(?:display|format)[^'"]*['"]/i);
    });
});
