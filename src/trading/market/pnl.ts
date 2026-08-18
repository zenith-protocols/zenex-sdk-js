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
