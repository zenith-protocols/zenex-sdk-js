import {
    BPS_DENOMINATOR,
    addI128,
    checkedBps,
    mulDivFloor,
    subI128,
} from '../../math/fixed.js';
import {
    FULL_CLOSE,
    OrderKind,
    Status,
} from '../../contracts/trading/trading_types.js';
import type { OrderParams } from '../../contracts/router/router_types.js';
import { isIncreaseOrderKind, isMarketOrderKind } from '../order/kinds.js';
import { orderExecutionPrice, validateOrder } from '../order/validation.js';
import type { PriceData } from '../market/types.js';
import type { MarketContext } from './context.js';
import {
    quotePositionAction,
    type PositionAction,
    type PositionActionOutcome,
} from './quote.js';

/**
 * The result of applying one order to the snapshot's position at a price.
 *
 * `fills` carries the exact transition the chain would execute. `rests`
 * means the order creates but does not fill now (trigger orders, or a
 * market order whose price bound is not crossed at this price). `gate`
 * means the order can never fill as constructed. The contract gate code
 * says why (for example #713 when a decrease would break margin).
 */
export type OrderApplication =
    | { kind: 'fills'; outcome: PositionActionOutcome; ledger: number }
    | { kind: 'rests'; reason: string; ledger: number }
    | { kind: 'gate'; code: number; reason: string; ledger: number };

export interface ApplyOrderOptions {
    /** Evaluate at this price instead of the snapshot price (what-if). */
    price?: PriceData;
    /** Defaults to the market's configured execution fee. */
    executionFee?: bigint;
    /** Reserved relay fee maximum; defaults to 0n for direct execution. */
    relayFee?: bigint;
}

const BOUND_NOT_CROSSED = 741;

function orderAction(order: OrderParams): PositionAction | undefined {
    if (order.kind === OrderKind.MarketIncrease) {
        if (order.notional === 0n) {
            return {
                kind: 'adjustMargin',
                direction: 'add',
                amount: order.margin,
            };
        }
        return {
            kind: 'increase',
            notional: order.notional,
            margin: order.margin,
        };
    }
    if (order.kind === OrderKind.MarketDecrease) {
        if (order.notional === FULL_CLOSE) return { kind: 'close' };
        if (order.notional === 0n) {
            return {
                kind: 'adjustMargin',
                direction: 'withdraw',
                amount: order.margin,
            };
        }
        return {
            kind: 'decrease',
            notional: order.notional,
            margin: order.margin,
        };
    }
    return undefined;
}

function gateCode(reason: string): number {
    const match = /#(\d+)/.exec(reason);
    return match === null ? 0 : parseInt(match[1], 10);
}

/**
 * Apply one order to the snapshot's position and report whether it fills,
 * rests, or gates at the given price. This is the creation pre-flight: the
 * chain accepts orders that can never fill, so callers quote here before they
 * build and sign the same `OrderParams`.
 */
export function applyOrder(
    snapshot: MarketContext,
    order: OrderParams,
    options: ApplyOrderOptions = {},
): OrderApplication {
    const ledger = snapshot.ledger;
    if (snapshot.subject && order.isLong !== snapshot.subject.isLong) {
        return {
            kind: 'gate',
            code: 0,
            reason: 'order side does not match the snapshot subject',
            ledger,
        };
    }
    const price = options.price ?? snapshot.price;
    const issues = validateOrder(order, {
        ledger: snapshot.ledger,
        now: snapshot.ledgerTime,
        status: snapshot.status,
        config: snapshot.config,
        price,
        priceUpdate: snapshot.priceUpdate,
        position: snapshot.position,
    });
    // A real gate outranks the bound-not-crossed signal: rests only when the
    // uncrossed bound is the sole reason the order would not fill now.
    const gate = issues.find((entry) => entry.code !== BOUND_NOT_CROSSED);
    if (gate !== undefined) {
        return { kind: 'gate', code: gate.code, reason: gate.reason, ledger };
    }
    // A size-growing increase cannot fill while opens are halted: a status
    // that disallows opens (only Active allows them past the Frozen/Retired
    // creation gate) or the side's ADL flag (`execute_order`, #705). The
    // halt outranks the uncrossed bound, which the contract judges later.
    if (
        isMarketOrderKind(order.kind) &&
        isIncreaseOrderKind(order.kind) &&
        order.notional > 0n
    ) {
        const sideAdl = order.isLong
            ? snapshot.adl?.long
            : snapshot.adl?.short;
        if (snapshot.status !== Status.Active || sideAdl === true) {
            return {
                kind: 'gate',
                code: 705,
                reason: 'contract error #705: increase halted',
                ledger,
            };
        }
    }
    if (issues.length > 0) {
        return { kind: 'rests', reason: issues[0].reason, ledger };
    }

    const action = orderAction(order);
    if (action === undefined) {
        return {
            kind: 'rests',
            reason: 'trigger orders rest until their trigger price crosses',
            ledger,
        };
    }

    const quote = quotePositionAction({
        ledger: snapshot.ledger,
        now: snapshot.ledgerTime,
        isLong: order.isLong,
        position: snapshot.position,
        market: snapshot.market,
        config: snapshot.config,
        price,
        vaultAssets: snapshot.vault.totalAssets,
        treasuryRate: snapshot.treasuryRate,
        action,
        executionFee: options.executionFee ?? snapshot.config.execFee,
        relayFee: options.relayFee ?? 0n,
    });
    if (quote.kind === 'exact') {
        return { kind: 'fills', outcome: quote.value, ledger };
    }
    const reason =
        quote.kind === 'unavailable'
            ? quote.reason
            : 'exact transition is unavailable';
    return { kind: 'gate', code: gateCode(reason), reason, ledger };
}

/**
 * Derive the adverse price bound for an order from a chosen maximum
 * slippage in basis points (10_000 = 100%) against the current
 * execution price.
 */
export function orderPriceBound(
    price: PriceData,
    isLong: boolean,
    kind: OrderKind,
    maxSlippageBps: bigint,
): bigint {
    const bps = checkedBps(maxSlippageBps);
    const executionPrice = orderExecutionPrice(kind, isLong, price);
    const adverse = mulDivFloor(executionPrice, bps, BPS_DENOMINATOR);
    const increases =
        kind === OrderKind.MarketIncrease ||
        kind === OrderKind.LimitIncrease ||
        kind === OrderKind.StopIncrease;
    return increases === isLong
        ? addI128(executionPrice, adverse)
        : subI128(executionPrice, adverse);
}

/**
 * Largest margin withdrawal that still fills, found by binary search over
 * `applyOrder`-equivalent transitions. Returns 0n when nothing above the
 * order dust floor fits inside the margin gates.
 */
export function maxWithdrawableMargin(
    snapshot: MarketContext,
    options: ApplyOrderOptions = {},
): bigint {
    const probe = (amount: bigint): boolean =>
        quotePositionAction({
            ledger: snapshot.ledger,
            now: snapshot.ledgerTime,
            isLong: snapshot.subject?.isLong ?? true,
            position: snapshot.position,
            market: snapshot.market,
            config: snapshot.config,
            price: options.price ?? snapshot.price,
            vaultAssets: snapshot.vault.totalAssets,
            treasuryRate: snapshot.treasuryRate,
            action: {
                kind: 'adjustMargin',
                direction: 'withdraw',
                amount,
            },
            executionFee: options.executionFee ?? snapshot.config.execFee,
            relayFee: options.relayFee ?? 0n,
        }).kind === 'exact';

    let low = snapshot.config.minOrderMargin;
    let high = snapshot.position.margin;
    if (low <= 0n || high < low || !probe(low)) return 0n;
    while (low < high) {
        const mid = low + (high - low + 1n) / 2n;
        if (probe(mid)) {
            low = mid;
        } else {
            high = mid - 1n;
        }
    }
    return low;
}
