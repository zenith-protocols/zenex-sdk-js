import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../../math/fixed.js';
import { sideCapacity } from '../market/capacity.js';
import { quoteTradeFees } from '../market/fees.js';
import { exactPositionPnl, marketSidePnl } from '../market/pnl.js';
import { advanceMarketAccruals } from '../market/rates.js';
import type { PriceData } from '../market/types.js';
import {
    decodeLedgerSequence,
    exact,
    estimate,
    unavailable,
} from '../quote/result.js';
import type { QuoteResult } from '../quote/result.js';
import type { Position } from '../../contracts/trading/trading_types.js';
import type { PositionQuoteContext } from './quote.js';

const OVERFLOW_MESSAGE = 'value is outside the i128 range';

function side(pair: { long: bigint; short: bigint }, isLong: boolean): bigint {
    return isLong ? pair.long : pair.short;
}

function accruedAmount(
    notional: bigint,
    marketIndex: bigint,
    positionIndex: bigint,
): bigint {
    return mulDivCeil(notional, subI128(marketIndex, positionIndex), SCALAR_18);
}

function haircutPnl(
    pnl: bigint,
    context: Pick<
        PositionQuoteContext,
        'market' | 'config' | 'price' | 'vaultAssets' | 'isLong'
    >,
): bigint {
    if (pnl <= 0n) return pnl;
    const pending = marketSidePnl(
        context.market,
        context.price,
        context.isLong,
        true,
    );
    const allowance = sideCapacity(
        context.vaultAssets,
        context.config.maxPnlTrader,
    );
    return pending > allowance ? mulDivFloor(pnl, allowance, pending) : pnl;
}

function caughtUnavailable<T>(error: unknown): QuoteResult<T> {
    if (
        error instanceof RangeError &&
        error.message.includes(OVERFLOW_MESSAGE)
    ) {
        return unavailable('CONTRACT_OVERFLOW', error.message);
    }
    return unavailable(
        'INVALID_INPUT',
        error instanceof Error
            ? error.message
            : 'invalid position lifecycle input',
    );
}

/**
 * Average entry price implied by `position`, price_scalar:
 * `floor(notional * SCALAR_18 / tokens)`. `undefined` when `position.tokens`
 * is `0n` (no open size), matching the entry-implied note on
 * `Position::tokens`.
 */
export function impliedEntryPrice(position: Position): bigint | undefined {
    if (position.tokens === 0n) return undefined;
    return mulDivFloor(position.notional, SCALAR_18, position.tokens);
}

/**
 * Leverage of `position` marked at `price`, SCALAR_18 (`SCALAR_18` = 1x):
 * `notional / (margin + pnl)`. The denominator is margin plus raw PnL, not
 * the fee-settled equity `liquidationState` returns. It also excludes
 * pending funding and borrowing, named in the result's `assumptions`.
 *
 * The contract has no leverage function; `TradingConfig.initMargin` states
 * the inverse relation, "max leverage = 1 / initMargin".
 *
 * @returns `estimate` of `0n` when `position.notional` is `0n`.
 *   `unavailable` (`INVALID_INPUT`) when margin plus PnL is zero or
 *   negative: leverage against non-positive equity is undefined.
 *   `unavailable` (`CONTRACT_OVERFLOW`) on an i128 overflow, or
 *   (`INVALID_INPUT`) on any other input error.
 */
export function positionLeverage(
    position: Position,
    price: PriceData,
    isLong: boolean,
): QuoteResult<bigint> {
    try {
        if (position.notional === 0n) {
            return estimate(0n, [
                'excludes unsettled funding and borrowing accruals',
            ]);
        }
        const equity = addI128(
            position.margin,
            exactPositionPnl(position, price, isLong),
        );
        if (equity <= 0n) {
            return unavailable(
                'INVALID_INPUT',
                'position equity must be positive to quote leverage',
            );
        }
        return estimate(mulDivFloor(position.notional, SCALAR_18, equity), [
            'excludes unsettled funding and borrowing accruals',
        ]);
    } catch (error) {
        return caughtUnavailable(error);
    }
}

/**
 * Exact liquidation check for `position` at `context.ledger`, token-dec.
 * Mirrors `Position::is_liquidatable`: advances the market's funding and
 * borrowing indices to `context.now` (`Market::load`), settles the full
 * position at `context.price` the way `Position::settle` would on a close,
 * and compares the result to the maintenance line.
 *
 * `equity` is the settled equity floored at `0n`, matching what a close or a
 * liquidation would pay out. `maintenanceRequired` is
 * `ceil(notional * maintenanceMargin / SCALAR_18)` (`Position::margin_requirement`).
 * `liquidatable` is `equity < maintenanceRequired`: `true` is
 * `Position::liquidate`'s eligibility gate, `false` is `Position::decrease`'s
 * solvency gate.
 *
 * @returns `unavailable` (`CONTRACT_GATE`, "contract error #720: position not
 *   found") when `position.notional` is `0n`. `unavailable`
 *   (`CONTRACT_OVERFLOW`) on an i128 overflow, or (`INVALID_INPUT`) on any
 *   other input error. Otherwise `exact` at `context.ledger`.
 */
export function liquidationState(
    position: Position,
    context: PositionQuoteContext,
): QuoteResult<{
    equity: bigint;
    maintenanceRequired: bigint;
    liquidatable: boolean;
}> {
    try {
        const accrued = advanceMarketAccruals(
            context.market,
            context.config,
            context.price,
            context.vaultAssets,
            context.now,
        ).market;
        const notional = position.notional;
        if (notional === 0n) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #720: position not found',
            );
        }
        const funding = accruedAmount(
            notional,
            side(accrued.fundingIdx, context.isLong),
            position.fundingIdx,
        );
        const borrowing = accruedAmount(
            notional,
            side(accrued.borrowingIdx, context.isLong),
            position.borrowingIdx,
        );

        const trade = quoteTradeFees(
            accrued,
            context.config,
            context.isLong,
            subI128(0n, notional),
            subI128(0n, position.tokens),
        );
        const debit = addI128(
            addI128(trade.base, trade.impact),
            addI128(borrowing, funding > 0n ? funding : 0n),
        );
        const rawPnl = exactPositionPnl(
            position,
            context.price,
            context.isLong,
        );
        const pnl = haircutPnl(rawPnl, {
            market: accrued,
            config: context.config,
            price: context.price,
            vaultAssets: context.vaultAssets,
            isLong: context.isLong,
        });
        const settledEquity = addI128(
            subI128(position.margin, debit),
            pnl,
        );
        const equity = settledEquity > 0n ? settledEquity : 0n;
        const maintenanceRequired = mulDivCeil(
            notional,
            context.config.maintenanceMargin,
            SCALAR_18,
        );

        return exact(
            {
                equity,
                maintenanceRequired,
                liquidatable: equity < maintenanceRequired,
            },
            context.ledger,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}
