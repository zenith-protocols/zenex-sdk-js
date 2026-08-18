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
