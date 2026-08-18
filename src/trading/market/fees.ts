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
    TradingConfig,
} from '../../contracts/trading/trading_types.js';
import type { TradeFees } from './types.js';

/** 10% cap on the impact fee rate (SCALAR_18), matching the contract's `MAX_IMPACT_RATE`. */
const MAX_IMPACT_RATE = SCALAR_18 / 10n;

function magnitude(value: bigint): bigint {
    const checked = checkedI128(value);
    return checked < 0n ? checkedI128(-checked) : checked;
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
