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

/**
 * How `buildOrderOperation` and `buildRestingMarketOrderOperation` submit
 * the built operation.
 *
 * `fillOrKill` batches `create_order` with an immediate Router fill in one
 * transaction. It needs `price`, a nonempty signed price update, and
 * `keeper`, the address credited the fill reward. `buildOrderOperation`
 * does not restrict the order kind for this policy.
 *
 * `restOnly` creates the order alone, for a keeper to fill later, and
 * carries no price. `buildOrderOperation` accepts it only for a limit or
 * stop order and rejects a market order as `INVALID_INPUT`.
 * `buildRestingMarketOrderOperation` accepts it only for a price-free
 * resting market order, the fallback for a caller that cannot co-sign a
 * Router fill.
 */
export type ContractExecutionPolicy =
    | {
          kind: 'fillOrKill';
          transport: 'direct';
          keeper: string;
          price: Uint8Array;
      }
    | { kind: 'restOnly'; transport: 'direct' };

interface PreparedExecutionBase {
    /** The policy kind used to build this operation. */
    policy: ContractExecutionPolicy['kind'];
    /** The built operation, base64 XDR, ready to add to a transaction. Not yet submitted or signed. */
    operationXdr: string;
}

/** A built order operation, ready to add to a transaction envelope. */
export type PreparedExecution = PreparedExecutionBase & {
    transport: 'direct';
};

export interface BuildOrderOperationInput {
    /** The trading contract that will create the order. */
    tradingAddress: string;
    /** Required for fill-or-kill execution. */
    routerAddress?: string;
    /** The order owner; must authorize the built operation. */
    user: string;
    /** The order to submit. */
    order: OrderParams;
    /** Optional calls after the one primary order. */
    calls?: Call[];
    /** How to submit the order. See `ContractExecutionPolicy` for which order kinds each policy accepts. */
    policy: ContractExecutionPolicy;
    /** The ledger snapshot to check `order` against before building the operation. */
    validation: OrderValidationContext;
}

/** The rest-only policy, narrowed for building a vault order. */
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
    /** The trading contract that will create the order. */
    tradingAddress: string;
    /** The order owner; must authorize the built operation. */
    user: string;
    /** A `MarketIncrease`/`MarketDecrease` order with `priceBound` as its guard. */
    order: OrderParams;
    /** Always 'restOnly'; carried onto the returned operation's `policy` field. */
    policy: RestOnlyExecutionPolicy;
    /**
     * The ledger snapshot to check `order` against. Its `price` and
     * `priceUpdate` are cleared before the check runs, so a `price` on the
     * snapshot has no effect here.
     */
    validation: OrderValidationContext;
}

export interface BuildVaultOrderOperationInput {
    /** The trading contract that will create the vault order. */
    tradingAddress: string;
    /** The vault order owner; must authorize the built operation. */
    user: string;
    /** The exact resting creation quote to build from. */
    quote: ExactVaultRestingOrderCreationQuote;
    /** Must be `restOnly`; a vault order carries no price. */
    policy: VaultRestOnlyExecutionPolicy;
}

/** A built resting vault deposit or redeem, ready to add to a transaction envelope. */
export type PreparedVaultRestingExecution = PreparedExecution & {
    action: 'resting';
    /** Which vault action was built: deposit or redeem. */
    vaultAction: 'deposit' | 'redeem';
    policy: 'restOnly';
};

/**
 * A built Retired-market redeem, ready to add to a transaction envelope.
 * Executes in the same call once submitted; no keeper fill follows.
 */
export interface PreparedVaultRetiredImmediateRedeemExecution {
    action: 'retiredImmediateRedeem';
    policy: 'retiredImmediateRedeem';
    transport: 'direct';
    /** The built operation, base64 XDR, ready to add to a transaction. Not yet submitted or signed. */
    operationXdr: string;
}

/** The result of `buildVaultActionExecution`: a resting order, or an immediate Retired-market redeem. */
export type PreparedVaultActionExecution =
    | PreparedVaultRestingExecution
    | PreparedVaultRetiredImmediateRedeemExecution;

export interface BuildVaultActionExecutionInput {
    /** The trading contract that will create the vault order. */
    tradingAddress: string;
    /** The vault order owner; must authorize the built operation. */
    user: string;
    /** The exact vault action quote to build from: a resting deposit or redeem, or a Retired-market immediate redeem. */
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

/**
 * Check an order against a ledger snapshot and build the operation its
 * policy selects. A `fillOrKill` policy builds an atomic Router
 * create-and-fill. A `restOnly` policy builds a create alone, for a keeper
 * to fill later.
 *
 * Runs `validateOrder(input.order, input.validation)` first. Any failed
 * check blocks the build, including a `Frozen` or `Retired` status
 * (contract error #704). A `restOnly` policy also needs a limit or stop
 * order; a market order with `restOnly` is rejected as `INVALID_INPUT`.
 * A `fillOrKill` policy needs `input.routerAddress`. For a
 * `MarketIncrease` under `fillOrKill`, the build then also checks that
 * `input.validation.status` is `Active`, catching `OnIce` and `Delisted`
 * (contract error #705; `Frozen` and `Retired` were already caught by
 * `validateOrder`). This check does not read `notional`, so it also
 * blocks a zero-notional, margin-only increase that the market contract
 * itself would allow while only opens are blocked. Every `create_order`
 * call in `input.calls` after the first is checked with the same gates as
 * the primary order; any other call passes through unchecked.
 *
 * @returns An `exact` QuoteResult holding the built operation as base64
 * XDR, bound to `input.validation.ledger`, on success. Returns
 * `unavailable` and builds nothing on failure: code `INVALID_INPUT` for a
 * policy or kind mismatch, a missing `routerAddress`, or a thrown error.
 * Code `CONTRACT_GATE` names the failing market contract error code, from
 * `validateOrder`'s list or #705 above, when the order or a trailing
 * order fails a check. Do not submit the transaction when the result is
 * `unavailable`.
 */
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
 * This is the non-auth-wallet fallback. A user who cannot co-sign a Router
 * fill-or-kill still opens or adjusts a position by resting a
 * `MarketIncrease`/`MarketDecrease` create_order that a keeper fills at the
 * prevailing mark. No signed price update is embedded here. The keeper
 * splices the verified price at fill time, so `priceBound` is the on-chain
 * slippage guard that caps the fill's adverse price. Unlike a limit/stop
 * resting order, a market order carries no trigger, so `triggerPrice`
 * must be zero.
 *
 * `input.validation` is checked with its `price` and `priceUpdate`
 * cleared. The price bound gate (contract error #741) is left to the
 * keeper at fill and is not previewed here.
 *
 * @returns An `exact` QuoteResult holding the built operation as base64
 * XDR, bound to `input.validation.ledger`, on success. Returns
 * `unavailable` with code `INVALID_INPUT` and no operation when
 * `input.policy.kind` is not `restOnly`, `input.order.kind` is not a
 * market kind, `triggerPrice` is nonzero, `priceBound` is not positive, or
 * building the operation throws. Returns `unavailable` with code
 * `CONTRACT_GATE` and the failing market contract error code (see
 * `validateOrder`) when the order fails a check against the snapshot. Do
 * not submit the transaction when the result is `unavailable`.
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

/**
 * Build one price-free vault order, a deposit or a redeem, from an exact
 * resting creation quote.
 *
 * The order carries no price and is filled by a keeper later, at the
 * deposit or redeem rate then in force. This function does not re-run
 * `validateOrder`; it trusts `input.quote` was produced against a valid
 * snapshot.
 *
 * @returns An `exact` QuoteResult holding the built operation as base64
 * XDR, bound to `input.quote.ledger`, on success. Returns `unavailable`
 * with code `INVALID_INPUT` and no operation when `input.policy.kind` is
 * not `restOnly`, `input.quote` is not an exact resting creation quote, or
 * building the operation throws.
 */
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
 * Build one exact vault action: a resting deposit or redeem for keeper
 * fill, or an immediate redeem on a Retired market.
 *
 * `input.quote.value.kind` selects the path. A `resting` value needs
 * `input.policy` and delegates to `buildVaultOrderOperation`. A
 * `retiredImmediateRedeem` value forbids `input.policy` and redeems
 * `creation.shares` shares straight out of the vault in the same call, no
 * keeper and no exec fee. `creation.shares` must be positive or the
 * market contract rejects it (error #732, `InvalidOrder`); `minOut` is
 * not applied on this path.
 *
 * @returns An `exact` QuoteResult on success, holding the built operation
 * as base64 XDR and, for a resting action, `vaultAction` naming which
 * action it is. Returns `unavailable` with code `INVALID_INPUT` when
 * `input.quote.kind` is not `exact`, `input.policy` is present or absent
 * against the wrong quote kind, or building the operation throws.
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
