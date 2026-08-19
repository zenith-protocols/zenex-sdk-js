import type { MarketData, Position, SidePair, TradingConfig } from '../../contracts/market/types.js';
import { SCALAR_18, addI128, checkedI128, mulDivCeil, mulDivFloor, subI128 } from '../../math/fixed.js';
/**
 * Verified oracle price consumed by the math mirrors. Ports the oracle
 * contract's `PriceData`: prices are fixed 18-dec with no
 * exponent, and `publishTime` anchors the position price floor, order
 * anti-replay, and the vault-order fill postdate gates.
 */
export interface PriceData {
    /** Data Streams stream id (the report's `feedId`), 32 bytes. */
    feedId: Buffer | Uint8Array;
    /** Best bid (18-dec), after spread reduction; the adverse close side. */
    bid: bigint;
    /** Best ask (18-dec), after spread reduction; the adverse open side. */
    ask: bigint;
    /** Unix timestamp (seconds) when the price was observed by the oracle. */
    publishTime: bigint;
}

/**
 * Trade fee split for a signed notional change on one side of the book,
 * token-dec. Ports `Market::trade_fees` and `MarketData::skew_split`. The
 * total fee charged is `base + impact`.
 */
export interface TradeFees {
    /** Portion of the fill's notional that widens the book's token imbalance. Sums with `improving` to the fill's notional. */
    worsening: bigint;
    /** Portion of the fill's notional that narrows the book's token imbalance. */
    improving: bigint;
    /** Base fee: `ceil(worsening * feeDom)` plus `ceil(improving * feeNonDom)`, both SCALAR_18 rates. */
    base: bigint;
    /** Size-quadratic impact fee on the fill's full notional, capped at 10% of it. */
    impact: bigint;
}

/** The price a new position opens at: the ask for a long, the bid for a short. 18-dec. */
export function entryPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.ask : price.bid;
}

/** The price an open position closes at: the bid for a long, the ask for a short. 18-dec. */
export function exitPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.bid : price.ask;
}

/**
 * Value the vault has reserved against `isLong`'s open interest, token-dec.
 *
 * A long marks its base size at the ask and rounds up. A short reads its
 * entry notional. Both round in the vault's favour, so this reads at or above
 * the true reserve.
 */
export function sideReserved(data: MarketData, price: PriceData, isLong: boolean): bigint {
    return isLong
        ? mulDivCeil(data.tokens.long, price.ask, SCALAR_18)
        : data.notional.short;
}

/**
 * How much of the vault one side of the book may draw on, token-dec. Each
 * side gets half the vault, scaled by `factor` and rounded down.
 *
 * @param factor SCALAR_18 fraction. Pass `config.maxUtilOpen` for the reserve
 *   cap, or `config.maxPnlTrader` for the PnL haircut allowance.
 */
export function sideCapacity(vaultAssets: bigint, factor: bigint): bigint {
    return mulDivFloor(vaultAssets / 2n, factor, SCALAR_18);
}

/**
 * Share of `capacity` that `reserve` consumes, as a SCALAR_18 fraction
 * clamped to `[0, 1]`. Rounds up.
 *
 * A zero `reserve` reads 0. A non-zero `reserve` against zero `capacity`
 * reads fully utilized.
 */
export function reserveUtilization(reserve: bigint, capacity: bigint): bigint {
    if (reserve <= 0n) return 0n;
    if (capacity === 0n) return SCALAR_18;
    const utilization = mulDivCeil(reserve, SCALAR_18, capacity);
    return utilization < SCALAR_18 ? utilization : SCALAR_18;
}

/** 10% ceiling on the impact fee rate, SCALAR_18. */
const MAX_IMPACT_RATE = SCALAR_18 / 10n;

function magnitude(value: bigint): bigint {
    const checked = checkedI128(value);
    return checked < 0n ? checkedI128(-checked) : checked;
}

/**
 * Fees a fill would pay on `isLong`'s side, token-dec. Every leg rounds up.
 *
 * The base fee splits by how the fill moves the book's long-versus-short
 * token imbalance. The part that widens the imbalance pays `config.feeDom`,
 * the part that narrows it pays `config.feeNonDom`. The split follows tokens
 * rather than notional, so which rate a trade mostly pays depends on the
 * book's current skew, not only on its own direction. Quote before you show a
 * cost: the same trade is priced differently on a different book.
 *
 * The impact fee is quadratic on the full notional and capped at 10% of it,
 * regardless of skew.
 *
 * @param signedNotional Fill's notional delta, token-dec. Positive to
 *   increase, negative to decrease. Only the magnitude affects the fee.
 * @param signedTokens Fill's base-size delta, base-dec, signed the same way.
 */
export function quoteTradeFees(
    data: MarketData,
    config: TradingConfig,
    isLong: boolean,
    signedNotional: bigint,
    signedTokens: bigint,
): TradeFees {
    const tokenDelta = signedTokens;
    const notionalDelta = signedNotional;
    const before = subI128(data.tokens.long, data.tokens.short);
    const after = isLong ? addI128(before, tokenDelta) : subI128(before, tokenDelta);
    const deltaTokens = magnitude(tokenDelta);

    let worseningTokens: bigint;
    let improvingTokens: bigint;
    if (before !== 0n && after !== 0n && (before < 0n) !== (after < 0n)) {
        worseningTokens = magnitude(after);
        improvingTokens = magnitude(before);
    } else if (magnitude(after) > magnitude(before)) {
        worseningTokens = deltaTokens;
        improvingTokens = 0n;
    } else {
        worseningTokens = 0n;
        improvingTokens = deltaTokens;
    }

    const notional = magnitude(notionalDelta);
    const worsening = deltaTokens === 0n
        ? 0n
        : mulDivCeil(notional, worseningTokens, deltaTokens);
    const improving = subI128(notional, worsening);
    const base = addI128(
        mulDivCeil(worsening, config.feeDom, SCALAR_18),
        mulDivCeil(improving, config.feeNonDom, SCALAR_18),
    );
    const quadraticImpact = mulDivCeil(notional, notional, config.impactScalar);
    const cappedImpact = mulDivCeil(notional, MAX_IMPACT_RATE, SCALAR_18);
    const impact = quadraticImpact < cappedImpact ? quadraticImpact : cappedImpact;

    return { worsening, improving, base, impact };
}


/**
 * Signed PnL of `position` if it closed now, token-dec. Positive is profit.
 *
 * A long is `floor(tokens * bid / SCALAR_18) - notional`. A short is
 * `notional - ceil(tokens * ask / SCALAR_18)`. Both round against the trader.
 */
export function exactPositionPnl(
    position: Position,
    price: PriceData,
    isLong: boolean,
): bigint {
    const marked = isLong
        ? mulDivFloor(position.tokens, exitPrice(price, isLong), SCALAR_18)
        : mulDivCeil(position.tokens, exitPrice(price, isLong), SCALAR_18);
    return isLong
        ? subI128(marked, position.notional)
        : subI128(position.notional, marked);
}

/**
 * Signed unrealized PnL of every position on `isLong`'s side, token-dec.
 *
 * A loss floors at the side's posted margin, because no more than that can
 * be realized.
 *
 * @param maximize `true` marks in the traders' favour: long at the ask
 *   rounded up, short at the bid rounded down. `false` marks against them:
 *   long at the bid rounded down, short at the ask rounded up.
 */
export function marketSidePnl(
    data: MarketData,
    price: PriceData,
    isLong: boolean,
    maximize: boolean,
): bigint {
    const tokens = isLong ? data.tokens.long : data.tokens.short;
    const notional = isLong ? data.notional.long : data.notional.short;
    const margin = isLong ? data.margin.long : data.margin.short;

    let pnl: bigint;
    if (isLong) {
        const marked = maximize
            ? mulDivCeil(tokens, price.ask, SCALAR_18)
            : mulDivFloor(tokens, price.bid, SCALAR_18);
        pnl = subI128(marked, notional);
    } else {
        const marked = maximize
            ? mulDivFloor(tokens, price.bid, SCALAR_18)
            : mulDivCeil(tokens, price.ask, SCALAR_18);
        pnl = subI128(notional, marked);
    }

    const lossFloor = subI128(0n, margin);
    return pnl > lossFloor ? pnl : lossFloor;
}

/**
 * Signed unrealized PnL across both sides, token-dec. Both sides use the same
 * `maximize` marking. See {@link marketSidePnl}.
 */
export function marketNetPnl(data: MarketData, price: PriceData, maximize: boolean): bigint {
    return addI128(
        marketSidePnl(data, price, true, maximize),
        marketSidePnl(data, price, false, maximize),
    );
}

/** Result of advancing a market's accrual indices to a quote time. */
export interface AccrualResult {
    /** Market data with `borrowingIdx` and `fundingIdx` advanced to `elapsed` seconds past `accruedAt`. */
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


function get(pair: SidePair, isLong: boolean): bigint {
    return isLong ? pair.long : pair.short;
}

function set(pair: SidePair, isLong: boolean, value: bigint): void {
    if (isLong) pair.long = value;
    else pair.short = value;
}

/**
 * Borrowing rate per second at `utilization` (kink model; SCALAR_18).
 *
 * Ports `borrowing::borrowing_rate`. Below the kink the rate climbs linearly
 * (`borrowRate * utilization`); above `targetUtil` an additional slope blends
 * in so the rate reaches exactly `increasedBorrowRate` at full utilization.
 * Both legs round up, as a charge.
 *
 * Exported so display surfaces can annualize the exact rate rather than
 * re-derive the kink curve in floats.
 */
export function borrowingRate(config: TradingConfig, utilization: bigint): bigint {
    const base = mulDivCeil(config.borrowRate, utilization, SCALAR_18);
    if (utilization <= config.targetUtil) return base;

    const excess = subI128(utilization, config.targetUtil);
    const span = subI128(SCALAR_18, config.targetUtil);
    const rateGap = subI128(config.increasedBorrowRate, config.borrowRate);
    return addI128(base, mulDivCeil(rateGap, excess, span));
}

/**
 * Advance the borrowing accrual by `elapsed` seconds. Returns a new
 * `MarketData` with `borrowingIdx` moved forward; `data` is unchanged.
 *
 * Ports `MarketData::accrue_borrowing`. The side with the strictly larger
 * base `tokens` pays; on a token tie both sides pay. Each paying side
 * accrues at the kink rate (`borrowingRate`) over its own
 * `reserveUtilization`, measured against its half of `vaultAssets`
 * (token-dec). A zero-utilization side accrues nothing.
 *
 * If `elapsed` (seconds) is negative, the call throws a `RangeError`.
 */
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

/**
 * Advance the funding accrual by `elapsed` seconds. Returns a new
 * `MarketData` with `fundingRate` and `fundingIdx` moved forward; `data` is
 * unchanged.
 *
 * Ports `MarketData::accrue_funding`. The rate evolves under the velocity
 * model: it accelerates toward the dominant side when skew is wide or the
 * rate is fresh or flipped, decays flat toward zero when skew is narrow,
 * and otherwise holds. The result clamps to `config.fundingMax`.
 *
 * The window charges at the evolved rate, floored at `config.fundingMin`.
 * The paying side's `fundingIdx` rises by the charged rate times `elapsed`.
 * The receiving side's `fundingIdx` falls by the paid total spread pro-rata
 * over the receiver's `notional`. With no notional on the receiving side,
 * the paid funding is not credited to it.
 *
 * If `elapsed` (seconds) is negative, the call throws a `RangeError`.
 */
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

/**
 * Advance both accrual indices to `now`, in one shared elapsed window.
 * Returns a new `MarketData` plus the elapsed seconds; `data` is unchanged.
 *
 * Ports `Market::load`'s accrual step: computes `elapsed = now - data.accruedAt`
 * once, then applies `advanceBorrowing` and `advanceFunding` over that same
 * window before stamping `accruedAt` to `now`. Call this before quoting or
 * applying any action, so borrowing and funding are current at the quote time.
 *
 * If `now` predates `data.accruedAt`, the call throws a `RangeError`.
 */
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

/**
 * Expand a single 18-dec price into the `PriceData` shape the exact math
 * consumes, with `bid = ask = price` (a zero-spread view). For callers that
 * hold one number instead of a verified report; a fill preview built from it
 * prices both sides at the same level.
 */
export function priceDataFromSingle(price: bigint, publishTime?: bigint): PriceData {
    return {
        feedId: new Uint8Array(32),
        bid: price,
        ask: price,
        publishTime: publishTime ?? BigInt(Math.floor(Date.now() / 1000)),
    };
}
