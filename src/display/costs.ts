import type { MarketData, TradingConfig } from '../contracts/trading/trading_types.js';
import type { PriceData, TradeFees } from '../trading/market/types.js';
import { quoteTradeFees } from '../trading/market/fees.js';
import { entryPrice, exitPrice } from '../trading/market/pricing.js';
import { SCALAR_18, mulDivFloor } from '../math/fixed.js';
import { formatPrice, formatToken } from './format.js';

export interface OrderCostPreview {
    /** Skew-split base fee, token units (`feeDom` on the worsening leg, `feeNonDom` on the improving leg). */
    baseFee: number;
    /** Size-quadratic impact fee, token units, capped at 10% of notional. */
    impactFee: number;
    /** Flat keeper execution fee escrowed with the order, token units. */
    execFee: number;
    /** baseFee + impactFee + execFee, token units. */
    totalFees: number;
    /** Margin escrowed at creation for an increase (`margin + execFee`), else `execFee` alone. Token units. */
    escrowed: number;
    /** Execution price the fill is sized at: ask for a long open, bid for a short. */
    executionPrice: number;
    /** Base size the notional buys at `executionPrice`, token units. */
    tokens: number;
    /** The exact fee bigints behind the floats above, for reconciliation against a quote. */
    exact: TradeFees;
}

/**
 * Previews the cost of opening, or adding to, a position. Approximate,
 * for display only.
 *
 * The fee split depends on which way the fill moves the book's token skew.
 * This needs the live `market` and `price`; it is not a function of size
 * alone.
 *
 * @param notional Exact token-dec bigint. Parse user input with
 * `parseAtomic`, never with a float multiply.
 * @param margin Exact token-dec bigint. Parse user input with
 * `parseAtomic`, never with a float multiply.
 * @param decimals The deployment's settlement token decimals.
 */
export function orderCostPreview(
    market: MarketData,
    config: TradingConfig,
    price: PriceData,
    isLong: boolean,
    notional: bigint,
    margin: bigint,
    decimals: number,
): OrderCostPreview {
    const execution = entryPrice(price, isLong);
    // Mirrors `increaseTransition`: the fill's base size at the entry price.
    const tokens =
        execution === 0n ? 0n : mulDivFloor(notional, SCALAR_18, execution);
    const fees = quoteTradeFees(market, config, isLong, notional, tokens);

    return {
        baseFee: formatToken(fees.base, decimals),
        impactFee: formatToken(fees.impact, decimals),
        execFee: formatToken(config.execFee, decimals),
        totalFees: formatToken(fees.base + fees.impact + config.execFee, decimals),
        escrowed: formatToken(margin + config.execFee, decimals),
        executionPrice: formatPrice(execution),
        // `to_tokens` divides a token-dec notional by an 18-dec price, so the
        // base size lands at the TOKEN's decimals -- not 18. Getting this wrong
        // is off by 10^11 on a 7-dec deployment.
        tokens: formatToken(tokens, decimals),
        exact: fees,
    };
}

/**
 * Previews the cost of closing, or reducing, a position. Approximate,
 * for display only.
 *
 * A decrease escrows only the `execFee`. The trade fee is debited from the
 * settled margin at fill.
 *
 * @param notional Exact token-dec bigint. Parse user input with
 * `parseAtomic`, never with a float multiply.
 * @param tokens The position's exact base size being closed, from the
 * stored position. Settlement-token decimals, not `SCALAR_18`, even though
 * prices are. Not re-derived from the price, so the fee split matches the
 * size actually leaving the book.
 * @param decimals The deployment's settlement token decimals.
 */
export function closeCostPreview(
    market: MarketData,
    config: TradingConfig,
    price: PriceData,
    isLong: boolean,
    notional: bigint,
    tokens: bigint,
    decimals: number,
): OrderCostPreview {
    const execution = exitPrice(price, isLong);
    const fees = quoteTradeFees(market, config, isLong, -notional, -tokens);

    return {
        baseFee: formatToken(fees.base, decimals),
        impactFee: formatToken(fees.impact, decimals),
        execFee: formatToken(config.execFee, decimals),
        totalFees: formatToken(fees.base + fees.impact + config.execFee, decimals),
        escrowed: formatToken(config.execFee, decimals),
        executionPrice: formatPrice(execution),
        // `to_tokens` divides a token-dec notional by an 18-dec price, so the
        // base size lands at the TOKEN's decimals -- not 18. Getting this wrong
        // is off by 10^11 on a 7-dec deployment.
        tokens: formatToken(tokens, decimals),
        exact: fees,
    };
}
