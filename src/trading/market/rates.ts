import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../../math/fixed.js';
import type {
    MarketData,
    SidePair,
    TradingConfig,
} from '../../contracts/trading/trading_types.js';
import {
    reserveUtilization,
    sideCapacity,
    sideReserved,
} from './capacity.js';
import type { PriceData } from './types.js';

export interface AccrualResult {
    market: MarketData;
    /** Seconds both indices accrued over, from the shared `accruedAt` clock. */
    elapsed: bigint;
}

function clonePair(value: SidePair): SidePair {
    return { long: value.long, short: value.short };
}

function cloneMarket(data: MarketData): MarketData {
    return {
        ...data,
        notional: clonePair(data.notional),
        margin: clonePair(data.margin),
        tokens: clonePair(data.tokens),
        fundingIdx: clonePair(data.fundingIdx),
        borrowingIdx: clonePair(data.borrowingIdx),
    };
}

function magnitude(value: bigint): bigint {
    const checked = checkedI128(value);
    return checked < 0n ? checkedI128(-checked) : checked;
}

function get(pair: SidePair, isLong: boolean): bigint {
    return isLong ? pair.long : pair.short;
}

function set(pair: SidePair, isLong: boolean, value: bigint): void {
    if (isLong) pair.long = value;
    else pair.short = value;
}

function borrowingRate(config: TradingConfig, utilization: bigint): bigint {
    const base = mulDivCeil(config.borrowRate, utilization, SCALAR_18);
    if (utilization <= config.targetUtil) return base;

    const excess = subI128(utilization, config.targetUtil);
    const span = subI128(SCALAR_18, config.targetUtil);
    const rateGap = subI128(config.increasedBorrowRate, config.borrowRate);
    return addI128(base, mulDivCeil(rateGap, excess, span));
}

export function advanceBorrowing(
    data: MarketData,
    config: TradingConfig,
    price: PriceData,
    vaultAssets: bigint,
    elapsed: bigint,
): MarketData {
    if (elapsed < 0n) {
        throw new RangeError('quote timestamp predates stored accrual');
    }

    const next = cloneMarket(data);
    if (elapsed === 0n) return next;

    const capacity = sideCapacity(vaultAssets, config.maxUtilOpen);

    for (const isLong of [true, false]) {
        const ownTokens = isLong ? next.tokens.long : next.tokens.short;
        const otherTokens = isLong ? next.tokens.short : next.tokens.long;
        if (ownTokens < otherTokens) continue;

        const utilization = reserveUtilization(sideReserved(next, price, isLong), capacity);
        const rate = borrowingRate(config, utilization);
        const indexDelta = mulDivFloor(rate, elapsed, 1n);
        set(next.borrowingIdx, isLong, addI128(get(next.borrowingIdx, isLong), indexDelta));
    }

    return next;
}

function evolvedFundingRate(
    data: MarketData,
    config: TradingConfig,
    elapsed: bigint,
): bigint {
    const saved = data.fundingRate;
    const total = addI128(data.tokens.long, data.tokens.short);
    if (total === 0n) return 0n;

    const imbalance = subI128(data.tokens.long, data.tokens.short);
    const skew = mulDivFloor(magnitude(imbalance), SCALAR_18, total);
    const direction = imbalance > 0n ? 1 : imbalance < 0n ? -1 : 0;
    const sameDirection = (saved > 0n && direction > 0) || (saved < 0n && direction < 0);

    let next = saved;
    if (direction !== 0 && (!sameDirection || skew > config.thresholdStableFunding)) {
        const velocity = mulDivFloor(config.fundingIncrease, skew, SCALAR_18);
        const step = mulDivFloor(velocity, elapsed, 1n);
        next = direction > 0 ? addI128(saved, step) : subI128(saved, step);
    } else if (direction !== 0 && skew < config.thresholdDecreaseFunding) {
        const decay = mulDivFloor(config.fundingDecrease, elapsed, 1n);
        const savedMagnitude = magnitude(saved);
        if (savedMagnitude <= decay) {
            next = saved > 0n ? 1n : saved < 0n ? -1n : 0n;
        } else {
            const reduced = subI128(savedMagnitude, decay);
            next = saved < 0n ? subI128(0n, reduced) : reduced;
        }
    }

    const minimum = subI128(0n, config.fundingMax);
    if (next < minimum) return minimum;
    return next > config.fundingMax ? config.fundingMax : next;
}

export function advanceFunding(
    data: MarketData,
    config: TradingConfig,
    elapsed: bigint,
): MarketData {
    if (elapsed < 0n) {
        throw new RangeError('quote timestamp predates stored accrual');
    }

    const next = cloneMarket(data);
    if (elapsed === 0n) return next;

    next.fundingRate = evolvedFundingRate(next, config, elapsed);
    if (next.fundingRate === 0n) return next;

    const longsPay = next.fundingRate > 0n;
    const rateMagnitude = magnitude(next.fundingRate);
    const chargedRate =
        rateMagnitude > config.fundingMin ? rateMagnitude : config.fundingMin;
    const payDelta = mulDivFloor(chargedRate, elapsed, 1n);
    set(next.fundingIdx, longsPay, addI128(get(next.fundingIdx, longsPay), payDelta));

    const payerNotional = get(next.notional, longsPay);
    const receiverNotional = get(next.notional, !longsPay);
    if (receiverNotional > 0n) {
        const receiverDelta = mulDivFloor(payDelta, payerNotional, receiverNotional);
        set(
            next.fundingIdx,
            !longsPay,
            subI128(get(next.fundingIdx, !longsPay), receiverDelta),
        );
    }

    return next;
}

export function advanceMarketAccruals(
    data: MarketData,
    config: TradingConfig,
    price: PriceData,
    vaultAssets: bigint,
    now: bigint,
): AccrualResult {
    if (now < data.accruedAt) {
        throw new RangeError('quote timestamp predates stored accrual');
    }
    // Mirror of Market::load: one elapsed window for both indices, one stamp.
    const elapsed = now - data.accruedAt;
    const afterBorrowing = advanceBorrowing(data, config, price, vaultAssets, elapsed);
    const market = advanceFunding(afterBorrowing, config, elapsed);
    market.accruedAt = now;
    return { market, elapsed };
}
