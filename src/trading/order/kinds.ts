import { OrderKind } from '../../contracts/trading/trading_types.js';

export type OrderKindCrossing = 'above' | 'below';

function unknownOrderKind(kind: never): never {
    throw new RangeError(`Unknown order kind: ${String(kind)}`);
}

/** Whether the order grows an existing position or opens a new one. */
export function isIncreaseOrderKind(kind: OrderKind): boolean {
    switch (kind) {
        case OrderKind.MarketIncrease:
        case OrderKind.LimitIncrease:
        case OrderKind.StopIncrease:
            return true;
        case OrderKind.MarketDecrease:
        case OrderKind.LimitDecrease:
        case OrderKind.StopDecrease:
            return false;
        default:
            return unknownOrderKind(kind);
    }
}

/** Whether the order shrinks margin, notional, or the whole position. */
export function isDecreaseOrderKind(kind: OrderKind): boolean {
    return !isIncreaseOrderKind(kind);
}

/** Whether the order is eligible immediately and does not use a trigger. */
export function isMarketOrderKind(kind: OrderKind): boolean {
    switch (kind) {
        case OrderKind.MarketIncrease:
        case OrderKind.MarketDecrease:
            return true;
        case OrderKind.LimitIncrease:
        case OrderKind.StopIncrease:
        case OrderKind.LimitDecrease:
        case OrderKind.StopDecrease:
            return false;
        default:
            return unknownOrderKind(kind);
    }
}

/** Whether the order remains pending until its configured price crossing. */
export function isRestingOrderKind(kind: OrderKind): boolean {
    return !isMarketOrderKind(kind);
}

/** Same as `isRestingOrderKind`, worded for a caller reasoning about triggers rather than pending state. */
export function isTriggerOrderKind(kind: OrderKind): boolean {
    return isRestingOrderKind(kind);
}

/**
 * Return the price crossing that makes a side-specific order eligible.
 * Market orders have no crossing and return `null`.
 */
export function orderKindCrossing(
    kind: OrderKind,
    isLong: boolean,
): OrderKindCrossing | null {
    switch (kind) {
        case OrderKind.MarketIncrease:
        case OrderKind.MarketDecrease:
            return null;
        case OrderKind.LimitIncrease:
        case OrderKind.StopDecrease:
            return isLong ? 'below' : 'above';
        case OrderKind.StopIncrease:
        case OrderKind.LimitDecrease:
            return isLong ? 'above' : 'below';
        default:
            return unknownOrderKind(kind);
    }
}

/**
 * Return whether a trigger fires on an upward crossing. Market orders return
 * `null` because they do not have a trigger direction.
 */
export function orderKindFiresAbove(
    kind: OrderKind,
    isLong: boolean,
): boolean | null {
    const crossing = orderKindCrossing(kind, isLong);
    return crossing === null ? null : crossing === 'above';
}
