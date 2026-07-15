import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../math/fixed.js';
import type {
    MarketData,
    SidePair,
    TradingConfig,
} from '../trading/trading_types.js';
import {
    reserveUtilization,
    sideCapacity,
    sideReserved,
} from './capacity.js';
import type { VerifiedPrice } from './types.js';

const U64_MAX = 2n ** 64n - 1n;

export interface AccrualResult {
    market: MarketData;
    elapsedBorrowing: bigint;
    elapsedFunding: bigint;
}

function clonePair(value: SidePair): SidePair {
    return { long: value.long, short: value.short };
}

function cloneMarket(data: MarketData): MarketData {
    return {
        ...data,
        notional: clonePair(data.notional),
        collateral: clonePair(data.collateral),
        tokens: clonePair(data.tokens),
        fundingIdx: clonePair(data.fundingIdx),
        borrowingIdx: clonePair(data.borrowingIdx),
    };
}

function checkedTimestamp(value: bigint, label: string): bigint {
    if (typeof value !== 'bigint') throw new TypeError(`${label} must be a bigint`);
    if (value < 0n || value > U64_MAX) throw new RangeError(`${label} must be a u64`);
    return value;
}

function nonnegative(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
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
    const target = nonnegative(config.targetUtil, 'target utilization');
    const borrowRate = nonnegative(config.borrowRate, 'borrow rate');
    const increased = nonnegative(config.increasedBorrowRate, 'increased borrow rate');
    if (target > SCALAR_18) throw new RangeError('target utilization exceeds one');
    if (increased < borrowRate) throw new RangeError('increased borrow rate is below borrow rate');

    const base = mulDivCeil(borrowRate, utilization, SCALAR_18);
    if (utilization <= target) return base;

    const excess = subI128(utilization, target);
    const span = subI128(SCALAR_18, target);
    const rateGap = subI128(increased, borrowRate);
    return addI128(base, mulDivCeil(rateGap, excess, span));
}

export function advanceBorrowing(
    data: MarketData,
    config: TradingConfig,
    price: VerifiedPrice,
    vaultAssets: bigint,
    now: bigint,
): MarketData {
    const quoteTime = checkedTimestamp(now, 'quote timestamp');
    const storedTime = checkedTimestamp(data.borrowingUpdate, 'borrowing update');
    if (quoteTime < storedTime) {
        throw new RangeError('quote timestamp predates stored borrowing accrual');
    }

    const next = cloneMarket(data);
    const elapsed = quoteTime - storedTime;
    next.borrowingUpdate = quoteTime;
    if (elapsed === 0n) return next;

    const longTokens = nonnegative(next.tokens.long, 'long tokens');
    const shortTokens = nonnegative(next.tokens.short, 'short tokens');
    const capacity = sideCapacity(vaultAssets, config.maxUtilOpen);

    for (const isLong of [true, false]) {
        const ownTokens = isLong ? longTokens : shortTokens;
        const otherTokens = isLong ? shortTokens : longTokens;
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
    const saved = checkedI128(data.fundingRate);
    const longTokens = nonnegative(data.tokens.long, 'long tokens');
    const shortTokens = nonnegative(data.tokens.short, 'short tokens');
    const total = addI128(longTokens, shortTokens);
    if (total === 0n) return 0n;

    const fundingIncrease = nonnegative(config.fundingIncrease, 'funding increase');
    const fundingDecrease = nonnegative(config.fundingDecrease, 'funding decrease');
    const stableThreshold = nonnegative(config.thresholdStableFunding, 'stable funding threshold');
    const decreaseThreshold = nonnegative(config.thresholdDecreaseFunding, 'decrease funding threshold');
    const fundingMax = nonnegative(config.fundingMax, 'maximum funding rate');
    if (stableThreshold > SCALAR_18 || decreaseThreshold > stableThreshold) {
        throw new RangeError('funding thresholds are invalid');
    }

    const imbalance = subI128(longTokens, shortTokens);
    const skew = mulDivFloor(magnitude(imbalance), SCALAR_18, total);
    const direction = imbalance > 0n ? 1 : imbalance < 0n ? -1 : 0;
    const sameDirection = (saved > 0n && direction > 0) || (saved < 0n && direction < 0);

    let next = saved;
    if (direction !== 0 && (!sameDirection || skew > stableThreshold)) {
        const velocity = mulDivFloor(fundingIncrease, skew, SCALAR_18);
        const step = mulDivFloor(velocity, elapsed, 1n);
        next = direction > 0 ? addI128(saved, step) : subI128(saved, step);
    } else if (direction !== 0 && skew < decreaseThreshold) {
        const decay = mulDivFloor(fundingDecrease, elapsed, 1n);
        const savedMagnitude = magnitude(saved);
        if (savedMagnitude <= decay) {
            next = saved > 0n ? 1n : saved < 0n ? -1n : 0n;
        } else {
            const reduced = subI128(savedMagnitude, decay);
            next = saved < 0n ? subI128(0n, reduced) : reduced;
        }
    }

    const minimum = subI128(0n, fundingMax);
    if (next < minimum) return minimum;
    return next > fundingMax ? fundingMax : next;
}

export function advanceFunding(
    data: MarketData,
    config: TradingConfig,
    now: bigint,
): MarketData {
    const quoteTime = checkedTimestamp(now, 'quote timestamp');
    const storedTime = checkedTimestamp(data.fundingUpdate, 'funding update');
    if (quoteTime < storedTime) {
        throw new RangeError('quote timestamp predates stored funding accrual');
    }

    const next = cloneMarket(data);
    const elapsed = quoteTime - storedTime;
    next.fundingUpdate = quoteTime;
    if (elapsed === 0n) return next;

    next.fundingRate = evolvedFundingRate(next, config, elapsed);
    if (next.fundingRate === 0n) return next;

    const longsPay = next.fundingRate > 0n;
    const minimumCharge = nonnegative(config.fundingMin, 'minimum funding rate');
    const rateMagnitude = magnitude(next.fundingRate);
    const chargedRate = rateMagnitude > minimumCharge ? rateMagnitude : minimumCharge;
    const payDelta = mulDivFloor(chargedRate, elapsed, 1n);
    set(next.fundingIdx, longsPay, addI128(get(next.fundingIdx, longsPay), payDelta));

    const payerNotional = nonnegative(get(next.notional, longsPay), 'payer notional');
    const receiverNotional = nonnegative(get(next.notional, !longsPay), 'receiver notional');
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
    price: VerifiedPrice,
    vaultAssets: bigint,
    now: bigint,
): AccrualResult {
    const quoteTime = checkedTimestamp(now, 'quote timestamp');
    const borrowingUpdate = checkedTimestamp(data.borrowingUpdate, 'borrowing update');
    const fundingUpdate = checkedTimestamp(data.fundingUpdate, 'funding update');
    if (quoteTime < borrowingUpdate || quoteTime < fundingUpdate) {
        throw new RangeError('quote timestamp predates stored accrual');
    }

    const afterBorrowing = advanceBorrowing(data, config, price, vaultAssets, quoteTime);
    return {
        market: advanceFunding(afterBorrowing, config, quoteTime),
        elapsedBorrowing: quoteTime - borrowingUpdate,
        elapsedFunding: quoteTime - fundingUpdate,
    };
}
