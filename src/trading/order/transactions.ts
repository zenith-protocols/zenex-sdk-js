import {
    decodeLedgerSequence,
    exact,
    unavailable,
    type QuoteResult,
} from '../quote/result.js';
import { TradingContract } from '../../contracts/trading/trading_contract.js';
import {
    OrderKind,
    Status,
    VaultOrderKind,
} from '../../contracts/trading/trading_types.js';
import { TradingRouterContract } from '../../contracts/router/router_contract.js';
import {
    createOrderCall,
    type Call,
    type OrderParams,
} from '../../contracts/router/router_types.js';
import type {
    ExactVaultOrderCreationQuote,
    ExactVaultRestingOrderCreationQuote,
} from '../quote/vault.js';
import {
    decodeCreateOrderCall,
    validateOrder,
    type OrderValidationContext,
} from './validation.js';

const U32_MAX = 4_294_967_295;

export type ContractExecutionPolicy =
    | {
          kind: 'fillOrKill';
          transport: 'direct';
          keeper: string;
          price: Uint8Array;
      }
    | { kind: 'restOnly'; transport: 'direct' };

interface PreparedExecutionBase {
    policy: ContractExecutionPolicy['kind'];
    operationXdr: string;
}

export type PreparedExecution = PreparedExecutionBase & {
    transport: 'direct';
};

export interface BuildOrderOperationInput {
    tradingAddress: string;
    /** Required for fill-or-kill execution. */
    routerAddress?: string;
    user: string;
    order: OrderParams;
    /** Optional calls after the one primary order. */
    calls?: Call[];
    policy: ContractExecutionPolicy;
    validation: OrderValidationContext;
}

export type VaultRestOnlyExecutionPolicy = Extract<
    ContractExecutionPolicy,
    { kind: 'restOnly' }
>;

/** A rest-only policy: a price-free create that a keeper fills later. */
export type RestOnlyExecutionPolicy = Extract<
    ContractExecutionPolicy,
    { kind: 'restOnly' }
>;

export interface BuildRestingMarketOrderInput {
    tradingAddress: string;
    user: string;
    /** A `MarketIncrease`/`MarketDecrease` order with `priceBound` as its guard. */
    order: OrderParams;
    policy: RestOnlyExecutionPolicy;
    validation: OrderValidationContext;
}

export interface BuildVaultOrderOperationInput {
    tradingAddress: string;
    user: string;
    quote: ExactVaultRestingOrderCreationQuote;
    policy: VaultRestOnlyExecutionPolicy;
}

export type PreparedVaultRestingExecution = PreparedExecution & {
    action: 'resting';
    vaultAction: 'deposit' | 'redeem';
    policy: 'restOnly';
};

export interface PreparedVaultRetiredImmediateRedeemExecution {
    action: 'retiredImmediateRedeem';
    policy: 'retiredImmediateRedeem';
    transport: 'direct';
    operationXdr: string;
}

export type PreparedVaultActionExecution =
    | PreparedVaultRestingExecution
    | PreparedVaultRetiredImmediateRedeemExecution;

export interface BuildVaultActionExecutionInput {
    tradingAddress: string;
    user: string;
    quote: ExactVaultOrderCreationQuote;
    /** Required for a resting action and forbidden for Retired redemption. */
    policy?: VaultRestOnlyExecutionPolicy;
}

function validU32(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0 && value <= U32_MAX;
}

function priceBytes(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array && value.byteLength > 0;
}

function invalid(reason: string): QuoteResult<PreparedExecution> {
    return unavailable('INVALID_INPUT', reason);
}

function preparedExecution(
    policy: ContractExecutionPolicy,
    operationXdr: string,
): PreparedExecution {
    return { policy: policy.kind, transport: 'direct', operationXdr };
}

function validateVaultCreationQuote(
    quote: ExactVaultRestingOrderCreationQuote,
): string | undefined {
    if (quote.kind !== 'exact' || quote.value.kind !== 'resting') {
        return 'vault order execution requires an exact resting creation quote';
    }
    return undefined;
}

function validateRetiredVaultCreationQuote(
    quote: ExactVaultOrderCreationQuote,
): string | undefined {
    if (
        quote.kind !== 'exact' ||
        quote.value.kind !== 'retiredImmediateRedeem'
    ) {
        return 'an exact Retired redemption quote is required';
    }
    return undefined;
}

function firstIssue(
    issues: ReturnType<typeof validateOrder>,
): QuoteResult<PreparedExecution> | undefined {
    const current = issues[0];
    if (current === undefined) return undefined;
    const prefix =
        current.code === 0 ? '' : `contract error #${current.code}: `;
    return unavailable(
        current.code === 0 ? 'INVALID_INPUT' : 'CONTRACT_GATE',
        `${prefix}${current.reason}`,
    );
}

function validatePolicy(
    policy: ContractExecutionPolicy,
    context: OrderValidationContext,
): string | undefined {
    if (policy.kind === 'restOnly') return undefined;
    if (!priceBytes(policy.price)) {
        return 'fill-or-kill requires a nonempty serialized price update no larger than 32 KiB';
    }
    if (context.price === undefined) {
        return 'fill-or-kill requires a verified market price in the validation snapshot';
    }
    // The keeper splices its own signed price (`policy.price`) at fill; it need
    // not equal the snapshot's placeholder bytes. Pricing integrity is enforced
    // by the synthesized `context.price` and the order's on-chain price bound,
    // not by matching opaque update bytes, which do not carry the mark.
    return undefined;
}

function validateTrailingOrders(
    calls: readonly Call[],
    context: OrderValidationContext,
): QuoteResult<PreparedExecution> | undefined {
    for (const call of calls) {
        if (call.func !== 'create_order') continue;
        try {
            const result = firstIssue(
                validateOrder(decodeCreateOrderCall(call), context),
            );
            if (result !== undefined) return result;
        } catch (error) {
            return invalid(
                error instanceof Error
                    ? error.message
                    : 'invalid trailing order call',
            );
        }
    }
    return undefined;
}

/** Build exactly the operation selected by the caller's explicit policy. */
export function buildOrderOperation(
    input: BuildOrderOperationInput,
): QuoteResult<PreparedExecution> {
    try {
        const policyError = validatePolicy(input.policy, input.validation);
        if (policyError !== undefined) return invalid(policyError);

        const orderError = firstIssue(
            validateOrder(input.order, input.validation),
        );
        if (orderError !== undefined) return orderError;

        if (input.policy.kind === 'restOnly') {
            if (
                input.order.kind === OrderKind.MarketIncrease ||
                input.order.kind === OrderKind.MarketDecrease
            ) {
                return invalid(
                    'rest-only execution requires a limit or stop order',
                );
            }
            const trading = new TradingContract(input.tradingAddress);
            const operationXdr = trading.createOrder(
                input.order.user,
                input.order.isLong,
                input.order.kind,
                input.order.notional,
                input.order.margin,
                input.order.triggerPrice,
                input.order.priceBound,
                input.order.expiration,
            );
            return exact(
                preparedExecution(input.policy, operationXdr),
                input.validation.ledger,
            );
        }

        if (typeof input.routerAddress !== 'string') {
            return invalid(
                'routerAddress is required for fill-or-kill execution',
            );
        }

        if (
            input.order.kind === OrderKind.MarketIncrease &&
            input.validation.status !== Status.Active
        ) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #705: market status blocks position increases',
            );
        }

        const calls = [createOrderCall(input.order), ...(input.calls ?? [])];
        const trailingError = validateTrailingOrders(
            calls.slice(1),
            input.validation,
        );
        if (trailingError !== undefined) return trailingError;

        const router = new TradingRouterContract(input.routerAddress);
        const operationXdr = router.createAndFill(
            calls,
            input.user,
            input.policy.keeper,
            input.policy.price,
        );
        return exact(
            preparedExecution(input.policy, operationXdr),
            input.validation.ledger,
        );
    } catch (error) {
        return invalid(
            error instanceof Error
                ? error.message
                : 'could not build order operation',
        );
    }
}

/**
 * Build a price-free resting market order for keeper execution.
 *
 * This is the non-auth-wallet fallback: a user who cannot co-sign a Router
 * fill-or-kill still opens or adjusts a position by resting a
 * `MarketIncrease`/`MarketDecrease` create_order that a keeper fills at the
 * prevailing mark. No signed price update is embedded here — the keeper splices
 * the verified price at fill time — so `priceBound` is the on-chain slippage
 * guard that caps the fill's adverse price. Unlike a limit/stop resting order,
 * a market order carries no trigger, so `triggerPrice` must be zero.
 */
export function buildRestingMarketOrderOperation(
    input: BuildRestingMarketOrderInput,
): QuoteResult<PreparedExecution> {
    try {
        if (input.policy.kind !== 'restOnly') {
            return invalid(
                'resting market order requires rest-only execution',
            );
        }
        if (
            input.order.kind !== OrderKind.MarketIncrease &&
            input.order.kind !== OrderKind.MarketDecrease
        ) {
            return invalid(
                'resting market order requires a market increase or decrease',
            );
        }
        // A market order has no trigger; the slippage guard is mandatory.
        if (input.order.triggerPrice !== 0n) {
            return invalid('resting market order must not carry a trigger price');
        }
        if (input.order.priceBound <= 0n) {
            return invalid(
                'resting market order requires a positive price bound as its slippage guard',
            );
        }

        // Validate the price-free create_order gates: a keeper supplies the mark
        // at fill, so the build carries no verified price of its own.
        const priceFreeValidation: OrderValidationContext = {
            ...input.validation,
            price: undefined,
            priceUpdate: undefined,
        };
        const orderError = firstIssue(
            validateOrder(input.order, priceFreeValidation),
        );
        if (orderError !== undefined) return orderError;

        const operationXdr = new TradingContract(
            input.tradingAddress,
        ).createOrder(
            input.order.user,
            input.order.isLong,
            input.order.kind,
            input.order.notional,
            input.order.margin,
            input.order.triggerPrice,
            input.order.priceBound,
            input.order.expiration,
        );

        return exact(
            preparedExecution(input.policy, operationXdr),
            input.validation.ledger,
        );
    } catch (error) {
        return invalid(
            error instanceof Error
                ? error.message
                : 'could not build resting market order operation',
        );
    }
}

/** Build exactly one price-free vault order from an exact creation quote. */
export function buildVaultOrderOperation(
    input: BuildVaultOrderOperationInput,
): QuoteResult<PreparedExecution> {
    try {
        if (input.policy.kind !== 'restOnly') {
            return invalid('vault order creation requires rest-only execution');
        }
        const quoteError = validateVaultCreationQuote(input.quote);
        if (quoteError !== undefined) return invalid(quoteError);

        const trading = new TradingContract(input.tradingAddress);
        const creation = input.quote.value;
        const kind =
            creation.action === 'deposit'
                ? VaultOrderKind.Deposit
                : VaultOrderKind.Redeem;
        const operationXdr = trading.createVaultOrder(
            input.user,
            kind,
            creation.amount,
            creation.minOut,
        );

        return exact(
            preparedExecution(input.policy, operationXdr),
            input.quote.ledger,
        );
    } catch (error) {
        return invalid(
            error instanceof Error
                ? error.message
                : 'could not build vault order operation',
        );
    }
}

function invalidVaultAction(
    reason: string,
): QuoteResult<PreparedVaultActionExecution> {
    return unavailable('INVALID_INPUT', reason);
}

/**
 * Prepare one exact vault action without conflating a resting order with the
 * direct-only Retired redemption path.
 */
export function buildVaultActionExecution(
    input: BuildVaultActionExecutionInput,
): QuoteResult<PreparedVaultActionExecution> {
    try {
        const quote = input.quote;
        if (quote.kind !== 'exact') {
            return invalidVaultAction(
                'an exact vault action quote is required',
            );
        }

        const creation = quote.value;
        if (creation.kind === 'resting') {
            if (input.policy === undefined) {
                return invalidVaultAction(
                    'resting vault action requires rest-only execution',
                );
            }
            const restingQuote: ExactVaultRestingOrderCreationQuote = {
                ...quote,
                value: creation,
            };
            const prepared = buildVaultOrderOperation({
                tradingAddress: input.tradingAddress,
                user: input.user,
                quote: restingQuote,
                policy: input.policy,
            });
            if (prepared.kind !== 'exact') {
                return prepared as QuoteResult<PreparedVaultActionExecution>;
            }
            return exact(
                {
                    ...prepared.value,
                    action: 'resting',
                    vaultAction: creation.action,
                    policy: 'restOnly',
                },
                prepared.ledger,
            );
        }

        if (input.policy !== undefined) {
            return invalidVaultAction(
                'Retired vault redemption is direct only and accepts no execution policy',
            );
        }
        const quoteError = validateRetiredVaultCreationQuote(quote);
        if (quoteError !== undefined) return invalidVaultAction(quoteError);

        const operationXdr = new TradingContract(
            input.tradingAddress,
        ).createVaultOrder(
            input.user,
            VaultOrderKind.Redeem,
            creation.shares,
            0n,
        );
        return exact(
            {
                action: 'retiredImmediateRedeem',
                policy: 'retiredImmediateRedeem',
                transport: 'direct',
                operationXdr,
            },
            quote.ledger,
        );
    } catch (error) {
        return invalidVaultAction(
            error instanceof Error
                ? error.message
                : 'could not build vault action execution',
        );
    }
}
