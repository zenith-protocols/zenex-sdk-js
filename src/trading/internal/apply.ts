import { ZenexErrorCode } from '../../errors.js';
import type { OrderParams } from '../../contracts/router/types.js';
import { FULL_CLOSE, OrderKind, Status } from '../../contracts/market/types.js';
import type { AdlState, MarketData, Position, MarketConfig } from '../../contracts/market/types.js';
import { BPS_DENOMINATOR, addI128, checkedBps, mulDivFloor, subI128 } from '../../math/fixed.js';
import type { PriceData } from './math.js';
import { isIncreaseOrderKind, isMarketOrderKind, orderExecutionPrice, validateOrder } from './order.js';
import { quotePositionAction } from './quote.js';
import type { PositionAction, PositionActionOutcome } from './quote.js';
import type { VaultAtomicState } from './vault.js';

/** Whose position, and which side, a context describes. */
export interface MarketSubject {
    /** Position owner. */
    readonly user: string;
    /** Side this position targets. */
    readonly isLong: boolean;
}

/** A coherent market + position + price view at one ledger. */
export interface MarketContext {
    /** Subject the `position` belongs to, when the context is subject-bound. */
    readonly subject?: MarketSubject;
    /** Ledger sequence the state was read at; order expiry is measured in it. */
    ledger: number;
    /**
     * Ledger close time in whole seconds; the clock every time gate uses.
     * This value is supplied by the caller. It defaults to the wall clock,
     * because the ledger entry read returns a sequence number, not a close
     * time.
     */
    ledgerTime: bigint;
    /** Operational status; only `Active` admits new risk. */
    status: Status;
    /** Market parameters. */
    config: MarketConfig;
    /** The market singleton. */
    market: MarketData;
    /** The subject's stored position on the side under action. */
    position: Position;
    /** Verified mark used to price the action. */
    price: PriceData;
    /**
     * Opaque execution-price payload carried onto a built order and spliced at
     * fill time. In the relay path the relay supplies its own signed update, so
     * this is a caller placeholder. This quote never inspects or checks it.
     */
    priceUpdate: Uint8Array;
    /** Atomic vault state backing PnL and withdrawal capacity. */
    vault: VaultAtomicState;
    /** Protocol fee rate (SCALAR_18); apportions fees, never charges them. */
    treasuryRate: bigint;
    /** Per-side ADL flags; a flagged side is closed-only. */
    adl?: AdlState;
    /**
     * `(terminalPrice, delistedAt)` once retired. `terminalPrice` is
     * price_scalar, `delistedAt` is unix seconds.
     */
    retirement?: readonly [bigint, bigint];
    /** Settlement token, when the context carries it. */
    collateralToken?: string;
}

/** A {@link MarketContext} known to describe a specific subject and side. */
export type SubjectBoundMarketContext = MarketContext & {
    readonly subject: MarketSubject;
    readonly adl: AdlState;
    readonly collateralToken: string;
};


/**
 * The outcome when one order is applied to the snapshot's position at a
 * price.
 *
 * `fills` carries the exact transition the chain would execute. `rests`
 * means the order creates but does not fill now (trigger orders, or a
 * market order whose price bound is not crossed at this price). `gate`
 * means the order can never fill as constructed. The gate code says why:
 * the mirrored contract error (for example #713 when a decrease would break
 * margin), or an SDK sentinel (`ZenexErrorCode.QuoteInvalidInput` /
 * `QuoteOverflow`) for a failure the contract never sees.
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
            code: ZenexErrorCode.QuoteInvalidInput,
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
    if (quote.kind === 'unavailable') {
        const code =
            quote.contractCode ??
            (quote.code === 'CONTRACT_OVERFLOW'
                ? ZenexErrorCode.QuoteOverflow
                : ZenexErrorCode.QuoteInvalidInput);
        return { kind: 'gate', code, reason: quote.reason, ledger };
    }
    return {
        kind: 'gate',
        code: ZenexErrorCode.QuoteInvalidInput,
        reason: 'exact transition is unavailable',
        ledger,
    };
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
