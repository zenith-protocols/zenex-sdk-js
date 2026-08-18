import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import { makeConfig } from '../helpers/trading_state.js';
import type {
    MarketData,
    Position,
    SidePair,
} from '../../src/contracts/trading/trading_types.js';
import type { PriceData } from '../../src/trading/market/types.js';
import { quoteTradeFees } from '../../src/trading/market/fees.js';
import { entryPrice } from '../../src/trading/market/pricing.js';
import {
    SECONDS_PER_YEAR,
    closeCostPreview,
    formatAnnualPercent,
    formatPercent,
    formatPrice,
    formatRatio,
    formatToken,
    fundingApr,
    fundingChargeApr,
    maxLeverage,
    orderCostPreview,
    positionDisplay,
    sideRates,
} from '../../src/display/index.js';

const pair = (long = 0n, short = 0n): SidePair => ({ long, short });
const TOKEN_DECIMALS = 7;
/** A token-dec amount: notional, margin, fees -- and base size (see below). */
const unit = (whole: number) => BigInt(whole) * 10n ** BigInt(TOKEN_DECIMALS);
/** An 18-dec price. Prices never use the token's decimals. */
const px = (whole: number) => BigInt(whole) * SCALAR_18;

function market(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        margin: pair(),
        tokens: pair(),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        accruedAt: 0n,
        fundingPool: 0n,
        fundingOwed: 0n,
        ...overrides,
    };
}

function price(bid: bigint, ask: bigint): PriceData {
    return { feedId: Buffer.alloc(32, 1), bid, ask, publishTime: 1_000n };
}

function position(overrides: Partial<Position> = {}): Position {
    return {
        notional: unit(1000),
        margin: unit(100),
        // `to_tokens` = notional * SCALAR_18 / price, so with a token-dec
        // notional and an 18-dec price the base size is at TOKEN decimals.
        tokens: unit(10),
        fundingIdx: 0n,
        borrowingIdx: 0n,
        pricedAt: 0n,
        unlocksAt: 0n,
        lockedNotional: 0n,
        decreaseOrders: [],
        ...overrides,
    };
}

describe('display/format', () => {
    it('separates the three scales the SDK returns', () => {
        // Token amounts use the deployment's decimals...
        expect(formatToken(unit(250), TOKEN_DECIMALS)).toBe(250);
        expect(formatToken(12_345_678n, 6)).toBe(12.345678);
        // ...ratios are always SCALAR_18...
        expect(formatRatio(SCALAR_18 / 4n)).toBe(0.25);
        expect(formatPercent(SCALAR_18 / 10n)).toBe(10);
        // ...and prices are fixed 18-dec regardless of the token's decimals.
        expect(formatPrice(25n * SCALAR_18)).toBe(25);
    });

    it('rejects a nonsensical decimals rather than silently mis-scaling', () => {
        expect(() => formatToken(1n, -1)).toThrow(RangeError);
        expect(() => formatToken(1n, 1.5)).toThrow(RangeError);
        expect(() => formatToken(1n, 39)).toThrow(RangeError);
    });

    it('annualizes a per-second rate and keeps its sign', () => {
        // A per-second rate of 1e18/SECONDS_PER_YEAR is exactly 100% a year.
        const perSecond = SCALAR_18 / BigInt(SECONDS_PER_YEAR);
        expect(formatAnnualPercent(perSecond)).toBeCloseTo(100, 4);
        expect(formatAnnualPercent(-perSecond)).toBeCloseTo(-100, 4);
    });
});

describe('display/rates', () => {
    const config = makeConfig();

    it('reports per-side utilization and the rate the side would pay', () => {
        const data = market({ tokens: pair(6n * SCALAR_18, 2n * SCALAR_18) });
        const long = sideRates(data, config, price(px(10), px(10)), unit(1000), true);

        expect(long.utilizationPercent).toBeGreaterThan(0);
        expect(long.borrowAprPercent).toBeGreaterThan(0);
        // Longs dominate on tokens, so longs are the side actually charged.
        expect(long.charged).toBe(true);
        expect(
            sideRates(data, config, price(px(10), px(10)), unit(1000), false).charged,
        ).toBe(false);
    });

    it('charges both sides on a token tie, matching the accrual', () => {
        const tied = market({ tokens: pair(4n * SCALAR_18, 4n * SCALAR_18) });
        const p = price(px(10), px(10));
        expect(sideRates(tied, config, p, unit(1000), true).charged).toBe(true);
        expect(sideRates(tied, config, p, unit(1000), false).charged).toBe(true);
    });

    it('signs funding by who pays', () => {
        expect(fundingApr(market({ fundingRate: 500n }))).toBeGreaterThan(0);
        expect(fundingApr(market({ fundingRate: -500n }))).toBeLessThan(0);
        expect(fundingApr(market({ fundingRate: 0n }))).toBe(0);
    });

    it('floors the charged funding rate but not the stored one', () => {
        // fundingMin is 1n; a stored rate below it still charges at the floor.
        const tiny = market({ fundingRate: 1n });
        const cfg = { ...config, fundingMin: 100n };
        expect(fundingChargeApr(tiny, cfg)).toBe(formatAnnualPercent(100n));
        expect(fundingApr(tiny)).toBe(formatAnnualPercent(1n));
        // A zero rate charges nothing at all, floor or no floor.
        expect(fundingChargeApr(market({ fundingRate: 0n }), cfg)).toBe(0);
    });

    it('derives max leverage from the initial margin', () => {
        expect(maxLeverage({ ...config, initMargin: SCALAR_18 / 10n })).toBe(10);
        expect(maxLeverage({ ...config, initMargin: 0n })).toBe(Infinity);
    });
});

describe('display/position', () => {
    const config = makeConfig();

    it('formats each field at its own scale', () => {
        // 10 tokens entered at 100.0 -> 1000.0 notional, marked at bid 110.
        const view = positionDisplay(
            position(),
            market(),
            config,
            price(px(110), px(112)),
            true,
            TOKEN_DECIMALS,
            0n,
        );

        expect(view.notional).toBe(1000);
        expect(view.margin).toBe(100);
        expect(view.entryPrice).toBe(100);
        // Long closes at the bid: 10 * 110 = 1100, so +100 profit.
        expect(view.pnl).toBe(100);
        expect(view.equity).toBe(200);
        expect(view.leverage).toBeCloseTo(5, 9);
        expect(view.healthFactor).toBeGreaterThan(1);
        expect(view.liquidationDistancePercent).toBeGreaterThan(0);
    });

    it('reads a crossed liquidation price as negative distance', () => {
        // Thin margin: the maintenance line sits above the current mark.
        const view = positionDisplay(
            position({ margin: 1n }),
            market(),
            config,
            price(px(50), px(51)),
            true,
            TOKEN_DECIMALS,
            0n,
        );
        expect(view.liquidationDistancePercent).toBeLessThan(0);
        expect(view.healthFactor).toBeLessThan(1);
    });

    it('floors leverage at zero once equity is gone', () => {
        const view = positionDisplay(
            position({ margin: 0n }),
            market(),
            config,
            price(px(1), px(2)),
            true,
            TOKEN_DECIMALS,
            0n,
        );
        expect(view.equity).toBeLessThanOrEqual(0);
        expect(view.leverage).toBe(0);
    });

    it('excludes locked notional only while the lock stands', () => {
        const locked = position({ lockedNotional: unit(400), unlocksAt: 2_000n });
        const args = [market(), config, price(px(100), px(100)), true, TOKEN_DECIMALS] as const;
        expect(positionDisplay(locked, ...args, 1_999n).unlockedNotional).toBe(600);
        // At the boundary the lock has expired.
        expect(positionDisplay(locked, ...args, 2_000n).unlockedNotional).toBe(1000);
    });
});

describe('display/costs', () => {
    const config = makeConfig();

    // The property that matters: the preview is a VIEW of the exact mirror, not
    // a parallel float implementation, so it cannot drift from the fill.
    it('open preview delegates to quoteTradeFees rather than recomputing', () => {
        const data = market({ tokens: pair(2n * SCALAR_18, 5n * SCALAR_18) });
        const p = price(px(100), px(100));
        const notional = unit(500);

        const preview = orderCostPreview(data, config, p, true, notional, unit(50), TOKEN_DECIMALS);
        const tokens = (notional * SCALAR_18) / entryPrice(p, true);
        const expected = quoteTradeFees(data, config, true, notional, tokens);

        expect(preview.exact).toEqual(expected);
        expect(preview.baseFee).toBe(formatToken(expected.base, TOKEN_DECIMALS));
        expect(preview.impactFee).toBe(formatToken(expected.impact, TOKEN_DECIMALS));
        expect(preview.totalFees).toBe(
            formatToken(expected.base + expected.impact + config.execFee, TOKEN_DECIMALS),
        );
    });

    it('escrows margin plus execFee on an open, execFee alone on a close', () => {
        const data = market({ tokens: pair(2n * SCALAR_18, 2n * SCALAR_18) });
        const p = price(px(100), px(100));

        const open = orderCostPreview(data, config, p, true, unit(500), unit(50), TOKEN_DECIMALS);
        expect(open.escrowed).toBe(50 + formatToken(config.execFee, TOKEN_DECIMALS));

        const close = closeCostPreview(
            data, config, p, true, unit(500), unit(5), TOKEN_DECIMALS,
        );
        expect(close.escrowed).toBe(formatToken(config.execFee, TOKEN_DECIMALS));
    });

    it('prices an open at the ask and a close at the bid', () => {
        const data = market();
        const p = price(px(99), px(101));
        expect(
            orderCostPreview(data, config, p, true, unit(100), unit(10), TOKEN_DECIMALS)
                .executionPrice,
        ).toBe(101);
        expect(
            closeCostPreview(data, config, p, true, unit(100), unit(1), TOKEN_DECIMALS)
                .executionPrice,
        ).toBe(99);
    });

    it('charges the worsening leg more than the improving one', () => {
        // Book is net short on tokens, so a long increase improves the skew.
        const shortHeavy = market({ tokens: pair(1n * SCALAR_18, 9n * SCALAR_18) });
        const longHeavy = market({ tokens: pair(9n * SCALAR_18, 1n * SCALAR_18) });
        const p = price(px(100), px(100));
        const args = [config, p, true, unit(100), unit(10), TOKEN_DECIMALS] as const;

        expect(orderCostPreview(longHeavy, ...args).baseFee)
            .toBeGreaterThan(orderCostPreview(shortHeavy, ...args).baseFee);
    });
});
