import {
    Address,
    StrKey,
    nativeToScVal,
    scValToNative,
    xdr,
} from '@stellar/stellar-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ExactRelayFeeToken } from '../../src/order/transactions.js';
import {
    ED25519_VERIFIER_SPEC_SHA256,
    ED25519_VERIFIER_WASM_SHA256,
    SESSION_POLICY_SPEC_SHA256,
    SESSION_POLICY_WASM_SHA256,
    buildRelayCallRequest,
} from '../../src/relay/policy.js';
import {
    buildPriceFreeRelayOperation,
    type PriceFreeRelayConfiguration,
} from '../../src/relay/price_free.js';
import type { VerifiedSmartAccountInstance } from '../../src/relay/smart_account_evidence.js';
import {
    TESTNET_NETWORK,
    TESTNET_NETWORK_ID,
    verifiedSmartAccountFixture,
} from '../helpers/smart_account_evidence.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 81));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 82));
const COLLATERAL = StrKey.encodeContract(Buffer.alloc(32, 83));
const REFERRAL = StrKey.encodeContract(Buffer.alloc(32, 84));
const SESSION_POLICY = StrKey.encodeContract(Buffer.alloc(32, 85));
const ED25519_VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 86));
const USER = StrKey.encodeContract(Buffer.alloc(32, 87));
const RECIPIENT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 88));
const REFERRER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 89));
const REQUEST_ID = 'e799860a-dd37-4de8-a756-76df984bcaa9';

function deployment(contractId: string, wasmHash: string, specHash: string) {
    return {
        contractId,
        wasmHash,
        evidence: {
            state: 'verified' as const,
            deploymentTransactionHash: '11'.repeat(32),
            ledger: 900n,
            instanceExecutableHash: wasmHash,
            uploadedWasmHash: wasmHash,
            specHash,
        },
    };
}

const DEPLOYMENTS = new Map(
    [
        deployment(
            SESSION_POLICY,
            SESSION_POLICY_WASM_SHA256,
            SESSION_POLICY_SPEC_SHA256,
        ),
        deployment(
            ED25519_VERIFIER,
            ED25519_VERIFIER_WASM_SHA256,
            ED25519_VERIFIER_SPEC_SHA256,
        ),
    ].map((record) => [record.contractId, record]),
);

let smartAccountInstance: VerifiedSmartAccountInstance;
let otherAccountInstance: VerifiedSmartAccountInstance;
let configuration: PriceFreeRelayConfiguration;

function smartAccounts(
    resolve: (
        contractId: string,
    ) => VerifiedSmartAccountInstance | undefined = (contractId) =>
        contractId === USER ? smartAccountInstance : undefined,
) {
    return {
        networkId: TESTNET_NETWORK_ID,
        networkPassphrase: TESTNET_NETWORK.passphrase,
        resolve,
    };
}

const feeToken: ExactRelayFeeToken = {
    collateralAssetId: 'usdc',
    contractId: COLLATERAL,
    decimals: 7,
    pricing: { kind: 'usdPeg', numerator: '1', denominator: '1' },
    minForwardChargeAtomic: 1n,
    maxSignedFeeAtomic: 10_000n,
};

function build(
    actions: Parameters<typeof buildPriceFreeRelayOperation>[0]['actions'],
) {
    return buildPriceFreeRelayOperation({
        user: USER,
        currentLedger: 1_000,
        configuration,
        feeToken,
        maxFeeAmount: 1_000n,
        feeExpiration: 1_050,
        actions,
    });
}

function decode(operationXdr: string) {
    const invoke = xdr.Operation.fromXDR(operationXdr, 'base64')
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract();
    return {
        contract: Address.fromScAddress(invoke.contractAddress()).toString(),
        fn: invoke.functionName().toString(),
        args: invoke.args(),
        nativeCalls: scValToNative(invoke.args()[0]) as {
            contract: string;
            func: string;
            args: unknown[];
        }[],
    };
}

function relayAuth(operationXdr: string): string {
    const hostFunction = xdr.Operation.fromXDR(operationXdr, 'base64')
        .body()
        .invokeHostFunctionOp()
        .hostFunction();
    const invoke = hostFunction.invokeContract();
    const args = invoke.args();
    const approval = (amount: xdr.ScVal) =>
        new xdr.SorobanAuthorizedInvocation({
            function:
                xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                    new xdr.InvokeContractArgs({
                        contractAddress: Address.fromScVal(
                            args[2],
                        ).toScAddress(),
                        functionName: 'approve',
                        args: [
                            args[1],
                            Address.fromScAddress(
                                invoke.contractAddress(),
                            ).toScVal(),
                            amount,
                            args[4],
                        ],
                    }),
                ),
            subInvocations: [],
        });
    return new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
            new xdr.SorobanAddressCredentials({
                address: Address.fromString(USER).toScAddress(),
                nonce: xdr.Int64.fromString('1'),
                signatureExpirationLedger: 1_050,
                signature: xdr.ScVal.scvBytes(Buffer.from([1])),
            }),
        ),
        rootInvocation: new xdr.SorobanAuthorizedInvocation({
            function:
                xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                    new xdr.InvokeContractArgs({
                        contractAddress: invoke.contractAddress(),
                        functionName: invoke.functionName(),
                        args: [args[0], args[2], args[3], args[4]],
                    }),
                ),
            subInvocations: [
                approval(args[3]),
                approval(nativeToScVal(0n, { type: 'i128' })),
            ],
        }),
    }).toXDR('base64');
}

describe('buildPriceFreeRelayOperation', () => {
    beforeAll(async () => {
        smartAccountInstance = await verifiedSmartAccountFixture(USER, 1_000);
        otherAccountInstance = await verifiedSmartAccountFixture(
            StrKey.encodeContract(Buffer.alloc(32, 90)),
            1_000,
        );
        configuration = {
            router: ROUTER,
            referral: REFERRAL,
            markets: [{ trading: TRADING, collateral: COLLATERAL }],
            feeTokens: [COLLATERAL],
            sessionPolicy: {
                contractId: SESSION_POLICY,
                ed25519Verifier: ED25519_VERIFIER,
                ruleName: 'trading-session',
                maximumDurationLedgers: 100n,
            },
            deployments: {
                resolve(contractId) {
                    return DEPLOYMENTS.get(contractId);
                },
            },
            smartAccounts: smartAccounts(),
        };
    });

    it('builds one mixed exact-allowlist batch with canonical unsigned tail', () => {
        const result = build([
            { kind: 'cancelOrder', trading: TRADING, id: 7 },
            { kind: 'cancelVaultOrder', trading: TRADING, id: 8 },
            { kind: 'claimFunding', trading: TRADING },
            {
                kind: 'transferCollateral',
                token: COLLATERAL,
                to: RECIPIENT,
                amount: 25n,
            },
            { kind: 'attributeReferral', referrer: REFERRER },
            {
                kind: 'addSingleMarketSession',
                trading: TRADING,
                signerKeyData: new Uint8Array(32).fill(9),
                validUntil: 1_050,
            },
            { kind: 'removeSessionRule', id: 3 },
        ]);

        expect(result.kind).toBe('ready');
        if (result.kind !== 'ready') return;
        expect(result.value.transport).toBe('relay');
        const call = decode(result.value.operationXdr);
        expect(call.contract).toBe(ROUTER);
        expect(call.fn).toBe('multicall_with_fee');
        expect(call.nativeCalls.map((entry) => entry.func)).toEqual([
            'cancel_order',
            'cancel_vault_order',
            'claim_funding',
            'transfer',
            'attribute',
            'add_context_rule',
            'remove_context_rule',
        ]);
        expect(call.nativeCalls[1]).toMatchObject({
            contract: TRADING,
            func: 'cancel_vault_order',
            args: [USER, 8],
        });
        expect(call.args.slice(1).map(scValToNative)).toEqual([
            USER,
            COLLATERAL,
            1_000n,
            1_050,
            1n,
            USER,
        ]);
        const session = call.nativeCalls[5]!;
        expect(session.contract).toBe(USER);
        expect(session.args[0]).toEqual(['Default']);
        expect(session.args[1]).toBe('trading-session');
        expect(session.args[2]).toBe(1_050);
        expect(session.args[4]).toEqual({
            [SESSION_POLICY]: {
                allowed_contracts: [TRADING, ROUTER, COLLATERAL],
                allowed_transfer_to: TRADING,
            },
        });

        const func = xdr.Operation.fromXDR(result.value.operationXdr, 'base64')
            .body()
            .invokeHostFunctionOp()
            .hostFunction()
            .toXDR('base64');
        const relayContracts = {
            router: ROUTER,
            trading: [TRADING],
            feeTokens: [COLLATERAL],
            referral: REFERRAL,
            markets: [{ trading: TRADING, collateral: COLLATERAL }],
            sessionPolicy: {
                contractId: SESSION_POLICY,
                ed25519Verifier: ED25519_VERIFIER,
                ruleName: 'trading-session',
                maximumDurationLedgers: 100n,
            },
        } as const;
        const relayRequest = {
            requestId: REQUEST_ID,
            policy: 'priceFree' as const,
            func,
            auth: [relayAuth(result.value.operationXdr)],
            contracts: relayContracts,
        };
        expect(
            buildRelayCallRequest({
                ...relayRequest,
                currentLedger: 1_000,
            }).policy,
        ).toBe('priceFree');
        expect(() => buildRelayCallRequest(relayRequest)).toThrow(/duration/);
        expect(() =>
            buildRelayCallRequest({
                ...relayRequest,
                currentLedger: 1_050,
            }),
        ).toThrow(/duration/);
    });

    it('rejects empty, arbitrary, unconfigured, and unsafe actions', () => {
        expect(build([])).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
        expect(
            build([
                {
                    kind: 'arbitrary',
                    contract: ROUTER,
                    func: 'set_admin',
                    args: [],
                } as never,
            ]),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            buildPriceFreeRelayOperation({
                user: USER,
                currentLedger: 1_000,
                configuration: { ...configuration, router: TRADING },
                feeToken,
                maxFeeAmount: 1_000n,
                feeExpiration: 1_050,
                actions: [{ kind: 'cancelOrder', trading: TRADING, id: 1 }],
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            build([
                {
                    kind: 'transferCollateral',
                    token: COLLATERAL,
                    to: USER,
                    amount: 1n,
                },
            ]),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            build([
                {
                    kind: 'addSingleMarketSession',
                    trading: TRADING,
                    signerKeyData: new Uint8Array(32),
                    validUntil: 1_101,
                },
            ]),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });

    it.each([
        [
            'add',
            {
                kind: 'addSingleMarketSession' as const,
                trading: TRADING,
                signerKeyData: new Uint8Array(32).fill(9),
                validUntil: 1_050,
            },
        ],
        ['remove', { kind: 'removeSessionRule' as const, id: 3 }],
    ])(
        'requires exact live account evidence for session %s',
        (_label, action) => {
            const base = {
                user: USER,
                currentLedger: 1_000,
                configuration,
                feeToken,
                maxFeeAmount: 1_000n,
                feeExpiration: 1_050,
                actions: [action],
            };
            expect(
                buildPriceFreeRelayOperation({
                    ...base,
                    configuration: {
                        ...configuration,
                        smartAccounts: smartAccounts(() => undefined),
                    },
                }),
            ).toMatchObject({
                kind: 'unavailable',
                reason: expect.stringMatching(/absent/i),
            });
            expect(
                buildPriceFreeRelayOperation({
                    ...base,
                    configuration: {
                        ...configuration,
                        smartAccounts: smartAccounts(
                            () => otherAccountInstance,
                        ),
                    },
                }),
            ).toMatchObject({
                kind: 'unavailable',
                reason: expect.stringMatching(/different contract identity/i),
            });
            expect(
                buildPriceFreeRelayOperation({
                    ...base,
                    configuration: {
                        ...configuration,
                        smartAccounts: smartAccounts(
                            () =>
                                ({
                                    ...smartAccountInstance,
                                }) as VerifiedSmartAccountInstance,
                        ),
                    },
                }),
            ).toMatchObject({
                kind: 'unavailable',
                reason: expect.stringMatching(/not live verified/i),
            });
            expect(
                buildPriceFreeRelayOperation({
                    ...base,
                    currentLedger: 1_001,
                }),
            ).toMatchObject({
                kind: 'unavailable',
                reason: expect.stringMatching(/different ledger/i),
            });
        },
    );

    it('keeps non-session actions independent from the live account registry', () => {
        const result = buildPriceFreeRelayOperation({
            user: USER,
            currentLedger: 1_000,
            configuration: {
                ...configuration,
                smartAccounts: smartAccounts(() => undefined),
            },
            feeToken,
            maxFeeAmount: 1_000n,
            feeExpiration: 1_050,
            actions: [{ kind: 'cancelOrder', trading: TRADING, id: 1 }],
        });

        expect(result.kind).toBe('ready');
    });
});
