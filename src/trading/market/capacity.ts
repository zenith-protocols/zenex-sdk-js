import {
    SCALAR_18,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../../math/fixed.js';
import type {
    MarketData,
    TradingConfig,
} from '../../contracts/trading/trading_types.js';
import type { PriceData } from './types.js';
import { marketNetPnl } from './pnl.js';

/**
 * Value the vault has reserved against `isLong`'s open interest, token-dec.
 *
 * A long marks its base size at the ask and rounds up. A short reads its
 * entry notional. Both round in the vault's favour, so this reads at or above
 * the true reserve.
 */
export function sideReserved(data: MarketData, price: PriceData, isLong: boolean): bigint {
    return isLong
        ? mulDivCeil(data.tokens.long, price.ask, SCALAR_18)
        : data.notional.short;
}

/**
 * How much of the vault one side of the book may draw on, token-dec. Each
 * side gets half the vault, scaled by `factor` and rounded down.
 *
 * @param factor SCALAR_18 fraction. Pass `config.maxUtilOpen` for the reserve
 *   cap, or `config.maxPnlTrader` for the PnL haircut allowance.
 */
export function sideCapacity(vaultAssets: bigint, factor: bigint): bigint {
    return mulDivFloor(vaultAssets / 2n, factor, SCALAR_18);
}

/**
 * Share of `capacity` that `reserve` consumes, as a SCALAR_18 fraction
 * clamped to `[0, 1]`. Rounds up.
 *
 * A zero `reserve` reads 0. A non-zero `reserve` against zero `capacity`
 * reads fully utilized.
 */
export function reserveUtilization(reserve: bigint, capacity: bigint): bigint {
    if (reserve <= 0n) return 0n;
    if (capacity === 0n) return SCALAR_18;
    const utilization = mulDivCeil(reserve, SCALAR_18, capacity);
    return utilization < SCALAR_18 ? utilization : SCALAR_18;
}
