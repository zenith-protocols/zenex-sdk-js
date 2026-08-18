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
    Position,
    TradingConfig,
} from '../../contracts/trading/trading_types.js';
import type { TradeFees, PriceData } from './types.js';

/** 10% cap on the impact fee rate (SCALAR_18), matching the contract's `MAX_IMPACT_RATE`. */
const MAX_IMPACT_RATE = SCALAR_18 / 10n;

function magnitude(value: bigint): bigint {
    const checked = checkedI128(value);
    return checked < 0n ? checkedI128(-checked) : checked;
}

/** Price at which a new position enters: the ask for a long, the bid for a short (18-dec). Ports `PriceData::entry`. */
export function entryPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.ask : price.bid;
}

/** Price at which a position closes or liquidates: the bid for a long, the ask for a short (18-dec). Ports `PriceData::exit`. */
export function exitPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.bid : price.ask;
}

/**
 * Signed PnL of `position` marked at the exit price, token-dec.
 *
 * Ports `math::pnl`. A long is `floor(tokens * bid / SCALAR_18) - notional`;
 * a short is `notional - ceil(tokens * ask / SCALAR_18)`. Both round against
 * the trader, the same conservative direction the contract uses for the
 * vault's accounting.
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
 * Reserved value backing `isLong`'s open interest, token-dec.
 *
 * Ports `MarketData::side_reserved`. A long side marks its base `tokens` at
 * the ask, rounded up; a short side reads its entry `notional` directly,
 * since its payout is bounded by it. Both readings overstate the reserve,
 * which keeps the utilization gates conservative.
 */
export function sideReserved(data: MarketData, price: PriceData, isLong: boolean): bigint {
    return isLong
        ? mulDivCeil(data.tokens.long, price.ask, SCALAR_18)
        : data.notional.short;
}

/**
 * Signed pending PnL of `isLong`'s side, token-dec.
 *
 * Ports `MarketData::side_pnl`, the measure behind every PnL-factor gate.
 * With `maximize` true the side marks to maximize trader PnL: long at the
 * ask rounded up, short at the bid rounded down. With `maximize` false it
 * marks to minimize trader PnL: long at the bid rounded down, short at the
 * ask rounded up. A loss floors at the negative of the side's posted
 * `margin`; a paper loss beyond margin cannot realize.
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
 * Signed net pending trader PnL across both sides, token-dec.
 *
 * Ports `MarketData::net_pnl`: the sum of `marketSidePnl` for the long and
 * short side at the same `maximize` marking.
 */
export function marketNetPnl(data: MarketData, price: PriceData, maximize: boolean): bigint {
    return addI128(
        marketSidePnl(data, price, true, maximize),
        marketSidePnl(data, price, false, maximize),
    );
}

/**
 * An 18-dec `factor` of half of `vaultAssets`, rounded down, token-dec.
 *
 * Ports `math::half_factor`. Each side of the book is measured against its
 * own half of the vault, so this is the shared denominator behind both the
 * reserve cap, pass `config.maxUtilOpen`, and the PnL haircut allowance,
 * pass `config.maxPnlTrader`.
 */
export function sideCapacity(vaultAssets: bigint, factor: bigint): bigint {
    return mulDivFloor(vaultAssets / 2n, factor, SCALAR_18);
}

/**
 * Reserve utilization: the share of `capacity` backing `reserve`, clamped to
 * `[0, 1]` (SCALAR_18).
 *
 * Ports `side_utilization`. An empty `reserve` reads 0; a non-empty
 * `reserve` against zero `capacity` reads full utilization. Otherwise the
 * ratio rounds up, so both the utilization gate and the borrowing rate it
 * feeds err high.
 */
export function reserveUtilization(reserve: bigint, capacity: bigint): bigint {
    if (reserve <= 0n) return 0n;
    if (capacity === 0n) return SCALAR_18;
    const utilization = mulDivCeil(reserve, SCALAR_18, capacity);
    return utilization < SCALAR_18 ? utilization : SCALAR_18;
}

/**
 * Trade fee quote for a signed change on `isLong`'s side, token-dec.
 *
 * Ports `Market::trade_fees`. It judges the change with
 * `MarketData::skew_split` by its effect on the book's long and short token
 * imbalance, not by notional, then maps that split onto `signedNotional`
 * pro-rata. The leg that widens the imbalance becomes `worsening` and pays
 * `config.feeDom`. The leg that narrows it becomes `improving` and pays
 * `config.feeNonDom`. Because the split follows tokens, which side pays the
 * dominant rate can depend on the book's skew, not only on the trade's own
 * direction. The impact fee is quadratic on the fill's full notional,
 * capped at 10% of it, and does not depend on skew. Every fee leg rounds
 * up, against the trader.
 *
 * `signedNotional` and `signedTokens` are the fill's signed deltas on
 * `isLong`'s side, positive for an increase and negative for a decrease
 * (token-dec and base-dec). Only their magnitudes affect the fee.
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
