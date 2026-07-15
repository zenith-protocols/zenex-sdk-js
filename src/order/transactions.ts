import { Address, StrKey } from '@stellar/stellar-sdk';
import { checkedI128 } from '../math/fixed.js';
import type { MarginAdjustmentQuote } from '../position/margin.js';
import type { PositionActionOutcome } from '../position/quote.js';
import { exact, unavailable, type QuoteResult } from '../quote/result.js';
import { TradingContract } from '../trading/trading_contract.js';
import { FULL_CLOSE, OrderKind, Status } from '../trading/trading_types.js';
import { TradingRouterContract } from '../trading-router/router_contract.js';
import {
    createOrderCall,
    type Call,
    type OrderParams,
} from '../trading-router/router_types.js';
import {
    decodeCreateOrderCall,
    orderExecutionPrice,
    validateFillOrKillCalls,
    validateOrder,
    type OrderValidationContext,
} from './validation.js';

const U32_MAX = 4_294_967_295;

export interface RelayFeeToken {
    collateralAssetId: string;
    contractId: string;
    decimals: number;
    pricing: { kind: 'usdPeg'; numerator: '1'; denominator: '1' };
    minForwardChargeAtomic: string;
    maxSignedFeeAtomic: string;
}

export interface ExactRelayFeeToken extends Omit<
    RelayFeeToken,
    'minForwardChargeAtomic' | 'maxSignedFeeAtomic'
> {
    minForwardChargeAtomic: bigint;
    maxSignedFeeAtomic: bigint;
}

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
          feeAmount: bigint;
          feeRecipient: string;
          keeper: string;
          price: Uint8Array;
      }
    | { kind: 'restOnly'; transport: 'direct' }
    | {
          kind: 'restOnly';
          transport: 'relay';
          feeToken: ExactRelayFeeToken;
          maxFeeAmount: bigint;
          feeExpiration: number;
          feeAmount: bigint;
          feeRecipient: string;
      };

export interface PreparedExecution {
    policy: ContractExecutionPolicy['kind'];
    operationXdr: string;
}

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
    return value instanceof Uint8Array && value.byteLength > 0;
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
    if (
        typeof token.collateralAssetId !== 'string' ||
        token.collateralAssetId.length === 0 ||
        !validContract(token.contractId)
    ) {
        return 'relay fee token identity is invalid';
    }
    if (
        !Number.isSafeInteger(token.decimals) ||
        token.decimals < 0 ||
        token.decimals > 38
    ) {
        return 'relay fee token decimals must be an integer from 0 through 38';
    }
    if (
        token.pricing?.kind !== 'usdPeg' ||
        token.pricing.numerator !== '1' ||
        token.pricing.denominator !== '1'
    ) {
        return 'relay fee token must use exact one-to-one USD-peg pricing';
    }

    let minimum: bigint;
    let maximum: bigint;
    let signedMaximum: bigint;
    let feeAmount: bigint;
    try {
        minimum = checkedI128(token.minForwardChargeAtomic);
        maximum = checkedI128(token.maxSignedFeeAtomic);
        signedMaximum = checkedI128(policy.maxFeeAmount);
        feeAmount = checkedI128(policy.feeAmount);
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
    if (
        feeAmount < 0n ||
        feeAmount > signedMaximum ||
        (feeAmount > 0n && feeAmount < minimum)
    ) {
        return 'relay fee amount is outside the signed maximum and configured minimum';
    }
    if (!validU32(policy.feeExpiration) || policy.feeExpiration < ledger) {
        return 'relay fee expiration must be a live u32 ledger';
    }
    if (!validAddress(policy.feeRecipient)) {
        return 'relay fee recipient is not a valid Stellar address';
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
    if (!validAddress(policy.keeper)) {
        return 'keeper is not a valid Stellar address';
    }
    if (!priceBytes(policy.price)) {
        return 'fill-or-kill requires a nonempty serialized price update';
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
    if (policy.transport === 'relay') {
        return validateRelayFeePolicy(policy, context.ledger);
    }
    if (policy.transport !== 'direct') {
        return 'unsupported contract execution transport';
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
                    feeAmount: input.policy.feeAmount,
                    feeRecipient: input.policy.feeRecipient,
                });
            }
            return exact(
                {
                    policy: 'restOnly',
                    operationXdr,
                },
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
            operationXdr = router.createAndFillWithFee({
                calls,
                user: input.user,
                feeToken: input.policy.feeToken.contractId,
                maxFeeAmount: input.policy.maxFeeAmount,
                feeExpiration: input.policy.feeExpiration,
                feeAmount: input.policy.feeAmount,
                feeRecipient: input.policy.feeRecipient,
                keeper: input.policy.keeper,
                price: input.policy.price,
            });
        } else {
            return invalid('unsupported contract execution policy');
        }
        return exact(
            { policy: 'fillOrKill', operationXdr },
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
