import { describe, it, expect } from 'vitest';
import { SCALAR_18 } from '../../src/math/index.js';
import { Position, MarketData, SidePair, TradingConfig } from '../../src/contracts/trading/trading_types.js';
import {
    positionPnl,
    pendingFunding,
    pendingBorrowing,
    positionEquity,
    unlockedNotional,
    liquidationPrice,
} from '../../src/trading/position/estimates.js';

// =============================================================================
// Hand-computed test vectors on the canonical test-data decimal system:
//
//   settlement token: 7 decimals, so $1.00 == 10_000_000n (1e7 token-dec)
//   oracle:           8 decimals (exponent -8), so $100,000 == 1e13 price units
//   base-dec tokens:  tokens = notional * SCALAR_18 / price
//                     (scale 10^(18 + 7 - 8) = 10^17 per whole base unit)
//
// Because SCALAR_18 is baked into `tokens` by that definition, marking back to
// token-dec divides by SCALAR_18 (`tokens * price / SCALAR_18`), so every
// `priceScalar` argument below is SCALAR_18. Rates and indices are SCALAR_18;
// per-second rates accrue as `indexDelta = rate * elapsedSeconds`.
//
// Reference fixture used throughout (all values derived by hand):
//   entry price $100,000 -> 10_000_000_000_000n (1e13)
//   notional    $50,000  -> 500_000_000_000n (5e11)
//   tokens      = 5e11 * 1e18 / 1e13 = 5e16 (= 0.5 base units at 1e17/unit)
//   margin  $5,000   -> 50_000_000_000n (5e10), 10x leverage
// =============================================================================

const PRICE_100K = 10_000_000_000_000n; // $100,000 at 8 oracle decimals
const PRICE_110K = 11_000_000_000_000n; // $110,000
const PRICE_300K = 30_000_000_000_000n; // $300,000

const NOTIONAL_50K = 500_000_000_000n; // $50,000, 7-dec
const TOKENS_HALF_UNIT = 50_000_000_000_000_000n; // 5e16 = 5e11 * 1e18 / 1e13
const COLLATERAL_5K = 50_000_000_000n; // $5,000, 7-dec

// Funding accrual: rate 2e9 per second (SCALAR_18; APR = 2e9 * 31,536,000
// = 6.3072e16 = 6.31%) over one hour: indexDelta = 2e9 * 3600 = 7.2e12.
const FUNDING_IDX_ONE_HOUR = 7_200_000_000_000n;
// Borrowing accrual: rate 5e9 per second over one day (86,400 s):
// indexDelta = 5e9 * 86,400 = 4.32e14.
const BORROWING_IDX_ONE_DAY = 432_000_000_000_000n;

function makePosition(overrides: Partial<Position> = {}): Position {
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

function pairOf(long: bigint, short: bigint): SidePair {
    return { long, short };
}

function makeMarket(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pairOf(0n, 0n),
        margin: pairOf(0n, 0n),
        tokens: pairOf(0n, 0n),
        fundingIdx: pairOf(0n, 0n),
        borrowingIdx: pairOf(0n, 0n),
        fundingRate: 0n,
        accruedAt: 0n,
        fundingPool: 0n,
        fundingOwed: 0n,
        ...overrides,
    };
}

// A valid baseline mirroring `zenex-contracts/trading/src/trading/config.rs::test_config`.
function baselineConfig(): TradingConfig {
    return {
        keeperRate: SCALAR_18 / 10n, // 10%
        minPositionNotional: 10_000_000n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1_000_000n,
        minOrderMargin: 1_000_000n,
        execFee: 100_000n, // $0.01, token-dec
        feeDom: SCALAR_18 / 200n, // 0.5%
        feeNonDom: (3n * SCALAR_18) / 1000n, // 0.3%
        impactScalar: 1_000_000_000_000n, // $100,000, token-dec
        maxUtilOpen: (8n * SCALAR_18) / 10n, // 80%
        maxUtilWithdraw: (9n * SCALAR_18) / 10n, // 90%
        initMargin: SCALAR_18 / 10n, // 10%
        maintenanceMargin: SCALAR_18 / 20n, // 5%
        liqFee: SCALAR_18 / 100n, // 1%
        notionalLock: 30n,
        targetUtil: SCALAR_18 / 2n, // 50%
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: SCALAR_18 / 2n, // 50%
        adlClearTarget: (4n * SCALAR_18) / 10n, // 40%
        maxPnlTrader: (9n * SCALAR_18) / 10n, // 90%
        maxPnlWithdraw: (15n * SCALAR_18) / 100n, // 15%
        redeemLock: 0n,
        depositFee: SCALAR_18 / 1000n, // 10 bps
        redeemFee: SCALAR_18 / 1000n, // 10 bps
        minDeposit: 1_000_000n,
        maxVaultBalance: 10_000_000_000_000n,
    };
}

describe('positionPnl (ports math::pnl)', () => {
    // $50,000 entered at $100,000 (tokens 5e16), marked at $110,000:
    // long: floor(5e16 * 1.1e13 / 1e18) - 5e11 = 5.5e11 - 5e11 = +5e10 (+$5,000).
    // short: 5e11 - ceil(5.5e11) = -5e10.
    it('long +$5,000 and short -$5,000 on a $100k -> $110k move', () => {
        const position = makePosition({ notional: NOTIONAL_50K, tokens: TOKENS_HALF_UNIT });
        expect(positionPnl(position, PRICE_110K, SCALAR_18, true)).toBe(50_000_000_000n);
        expect(positionPnl(position, PRICE_110K, SCALAR_18, false)).toBe(-50_000_000_000n);
    });

    // Fractional marking pins the rounding direction. $10.00 entered at $3.00:
    // tokens = 1e8 * 1e18 / 3e8 = floor(3.333...e17) = 333_333_333_333_333_333.
    // Marked at $2.50 (2.5e8): tokens * price = 83,333,333,333,333,333,250,000,000,
    // / 1e18 = 83,333,333.33325.
    // long: floor -> 83_333_333, pnl = 83_333_333 - 100_000_000 = -16_666_667.
    // short: ceil -> 83_333_334, pnl = 100_000_000 - 83_333_334 = +16_666_666.
    it('negative long PnL floors and the mirrored short gain ceils (one unit apart)', () => {
        const position = makePosition({ notional: 100_000_000n, tokens: 333_333_333_333_333_333n });
        const priceTwoFifty = 250_000_000n;
        expect(positionPnl(position, priceTwoFifty, SCALAR_18, true)).toBe(-16_666_667n);
        expect(positionPnl(position, priceTwoFifty, SCALAR_18, false)).toBe(16_666_666n);
    });

    it('zero position has zero pnl', () => {
        const position = makePosition();
        expect(positionPnl(position, PRICE_110K, SCALAR_18, true)).toBe(0n);
        expect(positionPnl(position, PRICE_110K, SCALAR_18, false)).toBe(0n);
    });
});

describe('pendingFunding / pendingBorrowing (port math::accrued_amount, ceil)', () => {
    // One hour at 2e9/s: indexDelta 7.2e12. On $50,000 notional:
    // ceil(5e11 * 7.2e12 / 1e18) = ceil(3.6e6) = 3_600_000 ($0.36).
    it('funding over one hour at a 6.31% APR per-second rate on $50k = $0.36', () => {
        const position = makePosition({ notional: NOTIONAL_50K, fundingIdx: 0n });
        const market = makeMarket({ fundingIdx: pairOf(FUNDING_IDX_ONE_HOUR, 0n) });
        expect(pendingFunding(position, market, true)).toBe(3_600_000n);
    });

    // notional 3, delta +0.5 * SCALAR_18: ceil(1.5) = 2.
    it('positive fractional funding rounds up', () => {
        const position = makePosition({ notional: 3n, fundingIdx: 0n });
        const market = makeMarket({ fundingIdx: pairOf(SCALAR_18 / 2n, 0n) });
        expect(pendingFunding(position, market, true)).toBe(2n);
    });

    // notional 3, delta -0.5 * SCALAR_18: ceil(-1.5) = -1 (an earner never over-claims).
    it('negative (earned) fractional funding rounds toward +inf', () => {
        const position = makePosition({ notional: 3n, fundingIdx: SCALAR_18 / 2n });
        const market = makeMarket({ fundingIdx: pairOf(0n, 0n) });
        expect(pendingFunding(position, market, true)).toBe(-1n);
    });

    // One day at 5e9/s: indexDelta 4.32e14. On $50,000 short notional:
    // ceil(5e11 * 4.32e14 / 1e18) = ceil(2.16e8) = 216_000_000 ($21.60).
    it('borrowing over one day on the short side = $21.60', () => {
        const position = makePosition({ notional: NOTIONAL_50K, borrowingIdx: 0n });
        const market = makeMarket({ borrowingIdx: pairOf(0n, BORROWING_IDX_ONE_DAY) });
        expect(pendingBorrowing(position, market, false)).toBe(216_000_000n);
    });
});

describe('positionEquity (margin + pnl - max(0, funding) - borrowing)', () => {
    const longPosition = makePosition({
        margin: COLLATERAL_5K,
        notional: NOTIONAL_50K,
        tokens: TOKENS_HALF_UNIT,
    });

    // margin 5e10 + pnl 5e10 ($100k -> $110k) - funding 3_600_000
    // - borrowing 216_000_000 = 100,000,000,000 - 219,600,000 = 99,780,400,000.
    it('debits paid funding and borrowing from margin + pnl', () => {
        const market = makeMarket({
            fundingIdx: pairOf(FUNDING_IDX_ONE_HOUR, 0n),
            borrowingIdx: pairOf(BORROWING_IDX_ONE_DAY, 0n),
        });
        expect(positionEquity(longPosition, market, PRICE_110K, SCALAR_18, true)).toBe(99_780_400_000n);
    });

    // The position snapshot sits above the market index (earned funding,
    // pending = -3_600_000): clamped to zero, so equity is exactly the
    // borrowing-only figure 1e11 - 216_000_000 = 99,784,000,000.
    it('earned funding never raises equity (clamped at zero)', () => {
        const earnedFundingPosition = makePosition({
            margin: COLLATERAL_5K,
            notional: NOTIONAL_50K,
            tokens: TOKENS_HALF_UNIT,
            fundingIdx: FUNDING_IDX_ONE_HOUR,
        });
        const market = makeMarket({
            fundingIdx: pairOf(0n, 0n),
            borrowingIdx: pairOf(BORROWING_IDX_ONE_DAY, 0n),
        });
        const equityWithEarnedFunding = positionEquity(earnedFundingPosition, market, PRICE_110K, SCALAR_18, true);
        expect(equityWithEarnedFunding).toBe(99_784_000_000n);

        // Identical to a position with no funding delta at all.
        const zeroFundingMarket = makeMarket({ borrowingIdx: pairOf(BORROWING_IDX_ONE_DAY, 0n) });
        expect(positionEquity(longPosition, zeroFundingMarket, PRICE_110K, SCALAR_18, true)).toBe(
            equityWithEarnedFunding,
        );
    });
});

describe('unlockedNotional (ports Position::locked, boundary at now == unlocks_at)', () => {
    const position = makePosition({
        notional: NOTIONAL_50K,
        lockedNotional: 200_000_000_000n, // $20,000 locked
        unlocksAt: 100n,
    });

    it('locked while now < unlocks_at', () => {
        expect(unlockedNotional(position, 50n)).toBe(300_000_000_000n);
    });

    it('fully unlocked exactly at now == unlocks_at (boundary)', () => {
        expect(unlockedNotional(position, 100n)).toBe(NOTIONAL_50K);
    });

    it('fully unlocked past unlocks_at', () => {
        expect(unlockedNotional(position, 150n)).toBe(NOTIONAL_50K);
    });

    it('zero position is fully unlocked (zero)', () => {
        expect(unlockedNotional(makePosition(), 0n)).toBe(0n);
    });
});

describe('liquidationPrice (inverts the maintenance-margin equity line)', () => {
    // $5,000 margin on $50,000 notional (10x), maintenance 5%:
    // maintenanceAmount = ceil(5e11 * 5e16 / 1e18) = 2.5e10 ($2,500).
    // Long: allowed loss = 5,000 - 2,500 = $2,500 on 0.5 base units
    //       = $5,000/unit drop, so $100,000 - $5,000 = $95,000 (9.5e12).
    //       Via the solver: target = 2.5e10 + 5e11 - 5e10 = 4.75e11;
    //       price = floor(4.75e11 * 1e18 / 5e16) = 9,500,000,000,000.
    const tenXPosition = makePosition({
        margin: COLLATERAL_5K,
        notional: NOTIONAL_50K,
        tokens: TOKENS_HALF_UNIT,
    });

    it('long liquidation at $95,000 with no accruals', () => {
        expect(liquidationPrice(tenXPosition, baselineConfig(), makeMarket(), true)).toBe(9_500_000_000_000n);
    });

    // Short: target = 5e11 + 5e10 - 2.5e10 = 5.25e11;
    // price = 5.25e11 * 1e18 / 5e16 = 10,500,000,000,000 ($105,000).
    it('short liquidation at $105,000 with no accruals', () => {
        expect(liquidationPrice(tenXPosition, baselineConfig(), makeMarket(), false)).toBe(10_500_000_000_000n);
    });

    // Accruals shrink the loss budget: funding 3_600_000 + borrowing 216_000_000
    // raise the long target to 475,219,600,000, price = target * 20
    // = 9,504,392,000,000 ($95,043.92; hand check: allowed loss
    // 5,000 - 2,500 - 0.36 - 21.60 = $2,478.04, over 0.5 units = $4,956.08 drop).
    it('paid funding and borrowing raise the long liquidation price to $95,043.92', () => {
        const market = makeMarket({
            fundingIdx: pairOf(FUNDING_IDX_ONE_HOUR, 0n),
            borrowingIdx: pairOf(BORROWING_IDX_ONE_DAY, 0n),
        });
        expect(liquidationPrice(tenXPosition, baselineConfig(), market, true)).toBe(9_504_392_000_000n);
    });

    // Earned funding (market index below the position snapshot) is clamped to
    // zero: it must not widen the loss budget below the no-accrual threshold.
    it('earned funding does not lower the liquidation price', () => {
        const earnedFundingPosition = makePosition({
            margin: COLLATERAL_5K,
            notional: NOTIONAL_50K,
            tokens: TOKENS_HALF_UNIT,
            fundingIdx: FUNDING_IDX_ONE_HOUR,
        });
        const market = makeMarket({ fundingIdx: pairOf(0n, 0n) });
        expect(liquidationPrice(earnedFundingPosition, baselineConfig(), market, true)).toBe(9_500_000_000_000n);
    });

    // The threshold is the maintenance line alone. The liquidation fee only
    // tiers the payout on-chain (soft tier liq_fee = 0 returns the remainder
    // to the trader, hard tier forfeits it to the vault); it never moves the
    // eligibility price.
    it('the soft/hard liquidation-fee tier does not move the threshold', () => {
        const softTierConfig = { ...baselineConfig(), liqFee: 0n };
        const hardTierConfig = { ...baselineConfig(), liqFee: (4n * SCALAR_18) / 100n }; // 4%, still < 5% maintenance
        expect(liquidationPrice(tenXPosition, softTierConfig, makeMarket(), true)).toBe(9_500_000_000_000n);
        expect(liquidationPrice(tenXPosition, hardTierConfig, makeMarket(), true)).toBe(9_500_000_000_000n);
    });

    // Over-collateralized long: target = 2.5e10 + 5e11 - 6e11 = -7.5e10 < 0,
    // clamped to zero (no reachable liquidation price).
    it('clamps to zero when margin exceeds notional plus maintenance', () => {
        const overCollateralized = makePosition({
            margin: 600_000_000_000n,
            notional: NOTIONAL_50K,
            tokens: TOKENS_HALF_UNIT,
        });
        expect(liquidationPrice(overCollateralized, baselineConfig(), makeMarket(), true)).toBe(0n);
    });

    it('zero position has no liquidation price', () => {
        expect(liquidationPrice(makePosition(), baselineConfig(), makeMarket(), true)).toBe(0n);
    });
});
