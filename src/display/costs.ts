// =============================================================================
// Order cost preview.
//
// Replaces hand-rolled float re-implementations of the contract's fee model.
// Every figure here is produced by the EXACT mirror (`quoteTradeFees`, which
// ports `Market::trade_fees`) and only then converted for display, so a preview
// can never drift from the fill the way a parallel float implementation does.
//
// Approximate at the last step only. The exact bigints remain available on
// `exact` for anything that must reconcile against a quote.
// =============================================================================

import type { MarketData, TradingConfig } from '../contracts/trading/trading_types.js';
import type { PriceData, TradeFees } from '../trading/market/types.js';
import { entryPrice, exitPrice, quoteTradeFees } from '../trading/market/capacity.js';
import { SCALAR_18, mulDivFloor } from '../math/fixed.js';
import { formatPrice, formatToken } from './format.js';

export interface OrderCostPreview {
    /** Skew-split base fee (`feeDom` on the worsening leg, `feeNonDom` on the improving leg). */
    baseFee: number;
    /** Size-quadratic impact fee, capped at 10% of notional. */
    impactFee: number;
    /** Flat keeper execution fee escrowed with the order. */
    execFee: number;
    /** baseFee + impactFee + execFee. */
    totalFees: number;
    /** Margin escrowed at creation for an increase (`margin + execFee`), else `execFee` alone. */
    escrowed: number;
    /** Execution price the fill is sized at: ask for a long open, bid for a short. */
    executionPrice: number;
    /** Base size the notional buys at `executionPrice`. */
    tokens: number;
    /** The unrounded fee bigints behind the floats above. */
    exact: TradeFees;
}

/**
 * Preview the cost of opening (or adding to) a position.
 *
 * `notional` and `margin` are token-dec bigints — parse user input with
 * `parseAtomic`, never with a float multiply. `decimals` is the deployment's
 * settlement token decimals.
 *
 * The fee split depends on which way the fill moves the book's token skew, so
 * this needs the live `market` and `price`; it is not a function of size alone.
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
 * Preview the cost of closing (or reducing) a position.
 *
 * A decrease escrows only the `execFee`; the trade fee is debited from the
 * settled margin at fill. `tokens` is the position's base size being closed,
 * which the caller has from the stored position — it is not re-derived from
 * the price, so the split matches the size actually leaving the book.
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
