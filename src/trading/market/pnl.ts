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
} from '../../contracts/trading/trading_types.js';
import type { PriceData } from './types.js';
import { exitPrice } from './pricing.js';

function magnitude(value: bigint): bigint {
    const checked = checkedI128(value);
    return checked < 0n ? checkedI128(-checked) : checked;
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
