import type { PriceData } from './types.js';

/** The price a new position opens at: the ask for a long, the bid for a short. 18-dec. */
export function entryPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.ask : price.bid;
}

/** The price an open position closes at: the bid for a long, the ask for a short. 18-dec. */
export function exitPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.bid : price.ask;
}
