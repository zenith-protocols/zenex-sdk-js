import type { PriceData } from './types.js';

/** Price at which a new position enters: the ask for a long, the bid for a short (18-dec). Ports `PriceData::entry`. */
export function entryPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.ask : price.bid;
}

/** Price at which a position closes or liquidates: the bid for a long, the ask for a short (18-dec). Ports `PriceData::exit`. */
export function exitPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.bid : price.ask;
}
