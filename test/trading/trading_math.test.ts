import { describe, it, expect } from 'vitest';
import { SCALAR_18 } from '../../src/math.js';
import { Position, MarketData, SidePair, TradingConfig } from '../../src/trading/trading_types.js';
import {
    positionPnl,
    pendingFunding,
    pendingBorrowing,
    positionEquity,
    unlockedNotional,
    liquidationPrice,
} from '../../src/trading/trading_position.js';
import {
    sidePnl,
    netPnl,
    utilization,
    skewSplitFees,
} from '../../src/trading/trading_market.js';
import { validateTradingConfig } from '../../src/trading/trading_config.js';

// =============================================================================
// Hand-computed test vectors. All money fields are token-dec (7-dec settlement
// token), so `10.0` == 10_0000000n == 1e8. `tokens` is the base-dec size with
// the SCALAR_18 fixed-point scalar baked in by the contract's `math::to_tokens`
// (`tokens = notional * SCALAR_18 / price`), so a 100.0 position entered at $10
// holds `100 * 1e18 / 10 = 1e19` tokens. Because that SCALAR_18 lives inside
// `tokens`, the token->notional conversion divides by SCALAR_18 (not the price
// scalar), and callers pass SCALAR_18 as the `priceScalar` argument. Prices are
// in price_scalar units (7-dec here, so $12 == 12_0000000n).
// =============================================================================

const S18 = SCALAR_18; // 1e18

function makePosition(overrides: Partial<Position> = {}): Position {
    return {
        collateral: 0n,
        notional: 0n,
        tokens: 0n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        updatedAt: 0n,
        ...overrides,
    };
}

function pair(long: bigint, short: bigint): SidePair {
    return { long, short };
}

function makeMarket(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(0n, 0n),
        collateral: pair(0n, 0n),
        tokens: pair(0n, 0n),
        fundingIdx: pair(0n, 0n),
        borrowingIdx: pair(0n, 0n),
        fundingRate: 0n,
        fundingUpdate: 0n,
        borrowingUpdate: 0n,
        fundingPool: 0n,
        fundingOwed: 0n,
        ...overrides,
    };
}

// A valid baseline config mirroring `zenex-contracts/trading/src/trading/config.rs::test_config`.
function goodConfig(): TradingConfig {
    return {
        keeperRate: S18 / 10n,               // 10%
        minPositionNotional: 10_000_000n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1_000_000n,
        minOrderCollateral: 1_000_000n,
        feeDom: S18 / 200n,                  // 0.5%
        feeNonDom: (3n * S18) / 1000n,       // 0.3%
        impactDivisor: 10n * S18,            // MIN_IMPACT
        maxUtilOpen: (8n * S18) / 10n,       // 80%
        maxUtilWithdraw: (9n * S18) / 10n,   // 90%
        initMargin: S18 / 10n,               // 10%
        maintenanceMargin: S18 / 20n,        // 5%
        liqFee: S18 / 100n,                  // 1%
        notionalLock: 30n,
        targetUtil: S18 / 2n,                // 50%
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: S18 / 2n,                 // 50%
        adlClearTarget: (4n * S18) / 10n,    // 40%
        maxPnlTrader: (9n * S18) / 10n,      // 90%
        redeemLock: 0n,
        depositLock: 20n,
        instantDepositPnl: S18 / 20n,        // 5%
        vaultFee: S18 / 1000n,               // 0.1%
        minDeposit: 1_000_000n,
        maxPnlDeposit: (15n * S18) / 100n,   // 15%
        maxPnlWithdraw: (15n * S18) / 100n,  // 15%
        maxVaultBalance: 10_000_000_000_000n,
    };
}

describe('positionPnl (ports math::pnl)', () => {
    // Brief vector: notional 1000e7, tokens 5e7, price 240*SCALAR_18 -> value 1200e7.
    // long: floor(5e7 * 240e18 / 1e18) - 1000e7 = 1200e7 - 1000e7 = 200e7.
    it('brief vector: long +200e7, short -200e7', () => {
        const pos = makePosition({ notional: 1000_0000000n, tokens: 50000000n });
        const price = 240n * S18;
        expect(positionPnl(pos, price, S18, true)).toBe(200_0000000n);
        expect(positionPnl(pos, price, S18, false)).toBe(-200_0000000n);
    });

    // Realistic vector matching the Rust long_position fixture: 100.0 notional,
    // 1e19 tokens (entry $10), marked at $12 -> +20.0.
    it('realistic vector: 100.0 long entered at $10, marked $12 -> +20.0', () => {
        const pos = makePosition({ notional: 100_0000000n, tokens: 10_000_000_000_000_000_000n });
        expect(positionPnl(pos, 12_0000000n, S18, true)).toBe(20_0000000n);
        // short entered at $10 marked $12 -> -20.0
        expect(positionPnl(pos, 12_0000000n, S18, false)).toBe(-20_0000000n);
    });

    it('zero position has zero pnl', () => {
        const pos = makePosition();
        expect(positionPnl(pos, 12_0000000n, S18, true)).toBe(0n);
        expect(positionPnl(pos, 12_0000000n, S18, false)).toBe(0n);
    });
});

describe('pendingFunding / pendingBorrowing (port accrued_amount, ceil)', () => {
    it('funding settlement = ceil(notional * (marketIdx - positionIdx) / SCALAR_18)', () => {
        const pos = makePosition({ notional: 1000_0000000n, fundingIdx: 0n });
        const market = makeMarket({ fundingIdx: pair(S18 / 100n, 0n) }); // +1% index move
        expect(pendingFunding(pos, market, true)).toBe(10_0000000n); // 1% of 1000.0 = 10.0
    });

    it('negative funding delta rounds toward +inf (earned funding, ceil)', () => {
        // notional 3, delta -0.5*SCALAR_18: ceil(3 * -5e17 / 1e18) = ceil(-1.5) = -1.
        const pos = makePosition({ notional: 3n, fundingIdx: S18 / 2n });
        const market = makeMarket({ fundingIdx: pair(0n, 0n) });
        expect(pendingFunding(pos, market, true)).toBe(-1n);
    });

    it('positive funding delta rounds up', () => {
        // notional 3, delta +0.5*SCALAR_18: ceil(1.5) = 2.
        const pos = makePosition({ notional: 3n, fundingIdx: 0n });
        const market = makeMarket({ fundingIdx: pair(S18 / 2n, 0n) });
        expect(pendingFunding(pos, market, true)).toBe(2n);
    });

    it('borrowing settlement on the short side', () => {
        const pos = makePosition({ notional: 1000_0000000n, borrowingIdx: 0n });
        const market = makeMarket({ borrowingIdx: pair(0n, (2n * S18) / 100n) }); // +2% short
        expect(pendingBorrowing(pos, market, false)).toBe(20_0000000n);
    });
});

describe('positionEquity (collateral + pnl - funding - borrowing)', () => {
    it('sums collateral, pnl, and accrued costs', () => {
        // collateral 10.0, pnl +20.0 ($10->$12), funding 1.0, borrowing 1.0 -> 28.0.
        const pos = makePosition({
            collateral: 10_0000000n,
            notional: 100_0000000n,
            tokens: 10_000_000_000_000_000_000n,
        });
        const market = makeMarket({
            fundingIdx: pair(S18 / 100n, 0n),   // +1% -> 1.0 on 100.0
            borrowingIdx: pair(S18 / 100n, 0n), // +1% -> 1.0 on 100.0
        });
        expect(positionEquity(pos, market, 12_0000000n, S18, true)).toBe(28_0000000n);
    });
});

describe('unlockedNotional (ports Position::locked, boundary at now == unlocks_at)', () => {
    const pos = makePosition({ notional: 100_0000000n, lockedNotional: 40_0000000n, unlocksAt: 100n });

    it('locked while now < unlocks_at', () => {
        expect(unlockedNotional(pos, 50n)).toBe(60_0000000n);
    });

    it('fully unlocked exactly at now == unlocks_at (boundary)', () => {
        expect(unlockedNotional(pos, 100n)).toBe(100_0000000n);
    });

    it('fully unlocked past unlocks_at', () => {
        expect(unlockedNotional(pos, 150n)).toBe(100_0000000n);
    });

    it('zero position is fully unlocked (zero)', () => {
        expect(unlockedNotional(makePosition(), 0n)).toBe(0n);
    });
});

describe('liquidationPrice (inverts the maintenance-margin equity line)', () => {
    // 10.0 collateral on 100.0 notional (10x), maintenance 5%. Long liquidates
    // when the 5.0 loss (collateral - mm) lands: entry $10 -> $9.50.
    it('long liquidation at $9.50 with no accruals', () => {
        const pos = makePosition({
            collateral: 10_0000000n,
            notional: 100_0000000n,
            tokens: 10_000_000_000_000_000_000n,
        });
        expect(liquidationPrice(pos, goodConfig(), makeMarket(), true)).toBe(9_5000000n);
    });

    it('short liquidation at $10.50 with no accruals', () => {
        const pos = makePosition({
            collateral: 10_0000000n,
            notional: 100_0000000n,
            tokens: 10_000_000_000_000_000_000n,
        });
        expect(liquidationPrice(pos, goodConfig(), makeMarket(), false)).toBe(10_5000000n);
    });

    it('accrued funding + borrowing raise the long liquidation price to $9.70', () => {
        const pos = makePosition({
            collateral: 10_0000000n,
            notional: 100_0000000n,
            tokens: 10_000_000_000_000_000_000n,
        });
        const market = makeMarket({
            fundingIdx: pair(S18 / 100n, 0n),   // +1.0
            borrowingIdx: pair(S18 / 100n, 0n), // +1.0
        });
        expect(liquidationPrice(pos, goodConfig(), market, true)).toBe(9_7000000n);
    });

    it('zero position has no liquidation price', () => {
        expect(liquidationPrice(makePosition(), goodConfig(), makeMarket(), true)).toBe(0n);
    });
});

describe('sidePnl / netPnl (port MarketData::side_pnl / net_pnl, conservative marking)', () => {
    const market = makeMarket({
        notional: pair(20_0000000n, 5_0000000n),
        collateral: pair(10_0000000n, 3_0000000n),
        tokens: pair(2_000_000_000_000_000_000n, 500_000_000_000_000_000n), // 2.0 / 0.5 base
    });

    it('long floor / short ceil at $12', () => {
        // long: floor(2e18*12e7/1e18) - 20e7 = 24e7 - 20e7 = +4.0.
        // short: 5e7 - ceil(5e17*12e7/1e18) = 5e7 - 6e7 = -1.0.
        expect(sidePnl(market, 12_0000000n, S18, true)).toBe(4_0000000n);
        expect(sidePnl(market, 12_0000000n, S18, false)).toBe(-1_0000000n);
        expect(netPnl(market, 12_0000000n, S18)).toBe(3_0000000n);
    });

    it('a side loss floors at its posted collateral', () => {
        // long at $1: floor(2e18*1e7/1e18) - 20e7 = 2e6 - 2e8 = -198e6, floored at -collateral (-10.0).
        expect(sidePnl(market, 1_0000000n, S18, true)).toBe(-10_0000000n);
    });
});

describe('utilization (open interest / vault, SCALAR_18 ratio)', () => {
    it('25.0 open interest over 100.0 vault = 0.25 * SCALAR_18', () => {
        const market = makeMarket({ notional: pair(20_0000000n, 5_0000000n) });
        expect(utilization(market, 100_0000000n)).toBe(S18 / 4n);
    });

    it('zero vault balance yields zero', () => {
        const market = makeMarket({ notional: pair(20_0000000n, 5_0000000n) });
        expect(utilization(market, 0n)).toBe(0n);
    });
});

describe('skewSplitFees (ports skew_split + Market::trade_fees)', () => {
    // Rust trade_fees fixture: longs 200.0/10 base, shorts 100.0/12 base (net
    // short 2 base). A 50.0 long increase buys 5 base, crossing balance: 2
    // improve, 3 worsen -> 30.0 worsening / 20.0 improving notional.
    it('matches the Rust vector: base 0.21, impact 3.0', () => {
        const market = makeMarket({
            notional: pair(200_0000000n, 100_0000000n),
            tokens: pair(10_000_000_000_000_000_000n, 12_000_000_000_000_000_000n),
        });
        const fees = skewSplitFees(goodConfig(), market, true, 50_0000000n, 5_000_000_000_000_000_000n);
        expect(fees.worsening).toBe(300_000_000n); // 30.0 notional
        expect(fees.improving).toBe(200_000_000n); // 20.0 notional
        expect(fees.base).toBe(2_100_000n);        // 0.15 + 0.06
        expect(fees.impact).toBe(30_000_000n);     // 30.0 / 10
    });

    it('a collateral-only order (zero tokens) charges nothing', () => {
        const market = makeMarket({
            notional: pair(200_0000000n, 100_0000000n),
            tokens: pair(10_000_000_000_000_000_000n, 12_000_000_000_000_000_000n),
        });
        const fees = skewSplitFees(goodConfig(), market, true, 0n, 0n);
        expect(fees.base).toBe(0n);
        expect(fees.impact).toBe(0n);
    });
});

describe('validateTradingConfig (ports Config::check_valid)', () => {
    it('accepts the known-good baseline config', () => {
        expect(validateTradingConfig(goodConfig())).toEqual([]);
    });

    it('flags maintenance_margin >= init_margin', () => {
        const cfg = { ...goodConfig(), maintenanceMargin: S18 / 10n }; // == initMargin
        const violations = validateTradingConfig(cfg);
        expect(violations.length).toBe(1);
        expect(violations[0]).toMatch(/initMargin/);
    });

    it('flags a negative rate with the NegativeValueNotAllowed family message', () => {
        const cfg = { ...goodConfig(), keeperRate: -1n };
        const violations = validateTradingConfig(cfg);
        expect(violations.some((v) => /keeperRate/.test(v) && /non-negative/.test(v))).toBe(true);
    });

    it('flags an out-of-bounds keeper rate', () => {
        const cfg = { ...goodConfig(), keeperRate: S18 / 2n + 1n }; // MAX_KEEPER_RATE + 1
        expect(validateTradingConfig(cfg).some((v) => /keeperRate/.test(v))).toBe(true);
    });

    it('flags a degenerate notional band', () => {
        const cfg = { ...goodConfig(), maxPositionNotional: 10_000_000n }; // == minPositionNotional
        expect(validateTradingConfig(cfg).some((v) => /maxPositionNotional/.test(v))).toBe(true);
    });
});
