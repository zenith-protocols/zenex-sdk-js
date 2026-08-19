import type { OrderParams } from '../contracts/router/types.js';
import type { Position } from '../contracts/market/types.js';
import { SCALAR_18, mulDivCeil } from '../math/fixed.js';
import type { Market } from './market.js';
import type { OrderEstimate } from './order.js';
import { previewOrder } from './order.js';
import type { PositionEstimate } from './position_est.js';
import { estimatePosition } from './position_est.js';
import type { PriceInput } from './price.js';
import { resolvePrice } from './price.js';
import { exitPrice } from './internal/math.js';
import {
    impliedEntryPrice,
    liquidationPrice,
    liquidationState,
    pendingBorrowing,
    pendingFunding,
    positionEquity,
    positionPnl,
    unlockedNotional,
} from './internal/position.js';

/**
 * One stored position that knows its side. `MarketUser.load` stamps `isLong`
 * from the storage key it read, so the methods never ask for it. All exact
 * bigints; the float view of the same numbers is `PositionEstimate`.
 *
 * Methods that take a `market` measure against it as passed — accrue first
 * (`market.accrue(price)`) when you want fill-grade numbers.
 */
export class MarketPosition {
    constructor(
        /** The side this row was stored under. */
        public isLong: boolean,
        /** Posted margin, token-dec. */
        public margin: bigint,
        /** Open size, token-dec. Zero means no open position. */
        public notional: bigint,
        /** Base size, token-dec. */
        public tokens: bigint,
        /** Funding index snapshot at the last change. */
        public fundingIdx: bigint,
        /** Borrowing index snapshot at the last change. */
        public borrowingIdx: bigint,
        /** Notional under the decrease lock, token-dec. */
        public lockedNotional: bigint,
        /** Unix seconds the decrease lock lapses at. */
        public unlocksAt: bigint,
        /** Unix seconds of the last pricing touch. */
        public pricedAt: bigint,
        /** Ids of pending decrease orders riding this side. */
        public decreaseOrders: number[],
    ) {}

    /** Wrap a parsed storage row (e.g. from an indexer) with its side. */
    static from(row: Position, isLong: boolean): MarketPosition {
        return new MarketPosition(
            isLong,
            row.margin,
            row.notional,
            row.tokens,
            row.fundingIdx,
            row.borrowingIdx,
            row.lockedNotional,
            row.unlocksAt,
            row.pricedAt,
            [...row.decreaseOrders],
        );
    }

    /** Whether this side carries any size. */
    isOpen(): boolean {
        return this.notional > 0n;
    }

    /** Mark-to-market PnL at `price` (exit side), token-dec. Signed. */
    pnl(price: PriceInput): bigint {
        const mark = exitPrice(resolvePrice(price), this.isLong);
        return positionPnl(this, mark, SCALAR_18, this.isLong);
    }

    /**
     * Margin + PnL - pending accruals at `price`, token-dec. The equity the
     * contract's margin gates measure.
     */
    equity(market: Market, price: PriceInput): bigint {
        const mark = exitPrice(resolvePrice(price), this.isLong);
        return positionEquity(this, market.data, mark, SCALAR_18, this.isLong);
    }

    /**
     * Funding accrued since this row's snapshot of the market index,
     * token-dec. Positive is owed by the trader, negative is earned.
     */
    pendingFunding(market: Market): bigint {
        return pendingFunding(this, market.data, this.isLong);
    }

    /** Borrowing accrued since this row's index snapshot, token-dec (never negative). */
    pendingBorrowing(market: Market): bigint {
        return pendingBorrowing(this, market.data, this.isLong);
    }

    /** Average entry price of the stored size (18-dec); `0n` with no open size. */
    entryPrice(): bigint {
        return impliedEntryPrice(this) ?? 0n;
    }

    /** The margin the maintenance requirement demands, token-dec, rounded up as the contract rounds. */
    maintenanceMargin(market: Market): bigint {
        return mulDivCeil(
            this.notional,
            market.config.maintenanceMargin,
            SCALAR_18,
        );
    }

    /** Price (18-dec) at which equity meets the maintenance margin; `0n` with no open size. */
    liquidationPrice(market: Market): bigint {
        return liquidationPrice(this, market.config, market.data, this.isLong);
    }

    /**
     * Whether a keeper liquidation would succeed at `price`: settled equity
     * below the maintenance requirement, measured exactly as
     * `execute_liquidation` does (close fees included). `false` with no open
     * size.
     */
    isLiquidatable(market: Market, price: PriceInput): boolean {
        const state = liquidationState(this, {
            ledger: market.ledger,
            // The market as passed: elapsed 0 against the stored accrual.
            now: market.data.accruedAt,
            isLong: this.isLong,
            position: this,
            market: market.data,
            config: market.config,
            price: resolvePrice(price),
            vaultAssets: market.vaultAssets,
            treasuryRate: 0n,
        });
        return state.kind === 'exact' ? state.value.liquidatable : false;
    }

    /** Notional not under the decrease lock at `now` (defaults to the wall clock), token-dec. */
    unlockedNotional(now?: bigint): bigint {
        return unlockedNotional(
            this,
            now ?? BigInt(Math.floor(Date.now() / 1000)),
        );
    }

    /** This position's display estimate at `price`. Delegates to {@link estimatePosition}. */
    estimate(market: Market, price: PriceInput, now?: bigint): PositionEstimate {
        return estimatePosition(market, this, price, now);
    }

    /** Pre-flight `order` against this position at `price`. Delegates to {@link previewOrder}. */
    preview(
        market: Market,
        order: OrderParams,
        price: PriceInput,
        now?: bigint,
    ): OrderEstimate {
        return previewOrder(market, this, order, price, now);
    }
}
