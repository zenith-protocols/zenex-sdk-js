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

const MAX_IMPACT_RATE = SCALAR_18 / 10n;

function magnitude(value: bigint): bigint {
    const checked = checkedI128(value);
    return checked < 0n ? checkedI128(-checked) : checked;
}

export function entryPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.ask : price.bid;
}

export function exitPrice(price: PriceData, isLong: boolean): bigint {
    return isLong ? price.bid : price.ask;
}

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

export function sideReserved(data: MarketData, price: PriceData, isLong: boolean): bigint {
    return isLong
        ? mulDivCeil(data.tokens.long, price.ask, SCALAR_18)
        : data.notional.short;
}

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

export function marketNetPnl(data: MarketData, price: PriceData, maximize: boolean): bigint {
    return addI128(
        marketSidePnl(data, price, true, maximize),
        marketSidePnl(data, price, false, maximize),
    );
}

export function sideCapacity(vaultAssets: bigint, factor: bigint): bigint {
    return mulDivFloor(vaultAssets / 2n, factor, SCALAR_18);
}

export function reserveUtilization(reserve: bigint, capacity: bigint): bigint {
    if (reserve <= 0n) return 0n;
    if (capacity === 0n) return SCALAR_18;
    const utilization = mulDivCeil(reserve, SCALAR_18, capacity);
    return utilization < SCALAR_18 ? utilization : SCALAR_18;
}

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
