import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import { estimateMarket } from '../../src/trading/market_est.js';
import { fixtureMarket, pair, px, unit } from './market_fixture.js';

describe('Market.borrowingRate', () => {
    // A rate that reaches the kink: 0.0001% per second below it.
    const config = {
        borrowRate: SCALAR_18 / 1_000_000n,
        increasedBorrowRate: SCALAR_18 / 100_000n,
    };
    const book = (longTokens: bigint, shortTokens: bigint) =>
        fixtureMarket({
            data: {
                notional: pair(unit(100), unit(100)),
                tokens: pair(longTokens, shortTokens),
                margin: pair(unit(10), unit(10)),
            },
            config,
        });

    it('charges only the dominant side, as the accrual does', () => {
        const market = book(unit(12), unit(8));
        expect(market.borrowingRate(true, px(10))).toBeGreaterThan(0n);
        expect(market.borrowingRate(false, px(10))).toBe(0n);

        // One hour of accrual moves the long index only.
        const later = market.accrue(px(10), 3_600n);
        expect(later.data.borrowingIdx.long).toBe(
            market.borrowingRate(true, px(10)) * 3_600n,
        );
        expect(later.data.borrowingIdx.short).toBe(0n);
    });

    it('charges both sides on a token tie', () => {
        const market = book(unit(10), unit(10));
        expect(market.borrowingRate(true, px(10))).toBeGreaterThan(0n);
        expect(market.borrowingRate(false, px(10))).toBeGreaterThan(0n);
    });

    it('leaves the estimate showing the rate a side would pay, flagged by charged', () => {
        const estimate = estimateMarket(book(unit(12), unit(8)), px(10));
        expect(estimate.short.borrowRatePercent1h).toBeGreaterThan(0);
        expect(estimate.short.charged).toBe(false);
        expect(estimate.short.netRatePercent1h).toBe(estimate.short.fundingRatePercent1h);
    });
});

describe('Market.netPnl', () => {
    // A long side of 5,000 tokens entered at $0.20 against a 500.0 vault,
    // marked at $0.30: 500.0 of pending profit, over the 225.0 allowance
    // (90% of half the vault). Share pricing recognizes 225.0 of it.
    const market = fixtureMarket({
        data: {
            notional: pair(unit(1000), 0n),
            tokens: pair(unit(5000), 0n),
            margin: pair(unit(100), 0n),
        },
        vaultAssets: unit(500),
    });

    it('caps each side at the haircut allowance, as share pricing does', () => {
        expect(market.sidePnl(true, px(0.3))).toBe(unit(500));
        expect(market.netPnl(px(0.3))).toBe(unit(225));
        expect(estimateMarket(market, px(0.3)).netPnl).toBe(225);
    });

    it('equals the uncapped sum while the cap does not bind', () => {
        expect(market.netPnl(px(0.21))).toBe(
            market.sidePnl(true, px(0.21)) + market.sidePnl(false, px(0.21)),
        );
    });
});
