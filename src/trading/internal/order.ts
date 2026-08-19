import type { Call, OrderParams } from '../../contracts/router/types.js';
import { FULL_CLOSE, MAX_ORDERS_PER_SIDE, OrderKind, Status, VaultOrderKind } from '../../contracts/market/types.js';
import type { Position, MarketConfig } from '../../contracts/market/types.js';
import type { i128, u32 } from '../../index.js';
import { checkedI128 } from '../../math/fixed.js';
import type { PriceData } from './math.js';
import { decodeLedgerSequence } from './quote.js';

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

// =============================================================================
// Argument interfaces
// =============================================================================

/**
 * Fields every position order carries, whatever its kind. Every builder below
 * returns `OrderParams` data, not XDR. Pass the result to `buildOrderOperation`,
 * which validates it against a ledger snapshot before submission.
 */
export interface OrderIntentBase {
    /** The market contract the order is created on. */
    market: string;
    /** The order owner. */
    user: string;
    /** Side the order targets. */
    isLong: boolean;
    /** Ledger sequence; eligible while the current sequence <= expiration. */
    expiration: u32;
}

/** Open a position at market (no trigger). */
export interface OpenMarketArgs extends OrderIntentBase {
    /** Size to open, token-dec. */
    notional: i128;
    /** Margin to escrow with the position, token-dec. */
    margin: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Open a position once the trigger price is crossed. */
export interface OpenLimitArgs extends OrderIntentBase {
    /** Size to open once the order fills, token-dec. */
    notional: i128;
    /** Margin to escrow with the position, token-dec. */
    margin: i128;
    /** Crossing price that makes the order eligible, price_scalar. Must be positive. */
    triggerPrice: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Fully close a position at market. */
export interface ClosePositionArgs extends OrderIntentBase {
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Decrease a position at market, optionally withdrawing margin. */
export interface DecreasePositionArgs extends OrderIntentBase {
    /** Size to close, token-dec. A value at or above the open size closes it fully. */
    notional: i128;
    /** Margin to withdraw, token-dec. 0 keeps the current margin. */
    margin: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Margin-only order (notional 0): add or withdraw margin without changing size. */
export interface ModifyMarginArgs extends OrderIntentBase {
    /** Margin to add or withdraw, token-dec. Always positive; the builder sets the direction. */
    amount: i128;
}

/** A take-profit or stop-loss trigger order. */
export interface TriggerOrderArgs extends OrderIntentBase {
    /** Crossing price that makes the order eligible, price_scalar. Must be positive. */
    triggerPrice: i128;
    /** Size to close on trigger, token-dec. Defaults to `FULL_CLOSE`, which closes the whole position. */
    notional?: i128;
    /** Fill slippage limit, price_scalar. 0 = unbounded. */
    priceBound: i128;
}

/** Deposit assets into the vault. */
export interface VaultDepositArgs {
    /** The market contract the order is created on. */
    market: string;
    /** The order owner. */
    user: string;
    /** Assets to deposit, token-dec. */
    amount: i128;
    /** Minimum shares received at fill, net of the deposit fee; 0 = unset. */
    minOut: i128;
}

/** Redeem vault shares for assets. */
export interface VaultRedeemArgs {
    /** The market contract the order is created on. */
    market: string;
    /** The order owner. */
    user: string;
    /** Shares to redeem, vault share decimals. */
    shares: i128;
    /** Minimum assets received at fill, net of the redeem fee; 0 = unset. */
    minOut: i128;
}

/** Arguments of a `create_vault_order` call, as data. */
export interface VaultOrderParams {
    /** The target market contract the `create_vault_order` runs on. */
    market: string;
    /** The order owner. */
    user: string;
    /** Deposit or Redeem. */
    kind: VaultOrderKind;
    /** Assets to deposit, token-dec, or shares to redeem, vault share decimals. */
    amount: i128;
    /** Minimum output at fill, net of the vault fee; 0 = unset. */
    minOut: i128;
}

// =============================================================================
// Position orders
// =============================================================================

/**
 * Open or add to a position at market (`MarketIncrease`). Fills `notional`,
 * `margin`, and `priceBound` from the caller. `triggerPrice` is always 0; a
 * market kind never reads it.
 */
export function openMarketParams(args: OpenMarketArgs): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketIncrease,
        notional: args.notional,
        margin: args.margin,
        triggerPrice: 0n,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Open a position once the trigger price is crossed favorably
 * (`LimitIncrease`): a long buys at-or-below the trigger, a short sells
 * at-or-above it.
 */
export function openLimitParams(args: OpenLimitArgs): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.LimitIncrease,
        notional: args.notional,
        margin: args.margin,
        triggerPrice: args.triggerPrice,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Fully close a position at market (`MarketDecrease`). `notional` is always
 * `FULL_CLOSE`, which tells the contract to close the entire position.
 * `margin` is always 0, so nothing is withdrawn beyond the closed proceeds.
 * `triggerPrice` is always 0; a market kind never reads it.
 */
export function closePositionParams(args: ClosePositionArgs): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketDecrease,
        notional: FULL_CLOSE,
        margin: 0n,
        triggerPrice: 0n,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Decrease a position at market (`MarketDecrease`), optionally withdrawing
 * margin. `triggerPrice` is always 0; a market kind never reads it.
 */
export function decreasePositionParams(
    args: DecreasePositionArgs,
): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketDecrease,
        notional: args.notional,
        margin: args.margin,
        triggerPrice: 0n,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Add margin to a position without changing its size (`MarketIncrease` with
 * `notional` fixed at 0). `triggerPrice` is always 0 and unread by a market
 * kind. `priceBound` is always 0, so the fill has no slippage limit.
 */
export function addMarginParams(args: ModifyMarginArgs): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketIncrease,
        notional: 0n,
        margin: args.amount,
        triggerPrice: 0n,
        priceBound: 0n,
        expiration: args.expiration,
    };
}

/**
 * Withdraw margin from a position without changing its size (`MarketDecrease`
 * with `notional` fixed at 0). `triggerPrice` is always 0 and unread by a
 * market kind. `priceBound` is always 0, so the fill has no slippage limit.
 */
export function withdrawMarginParams(args: ModifyMarginArgs): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.MarketDecrease,
        notional: 0n,
        margin: args.amount,
        triggerPrice: 0n,
        priceBound: 0n,
        expiration: args.expiration,
    };
}

/**
 * Place a take-profit trigger (`LimitDecrease`): closes size when the price
 * crosses `triggerPrice` favorably, upside for a long and downside for a
 * short. `margin` is always 0; a trigger order never withdraws margin.
 */
export function takeProfitParams(args: TriggerOrderArgs): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.LimitDecrease,
        notional: args.notional ?? FULL_CLOSE,
        margin: 0n,
        triggerPrice: args.triggerPrice,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

/**
 * Place a stop-loss trigger (`StopDecrease`): closes size when the price
 * crosses `triggerPrice` adversely, downside for a long and upside for a
 * short. `margin` is always 0; a trigger order never withdraws margin.
 */
export function stopLossParams(args: TriggerOrderArgs): OrderParams {
    return {
        market: args.market,
        user: args.user,
        isLong: args.isLong,
        kind: OrderKind.StopDecrease,
        notional: args.notional ?? FULL_CLOSE,
        margin: 0n,
        triggerPrice: args.triggerPrice,
        priceBound: args.priceBound,
        expiration: args.expiration,
    };
}

// =============================================================================
// Vault orders
// =============================================================================

/** Deposit assets into the vault for the keeper to fill. */
export function vaultDepositParams(args: VaultDepositArgs): VaultOrderParams {
    return {
        market: args.market,
        user: args.user,
        kind: VaultOrderKind.Deposit,
        amount: args.amount,
        minOut: args.minOut,
    };
}

/**
 * Redeem vault shares for assets, for the keeper to fill. The share count
 * travels in the same `amount` argument a deposit uses for assets.
 */
export function vaultRedeemParams(args: VaultRedeemArgs): VaultOrderParams {
    return {
        market: args.market,
        user: args.user,
        kind: VaultOrderKind.Redeem,
        amount: args.shares,
        minOut: args.minOut,
    };
}
import { Address, scValToNative } from '@stellar/stellar-sdk';

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
    /** The market contract error code this failure maps to. */
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
    config: MarketConfig;
    /**
     * Verified market price at the snapshot. Omit it to skip the price
     * checks: the malformed-price check and, for a market order, the price
     * bound check both need it.
     */
    price?: PriceData;
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
        market: Address.fromString(call.contract).toString(),
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
