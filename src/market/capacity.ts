import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../math/fixed.js';
import type {
    MarketData,
    Position,
    TradingConfig,
} from '../trading/trading_types.js';
import type { TradeFees, VerifiedPrice } from './types.js';

const MAX_IMPACT_RATE = SCALAR_18 / 10n;
const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;

function assertVerifiedPrice(price: VerifiedPrice): void {
    if (!Number.isSafeInteger(price.feedId) || price.feedId < 0 || price.feedId > U32_MAX) {
        throw new RangeError('verified price feed id must be a u32');
    }
    if (!Number.isInteger(price.exponent) || price.exponent < -18 || price.exponent > 0) {
        throw new RangeError('verified price exponent must be between -18 and 0');
    }
    checkedI128(price.bid);
    checkedI128(price.ask);
    if (price.bid <= 0n || price.ask <= 0n || price.bid > price.ask) {
        throw new RangeError('verified price must have positive noncrossed bid and ask');
    }
    if (typeof price.publishTime !== 'bigint' || price.publishTime < 0n || price.publishTime > U64_MAX) {
        throw new RangeError('verified price publish time must be a u64 bigint');
    }
    if (price.source !== 'pyth' && price.source !== 'terminal') {
        throw new TypeError('verified price source is invalid');
    }
    if (price.source === 'terminal' && price.bid !== price.ask) {
        throw new RangeError('terminal price must be flat');
    }
}

function requireNonnegative(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
}

function magnitude(value: bigint): bigint {
    const checked = checkedI128(value);
    return checked < 0n ? checkedI128(-checked) : checked;
}

export function entryPrice(price: VerifiedPrice, isLong: boolean): bigint {
    assertVerifiedPrice(price);
    return isLong ? price.ask : price.bid;
}

export function exitPrice(price: VerifiedPrice, isLong: boolean): bigint {
    assertVerifiedPrice(price);
    return isLong ? price.bid : price.ask;
}

export function exactPositionPnl(
    position: Position,
    price: VerifiedPrice,
    isLong: boolean,
): bigint {
    const notional = requireNonnegative(position.notional, 'position notional');
    const tokens = requireNonnegative(position.tokens, 'position tokens');
    const marked = isLong
        ? mulDivFloor(tokens, exitPrice(price, isLong), SCALAR_18)
        : mulDivCeil(tokens, exitPrice(price, isLong), SCALAR_18);
    return isLong ? subI128(marked, notional) : subI128(notional, marked);
}

export function sideReserved(data: MarketData, price: VerifiedPrice, isLong: boolean): bigint {
    assertVerifiedPrice(price);
    return isLong
        ? mulDivCeil(requireNonnegative(data.tokens.long, 'long tokens'), price.ask, SCALAR_18)
        : requireNonnegative(data.notional.short, 'short notional');
}

export function marketSidePnl(
    data: MarketData,
    price: VerifiedPrice,
    isLong: boolean,
    maximize: boolean,
): bigint {
    assertVerifiedPrice(price);
    const tokens = requireNonnegative(
        isLong ? data.tokens.long : data.tokens.short,
        isLong ? 'long tokens' : 'short tokens',
    );
    const notional = requireNonnegative(
        isLong ? data.notional.long : data.notional.short,
        isLong ? 'long notional' : 'short notional',
    );
    const collateral = requireNonnegative(
        isLong ? data.collateral.long : data.collateral.short,
        isLong ? 'long collateral' : 'short collateral',
    );

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

    const lossFloor = subI128(0n, collateral);
    return pnl > lossFloor ? pnl : lossFloor;
}

export function marketNetPnl(data: MarketData, price: VerifiedPrice, maximize: boolean): bigint {
    return addI128(
        marketSidePnl(data, price, true, maximize),
        marketSidePnl(data, price, false, maximize),
    );
}

export function sideCapacity(vaultAssets: bigint, factor: bigint): bigint {
    const assets = requireNonnegative(vaultAssets, 'vault assets');
    const checkedFactor = requireNonnegative(factor, 'capacity factor');
    return mulDivFloor(assets / 2n, checkedFactor, SCALAR_18);
}

export function reserveUtilization(reserve: bigint, capacity: bigint): bigint {
    const checkedReserve = checkedI128(reserve);
    const checkedCapacity = requireNonnegative(capacity, 'reserve capacity');
    if (checkedReserve <= 0n) return 0n;
    if (checkedCapacity === 0n) return SCALAR_18;
    const utilization = mulDivCeil(checkedReserve, SCALAR_18, checkedCapacity);
    return utilization < SCALAR_18 ? utilization : SCALAR_18;
}

export function quoteTradeFees(
    data: MarketData,
    config: TradingConfig,
    isLong: boolean,
    signedNotional: bigint,
    signedTokens: bigint,
): TradeFees {
    const longTokens = requireNonnegative(data.tokens.long, 'long tokens');
    const shortTokens = requireNonnegative(data.tokens.short, 'short tokens');
    const tokenDelta = checkedI128(signedTokens);
    const notionalDelta = checkedI128(signedNotional);
    const feeDom = requireNonnegative(config.feeDom, 'dominant fee rate');
    const feeNonDom = requireNonnegative(config.feeNonDom, 'nondominant fee rate');
    const impactScalar = requireNonnegative(config.impactScalar, 'impact scalar');
    if (impactScalar === 0n) throw new RangeError('impact scalar must be positive');

    const before = subI128(longTokens, shortTokens);
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
        mulDivCeil(worsening, feeDom, SCALAR_18),
        mulDivCeil(improving, feeNonDom, SCALAR_18),
    );
    const quadraticImpact = mulDivCeil(notional, notional, impactScalar);
    const cappedImpact = mulDivCeil(notional, MAX_IMPACT_RATE, SCALAR_18);
    const impact = quadraticImpact < cappedImpact ? quadraticImpact : cappedImpact;

    return { worsening, improving, base, impact };
}
