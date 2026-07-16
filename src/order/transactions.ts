import { Address, StrKey } from '@stellar/stellar-sdk';
import { MAX_SIGNED_PRICE_UPDATE_BYTES } from '../data/price.js';
import { checkedI128 } from '../math/fixed.js';
import type { MarginAdjustmentQuote } from '../position/margin.js';
import {
    quotePositionDecreaseIntent,
    type ExactPositionDecreaseIntentQuote,
    type QuotePositionDecreaseIntentInput,
} from '../position/decrease.js';
import { canonicalIdentity } from '../position/decrease_identity.js';
import {
    quotePositionIncreaseIntent,
    type ExactPositionIncreaseIntentQuote,
} from '../position/increase.js';
import type { PositionActionOutcome } from '../position/quote.js';
import {
    decodeLedgerSequence,
    exact,
    unavailable,
    type QuoteResult,
} from '../quote/result.js';
import { TradingContract } from '../trading/trading_contract.js';
import type { SubjectBoundTradingSnapshot } from '../trading/trading_snapshot.js';
import {
    FULL_CLOSE,
    OrderKind,
    Status,
    VaultOrderKind,
} from '../trading/trading_types.js';
import { TradingRouterContract } from '../trading-router/router_contract.js';
import {
    createOrderCall,
    type Call,
    type OrderParams,
} from '../trading-router/router_types.js';
import type {
    ExactVaultOrderCreationQuote,
    ExactVaultRestingOrderCreationQuote,
} from '../vault/quote.js';
import {
    decodeCreateOrderCall,
    orderExecutionPrice,
    validateFillOrKillCalls,
    validateOrder,
    type OrderValidationContext,
} from './validation.js';
import {
    exactRelayFeeTokenIssue,
    type ExactRelayFeeToken,
    type RelayFeeToken,
} from './fee_token.js';

export type { ExactRelayFeeToken, RelayFeeToken } from './fee_token.js';

const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;

export type ContractExecutionPolicy =
    | {
          kind: 'fillOrKill';
          transport: 'direct';
          keeper: string;
          price: Uint8Array;
      }
    | {
          kind: 'fillOrKill';
          transport: 'relay';
          feeToken: ExactRelayFeeToken;
          maxFeeAmount: bigint;
          feeExpiration: number;
      }
    | { kind: 'restOnly'; transport: 'direct' }
    | {
          kind: 'restOnly';
          transport: 'relay';
          feeToken: ExactRelayFeeToken;
          maxFeeAmount: bigint;
          feeExpiration: number;
      };

interface PreparedExecutionBase {
    policy: ContractExecutionPolicy['kind'];
    operationXdr: string;
}

export type PreparedExecution =
    | (PreparedExecutionBase & { transport: 'direct' })
    | (PreparedExecutionBase & { transport: 'relay' });

export interface BuildOrderOperationInput {
    tradingAddress: string;
    /** Required for fill-or-kill and relayed rest-only execution. */
    routerAddress?: string;
    user: string;
    order: OrderParams;
    /** Optional calls after the one primary order. */
    calls?: Call[];
    policy: ContractExecutionPolicy;
    validation: OrderValidationContext;
}

export interface BuildPositionActionExecutionInput {
    tradingAddress: string;
    routerAddress: string;
    user: string;
    isLong: boolean;
    outcome: PositionActionOutcome;
    expiration: number;
    policy: ContractExecutionPolicy;
    validation: OrderValidationContext;
}

export type PositionDecreaseFillOrKillPolicy = Extract<
    ContractExecutionPolicy,
    { kind: 'fillOrKill' }
>;

export interface BuildPositionDecreaseIntentExecutionInput {
    snapshot: SubjectBoundTradingSnapshot;
    user: string;
    quote: ExactPositionDecreaseIntentQuote;
    policy: PositionDecreaseFillOrKillPolicy;
}

export type PositionIncreaseFillOrKillPolicy = Extract<
    ContractExecutionPolicy,
    { kind: 'fillOrKill' }
>;

export interface BuildPositionIncreaseIntentExecutionInput {
    snapshot: SubjectBoundTradingSnapshot;
    quote: ExactPositionIncreaseIntentQuote;
    policy: PositionIncreaseFillOrKillPolicy;
}

export interface BuildMarginAdjustmentExecutionInput {
    tradingAddress: string;
    routerAddress: string;
    user: string;
    isLong: boolean;
    quote: MarginAdjustmentQuote;
    expiration: number;
    policy: ContractExecutionPolicy;
    validation: OrderValidationContext;
}

export type VaultRestOnlyExecutionPolicy = Extract<
    ContractExecutionPolicy,
    { kind: 'restOnly' }
>;

export interface BuildVaultOrderOperationInput {
    tradingAddress: string;
    /** Required only for relayed rest-only execution. */
    routerAddress?: string;
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
    /** Accepted only for a relayed resting action. */
    routerAddress?: string;
    user: string;
    quote: ExactVaultOrderCreationQuote;
    /** Required for a resting action and forbidden for Retired redemption. */
    policy?: VaultRestOnlyExecutionPolicy;
}

function validContract(value: string): boolean {
    return StrKey.isValidContract(value);
}

function validAddress(value: string): boolean {
    try {
        Address.fromString(value);
        return true;
    } catch {
        return false;
    }
}

function validU32(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0 && value <= U32_MAX;
}

function priceBytes(value: unknown): value is Uint8Array {
    return (
        value instanceof Uint8Array &&
        value.byteLength > 0 &&
        value.byteLength <= MAX_SIGNED_PRICE_UPDATE_BYTES
    );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < left.byteLength; index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}

function priceTime(context: OrderValidationContext): bigint {
    return context.price?.publishTime ?? context.now;
}

function invalid(reason: string): QuoteResult<PreparedExecution> {
    return unavailable('INVALID_INPUT', reason);
}

function preparedExecution(
    policy: ContractExecutionPolicy,
    operationXdr: string,
): PreparedExecution {
    if (policy.transport === 'direct') {
        return { policy: policy.kind, transport: 'direct', operationXdr };
    }
    return { policy: policy.kind, transport: 'relay', operationXdr };
}

function validU64(value: unknown): value is bigint {
    return typeof value === 'bigint' && value >= 0n && value <= U64_MAX;
}

function validateVaultCreationQuote(
    quote: ExactVaultRestingOrderCreationQuote,
): string | undefined {
    if (!quote || typeof quote !== 'object' || quote.kind !== 'exact') {
        return 'an exact vault order creation quote is required';
    }
    try {
        decodeLedgerSequence(quote.ledger);
    } catch (error) {
        return error instanceof Error
            ? error.message
            : 'quote ledger is invalid';
    }
    const value = quote.value;
    if (
        !value ||
        typeof value !== 'object' ||
        value.kind !== 'resting' ||
        value.policy !== 'restOnly'
    ) {
        return 'vault order execution requires an exact resting creation quote';
    }
    if (
        !validU64(value.createdAt) ||
        !validU64(quote.priceTime) ||
        quote.priceTime !== value.createdAt
    ) {
        return 'vault order quote timestamp does not match its creation boundary';
    }
    const expectedFillAfter =
        value.createdAt === U64_MAX ? null : value.createdAt + 1n;
    if (value.fillAfter !== expectedFillAfter) {
        return 'vault order later price boundary is invalid';
    }

    let amount: bigint;
    let minOut: bigint;
    let executionFee: bigint;
    let escrowedAssets: bigint;
    let escrowedShares: bigint;
    try {
        amount = checkedI128(value.amount);
        minOut = checkedI128(value.minOut);
        executionFee = checkedI128(value.executionFee);
        escrowedAssets = checkedI128(value.escrowedAssets);
        escrowedShares = checkedI128(value.escrowedShares);
    } catch (error) {
        return error instanceof Error
            ? error.message
            : 'vault order quote atomics are invalid';
    }
    if (amount <= 0n || minOut < 0n || executionFee < 0n) {
        return 'vault order quote contains invalid atomic values';
    }
    if (value.action === 'deposit') {
        let expectedEscrow: bigint;
        try {
            expectedEscrow = checkedI128(amount + executionFee);
        } catch (error) {
            return error instanceof Error
                ? error.message
                : 'vault order escrow is invalid';
        }
        if (
            escrowedAssets !== expectedEscrow ||
            escrowedShares !== 0n ||
            value.redeemUnlockAt !== null
        ) {
            return 'vault deposit quote escrow is inconsistent';
        }
        return undefined;
    }
    if (value.action !== 'redeem') {
        return 'vault order action is unknown';
    }
    if (
        escrowedAssets !== executionFee ||
        escrowedShares !== amount ||
        !validU64(value.redeemUnlockAt) ||
        value.redeemUnlockAt < value.createdAt
    ) {
        return 'vault redeem quote escrow or cooldown is inconsistent';
    }
    return undefined;
}

function validateRetiredVaultCreationQuote(
    quote: ExactVaultOrderCreationQuote,
): string | undefined {
    if (!quote || typeof quote !== 'object' || quote.kind !== 'exact') {
        return 'an exact vault action quote is required';
    }
    try {
        decodeLedgerSequence(quote.ledger);
    } catch (error) {
        return error instanceof Error
            ? error.message
            : 'quote ledger is invalid';
    }
    if (!validU64(quote.priceTime)) {
        return 'vault action quote timestamp is invalid';
    }

    const value = quote.value;
    if (
        !value ||
        typeof value !== 'object' ||
        value.kind !== 'retiredImmediateRedeem' ||
        value.policy !== 'direct' ||
        value.action !== 'redeem' ||
        value.minOutApplied !== false ||
        value.executionFee !== 0n
    ) {
        return 'Retired vault action quote is inconsistent';
    }
    try {
        const shares = checkedI128(value.shares);
        const assets = checkedI128(value.assets);
        if (shares <= 0n || assets < 0n) {
            return 'Retired vault action atomics are invalid';
        }
    } catch (error) {
        return error instanceof Error
            ? error.message
            : 'Retired vault action atomics are invalid';
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

function validateRelayFeePolicy(
    policy: Extract<ContractExecutionPolicy, { transport: 'relay' }>,
    ledger: number,
): string | undefined {
    const token = policy.feeToken;
    const tokenIssue = exactRelayFeeTokenIssue(token);
    if (tokenIssue !== undefined) return tokenIssue;

    let minimum: bigint;
    let maximum: bigint;
    let signedMaximum: bigint;
    try {
        minimum = token.minForwardChargeAtomic;
        maximum = token.maxSignedFeeAtomic;
        signedMaximum = checkedI128(policy.maxFeeAmount);
    } catch (error) {
        return error instanceof Error
            ? error.message
            : 'relay fee values are invalid';
    }
    if (minimum < 0n || maximum <= 0n || minimum > maximum) {
        return 'relay fee token bounds are invalid';
    }
    if (
        signedMaximum <= 0n ||
        signedMaximum < minimum ||
        signedMaximum > maximum
    ) {
        return 'signed relay fee maximum is outside configured token bounds';
    }
    if (!validU32(policy.feeExpiration) || policy.feeExpiration <= ledger) {
        return 'relay fee expiration must be a live u32 ledger';
    }
    return undefined;
}

function validatePolicy(
    policy: ContractExecutionPolicy,
    context: OrderValidationContext,
): string | undefined {
    if (policy.kind === 'restOnly') {
        if (policy.transport === 'direct') return undefined;
        if (policy.transport === 'relay') {
            return validateRelayFeePolicy(policy, context.ledger);
        }
        return 'unsupported contract execution transport';
    }
    if (policy.kind !== 'fillOrKill') {
        return 'unsupported contract execution policy';
    }
    if (policy.transport === 'relay') {
        if (context.price === undefined) {
            return 'fill-or-kill requires a verified market price in the validation snapshot';
        }
        if (!priceBytes(context.priceUpdate)) {
            return 'fill-or-kill requires a nonempty verified price update no larger than 32 KiB';
        }
        return validateRelayFeePolicy(policy, context.ledger);
    }
    if (policy.transport !== 'direct') {
        return 'unsupported contract execution transport';
    }
    if (!validAddress(policy.keeper)) {
        return 'keeper is not a valid Stellar address';
    }
    if (!priceBytes(policy.price)) {
        return 'fill-or-kill requires a nonempty serialized price update no larger than 32 KiB';
    }
    if (context.price === undefined) {
        return 'fill-or-kill requires a verified market price in the validation snapshot';
    }
    if (
        !priceBytes(context.priceUpdate) ||
        !sameBytes(policy.price, context.priceUpdate)
    ) {
        return 'serialized price update does not match the verified validation snapshot';
    }
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
        if (!validContract(input.tradingAddress)) {
            return invalid('tradingAddress must be a valid contract ID');
        }
        if (!validAddress(input.user)) {
            return invalid('user must be a valid Stellar address');
        }
        if (
            input.order.trading !== input.tradingAddress ||
            input.order.user !== input.user
        ) {
            return invalid(
                'order identity does not match configured market and user',
            );
        }

        const policyError = validatePolicy(input.policy, input.validation);
        if (policyError !== undefined) return invalid(policyError);

        const orderError = firstIssue(
            validateOrder(input.order, input.validation),
        );
        if (orderError !== undefined) return orderError;

        if (input.policy.kind === 'restOnly') {
            if ((input.calls?.length ?? 0) !== 0) {
                return invalid(
                    'rest-only execution cannot ignore a call batch',
                );
            }
            if (
                input.order.kind === OrderKind.MarketIncrease ||
                input.order.kind === OrderKind.MarketDecrease
            ) {
                return invalid(
                    'rest-only execution requires a limit or stop order',
                );
            }
            let operationXdr: string;
            if (input.policy.transport === 'direct') {
                const trading = new TradingContract(input.tradingAddress);
                operationXdr = trading.createOrder(
                    input.order.user,
                    input.order.isLong,
                    input.order.kind,
                    input.order.notional,
                    input.order.collateral,
                    input.order.triggerPrice,
                    input.order.priceBound,
                    input.order.expiration,
                );
            } else {
                if (
                    typeof input.routerAddress !== 'string' ||
                    !validContract(input.routerAddress)
                ) {
                    return invalid('routerAddress must be a valid contract ID');
                }
                operationXdr = new TradingRouterContract(
                    input.routerAddress,
                ).multicallWithFee({
                    calls: [createOrderCall(input.order)],
                    user: input.user,
                    feeToken: input.policy.feeToken.contractId,
                    maxFeeAmount: input.policy.maxFeeAmount,
                    feeExpiration: input.policy.feeExpiration,
                    feeAmount: 1n,
                    feeRecipient: input.user,
                });
            }
            return exact(
                preparedExecution(input.policy, operationXdr),
                input.validation.ledger,
                priceTime(input.validation),
            );
        }

        if (
            typeof input.routerAddress !== 'string' ||
            !validContract(input.routerAddress)
        ) {
            return invalid('routerAddress must be a valid contract ID');
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
        const grammarIssues = validateFillOrKillCalls(calls, {
            tradingAddress: input.tradingAddress,
            user: input.user,
            isLong: input.order.isLong,
        });
        if (grammarIssues.length > 0) {
            return invalid(grammarIssues[0].reason);
        }
        const trailingError = validateTrailingOrders(
            calls.slice(1),
            input.validation,
        );
        if (trailingError !== undefined) return trailingError;

        const router = new TradingRouterContract(input.routerAddress);
        let operationXdr: string;
        if (input.policy.transport === 'direct') {
            operationXdr = router.createAndFill(
                calls,
                input.user,
                input.policy.keeper,
                input.policy.price,
            );
        } else if (input.policy.transport === 'relay') {
            const priceUpdate = input.validation.priceUpdate;
            if (!priceBytes(priceUpdate)) {
                return invalid(
                    'fill-or-kill requires a nonempty verified price update no larger than 32 KiB',
                );
            }
            operationXdr = router.createAndFillWithFee({
                calls,
                user: input.user,
                feeToken: input.policy.feeToken.contractId,
                maxFeeAmount: input.policy.maxFeeAmount,
                feeExpiration: input.policy.feeExpiration,
                feeAmount: 1n,
                feeRecipient: input.user,
                keeper: input.user,
                price: priceUpdate,
            });
        } else {
            return invalid('unsupported contract execution policy');
        }
        return exact(
            preparedExecution(input.policy, operationXdr),
            input.validation.ledger,
            priceTime(input.validation),
        );
    } catch (error) {
        return invalid(
            error instanceof Error
                ? error.message
                : 'could not build order operation',
        );
    }
}

/** Build exactly one price-free vault order from an exact creation quote. */
export function buildVaultOrderOperation(
    input: BuildVaultOrderOperationInput,
): QuoteResult<PreparedExecution> {
    try {
        if (!validContract(input.tradingAddress)) {
            return invalid('tradingAddress must be a valid contract ID');
        }
        if (!validAddress(input.user)) {
            return invalid('user must be a valid Stellar address');
        }
        if (Object.prototype.hasOwnProperty.call(input, 'calls')) {
            return invalid(
                'vault rest-only execution does not accept a call batch',
            );
        }
        if (!input.policy || input.policy.kind !== 'restOnly') {
            return invalid('vault order creation requires rest-only execution');
        }
        const quoteError = validateVaultCreationQuote(input.quote);
        if (quoteError !== undefined) return invalid(quoteError);

        if (input.policy.transport === 'relay') {
            const relayError = validateRelayFeePolicy(
                input.policy,
                input.quote.ledger,
            );
            if (relayError !== undefined) return invalid(relayError);
        } else if (input.policy.transport !== 'direct') {
            return invalid('unsupported vault order execution transport');
        }

        const trading = new TradingContract(input.tradingAddress);
        const creation = input.quote.value;
        const kind =
            creation.action === 'deposit'
                ? VaultOrderKind.Deposit
                : VaultOrderKind.Redeem;
        let operationXdr: string;
        if (input.policy.transport === 'direct') {
            operationXdr = trading.createVaultOrder(
                input.user,
                kind,
                creation.amount,
                creation.minOut,
            );
        } else {
            if (
                typeof input.routerAddress !== 'string' ||
                !validContract(input.routerAddress)
            ) {
                return invalid('routerAddress must be a valid contract ID');
            }
            operationXdr = new TradingRouterContract(
                input.routerAddress,
            ).multicallWithFee({
                calls: [
                    trading.createVaultOrderCall(
                        input.user,
                        kind,
                        creation.amount,
                        creation.minOut,
                    ),
                ],
                user: input.user,
                feeToken: input.policy.feeToken.contractId,
                maxFeeAmount: input.policy.maxFeeAmount,
                feeExpiration: input.policy.feeExpiration,
                feeAmount: 1n,
                feeRecipient: input.user,
            });
        }

        return exact(
            preparedExecution(input.policy, operationXdr),
            input.quote.ledger,
            input.quote.priceTime,
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
        if (!input || typeof input !== 'object') {
            return invalidVaultAction('vault action input is required');
        }
        if (Object.prototype.hasOwnProperty.call(input, 'calls')) {
            return invalidVaultAction(
                'vault action execution does not accept a call batch',
            );
        }
        const quote = input.quote;
        if (
            !quote ||
            typeof quote !== 'object' ||
            quote.kind !== 'exact' ||
            !quote.value ||
            typeof quote.value !== 'object'
        ) {
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
            if (
                input.policy.transport === 'direct' &&
                Object.prototype.hasOwnProperty.call(input, 'routerAddress')
            ) {
                return invalidVaultAction(
                    'routerAddress is accepted only for relayed resting actions',
                );
            }
            const restingQuote: ExactVaultRestingOrderCreationQuote = {
                ...quote,
                value: creation,
            };
            const prepared = buildVaultOrderOperation({
                tradingAddress: input.tradingAddress,
                routerAddress: input.routerAddress,
                user: input.user,
                quote: restingQuote,
                policy: input.policy,
            });
            if (prepared.kind === 'unavailable') return prepared;
            if (prepared.kind === 'estimate') {
                return invalidVaultAction(
                    'resting vault operation must have exact provenance',
                );
            }
            return exact(
                {
                    ...prepared.value,
                    action: 'resting',
                    vaultAction: creation.action,
                    policy: 'restOnly',
                },
                prepared.ledger,
                prepared.priceTime,
            );
        }

        if (creation.kind !== 'retiredImmediateRedeem') {
            return invalidVaultAction('vault action kind is unknown');
        }
        if (
            Object.prototype.hasOwnProperty.call(input, 'policy') ||
            Object.prototype.hasOwnProperty.call(input, 'routerAddress')
        ) {
            return invalidVaultAction(
                'Retired vault redemption is direct only and accepts no execution policy or Router',
            );
        }
        if (!validContract(input.tradingAddress)) {
            return invalidVaultAction(
                'tradingAddress must be a valid contract ID',
            );
        }
        if (!validAddress(input.user)) {
            return invalidVaultAction('user must be a valid Stellar address');
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
            quote.priceTime,
        );
    } catch (error) {
        return invalidVaultAction(
            error instanceof Error
                ? error.message
                : 'could not build vault action execution',
        );
    }
}

function requireFillOrKill(
    policy: ContractExecutionPolicy,
): QuoteResult<PreparedExecution> | undefined {
    return policy.kind === 'fillOrKill'
        ? undefined
        : invalid('position actions require explicit fill-or-kill execution');
}

/** Convert a quoted position action to contract atomics without rescaling. */
export function buildPositionActionExecution(
    input: BuildPositionActionExecutionInput,
): QuoteResult<PreparedExecution> {
    const policyError = requireFillOrKill(input.policy);
    if (policyError !== undefined) return policyError;

    let kind: OrderKind;
    let notional: bigint;
    let collateral: bigint;
    const action = input.outcome.action;
    if (action.kind === 'increase') {
        kind = OrderKind.MarketIncrease;
        notional = action.notional;
        collateral = action.collateral;
    } else if (action.kind === 'decrease') {
        kind = OrderKind.MarketDecrease;
        notional = action.notional;
        collateral = action.collateral;
    } else if (action.kind === 'close') {
        kind = OrderKind.MarketDecrease;
        notional = FULL_CLOSE;
        collateral = 0n;
    } else {
        kind =
            action.direction === 'add'
                ? OrderKind.MarketIncrease
                : OrderKind.MarketDecrease;
        notional = 0n;
        collateral = action.amount;
    }

    if (input.validation.price === undefined) {
        return invalid('position execution requires a verified market price');
    }
    const expectedExecutionPrice = orderExecutionPrice(
        kind,
        input.isLong,
        input.validation.price,
    );
    if (input.outcome.executionPrice !== expectedExecutionPrice) {
        return invalid(
            'position quote execution price does not match the validation snapshot',
        );
    }

    return buildOrderOperation({
        tradingAddress: input.tradingAddress,
        routerAddress: input.routerAddress,
        user: input.user,
        order: {
            trading: input.tradingAddress,
            user: input.user,
            isLong: input.isLong,
            kind,
            notional,
            collateral,
            triggerPrice: 0n,
            priceBound: input.outcome.executionPrice,
            expiration: input.expiration,
        },
        policy: input.policy,
        validation: input.validation,
    });
}

/** Prepare one exact snapshot-bound decrease through Router fill-or-kill. */
export function buildPositionDecreaseIntentExecution(
    input: BuildPositionDecreaseIntentExecutionInput,
): QuoteResult<PreparedExecution> {
    try {
        if (!input || typeof input !== 'object') {
            return invalid('position decrease execution input is required');
        }
        if (Object.prototype.hasOwnProperty.call(input, 'calls')) {
            return invalid(
                'position decrease intent execution does not accept calls',
            );
        }
        if (
            !input.snapshot ||
            typeof input.snapshot !== 'object' ||
            !input.snapshot.subject ||
            typeof input.snapshot.subject !== 'object'
        ) {
            return invalid('snapshot subject provenance is required');
        }
        if (input.user !== input.snapshot.subject.user) {
            return invalid('execution user must match snapshot subject');
        }
        const policyError = requireFillOrKill(input.policy);
        if (policyError !== undefined) return policyError;
        const quote = input.quote;
        if (!quote || typeof quote !== 'object' || quote.kind !== 'exact') {
            return invalid(
                'an exact position decrease intent quote is required',
            );
        }
        const value = quote.value;
        if (
            !value ||
            typeof value !== 'object' ||
            value.kind !== 'positionDecrease'
        ) {
            return invalid('position decrease intent quote value is invalid');
        }
        const intent = value.intent;
        if (!intent || typeof intent !== 'object') {
            return invalid('position decrease normalized intent is required');
        }

        const quoteInputBase = {
            snapshot: input.snapshot,
            isLong: value.identity.isLong,
            size: intent.size,
            execution: intent.execution,
            maximumSlippage: intent.maximumSlippage,
            validForLedgers: intent.validForLedgers,
        };
        let quoteInput: QuotePositionDecreaseIntentInput;
        if (intent.size.kind === 'full') {
            if (intent.collateralReturn !== null) {
                return invalid(
                    'full position decrease quote contains collateral intent',
                );
            }
            quoteInput = quoteInputBase as QuotePositionDecreaseIntentInput;
        } else {
            if (intent.collateralReturn === null) {
                return invalid(
                    'partial position decrease quote lacks collateral intent',
                );
            }
            quoteInput = {
                ...quoteInputBase,
                collateralReturn: intent.collateralReturn,
            } as QuotePositionDecreaseIntentInput;
        }
        const expected = quotePositionDecreaseIntent(quoteInput);
        if (expected.kind !== 'exact') {
            return invalid(
                'position decrease quote does not match the supplied snapshot',
            );
        }
        if (canonicalIdentity(expected) !== canonicalIdentity(quote)) {
            return invalid(
                'position decrease quote does not match the supplied snapshot or normalized intent',
            );
        }

        if (input.policy.transport !== intent.execution.transport) {
            return invalid(
                'position decrease quote transport does not match execution policy',
            );
        }
        if (input.policy.transport === 'relay') {
            if (intent.execution.transport !== 'relay') {
                return invalid(
                    'relay policy requires a relay position decrease quote',
                );
            }
            const quotedRelayFee = checkedI128(intent.execution.relayFee);
            const signedMaximum = checkedI128(input.policy.maxFeeAmount);
            if (quotedRelayFee !== signedMaximum) {
                return invalid(
                    'quoted relay fee must equal the signed policy maximum',
                );
            }
            if (input.policy.feeExpiration !== expected.value.expiration) {
                return invalid(
                    'relay fee expiration must equal the quoted order expiration',
                );
            }
        }

        const action = expected.value.action;
        let notional: bigint;
        let collateral: bigint;
        if (action.kind === 'close') {
            notional = FULL_CLOSE;
            collateral = 0n;
        } else if (action.kind === 'decrease') {
            notional = action.notional;
            collateral = action.collateral;
        } else {
            return invalid('position decrease quote action is invalid');
        }

        const snapshot = input.snapshot;
        return buildOrderOperation({
            tradingAddress: snapshot.deployment.trading,
            routerAddress: snapshot.deployment.router,
            user: input.user,
            order: {
                trading: snapshot.deployment.trading,
                user: input.user,
                isLong: expected.value.identity.isLong,
                kind: OrderKind.MarketDecrease,
                notional,
                collateral,
                triggerPrice: 0n,
                priceBound: expected.value.priceBound,
                expiration: expected.value.expiration,
            },
            policy: input.policy,
            validation: {
                ledger: snapshot.ledger,
                now: snapshot.ledgerTime,
                status: snapshot.status,
                config: snapshot.config,
                price: snapshot.price,
                priceUpdate: snapshot.priceUpdate,
            },
        });
    } catch (error) {
        return invalid(
            error instanceof Error
                ? error.message
                : 'could not build position decrease execution',
        );
    }
}

/** Prepare one exact snapshot-bound open or increase through Router fill-or-kill. */
export function buildPositionIncreaseIntentExecution(
    input: BuildPositionIncreaseIntentExecutionInput,
): QuoteResult<PreparedExecution> {
    try {
        if (!input || typeof input !== 'object') {
            return invalid('position increase execution input is required');
        }
        for (const forbidden of ['calls', 'user', 'isLong'] as const) {
            if (Object.prototype.hasOwnProperty.call(input, forbidden)) {
                return invalid(
                    'position increase execution derives calls, user, and side from its exact quote and snapshot',
                );
            }
        }
        if (
            !input.snapshot ||
            typeof input.snapshot !== 'object' ||
            !input.snapshot.subject ||
            typeof input.snapshot.subject !== 'object'
        ) {
            return invalid('snapshot subject provenance is required');
        }
        const policyError = requireFillOrKill(input.policy);
        if (policyError !== undefined) return policyError;
        const quote = input.quote;
        if (!quote || typeof quote !== 'object' || quote.kind !== 'exact') {
            return invalid(
                'an exact position increase intent quote is required',
            );
        }
        const value = quote.value;
        if (
            !value ||
            typeof value !== 'object' ||
            value.kind !== 'positionIncrease' ||
            !value.intent ||
            typeof value.intent !== 'object'
        ) {
            return invalid('position increase intent quote value is invalid');
        }

        const intent = value.intent;
        const expected = quotePositionIncreaseIntent({
            snapshot: input.snapshot,
            notional: intent.notional,
            desiredPostFeeMarginDelta: intent.desiredPostFeeMarginDelta,
            execution: intent.execution,
            maximumSlippage: intent.maximumSlippage,
            validForLedgers: intent.validForLedgers,
        });
        if (expected.kind !== 'exact') {
            return invalid(
                'position increase quote does not match the supplied snapshot',
            );
        }
        if (canonicalIdentity(expected) !== canonicalIdentity(quote)) {
            return invalid(
                'position increase quote does not match the supplied snapshot or normalized intent',
            );
        }
        if (input.policy.transport !== intent.execution.transport) {
            return invalid(
                'position increase quote transport does not match execution policy',
            );
        }
        if (input.policy.transport === 'relay') {
            if (intent.execution.transport !== 'relay') {
                return invalid(
                    'relay policy requires a relay position increase quote',
                );
            }
            if (
                canonicalIdentity(input.policy.feeToken) !==
                canonicalIdentity(intent.execution.feeToken)
            ) {
                return invalid(
                    'relay fee token must equal the quoted exact fee-token configuration',
                );
            }
            if (
                checkedI128(input.policy.maxFeeAmount) !==
                intent.execution.feeToken.maxSignedFeeAtomic
            ) {
                return invalid(
                    'signed relay fee maximum must equal the quoted token maximum',
                );
            }
            if (input.policy.feeExpiration !== expected.value.expiration) {
                return invalid(
                    'relay fee expiration must equal the quoted order expiration',
                );
            }
        }

        const action = expected.value.outcome.action;
        if (
            action.kind !== 'increase' ||
            action.notional !== expected.value.intent.notional ||
            action.collateral !== expected.value.grossOrderCollateral
        ) {
            return invalid('position increase quote action is inconsistent');
        }
        const snapshot = input.snapshot;
        const user = snapshot.subject.user;
        return buildOrderOperation({
            tradingAddress: snapshot.deployment.trading,
            routerAddress: snapshot.deployment.router,
            user,
            order: {
                trading: snapshot.deployment.trading,
                user,
                isLong: snapshot.subject.isLong,
                kind: OrderKind.MarketIncrease,
                notional: action.notional,
                collateral: action.collateral,
                triggerPrice: 0n,
                priceBound: expected.value.priceBound,
                expiration: expected.value.expiration,
            },
            policy: input.policy,
            validation: {
                ledger: snapshot.ledger,
                now: snapshot.ledgerTime,
                status: snapshot.status,
                config: snapshot.config,
                price: snapshot.price,
                priceUpdate: snapshot.priceUpdate,
            },
        });
    } catch (error) {
        return invalid(
            error instanceof Error
                ? error.message
                : 'could not build position increase execution',
        );
    }
}

/** Encode the gross quoted delta exactly, including Max withdrawal results. */
export function buildMarginAdjustmentExecution(
    input: BuildMarginAdjustmentExecutionInput,
): QuoteResult<PreparedExecution> {
    const policyError = requireFillOrKill(input.policy);
    if (policyError !== undefined) return policyError;
    if (input.validation.price === undefined) {
        return invalid('margin execution requires a verified market price');
    }
    if (
        input.quote.direction !== 'add' &&
        input.quote.direction !== 'withdraw'
    ) {
        return invalid('margin quote direction is invalid');
    }
    const kind =
        input.quote.direction === 'add'
            ? OrderKind.MarketIncrease
            : OrderKind.MarketDecrease;
    return buildOrderOperation({
        tradingAddress: input.tradingAddress,
        routerAddress: input.routerAddress,
        user: input.user,
        order: {
            trading: input.tradingAddress,
            user: input.user,
            isLong: input.isLong,
            kind,
            notional: 0n,
            collateral: input.quote.requestedAtomicDelta,
            triggerPrice: 0n,
            priceBound: orderExecutionPrice(
                kind,
                input.isLong,
                input.validation.price,
            ),
            expiration: input.expiration,
        },
        policy: input.policy,
        validation: input.validation,
    });
}
