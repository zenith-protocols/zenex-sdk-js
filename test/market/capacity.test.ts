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
    sideCapacity,
    sideReserved,
} from '../../src/market/capacity.js';
import type { VerifiedPrice } from '../../src/market/types.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../src/trading/trading_types.js';
import { loadGoldenCases } from '../helpers/golden.js';
import type { GoldenCase } from '../helpers/golden.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected a golden vector record');
    }
    return value as Record<string, unknown>;
}

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function market(overrides: Partial<MarketData> = {}): MarketData {
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

function position(overrides: Partial<Position> = {}): Position {
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

function verifiedPrice(inputs: Record<string, unknown>, source: VerifiedPrice['source'] = 'pyth'): VerifiedPrice {
    const terminal = inputs.terminal_price as bigint | undefined;
    return {
        feedId: Number(inputs.feed_id),
        exponent: Number(inputs.exponent),
        bid: terminal ?? inputs.bid as bigint,
        ask: terminal ?? inputs.ask as bigint,
        publishTime: (inputs.publish_time ?? inputs.now) as bigint,
        source,
    };
}

const positionVectors = loadGoldenCases('trading', 'position');
const pnlVectors = positionVectors.filter((entry) => entry.operation === 'pnl');
const feeVectors = positionVectors.filter((entry) => record(entry.work).base_fee !== undefined);

describe('exact market marks and capacity', () => {
    it('selects the contract entry and exit sides', () => {
        const price: VerifiedPrice = {
            feedId: 1,
            exponent: -8,
            bid: 900_000_000n,
            ask: 1_100_000_000n,
            publishTime: 10n,
            source: 'pyth',
        };

        expect(entryPrice(price, true)).toBe(price.ask);
        expect(entryPrice(price, false)).toBe(price.bid);
        expect(exitPrice(price, true)).toBe(price.bid);
        expect(exitPrice(price, false)).toBe(price.ask);
    });

    it.each(pnlVectors)('$id uses adverse exit rounding', (golden) => {
        const inputs = record(golden.inputs);
        const expected = record(golden.expected);

        expect(exactPositionPnl(
            position({ notional: inputs.notional as bigint, tokens: inputs.tokens as bigint }),
            verifiedPrice(inputs),
            inputs.is_long as boolean,
        )).toBe(expected.pnl);
    });

    it('floors a fractional long exit and ceils the mirrored short exit', () => {
        const price: VerifiedPrice = {
            feedId: 1,
            exponent: -8,
            bid: 250_000_000n,
            ask: 250_000_000n,
            publishTime: 1n,
            source: 'pyth',
        };
        const open = position({
            notional: 100_000_000n,
            tokens: 333_333_333_333_333_333n,
        });

        expect(exactPositionPnl(open, price, true)).toBe(-16_666_667n);
        expect(exactPositionPnl(open, price, false)).toBe(16_666_666n);
    });

    it.each(loadGoldenCases('trading', 'capacity'))('$id matches reserve and side-capacity boundaries', (golden) => {
        const inputs = record(golden.inputs);
        const work = record(golden.work);
        const expected = record(golden.expected);
        const data = market({
            notional: pair(0n, (inputs.short_notional ?? 0n) as bigint),
            tokens: pair((inputs.long_tokens ?? 0n) as bigint, 0n),
        });
        const price = verifiedPrice(inputs);
        const longReserve = sideReserved(data, price, true);
        const shortReserve = sideReserved(data, price, false);

        if (golden.operation === 'reserve') {
            expect(longReserve).toBe(expected.long_reserved);
            expect(shortReserve).toBe(expected.short_reserved);
            return;
        }

        const capacity = sideCapacity(inputs.vault_balance as bigint, inputs.cap as bigint);
        expect(capacity).toBe(work.capacity);
        expect(longReserve).toBe(work.long_reserved);
        expect(shortReserve).toBe(work.short_reserved);
        expect(longReserve <= capacity && shortReserve <= capacity).toBe(expected.accepted);
    });

    it('rounds a long ask reserve up by one atomic unit', () => {
        const price: VerifiedPrice = {
            feedId: 1,
            exponent: 0,
            bid: 1n,
            ask: 1n,
            publishTime: 0n,
            source: 'pyth',
        };

        expect(sideReserved(market({ tokens: pair(1n, 0n) }), price, true)).toBe(1n);
    });

    it('marks both side PnLs in the maximizing and minimizing directions', () => {
        const data = market({
            notional: pair(200_000_000n, 50_000_000n),
            collateral: pair(100_000_000n, 30_000_000n),
            tokens: pair(2_000_000_000_000_000_000n, 500_000_000_000_000_000n),
        });
        const price: VerifiedPrice = {
            feedId: 1,
            exponent: -7,
            bid: 90_000_000n,
            ask: 110_000_000n,
            publishTime: 0n,
            source: 'pyth',
        };

        expect(marketSidePnl(data, price, true, true)).toBe(20_000_000n);
        expect(marketSidePnl(data, price, false, true)).toBe(5_000_000n);
        expect(marketNetPnl(data, price, true)).toBe(25_000_000n);
        expect(marketSidePnl(data, price, true, false)).toBe(-20_000_000n);
        expect(marketSidePnl(data, price, false, false)).toBe(-5_000_000n);
        expect(marketNetPnl(data, price, false)).toBe(-25_000_000n);
    });

    it('floors a marked side loss at posted collateral', () => {
        const data = market({
            notional: pair(200_000_000n, 50_000_000n),
            collateral: pair(10_000_000n, 30_000_000n),
            tokens: pair(2_000_000_000_000_000_000n, 500_000_000_000_000_000n),
        });
        const price: VerifiedPrice = {
            feedId: 1,
            exponent: -7,
            bid: 90_000_000n,
            ask: 110_000_000n,
            publishTime: 0n,
            source: 'pyth',
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
    it.each(feeVectors)('$id matches the Rust-owned fee work values', (golden: GoldenCase) => {
        const inputs = record(golden.inputs);
        const work = record(golden.work);
        const expected = record(golden.expected);
        const isIncrease = golden.operation === 'increase';
        const closedNotional = (work.closed_notional
            ?? expected.closed_notional
            ?? inputs.position_notional) as bigint;
        const signedNotional = isIncrease
            ? inputs.notional_delta as bigint
            : -closedNotional;
        const signedTokens = isIncrease
            ? work.tokens_added as bigint
            : -(work.closed_tokens as bigint);
        const data = market({
            tokens: pair((inputs.position_tokens ?? 0n) as bigint, 0n),
        });
        const fees = quoteTradeFees(
            data,
            config({
                feeDom: inputs.fee_dom as bigint,
                feeNonDom: inputs.fee_non_dom as bigint,
                impactScalar: inputs.impact_scalar as bigint,
            }),
            inputs.is_long as boolean,
            signedNotional,
            signedTokens,
        );

        expect(fees.base).toBe(work.base_fee);
        expect(fees.impact).toBe(work.impact_fee);
    });

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
        const marketRoot = `${repoRoot}/src/market`;
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
