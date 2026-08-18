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
 * Reserved value backing `isLong`'s open interest, token-dec.
 *
 * Ports `MarketData::side_reserved`. A long side marks its base `tokens` at
 * the ask, rounded up; a short side reads its entry `notional` directly,
 * since its payout is bounded by it. Both readings overstate the reserve,
 * which keeps the utilization gates conservative.
 */
export function sideReserved(data: MarketData, price: PriceData, isLong: boolean): bigint {
    return isLong
        ? mulDivCeil(data.tokens.long, price.ask, SCALAR_18)
        : data.notional.short;
}

/**
 * An 18-dec `factor` of half of `vaultAssets`, rounded down, token-dec.
 *
 * Ports `math::half_factor`. Each side of the book is measured against its
 * own half of the vault, so this is the shared denominator behind both the
 * reserve cap, pass `config.maxUtilOpen`, and the PnL haircut allowance,
 * pass `config.maxPnlTrader`.
 */
export function sideCapacity(vaultAssets: bigint, factor: bigint): bigint {
    return mulDivFloor(vaultAssets / 2n, factor, SCALAR_18);
}

/**
 * Reserve utilization: the share of `capacity` backing `reserve`, clamped to
 * `[0, 1]` (SCALAR_18).
 *
 * Ports `side_utilization`. An empty `reserve` reads 0; a non-empty
 * `reserve` against zero `capacity` reads full utilization. Otherwise the
 * ratio rounds up, so both the utilization gate and the borrowing rate it
 * feeds err high.
 */
export function reserveUtilization(reserve: bigint, capacity: bigint): bigint {
    if (reserve <= 0n) return 0n;
    if (capacity === 0n) return SCALAR_18;
    const utilization = mulDivCeil(reserve, SCALAR_18, capacity);
    return utilization < SCALAR_18 ? utilization : SCALAR_18;
}
