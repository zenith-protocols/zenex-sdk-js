import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import type { MarketConfig } from '../../src/contracts/market/types.js';
import { MarketPosition } from '../../src/trading/position.js';
import { estimatePosition } from '../../src/trading/position_est.js';
import { fixtureMarket, pair, px, unit } from './market_fixture.js';

// The maintenance gate compares settled equity (margin less the full close
// fee and the accruals, plus the haircut PnL) with ceil(2% * notional). The
// health factor and the liquidation price must measure the same line, or a
// position shows healthy while a keeper can already liquidate it.

/** The live mainnet XLM-USD market config. */
const MAINNET: Partial<MarketConfig> = {
    keeperRate: SCALAR_18 / 10n,
    minPositionNotional: 10_000_000n,
    maxPositionNotional: 5_000_000_000n,
    maxOpenInterest: 500_000_000_000n,
    minOrderNotional: 10_000_000n,
    minOrderMargin: 10_000_000n,
    execFee: 100_000n,
    feeDom: 600_000_000_000_000n,
    feeNonDom: 400_000_000_000_000n,
    impactScalar: 100_000_000_000_000n,
    initMargin: SCALAR_18 / 20n,
    maintenanceMargin: SCALAR_18 / 50n,
    liqFee: SCALAR_18 / 200n,
};

/** A lone long of `notional` on `margin` holding `tokens`, on a deep vault. */
function loneLong(notional: bigint, margin: bigint, tokens: bigint) {
    const market = fixtureMarket({
        config: MAINNET,
        vaultAssets: unit(100_000),
        data: {
            notional: pair(notional, 0n),
            margin: pair(margin, 0n),
            tokens: pair(tokens, 0n),
        },
    });
    const position = new MarketPosition(true, margin, notional, tokens, 0n, 0n, 0n, 0n, 0n, []);
    return { market, position };
}

describe('the health factor measures the liquidation gate', () => {
    // 500.0 long on 25.0 margin, 2,500 base, marked at $0.19404: the mark
    // equity 25 - 14.9 = 10.1 clears the 10.0 line, but settled equity
    // 25 - 0.2 base - 0.025 impact - 14.9 = 9.875 does not.
    it('reads below 1 for a position a keeper can liquidate', () => {
        const { market, position } = loneLong(unit(500), unit(25), unit(2_500));
        const mark = px(0.19404);
        expect(position.equity(market, mark)).toBe(101_000_000n);
        expect(position.maintenanceMargin(market)).toBe(100_000_000n);
        expect(position.isLiquidatable(market, mark)).toBe(true);

        const estimate = estimatePosition(market, position, mark, 0n);
        expect(estimate.healthFactor).toBeCloseTo(0.9875, 12);
        expect(estimate.liquidationDistancePercent).toBeLessThan(0);
    });

    it('crosses 1 exactly where the gate flips', () => {
        const { market, position } = loneLong(unit(500), unit(25), unit(2_500));
        for (let cents = 19_300; cents <= 19_500; cents++) {
            const mark = px(cents / 100_000);
            const estimate = estimatePosition(market, position, mark, 0n);
            expect(estimate.healthFactor < 1, `mark ${cents}`).toBe(
                position.isLiquidatable(market, mark),
            );
        }
    });
});

describe('the liquidation price sits on the gate', () => {
    // 1,000.0 long on 50.0 margin entered at $0.213. Without the 0.5 close
    // fee the price read 0.20661, where the gate already fires.
    const tokens = (unit(1000) * SCALAR_18) / px(0.213);

    it('is the last liquidatable price, one wei below a safe one', () => {
        const { market, position } = loneLong(unit(1000), unit(50), tokens);
        const price = position.liquidationPrice(market);
        expect(position.isLiquidatable(market, price)).toBe(true);
        expect(position.isLiquidatable(market, price + 1n)).toBe(false);
        // The mark the audit found liquidatable sits below it.
        expect(price > px(0.20671)).toBe(true);
        expect(position.isLiquidatable(market, px(0.20671))).toBe(true);
    });

    it('feeds the estimate the same price', () => {
        const { market, position } = loneLong(unit(1000), unit(50), tokens);
        const estimate = estimatePosition(market, position, px(0.21), 0n);
        expect(estimate.liquidationPrice).toBe(
            Number(position.liquidationPrice(market)) / 1e18,
        );
    });
});
