import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import {
    advanceBorrowing,
    advanceFunding,
    advanceMarketAccruals,
} from '../../src/trading/market/rates.js';
import type { PriceData } from '../../src/trading/market/types.js';
import type {
    MarketData,
    SidePair,
    TradingConfig,
} from '../../src/contracts/trading/trading_types.js';

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
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: 800_000_000_000_000_000n,
        maxUtilWithdraw: 900_000_000_000_000_000n,
        initMargin: 100_000_000_000_000_000n,
        maintenanceMargin: 50_000_000_000_000_000n,
        liqFee: 0n,
        notionalLock: 15n,
        targetUtil: 800_000_000_000_000_000n,
        borrowRate: 3_000_000_000n,
        increasedBorrowRate: 30_000_000_000n,
        fundingIncrease: 1_000n,
        fundingDecrease: 500n,
        thresholdStableFunding: 50_000_000_000_000_000n,
        thresholdDecreaseFunding: 20_000_000_000_000_000n,
        fundingMin: 0n,
        fundingMax: 1_000_000n,
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

function price(): PriceData {
    return {
        feedId: Buffer.alloc(32, 1),
        bid: 1_000_000_000n,
        ask: 1_000_000_000n,
        publishTime: 1n,
    };
}

describe('exact borrowing advancement', () => {
    it('handles empty reserve and full utilization against zero capacity', () => {
        const empty = advanceBorrowing(market(), config(), price(), 0n, 10n);
        const full = advanceBorrowing(
            market({
                notional: pair(1n, 0n),
                tokens: pair(SCALAR_18, 0n),
            }),
            config(),
            price(),
            0n,
            10n,
        );

        expect(empty.borrowingIdx).toEqual(pair());
        expect(empty.borrowingUpdate).toBe(10n);
        expect(full.borrowingIdx).toEqual(pair(300_000_000_000n, 0n));
    });

    it('charges only a strictly dominant short side', () => {
        const advanced = advanceBorrowing(
            market({
                notional: pair(0n, 200_000_000n),
                tokens: pair(0n, 200_000_000_000_000_000n),
            }),
            config(),
            price(),
            1_000_000_000n,
            1n,
        );

        expect(advanced.borrowingIdx).toEqual(pair(0n, 1_500_000_000n));
    });

    it('advances only the timestamp when elapsed time is zero', () => {
        const original = market({
            borrowingIdx: pair(10n, 20n),
            borrowingUpdate: 50n,
        });
        const advanced = advanceBorrowing(original, config(), price(), 1_000n, 50n);

        expect(advanced.borrowingIdx).toEqual(pair(10n, 20n));
        expect(advanced.borrowingUpdate).toBe(50n);
        expect(advanced.borrowingIdx).not.toBe(original.borrowingIdx);
    });
});

describe('exact funding advancement', () => {
    it('holds, decays, parks at one, and clamps the saved rate', () => {
        const hold = advanceFunding(
            market({ tokens: pair(1_030n, 970n), fundingRate: 5_000n }),
            config(),
            10n,
        );
        const decay = advanceFunding(
            market({ tokens: pair(1_010n, 990n), fundingRate: 5_000n }),
            config(),
            4n,
        );
        const parked = advanceFunding(
            market({ tokens: pair(1_010n, 990n), fundingRate: 5_000n }),
            config(),
            10n,
        );
        const clamped = advanceFunding(
            market({ tokens: pair(3n, 1n), fundingRate: 999_000n }),
            config(),
            10n,
        );

        expect(hold.fundingRate).toBe(5_000n);
        expect(decay.fundingRate).toBe(3_000n);
        expect(parked.fundingRate).toBe(1n);
        expect(clamped.fundingRate).toBe(1_000_000n);
    });

    it('applies the minimum charged rate without changing the evolved saved rate', () => {
        const advanced = advanceFunding(
            market({
                notional: pair(200_000_000n, 50_000_000n),
                tokens: pair(200_000_000_000_000_000n, 0n),
            }),
            config({ fundingMin: 50_000n }),
            10n,
        );

        expect(advanced.fundingRate).toBe(10_000n);
        expect(advanced.fundingIdx).toEqual(pair(500_000n, -2_000_000n));
    });

    it('credits no empty receiver and floors receiver pro-rata credit', () => {
        const emptyReceiver = advanceFunding(
            market({
                notional: pair(200_000_000n, 0n),
                tokens: pair(200_000_000_000_000_000n, 0n),
            }),
            config(),
            10n,
        );
        const floored = advanceFunding(
            market({
                notional: pair(1n, 3n),
                tokens: pair(1n, 1n),
                fundingRate: 1n,
            }),
            config(),
            1n,
        );

        expect(emptyReceiver.fundingIdx.short).toBe(0n);
        expect(floored.fundingIdx).toEqual(pair(1n, 0n));
    });

    it('resets an empty market rate and no-ops at zero elapsed', () => {
        const empty = advanceFunding(market({ fundingRate: 12_345n }), config(), 10n);
        const noElapsed = advanceFunding(
            market({ fundingRate: 5_000n, fundingUpdate: 10n, fundingIdx: pair(1n, 2n) }),
            config(),
            10n,
        );

        expect(empty.fundingRate).toBe(0n);
        expect(noElapsed.fundingRate).toBe(5_000n);
        expect(noElapsed.fundingIdx).toEqual(pair(1n, 2n));
    });
});

describe('coherent market accrual ordering and chronology', () => {
    it('returns elapsed windows and an immutable borrowing-then-funding snapshot', () => {
        const original = market({
            notional: pair(200_000_000n, 50_000_000n),
            tokens: pair(200_000_000_000_000_000n, 0n),
            borrowingUpdate: 2n,
            fundingUpdate: 4n,
        });
        const before = structuredClone(original);
        const result = advanceMarketAccruals(original, config(), price(), 1_000_000_000n, 10n);

        expect(result.elapsedBorrowing).toBe(8n);
        expect(result.elapsedFunding).toBe(6n);
        expect(result.market.borrowingUpdate).toBe(10n);
        expect(result.market.fundingUpdate).toBe(10n);
        expect(original).toEqual(before);
    });

    it('rejects any quote timestamp before stored borrowing or funding state', () => {
        const data = market({ borrowingUpdate: 10n, fundingUpdate: 20n });

        expect(() => advanceBorrowing(data, config(), price(), 1_000n, 9n))
            .toThrowError(new RangeError('quote timestamp predates stored borrowing accrual'));
        expect(() => advanceFunding(data, config(), 19n))
            .toThrowError(new RangeError('quote timestamp predates stored funding accrual'));
        // The composite no longer duplicates the chronology check up front; the
        // inner funding advancement still rejects the stale timestamp.
        expect(() => advanceMarketAccruals(data, config(), price(), 1_000n, 15n))
            .toThrowError(new RangeError('quote timestamp predates stored funding accrual'));
    });
});
