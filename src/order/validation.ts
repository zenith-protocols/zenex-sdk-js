import { Address, StrKey, scValToNative } from '@stellar/stellar-sdk';
import { checkedI128 } from '../math/fixed.js';
import type { VerifiedPrice } from '../market/types.js';
import { decodeLedgerSequence } from '../quote/result.js';
import {
    OrderKind,
    Status,
    type TradingConfig,
} from '../trading/trading_types.js';
import type { Call, OrderParams } from '../trading-router/router_types.js';

const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;
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
    price?: VerifiedPrice;
    /**
     * Serialized update submitted when `price` was loaded. Pyth markets
     * verify it; terminal markets ignore the payload by contract design.
     */
    priceUpdate?: Uint8Array;
}

export interface StrictMarketIdentity {
    tradingAddress: string;
    user: string;
    isLong: boolean;
}

function issue(
    code: number,
    field: OrderValidationIssue['field'],
    reason: string,
): OrderValidationIssue {
    return { code, field, reason };
}

function validAddress(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        Address.fromString(value);
        return true;
    } catch {
        return false;
    }
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

function isIncrease(kind: OrderKind): boolean {
    return (
        kind === OrderKind.MarketIncrease ||
        kind === OrderKind.LimitIncrease ||
        kind === OrderKind.StopIncrease
    );
}

function isMarket(kind: OrderKind): boolean {
    return (
        kind === OrderKind.MarketIncrease || kind === OrderKind.MarketDecrease
    );
}

function isTrigger(kind: OrderKind): boolean {
    return !isMarket(kind);
}

export function orderExecutionPrice(
    kind: OrderKind,
    isLong: boolean,
    price: VerifiedPrice,
): bigint {
    if (isIncrease(kind)) return isLong ? price.ask : price.bid;
    return isLong ? price.bid : price.ask;
}

function validatePrice(
    price: VerifiedPrice,
    now: bigint,
): OrderValidationIssue[] {
    if (
        !validU32(price.feedId) ||
        typeof price.exponent !== 'number' ||
        !Number.isSafeInteger(price.exponent) ||
        price.exponent < -2_147_483_648 ||
        price.exponent > 2_147_483_647 ||
        typeof price.bid !== 'bigint' ||
        typeof price.ask !== 'bigint' ||
        price.bid <= 0n ||
        price.ask <= 0n ||
        price.bid > price.ask ||
        typeof price.publishTime !== 'bigint' ||
        price.publishTime < 0n ||
        price.publishTime > U64_MAX ||
        price.publishTime > now ||
        (price.source !== 'pyth' && price.source !== 'terminal')
    ) {
        return [
            issue(
                740,
                'batch',
                'market price is malformed or newer than the validation snapshot',
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

    if (!params || typeof params !== 'object') {
        return [issue(0, 'batch', 'order params must be an object')];
    }
    if (!context || typeof context !== 'object') {
        return [issue(0, 'batch', 'validation context must be an object')];
    }

    if (!StrKey.isValidContract(params.trading)) {
        issues.push(issue(0, 'trading', 'trading must be a valid contract ID'));
    }
    if (!validAddress(params.user)) {
        issues.push(issue(0, 'user', 'user must be a valid Stellar address'));
    }
    if (typeof params.isLong !== 'boolean') {
        issues.push(issue(0, 'isLong', 'isLong must be a boolean'));
    }

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
    if (
        typeof context.now !== 'bigint' ||
        context.now < 0n ||
        context.now > U64_MAX
    ) {
        issues.push(
            issue(0, 'batch', 'validation time must be a nonnegative u64'),
        );
    }
    if (
        context.status !== Status.Active &&
        context.status !== Status.OnIce &&
        context.status !== Status.Frozen &&
        context.status !== Status.Delisted &&
        context.status !== Status.Retired
    ) {
        issues.push(issue(702, 'batch', 'validation status is unknown'));
    }

    let minOrderNotional: bigint | undefined;
    let minOrderCollateral: bigint | undefined;
    let maxPositionNotional: bigint | undefined;
    try {
        minOrderNotional = checkedI128(context.config.minOrderNotional);
        minOrderCollateral = checkedI128(context.config.minOrderCollateral);
        maxPositionNotional = checkedI128(context.config.maxPositionNotional);
        if (
            minOrderNotional <= 0n ||
            minOrderCollateral <= 0n ||
            maxPositionNotional <= 0n
        ) {
            throw new RangeError(
                'order validation config bounds must be positive',
            );
        }
    } catch (error) {
        issues.push(
            issue(
                700,
                'batch',
                error instanceof Error
                    ? error.message
                    : 'order validation config is invalid',
            ),
        );
    }

    const knownKind =
        typeof params.kind === 'number' &&
        Number.isInteger(params.kind) &&
        ORDER_KINDS.has(params.kind);
    if (!knownKind) {
        issues.push(issue(734, 'kind', 'unknown order kind'));
    }

    const notional = checkedAtomic(params.notional, 'notional', issues);
    const collateral = checkedAtomic(params.collateral, 'collateral', issues);
    const triggerPrice = checkedAtomic(
        params.triggerPrice,
        'triggerPrice',
        issues,
    );
    const priceBound = checkedAtomic(params.priceBound, 'priceBound', issues);

    if (notional !== undefined && notional < 0n) {
        issues.push(issue(710, 'notional', 'notional must be nonnegative'));
    }
    if (collateral !== undefined && collateral < 0n) {
        issues.push(issue(710, 'collateral', 'collateral must be nonnegative'));
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

    if (
        notional !== undefined &&
        notional > 0n &&
        minOrderNotional !== undefined &&
        notional < minOrderNotional
    ) {
        issues.push(
            issue(732, 'notional', 'notional is below the order dust floor'),
        );
    }
    if (
        collateral !== undefined &&
        collateral > 0n &&
        minOrderCollateral !== undefined &&
        collateral < minOrderCollateral
    ) {
        issues.push(
            issue(
                732,
                'collateral',
                'collateral is below the order dust floor',
            ),
        );
    }
    if (notional === 0n && collateral === 0n) {
        issues.push(issue(732, 'batch', 'order cannot be a no-op'));
    }

    if (knownKind) {
        const kind = params.kind as OrderKind;
        if (isTrigger(kind) && triggerPrice === 0n) {
            issues.push(
                issue(
                    732,
                    'triggerPrice',
                    'trigger order requires a positive trigger price',
                ),
            );
        }
        if (
            isIncrease(kind) &&
            notional !== undefined &&
            maxPositionNotional !== undefined &&
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
        const priceIssues = validatePrice(context.price, context.now);
        issues.push(...priceIssues);
        if (
            priceIssues.length === 0 &&
            knownKind &&
            isMarket(params.kind as OrderKind) &&
            priceBound !== undefined &&
            priceBound > 0n
        ) {
            const executionPrice = orderExecutionPrice(
                params.kind as OrderKind,
                params.isLong,
                context.price,
            );
            const buy = isIncrease(params.kind as OrderKind) === params.isLong;
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
        user,
        isLong,
        kind,
        notional,
        collateral,
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
        collateral: collateral as bigint,
        triggerPrice: triggerPrice as bigint,
        priceBound: priceBound as bigint,
        expiration: expiration as number,
    };
    if (user !== decoded.user) {
        throw new TypeError(
            'create_order user could not be decoded canonically',
        );
    }
    return decoded;
}

function validatePrimary(
    call: Call,
    expected: StrictMarketIdentity,
): OrderValidationIssue[] {
    const issues: OrderValidationIssue[] = [];
    let decoded: OrderParams;
    try {
        decoded = decodeCreateOrderCall(call);
    } catch (error) {
        return [
            issue(
                0,
                'batch',
                error instanceof Error
                    ? error.message
                    : 'malformed primary call',
            ),
        ];
    }
    if (decoded.trading !== expected.tradingAddress) {
        issues.push(
            issue(0, 'batch', 'primary call targets a different market'),
        );
    }
    if (decoded.user !== expected.user) {
        issues.push(issue(0, 'batch', 'primary call embeds a different user'));
    }
    if (decoded.isLong !== expected.isLong) {
        issues.push(issue(0, 'batch', 'primary call embeds a different side'));
    }
    if (
        decoded.kind !== OrderKind.MarketIncrease &&
        decoded.kind !== OrderKind.MarketDecrease
    ) {
        issues.push(issue(0, 'batch', 'primary call must be a market order'));
    }
    return issues;
}

function validateCancel(
    call: Call,
    expected: StrictMarketIdentity,
): OrderValidationIssue[] {
    try {
        if (call.contract !== expected.tradingAddress) {
            throw new TypeError('cancellation targets a different market');
        }
        if (!Array.isArray(call.args) || call.args.length !== 2) {
            throw new TypeError(
                'cancel_order call must contain exactly two arguments',
            );
        }
        if (Address.fromScVal(call.args[0]).toString() !== expected.user) {
            throw new TypeError('cancellation embeds a different user');
        }
        const id = scValToNative(call.args[1]);
        if (!validU32(id)) throw new TypeError('cancellation id must be a u32');
        return [];
    } catch (error) {
        return [
            issue(
                0,
                'batch',
                error instanceof Error
                    ? error.message
                    : 'malformed cancellation call',
            ),
        ];
    }
}

function validateTrailingCreate(
    call: Call,
    expected: StrictMarketIdentity,
): OrderValidationIssue[] {
    try {
        const decoded = decodeCreateOrderCall(call);
        if (decoded.trading !== expected.tradingAddress) {
            throw new TypeError('trailing order targets a different market');
        }
        if (decoded.user !== expected.user) {
            throw new TypeError('trailing order embeds a different user');
        }
        if (decoded.isLong !== expected.isLong) {
            throw new TypeError('trailing order embeds a different side');
        }
        if (
            decoded.kind !== OrderKind.LimitDecrease &&
            decoded.kind !== OrderKind.StopDecrease
        ) {
            throw new TypeError(
                'trailing order must be a limit or stop decrease',
            );
        }
        return [];
    } catch (error) {
        return [
            issue(
                0,
                'batch',
                error instanceof Error
                    ? error.message
                    : 'malformed trailing order',
            ),
        ];
    }
}

/** Validate the one-primary-market grammar before a Router fill invocation. */
export function validateFillOrKillCalls(
    calls: readonly Call[],
    expected: StrictMarketIdentity,
): OrderValidationIssue[] {
    if (!Array.isArray(calls) || calls.length === 0) {
        return [issue(0, 'batch', 'fill-or-kill requires one primary call')];
    }
    if (
        !StrKey.isValidContract(expected.tradingAddress) ||
        !validAddress(expected.user) ||
        typeof expected.isLong !== 'boolean'
    ) {
        return [issue(0, 'batch', 'expected market identity is invalid')];
    }

    const issues = validatePrimary(calls[0], expected);
    for (const call of calls.slice(1)) {
        if (call.func === 'cancel_order') {
            issues.push(...validateCancel(call, expected));
        } else if (call.func === 'create_order') {
            issues.push(...validateTrailingCreate(call, expected));
        } else {
            issues.push(
                issue(
                    0,
                    'batch',
                    `trailing function ${String(call.func)} is not allowed`,
                ),
            );
        }
    }
    return issues;
}
