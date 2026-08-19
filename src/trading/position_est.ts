import { SCALAR_18, mulDivCeil, mulDivFloor } from '../math/fixed.js';
import { formatPrice, formatToken, formatTokenFloor } from '../float.js';
import type { Market } from './market.js';
import type { MarketPosition } from './position.js';
import type { PriceInput } from './price.js';
import { resolvePrice } from './price.js';
import { marketContext } from './order.js';
import { exitPrice, quoteTradeFees } from './internal/math.js';
import { maxWithdrawableMargin } from './internal/apply.js';
import {
    impliedEntryPrice,
    liquidationPrice,
    pendingBorrowing,
    pendingFunding,
    positionEquity,
    positionPnl,
    unlockedNotional,
} from './internal/position.js';

/**
 * The float projection of one stored position, marked at the estimate
 * price. Plain data: serializes, spreads into props, survives a query
 * cache. Never feed any of it back into an order.
 */
export interface PositionEstimate {
    /** Open size, token units. */
    notional: number;
    /** Base size, token units. */
    tokens: number;
    /** Current value of the base size at the estimate price (`tokens * mark`), token units. */
    positionValue: number;
    /** Posted margin, token units. */
    margin: number;
    /** Mark-to-market PnL at the close price, token units. */
    pnl: number;
    /** Margin + PnL - pending accruals, token units. */
    equity: number;
    /** Pending funding, token units. Positive is owed by the trader. */
    pendingFunding: number;
    /** Pending borrowing, token units (never negative). */
    pendingBorrowing: number;
    /** notional / equity, e.g. `3.5` for 3.5x. `0` on non-positive equity. */
    leverage: number;
    /** Average entry price, or `0` with no open size. */
    entryPrice: number;
    /** Price at which equity meets the maintenance margin. */
    liquidationPrice: number;
    /** equity / maintenance requirement; above `1` is healthy, `Infinity` with no requirement. */
    healthFactor: number;
    /** Signed % move from mark to liquidation price; negative once crossed. */
    liquidationDistancePercent: number;
    /** Cost to fully close now: base + impact fee at the estimate price, token units. */
    closeFee: number;
    /** PnL net of a full close: `pnl - closeFee - pendingFunding - pendingBorrowing`, token units. The positions table's headline number. */
    netPnl: number;
    /** `netPnl / margin * 100`. `0` on zero margin. */
    netPnlPercent: number;
    /** Notional not under the decrease lock, token units. */
    unlockedNotional: number;
    /**
     * Largest margin withdrawal that still fills at the estimate price
     * (probed over exact transitions: equity and initial-margin gates,
     * order dust floor), token units, floor-rounded so the value
     * round-trips through an input field and `parseAtomic` without
     * exceeding the true maximum. `0` when nothing fits.
     */
    maxWithdrawableMargin: number;
}

/**
 * Compute one position's display estimate at `price` (bare bigint =
 * zero-spread); the side rides in with the position. `now` drives the
 * decrease lock and defaults to the wall clock.
 *
 * Measures against `market` as passed — pending accruals reflect the
 * indices as stored on-chain. Pass `market.accrue(price)` for numbers
 * advanced to now.
 */
export function estimatePosition(
    market: Market,
    position: MarketPosition,
    price: PriceInput,
    now?: bigint,
): PositionEstimate {
    const decimals = market.assetDecimals;
    const config = market.config;
    const data = market.data;
    const isLong = position.isLong;
    const clock = now ?? BigInt(Math.floor(Date.now() / 1000));
    const p = resolvePrice(price);
    const mark = exitPrice(p, isLong);

    const pnlRaw = positionPnl(position, mark, SCALAR_18, isLong);
    const equityRaw = positionEquity(position, data, mark, SCALAR_18, isLong);
    const fundingRaw = pendingFunding(position, data, isLong);
    const borrowingRaw = pendingBorrowing(position, data, isLong);
    const liqRaw = liquidationPrice(position, config, data, isLong);
    const entryRaw = impliedEntryPrice(position) ?? 0n;

    // Rounds up as the contract does, so the displayed headroom never reads
    // safer than the chain's own check.
    const maintenanceRaw = mulDivCeil(
        position.notional,
        config.maintenanceMargin,
        SCALAR_18,
    );

    // Closing the whole size: the fee split of `-notional, -tokens` leaving
    // the book, exactly as a close fill charges it.
    const closeFees =
        position.notional > 0n
            ? quoteTradeFees(
                  data,
                  config,
                  isLong,
                  -position.notional,
                  -position.tokens,
              )
            : undefined;
    const closeFeeRaw =
        closeFees === undefined ? 0n : closeFees.base + closeFees.impact;
    const netPnlRaw = pnlRaw - closeFeeRaw - fundingRaw - borrowingRaw;

    const markFloat = formatPrice(mark);
    const liqFloat = formatPrice(liqRaw);
    // Signed toward safety: a long is safe while the mark sits above the
    // liquidation price, a short while it sits below.
    const distance =
        markFloat === 0
            ? 0
            : ((isLong ? markFloat - liqFloat : liqFloat - markFloat) /
                  markFloat) *
              100;

    const maxWithdrawRaw =
        position.notional > 0n
            ? maxWithdrawableMargin(marketContext(market, position, price, clock))
            : 0n;

    return {
        notional: formatToken(position.notional, decimals),
        tokens: formatToken(position.tokens, decimals),
        positionValue: formatToken(
            mulDivFloor(position.tokens, mark, SCALAR_18),
            decimals,
        ),
        margin: formatToken(position.margin, decimals),
        pnl: formatToken(pnlRaw, decimals),
        equity: formatToken(equityRaw, decimals),
        pendingFunding: formatToken(fundingRaw, decimals),
        pendingBorrowing: formatToken(borrowingRaw, decimals),
        leverage:
            equityRaw <= 0n ? 0 : Number(position.notional) / Number(equityRaw),
        entryPrice: formatPrice(entryRaw),
        liquidationPrice: liqFloat,
        healthFactor:
            maintenanceRaw === 0n
                ? Infinity
                : Number(equityRaw) / Number(maintenanceRaw),
        liquidationDistancePercent: distance,
        closeFee: formatToken(closeFeeRaw, decimals),
        netPnl: formatToken(netPnlRaw, decimals),
        netPnlPercent:
            position.margin === 0n
                ? 0
                : (Number(netPnlRaw) / Number(position.margin)) * 100,
        unlockedNotional: formatToken(
            unlockedNotional(position, clock),
            decimals,
        ),
        maxWithdrawableMargin: formatTokenFloor(maxWithdrawRaw, decimals),
    };
}
