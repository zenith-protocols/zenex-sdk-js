import { Address, scValToNative } from '@stellar/stellar-sdk';
import { checkedI128 } from '../../math/fixed.js';
import type { PriceData } from '../market/types.js';
import { decodeLedgerSequence } from '../quote/result.js';
import {
    MAX_ORDERS_PER_SIDE,
    OrderKind,
    Status,
    type Position,
    type TradingConfig,
} from '../../contracts/trading/trading_types.js';
import type { Call, OrderParams } from '../../contracts/router/router_types.js';
import {
    isDecreaseOrderKind,
    isIncreaseOrderKind,
    isMarketOrderKind,
    isTriggerOrderKind,
} from './kinds.js';

const U32_MAX = 4_294_967_295;
const ORDER_KINDS = new Set<number>([
    OrderKind.MarketIncrease,
    OrderKind.LimitIncrease,
    OrderKind.StopIncrease,
    OrderKind.MarketDecrease,
    OrderKind.LimitDecrease,
    OrderKind.StopDecrease,
]);

/**
 * One failed check returned by `validateOrder`. A batch order can fail
 * several checks at once; `buildOrderOperation` only surfaces the first.
 */
export interface OrderValidationIssue {
    /** The market contract error code this failure maps to, or 0 for an input error the contract never sees. */
    code: number;
    /** The `OrderParams` field at fault, or 'batch' when no single field is responsible. */
    field: keyof OrderParams | 'batch';
    /** A message safe to show to the caller. */
    reason: string;
}

/**
 * A snapshot of ledger state to check an order against. Build one snapshot
 * per as-of ledger and reuse it for every order checked against that ledger.
 */
export interface OrderValidationContext {
    /** Ledger sequence the snapshot was read at, u32 range. An order's `expiration` must be at or after this value. */
    ledger: number;
    /** Unix seconds the snapshot was read at. Not read by `validateOrder`. */
    now: bigint;
    /** Market operational status at the snapshot. `Frozen` and `Retired` block order creation. */
    status: Status;
    /** Market config at the snapshot. Supplies the dust floors and the max position notional checked here. */
    config: TradingConfig;
    /**
     * Verified market price at the snapshot. Omit it to skip the price
     * checks: the malformed-price check and, for a market order, the price
     * bound check both need it.
     */
    price?: PriceData;
    /**
     * Serialized update submitted when `price` was loaded; terminal markets
     * ignore the payload by contract design.
     */
    priceUpdate?: Uint8Array;
    /**
     * The side's stored position. When present, a decrease kind preflights
     * the `MAX_ORDERS_PER_SIDE` pending-decrease cap (contract error #733)
     * that `create_order` enforces when it appends to `decrease_orders`.
     * Omit it to skip this preflight; the contract still enforces the cap
     * at submission.
     */
    position?: Position;
}

function issue(
    code: number,
    field: OrderValidationIssue['field'],
    reason: string,
): OrderValidationIssue {
    return { code, field, reason };
}

function validU32(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= U32_MAX
    );
}

function checkedAtomic(
    value: unknown,
    field: keyof OrderParams,
    issues: OrderValidationIssue[],
): bigint | undefined {
    try {
        return checkedI128(value as bigint);
    } catch (error) {
        issues.push(
            issue(
                710,
                field,
                error instanceof Error
                    ? error.message
                    : `${field} is not an i128`,
            ),
        );
        return undefined;
    }
}

/**
 * The price a fill against `kind` and `isLong` would execute at: the ask
 * for a long increase or a short decrease, the bid for a short increase or
 * a long decrease. `price.bid` and `price.ask` are 18-dec.
 */
export function orderExecutionPrice(
    kind: OrderKind,
    isLong: boolean,
    price: PriceData,
): bigint {
    if (isIncreaseOrderKind(kind)) return isLong ? price.ask : price.bid;
    return isLong ? price.bid : price.ask;
}

function validatePrice(price: PriceData): OrderValidationIssue[] {
    if (price.bid <= 0n || price.ask <= 0n || price.bid > price.ask) {
        return [
            issue(
                740,
                'batch',
                'market price is malformed',
            ),
        ];
    }
    return [];
}

/**
 * Check one order's shape against a ledger snapshot before submission.
 * Mirrors the market contract's price-free `create_order` checks, and, for
 * a market order, its price bound. Nothing throws; every failed check is
 * returned.
 *
 * @param params - The order to check.
 * @param context - The ledger snapshot to check it against.
 * @returns Every failed check, in the order found. Empty when the order is
 * valid at this snapshot. The contract can still reject a valid order at
 * submission if the ledger has since moved past `context.ledger`.
 *
 * Each issue's `code` names the market contract error it maps to:
 * - 0: `context.ledger` is not a valid u32 ledger sequence. An input error
 *   the contract never sees.
 * - 704 (`MarketFrozen`): `context.status` is `Frozen` or `Retired`.
 * - 710 (`NegativeValueNotAllowed`): a magnitude, `triggerPrice`, or
 *   `priceBound` is not a valid i128, or is negative.
 * - 712 (`NotionalAboveMaximum`): an increase's `notional` exceeds
 *   `context.config.maxPositionNotional`.
 * - 731 (`OrderExpired`): `expiration` is not a valid u32 ledger sequence,
 *   or is behind `context.ledger`.
 * - 732 (`InvalidOrder`): a moved `notional` or `margin` is below its dust
 *   floor, the order moves neither, or a trigger kind carries a
 *   `triggerPrice` of zero.
 * - 733 (`TooManyOrders`): the order is a decrease kind and
 *   `context.position` already holds `MAX_ORDERS_PER_SIDE` pending
 *   decrease orders.
 * - 734 (`UnknownKind`): `kind` is not one of the six `OrderKind` values.
 * - 740: `context.price` is set and its `bid` or `ask` is not positive, or
 *   `bid` exceeds `ask`. This code number coincides with
 *   `MarketError::StalePrice` but does not test staleness. A malformed
 *   price never reaches the market contract, since the oracle verifier
 *   rejects it first.
 * - 741 (`PriceBoundExceeded`): `context.price` is set, `kind` is a market
 *   kind, `priceBound` is positive, and the execution price would cross
 *   it.
 *
 * `IncreaseHalted` (#705) and every sizing, margin, and utilization gate
 * run only at fill, against the position the order would produce, and are
 * not previewed here.
 */
export function validateOrder(
    params: OrderParams,
    context: OrderValidationContext,
): OrderValidationIssue[] {
    const issues: OrderValidationIssue[] = [];

    let ledger: number | undefined;
    try {
        ledger = decodeLedgerSequence(context.ledger);
    } catch (error) {
        issues.push(
            issue(
                0,
                'batch',
                error instanceof Error
                    ? error.message
                    : 'invalid validation ledger',
            ),
        );
    }
    const minOrderNotional = context.config.minOrderNotional;
    const minOrderMargin = context.config.minOrderMargin;
    const maxPositionNotional = context.config.maxPositionNotional;

    const knownKind =
        typeof params.kind === 'number' &&
        Number.isInteger(params.kind) &&
        ORDER_KINDS.has(params.kind);
    if (!knownKind) {
        issues.push(issue(734, 'kind', 'unknown order kind'));
    }

    const notional = checkedAtomic(params.notional, 'notional', issues);
    const margin = checkedAtomic(params.margin, 'margin', issues);
    const triggerPrice = checkedAtomic(
        params.triggerPrice,
        'triggerPrice',
        issues,
    );
    const priceBound = checkedAtomic(params.priceBound, 'priceBound', issues);

    if (notional !== undefined && notional < 0n) {
        issues.push(issue(710, 'notional', 'notional must be nonnegative'));
    }
    if (margin !== undefined && margin < 0n) {
        issues.push(issue(710, 'margin', 'margin must be nonnegative'));
    }
    if (triggerPrice !== undefined && triggerPrice < 0n) {
        issues.push(
            issue(710, 'triggerPrice', 'trigger price must be nonnegative'),
        );
    }
    if (priceBound !== undefined && priceBound < 0n) {
        issues.push(
            issue(710, 'priceBound', 'price bound must be nonnegative'),
        );
    }

    if (notional !== undefined && notional > 0n && notional < minOrderNotional) {
        issues.push(
            issue(732, 'notional', 'notional is below the order dust floor'),
        );
    }
    if (
        margin !== undefined &&
        margin > 0n &&
        margin < minOrderMargin
    ) {
        issues.push(
            issue(
                732,
                'margin',
                'margin is below the order dust floor',
            ),
        );
    }
    if (notional === 0n && margin === 0n) {
        issues.push(issue(732, 'batch', 'order cannot be a no-op'));
    }

    if (knownKind) {
        const kind = params.kind as OrderKind;
        if (isTriggerOrderKind(kind) && triggerPrice === 0n) {
            issues.push(
                issue(
                    732,
                    'triggerPrice',
                    'trigger order requires a positive trigger price',
                ),
            );
        }
        if (
            isIncreaseOrderKind(kind) &&
            notional !== undefined &&
            notional > maxPositionNotional
        ) {
            issues.push(
                issue(
                    712,
                    'notional',
                    'increase exceeds maximum position notional',
                ),
            );
        }
        if (
            isDecreaseOrderKind(kind) &&
            context.position !== undefined &&
            context.position.decreaseOrders.length >= MAX_ORDERS_PER_SIDE
        ) {
            issues.push(
                issue(
                    733,
                    'kind',
                    'side already holds the maximum pending decrease orders',
                ),
            );
        }
    }

    if (!validU32(params.expiration)) {
        issues.push(
            issue(731, 'expiration', 'expiration must be a u32 ledger'),
        );
    } else if (ledger !== undefined && params.expiration < ledger) {
        issues.push(
            issue(
                731,
                'expiration',
                'order expiration is behind the snapshot ledger',
            ),
        );
    }

    if (context.status === Status.Frozen || context.status === Status.Retired) {
        issues.push(issue(704, 'batch', 'market status blocks order creation'));
    }

    if (context.price !== undefined) {
        const priceIssues = validatePrice(context.price);
        issues.push(...priceIssues);
        if (
            priceIssues.length === 0 &&
            knownKind &&
            isMarketOrderKind(params.kind as OrderKind) &&
            priceBound !== undefined &&
            priceBound > 0n
        ) {
            const executionPrice = orderExecutionPrice(
                params.kind as OrderKind,
                params.isLong,
                context.price,
            );
            const buy =
                isIncreaseOrderKind(params.kind as OrderKind) === params.isLong;
            const within = buy
                ? executionPrice <= priceBound
                : executionPrice >= priceBound;
            if (!within) {
                issues.push(
                    issue(
                        741,
                        'priceBound',
                        'market execution price exceeds price bound',
                    ),
                );
            }
        }
    }

    return issues;
}

/**
 * Decode a `create_order` `Call` back into `OrderParams`, so a trailing
 * order in a batch can be checked with `validateOrder` before submission.
 *
 * @throws {TypeError} if `call.func` is not `create_order`, or its
 * argument count is not eight.
 */
export function decodeCreateOrderCall(call: Call): OrderParams {
    if (call.func !== 'create_order') {
        throw new TypeError('call function must be create_order');
    }
    if (!Array.isArray(call.args) || call.args.length !== 8) {
        throw new TypeError(
            'create_order call must contain exactly eight arguments',
        );
    }
    const [
        ,
        isLong,
        kind,
        notional,
        margin,
        triggerPrice,
        priceBound,
        expiration,
    ] = call.args.map((arg) => scValToNative(arg));
    const decoded: OrderParams = {
        trading: Address.fromString(call.contract).toString(),
        user: Address.fromScVal(call.args[0]).toString(),
        isLong: isLong as boolean,
        kind: kind as OrderKind,
        notional: notional as bigint,
        margin: margin as bigint,
        triggerPrice: triggerPrice as bigint,
        priceBound: priceBound as bigint,
        expiration: expiration as number,
    };
    return decoded;
}
