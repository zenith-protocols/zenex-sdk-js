import { Address, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { checkedI128 } from '../math/fixed.js';
import type { ExactRelayFeeToken } from '../order/transactions.js';
import {
    contextRuleTypeToScVal,
    signerToScVal,
    type AddContextRuleArgs,
} from '../smart-account/smart_account_contract.js';
import { TradingContract } from '../trading/trading_contract.js';
import { TradingRouterContract } from '../trading-router/router_contract.js';
import type { Call } from '../trading-router/router_types.js';
import { buildSingleMarketSessionRule } from './policy.js';
import type { PolicyBuildResult, TrustedDeploymentRegistry } from './types.js';

const U32_MAX = 4_294_967_295;
const RULE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export interface PriceFreeRelayConfiguration {
    readonly router: string;
    readonly referral: string;
    readonly markets: readonly {
        readonly trading: string;
        readonly collateral: string;
    }[];
    readonly feeTokens: readonly string[];
    readonly sessionPolicy: {
        readonly contractId: string;
        readonly ed25519Verifier: string;
        readonly ruleName: string;
        readonly maximumDurationLedgers: bigint;
    };
    readonly deployments: TrustedDeploymentRegistry;
}

export type PriceFreeRelayAction =
    | {
          readonly kind: 'cancelOrder';
          readonly trading: string;
          readonly id: number;
      }
    | {
          readonly kind: 'cancelVaultOrder';
          readonly trading: string;
          readonly id: number;
      }
    | {
          readonly kind: 'claimFunding';
          readonly trading: string;
      }
    | {
          readonly kind: 'transferCollateral';
          readonly token: string;
          readonly to: string;
          readonly amount: bigint;
      }
    | {
          readonly kind: 'attributeReferral';
          readonly referrer: string;
      }
    | {
          readonly kind: 'addSingleMarketSession';
          readonly trading: string;
          readonly signerKeyData: Uint8Array;
          readonly validUntil: number;
      }
    | {
          readonly kind: 'removeSessionRule';
          readonly id: number;
      };

export interface BuildPriceFreeRelayOperationInput {
    readonly user: string;
    readonly currentLedger: number;
    readonly configuration: PriceFreeRelayConfiguration;
    readonly feeToken: ExactRelayFeeToken;
    readonly maxFeeAmount: bigint;
    readonly feeExpiration: number;
    readonly actions: readonly PriceFreeRelayAction[];
}

export interface PreparedPriceFreeRelayOperation {
    readonly policy: 'priceFree';
    readonly operationXdr: string;
}

function unavailable(reason: string): {
    kind: 'unavailable';
    code: 'INVALID_INPUT';
    reason: string;
} {
    return { kind: 'unavailable', code: 'INVALID_INPUT', reason };
}

function validAddress(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))
    );
}

function validContract(value: unknown): value is string {
    return typeof value === 'string' && StrKey.isValidContract(value);
}

function validU32(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= U32_MAX
    );
}

function configurationIssue(
    configuration: PriceFreeRelayConfiguration,
): string | undefined {
    if (!configuration || typeof configuration !== 'object') {
        return 'price-free relay configuration is required';
    }
    if (
        !validContract(configuration.router) ||
        !validContract(configuration.referral)
    ) {
        return 'price-free Router and Referral identities must be contract IDs';
    }
    if (
        !Array.isArray(configuration.markets) ||
        configuration.markets.length === 0
    ) {
        return 'price-free relay configuration requires at least one market';
    }
    const trading = new Set<string>();
    const collateral = new Set<string>();
    for (const market of configuration.markets) {
        if (
            !market ||
            !validContract(market.trading) ||
            !validContract(market.collateral) ||
            new Set([market.trading, configuration.router, market.collateral])
                .size !== 3 ||
            trading.has(market.trading)
        ) {
            return 'price-free market identities are invalid';
        }
        trading.add(market.trading);
        collateral.add(market.collateral);
    }
    if (
        !Array.isArray(configuration.feeTokens) ||
        configuration.feeTokens.length === 0 ||
        configuration.feeTokens.some(
            (contractId) =>
                !validContract(contractId) || !collateral.has(contractId),
        ) ||
        new Set(configuration.feeTokens).size !== configuration.feeTokens.length
    ) {
        return 'price-free fee-token identities are invalid';
    }
    const session = configuration.sessionPolicy;
    if (
        !session ||
        !validContract(session.contractId) ||
        !validContract(session.ed25519Verifier) ||
        typeof session.ruleName !== 'string' ||
        !RULE_NAME.test(session.ruleName) ||
        typeof session.maximumDurationLedgers !== 'bigint' ||
        session.maximumDurationLedgers <= 0n ||
        session.maximumDurationLedgers > BigInt(U32_MAX)
    ) {
        return 'price-free session-policy configuration is invalid';
    }
    if (
        !configuration.deployments ||
        typeof configuration.deployments.resolve !== 'function'
    ) {
        return 'trusted deployment registry is required';
    }
    return undefined;
}

function feeIssue(
    input: BuildPriceFreeRelayOperationInput,
): string | undefined {
    const token = input.feeToken;
    if (
        !token ||
        typeof token.collateralAssetId !== 'string' ||
        token.collateralAssetId.length === 0 ||
        !validContract(token.contractId) ||
        !input.configuration.feeTokens.includes(token.contractId)
    ) {
        return 'relay fee token is not enabled by the configuration';
    }
    if (
        !Number.isSafeInteger(token.decimals) ||
        token.decimals < 0 ||
        token.decimals > 38 ||
        token.pricing?.kind !== 'usdPeg' ||
        token.pricing.numerator !== '1' ||
        token.pricing.denominator !== '1'
    ) {
        return 'relay fee token metadata is not exact USD-peg metadata';
    }
    let minimum: bigint;
    let maximum: bigint;
    let selected: bigint;
    try {
        minimum = checkedI128(token.minForwardChargeAtomic);
        maximum = checkedI128(token.maxSignedFeeAtomic);
        selected = checkedI128(input.maxFeeAmount);
    } catch (error) {
        return error instanceof Error ? error.message : 'relay fee is invalid';
    }
    if (
        minimum < 0n ||
        maximum <= 0n ||
        minimum > maximum ||
        selected <= 0n ||
        selected < minimum ||
        selected > maximum
    ) {
        return 'signed relay fee maximum is outside configured token bounds';
    }
    if (
        !validU32(input.currentLedger) ||
        !validU32(input.feeExpiration) ||
        input.feeExpiration <= input.currentLedger
    ) {
        return 'relay fee expiration must be a live u32 ledger';
    }
    return undefined;
}

function policiesToScVal(policies: Map<string, xdr.ScVal>): xdr.ScVal {
    const entries = [...policies].map(
        ([contractId, parameters]) =>
            new xdr.ScMapEntry({
                key: Address.fromString(contractId).toScVal(),
                val: parameters,
            }),
    );
    entries.sort((left, right) =>
        left.key().toXDR('hex').localeCompare(right.key().toXDR('hex')),
    );
    return xdr.ScVal.scvMap(entries);
}

function addContextRuleCall(
    smartAccount: string,
    rule: AddContextRuleArgs,
): Call {
    if (rule.validUntil === undefined) {
        throw new TypeError('price-free session rule requires an expiry');
    }
    return {
        contract: smartAccount,
        func: 'add_context_rule',
        args: [
            contextRuleTypeToScVal(rule.contextType),
            nativeToScVal(rule.name, { type: 'string' }),
            xdr.ScVal.scvU32(rule.validUntil),
            xdr.ScVal.scvVec(rule.signers.map(signerToScVal)),
            policiesToScVal(rule.policies),
        ],
    };
}

function actionCalls(
    input: BuildPriceFreeRelayOperationInput,
): PolicyBuildResult<Call[]> {
    if (
        !Array.isArray(input.actions) ||
        input.actions.length === 0 ||
        input.actions.length > 64
    ) {
        return {
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'price-free batch must contain between one and 64 actions',
        };
    }
    const markets = new Map(
        input.configuration.markets.map((market) => [market.trading, market]),
    );
    const calls: Call[] = [];

    for (const action of input.actions) {
        if (!action || typeof action !== 'object') {
            return {
                kind: 'unavailable',
                code: 'INVALID_INPUT',
                reason: 'price-free action must be an object',
            };
        }
        if (action.kind === 'cancelOrder') {
            if (!markets.has(action.trading) || !validU32(action.id)) {
                return unavailable('cancelOrder action is invalid');
            }
            calls.push(
                new TradingContract(action.trading).cancelOrderCall(
                    input.user,
                    action.id,
                ),
            );
        } else if (action.kind === 'cancelVaultOrder') {
            if (!markets.has(action.trading) || !validU32(action.id)) {
                return unavailable('cancelVaultOrder action is invalid');
            }
            calls.push(
                new TradingContract(action.trading).cancelVaultOrderCall(
                    input.user,
                    action.id,
                ),
            );
        } else if (action.kind === 'claimFunding') {
            if (!markets.has(action.trading)) {
                return unavailable('claimFunding market is not configured');
            }
            calls.push({
                contract: action.trading,
                func: 'claim_funding',
                args: [Address.fromString(input.user).toScVal()],
            });
        } else if (action.kind === 'transferCollateral') {
            let amount: bigint;
            try {
                amount = checkedI128(action.amount);
            } catch (error) {
                return unavailable(
                    error instanceof Error
                        ? error.message
                        : 'collateral transfer amount is invalid',
                );
            }
            if (
                !input.configuration.feeTokens.includes(action.token) ||
                !validAddress(action.to) ||
                action.to === input.user ||
                amount <= 0n
            ) {
                return unavailable('transferCollateral action is invalid');
            }
            calls.push({
                contract: action.token,
                func: 'transfer',
                args: [
                    Address.fromString(input.user).toScVal(),
                    Address.fromString(action.to).toScVal(),
                    nativeToScVal(amount, { type: 'i128' }),
                ],
            });
        } else if (action.kind === 'attributeReferral') {
            if (
                !validAddress(action.referrer) ||
                action.referrer === input.user
            ) {
                return unavailable('attributeReferral action is invalid');
            }
            calls.push({
                contract: input.configuration.referral,
                func: 'attribute',
                args: [
                    Address.fromString(input.user).toScVal(),
                    Address.fromString(action.referrer).toScVal(),
                ],
            });
        } else if (action.kind === 'addSingleMarketSession') {
            const market = markets.get(action.trading);
            if (market === undefined || !StrKey.isValidContract(input.user)) {
                return unavailable(
                    'session rule requires the verified user smart account and one configured market',
                );
            }
            const session = buildSingleMarketSessionRule({
                sessionPolicy: input.configuration.sessionPolicy.contractId,
                smartAccount: input.user,
                deployments: input.configuration.deployments,
                capability: 'single-transfer-destination-v1',
                markets: [
                    {
                        trading: market.trading,
                        router: input.configuration.router,
                        collateral: market.collateral,
                    },
                ],
                signer: {
                    tag: 'External',
                    verifier: input.configuration.sessionPolicy.ed25519Verifier,
                    keyData: action.signerKeyData,
                },
                name: input.configuration.sessionPolicy.ruleName,
                currentLedger: input.currentLedger,
                maximumDurationLedgers:
                    input.configuration.sessionPolicy.maximumDurationLedgers,
                validUntil: action.validUntil,
            });
            if (session.kind !== 'ready') return session;
            calls.push(addContextRuleCall(input.user, session.value));
        } else if (action.kind === 'removeSessionRule') {
            if (
                !StrKey.isValidContract(input.user) ||
                !validU32(action.id) ||
                action.id === 0
            ) {
                return unavailable('removeSessionRule action is invalid');
            }
            calls.push({
                contract: input.user,
                func: 'remove_context_rule',
                args: [xdr.ScVal.scvU32(action.id)],
            });
        } else {
            return unavailable(
                'price-free action is outside the exact allowlist',
            );
        }
    }
    return { kind: 'ready', value: calls };
}

/** Build only the Router price-free action grammar accepted by the relay. */
export function buildPriceFreeRelayOperation(
    input: BuildPriceFreeRelayOperationInput,
): PolicyBuildResult<PreparedPriceFreeRelayOperation> {
    try {
        if (!input || typeof input !== 'object' || !validAddress(input.user)) {
            return unavailable(
                'price-free relay user must be a G or C address',
            );
        }
        const configIssue = configurationIssue(input.configuration);
        if (configIssue !== undefined) return unavailable(configIssue);
        const relayFeeIssue = feeIssue(input);
        if (relayFeeIssue !== undefined) return unavailable(relayFeeIssue);
        const calls = actionCalls(input);
        if (calls.kind !== 'ready') return calls;

        return {
            kind: 'ready',
            value: {
                policy: 'priceFree',
                operationXdr: new TradingRouterContract(
                    input.configuration.router,
                ).multicallWithFee({
                    calls: calls.value,
                    user: input.user,
                    feeToken: input.feeToken.contractId,
                    maxFeeAmount: input.maxFeeAmount,
                    feeExpiration: input.feeExpiration,
                    feeAmount: 1n,
                    feeRecipient: input.user,
                }),
            },
        };
    } catch (error) {
        return unavailable(
            error instanceof Error
                ? error.message
                : 'could not build price-free relay operation',
        );
    }
}
