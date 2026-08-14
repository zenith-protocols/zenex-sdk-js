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

export interface OrderValidationIssue {
    code: number;
    field: keyof OrderParams | 'batch';
    reason: string;
}

export interface OrderValidationContext {
    ledger: number;
    now: bigint;
    status: Status;
    config: TradingConfig;
    price?: PriceData;
    /**
     * Serialized update submitted when `price` was loaded; terminal markets
     * ignore the payload by contract design.
     */
    priceUpdate?: Uint8Array;
    /**
     * The side's stored position. When present, decrease kinds preflight the
     * `MAX_ORDERS_PER_SIDE` pending-decrease cap (#733) that `create_order`
     * enforces when it appends to `decrease_orders`.
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

/** Mirror the price-free create_order checks and market-order price bound. */
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
