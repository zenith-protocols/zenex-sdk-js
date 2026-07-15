import {
    Account,
    Address,
    Keypair,
    Networks,
    Operation,
    StrKey,
    TransactionBuilder,
    hash,
    scValToNative,
    xdr,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    RELAY_REQUEST_STATES,
    ED25519_VERIFIER_SPEC_SHA256,
    ED25519_VERIFIER_WASM_SHA256,
    SESSION_POLICY_SPEC_SHA256,
    SESSION_POLICY_WASM_SHA256,
    SMART_ACCOUNT_SPEC_SHA256,
    SMART_ACCOUNT_WASM_SHA256,
    WEBAUTHN_VERIFIER_SPEC_SHA256,
    WEBAUTHN_VERIFIER_WASM_SHA256,
    buildRelayCallRequest,
    buildSingleMarketSessionRule,
    buildSmartAccountDeploymentRequest,
} from '../../src/relay/policy.js';
import { OrderKind } from '../../src/trading/trading_types.js';
import { TradingContract } from '../../src/trading/trading_contract.js';
import { TradingRouterContract } from '../../src/trading-router/router_contract.js';

const REQUEST_ID = '891c52ff-8c33-42b7-a3a3-2211a3f8e1f4';
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 20));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 21));
const COLLATERAL = StrKey.encodeContract(Buffer.alloc(32, 22));
const SESSION_POLICY = StrKey.encodeContract(Buffer.alloc(32, 23));
const SMART_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 24));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 25));
const ED25519_VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 30));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 26));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 27));
const RECIPIENT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 28));
const OTHER_ROUTER = StrKey.encodeContract(Buffer.alloc(32, 29));
const TRUSTED_CONTRACTS = {
    router: ROUTER,
    trading: [TRADING],
    feeTokens: [COLLATERAL],
} as const;
const DEPLOYER_KEYPAIR = Keypair.fromRawEd25519Seed(
    hash(Buffer.from('openzeppelin-smart-account-kit')),
);
const SMART_ACCOUNT_DEPLOYMENT = {
    kitVersion: '0.3.0' as const,
    deployer: DEPLOYER_KEYPAIR.publicKey(),
    accountWasmSha256: SMART_ACCOUNT_WASM_SHA256,
    webauthnVerifier: VERIFIER,
    networkPassphrase: Networks.TESTNET,
};

function verifiedEvidence(uploadedWasmHash: string, specHash: string) {
    return {
        state: 'verified' as const,
        deploymentTransactionHash: '11'.repeat(32),
        ledger: '99',
        instanceExecutableHash: uploadedWasmHash,
        uploadedWasmHash,
        specHash,
    };
}

function verifiedDeployment(
    contractId: string,
    wasmHash: string,
    specHash: string,
) {
    return {
        contractId,
        wasmHash,
        evidence: verifiedEvidence(wasmHash, specHash),
    };
}

function deploymentRegistry(
    ...deployments: ReturnType<typeof verifiedDeployment>[]
) {
    const byId = new Map(
        deployments.map((deployment) => [deployment.contractId, deployment]),
    );
    return {
        resolve(contractId: string) {
            return byId.get(contractId);
        },
    };
}

const WEBAUTHN_DEPLOYMENT = verifiedDeployment(
    VERIFIER,
    WEBAUTHN_VERIFIER_WASM_SHA256,
    WEBAUTHN_VERIFIER_SPEC_SHA256,
);
const DEPLOYMENT_REGISTRY = deploymentRegistry(WEBAUTHN_DEPLOYMENT);
const P256_GENERATOR = Buffer.from(
    '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296' +
        '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
    'hex',
);
const WEBAUTHN_KEY_DATA = Buffer.concat([P256_GENERATOR, Buffer.alloc(32, 33)]);

function primaryCall() {
    return TradingRouterContract.createOrderCall({
        trading: TRADING,
        user: USER,
        isLong: true,
        kind: OrderKind.MarketIncrease,
        notional: 100n,
        collateral: 20n,
        triggerPrice: 0n,
        priceBound: 101n,
        expiration: 1_000,
    });
}

function hostFunction(operationXdr: string): string {
    return xdr.Operation.fromXDR(operationXdr, 'base64')
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .toXDR('base64');
}

function authEntry(functionName = 'create_order'): string {
    const rootInvocation = new xdr.SorobanAuthorizedInvocation({
        function:
            xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                new xdr.InvokeContractArgs({
                    contractAddress: Address.fromString(TRADING).toScAddress(),
                    functionName,
                    args: [],
                }),
            ),
        subInvocations: [],
    });
    return new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation,
    }).toXDR('base64');
}

function fillOrKillFunc(): string {
    return hostFunction(
        new TradingRouterContract(ROUTER).createAndFillWithFee({
            calls: [primaryCall()],
            user: USER,
            feeToken: COLLATERAL,
            maxFeeAmount: 1_000n,
            feeExpiration: 1_000,
            feeAmount: 100n,
            feeRecipient: RECIPIENT,
            keeper: KEEPER,
            price: new Uint8Array([1, 2, 3]),
        }),
    );
}

function restOnlyFunc(): string {
    return hostFunction(
        new TradingContract(TRADING).createOrder(
            USER,
            true,
            OrderKind.LimitIncrease,
            100n,
            20n,
            90n,
            101n,
            1_000,
        ),
    );
}

function priceFreeFunc(): string {
    return hostFunction(
        new TradingRouterContract(ROUTER).multicallWithFee({
            calls: [new TradingContract(TRADING).cancelOrderCall(USER, 7)],
            user: USER,
            feeToken: COLLATERAL,
            maxFeeAmount: 1_000n,
            feeExpiration: 1_000,
            feeAmount: 100n,
            feeRecipient: RECIPIENT,
        }),
    );
}

describe('buildRelayCallRequest', () => {
    it.each([
        ['fillOrKill' as const, fillOrKillFunc],
        ['restOnly' as const, restOnlyFunc],
        ['priceFree' as const, priceFreeFunc],
    ])(
        'accepts canonical %s host-function and ordered auth XDR',
        (policy, makeFunc) => {
            const auth = [authEntry('first'), authEntry('second')];
            const request = buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy,
                func: makeFunc(),
                auth,
                contracts: TRUSTED_CONTRACTS,
            });
            expect(request).toEqual({
                requestId: REQUEST_ID,
                policy,
                func: makeFunc(),
                auth,
            });
            expect(Object.isFrozen(request)).toBe(true);
            expect(Object.isFrozen(request.auth)).toBe(true);
        },
    );

    it('rejects invalid IDs, empty or malformed auth, and non-host-function XDR', () => {
        expect(() =>
            buildRelayCallRequest({
                requestId: 'not-a-uuid',
                policy: 'fillOrKill',
                func: fillOrKillFunc(),
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/UUID/);
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'fillOrKill',
                func: fillOrKillFunc(),
                auth: [],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/auth/);
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'fillOrKill',
                func: fillOrKillFunc(),
                auth: ['AAAA'],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/auth/);
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'fillOrKill',
                func: xdr.Operation.fromXDR(
                    new TradingRouterContract(ROUTER).createAndFillWithFee({
                        calls: [primaryCall()],
                        user: USER,
                        feeToken: COLLATERAL,
                        maxFeeAmount: 1_000n,
                        feeExpiration: 1_000,
                        feeAmount: 100n,
                        feeRecipient: RECIPIENT,
                        keeper: KEEPER,
                        price: new Uint8Array([1]),
                    }),
                    'base64',
                ).toXDR('base64'),
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/host-function/);
    });

    it('rejects policy downgrade or cross-route function names', () => {
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'fillOrKill',
                func: restOnlyFunc(),
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/fillOrKill/);
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'priceFree',
                func: fillOrKillFunc(),
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/priceFree/);
    });

    it('rejects a lookalike function on an untrusted contract', () => {
        const func = hostFunction(
            new TradingRouterContract(OTHER_ROUTER).createAndFillWithFee({
                calls: [primaryCall()],
                user: USER,
                feeToken: COLLATERAL,
                maxFeeAmount: 1_000n,
                feeExpiration: 1_000,
                feeAmount: 100n,
                feeRecipient: RECIPIENT,
                keeper: KEEPER,
                price: new Uint8Array([1, 2, 3]),
            }),
        );
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'fillOrKill',
                func,
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/trusted Router/);
    });

    it('rejects an untrusted fee token and a second primary market call', () => {
        const operation = (feeToken: string, calls = [primaryCall()]) =>
            hostFunction(
                new TradingRouterContract(ROUTER).createAndFillWithFee({
                    calls,
                    user: USER,
                    feeToken,
                    maxFeeAmount: 1_000n,
                    feeExpiration: 1_000,
                    feeAmount: 100n,
                    feeRecipient: RECIPIENT,
                    keeper: KEEPER,
                    price: new Uint8Array([1, 2, 3]),
                }),
            );
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'fillOrKill',
                func: operation(OTHER_ROUTER),
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/fee token/);
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'fillOrKill',
                func: operation(COLLATERAL, [primaryCall(), primaryCall()]),
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/primary|trailing/);
    });

    it('keeps priceFree Router batches cancellation-only', () => {
        const func = hostFunction(
            new TradingRouterContract(ROUTER).multicallWithFee({
                calls: [{ contract: TRADING, func: 'set_config', args: [] }],
                user: USER,
                feeToken: COLLATERAL,
                maxFeeAmount: 1_000n,
                feeExpiration: 1_000,
                feeAmount: 100n,
                feeRecipient: RECIPIENT,
            }),
        );
        expect(() =>
            buildRelayCallRequest({
                requestId: REQUEST_ID,
                policy: 'priceFree',
                func,
                auth: [authEntry()],
                contracts: TRUSTED_CONTRACTS,
            }),
        ).toThrow(/cancellation/);
    });

    it('pins the durable relay lifecycle states', () => {
        expect(RELAY_REQUEST_STATES).toEqual([
            'preparing',
            'submitting',
            'submitted',
            'confirmed_success',
            'confirmed_failure',
            'failed_no_submit',
            'unknown',
        ]);
    });
});

function deploymentEnvelope(
    options: {
        signed?: boolean;
        wasmHash?: string;
        malformedConstructor?: boolean;
        keyDataLength?: number;
        malformedP256Point?: boolean;
        wrongSalt?: boolean;
        wrongSigner?: boolean;
        extraSignature?: boolean;
    } = {},
): string {
    const keypair = DEPLOYER_KEYPAIR;
    const source = new Account(keypair.publicKey(), '1');
    const credentialId = Buffer.alloc(32, 33);
    const keyData = Buffer.from(WEBAUTHN_KEY_DATA);
    if (options.malformedP256Point) keyData[64] ^= 1;
    const operation = Operation.createCustomContract({
        address: Address.fromString(keypair.publicKey()),
        wasmHash: Buffer.from(
            options.wasmHash ?? SMART_ACCOUNT_WASM_SHA256,
            'hex',
        ),
        salt: options.wrongSalt ? Buffer.alloc(32, 32) : hash(credentialId),
        constructorArgs: options.malformedConstructor
            ? [xdr.ScVal.scvVec([]), xdr.ScVal.scvMap([])]
            : [
                  xdr.ScVal.scvVec([
                      xdr.ScVal.scvVec([
                          xdr.ScVal.scvSymbol('External'),
                          Address.fromString(VERIFIER).toScVal(),
                          xdr.ScVal.scvBytes(
                              options.keyDataLength === undefined
                                  ? keyData
                                  : keyData.subarray(0, options.keyDataLength),
                          ),
                      ]),
                  ]),
                  xdr.ScVal.scvMap([]),
              ],
    });
    const transaction = new TransactionBuilder(source, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
    })
        .addOperation(operation)
        .setTimeout(0)
        .build();
    if (options.signed !== false) {
        transaction.sign(
            options.wrongSigner
                ? Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41))
                : keypair,
        );
    }
    if (options.extraSignature) {
        transaction.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42)));
    }
    return transaction.toXDR();
}

describe('buildSmartAccountDeploymentRequest', () => {
    it('accepts one signed pinned smart-account create-contract envelope', () => {
        const envelopeXdr = deploymentEnvelope();
        const request = buildSmartAccountDeploymentRequest({
            requestId: REQUEST_ID,
            envelopeXdr,
            deployment: SMART_ACCOUNT_DEPLOYMENT,
            deployments: DEPLOYMENT_REGISTRY,
        });
        expect(request).toEqual({
            requestId: REQUEST_ID,
            policy: 'smartAccountDeployment',
            envelopeXdr,
        });
        expect(Object.isFrozen(request)).toBe(true);
    });

    it('rejects unsigned or wrong-WASM deployment envelopes', () => {
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ signed: false }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/signed/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ wrongSigner: true }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/signature/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ extraSignature: true }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/exactly one signature/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope(),
                deployment: {
                    ...SMART_ACCOUNT_DEPLOYMENT,
                    networkPassphrase: Networks.PUBLIC,
                },
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/signature/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ wasmHash: 'ab'.repeat(32) }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/WASM/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ malformedConstructor: true }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/signer/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ wrongSalt: true }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/salt/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ keyDataLength: 32 }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/signer/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope({ malformedP256Point: true }),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/signer/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope(),
                deployment: {
                    ...SMART_ACCOUNT_DEPLOYMENT,
                    webauthnVerifier: OTHER_ROUTER,
                },
                deployments: DEPLOYMENT_REGISTRY,
            }),
        ).toThrow(/verifier deployment/);
        expect(() =>
            buildSmartAccountDeploymentRequest({
                requestId: REQUEST_ID,
                envelopeXdr: deploymentEnvelope(),
                deployment: SMART_ACCOUNT_DEPLOYMENT,
                deployments: deploymentRegistry(
                    verifiedDeployment(
                        VERIFIER,
                        'ab'.repeat(32),
                        WEBAUTHN_VERIFIER_SPEC_SHA256,
                    ),
                ),
            }),
        ).toThrow(/pinned WASM/);
    });
});

describe('buildSingleMarketSessionRule', () => {
    const sessionPolicyDeployment = verifiedDeployment(
        SESSION_POLICY,
        SESSION_POLICY_WASM_SHA256,
        SESSION_POLICY_SPEC_SHA256,
    );
    const smartAccountDeployment = verifiedDeployment(
        SMART_ACCOUNT,
        SMART_ACCOUNT_WASM_SHA256,
        SMART_ACCOUNT_SPEC_SHA256,
    );
    const ed25519VerifierDeployment = verifiedDeployment(
        ED25519_VERIFIER,
        ED25519_VERIFIER_WASM_SHA256,
        ED25519_VERIFIER_SPEC_SHA256,
    );
    const input = {
        sessionPolicy: SESSION_POLICY,
        smartAccount: SMART_ACCOUNT,
        deployments: deploymentRegistry(
            sessionPolicyDeployment,
            smartAccountDeployment,
            ed25519VerifierDeployment,
        ),
        capability: 'single-transfer-destination-v1' as const,
        markets: [{ trading: TRADING, router: ROUTER, collateral: COLLATERAL }],
        signer: {
            tag: 'External' as const,
            verifier: ED25519_VERIFIER,
            keyData: new Uint8Array(32).fill(9),
        },
        name: 'zenex-session',
        validUntil: 50_000,
    };

    it('builds one Default rule with one verified single-destination policy', () => {
        const result = buildSingleMarketSessionRule(input);
        expect(result.kind).toBe('ready');
        if (result.kind !== 'ready') return;
        expect(result.value.contextType).toEqual({ tag: 'Default' });
        expect(result.value.name).toBe('zenex-session');
        expect(result.value.validUntil).toBe(50_000);
        expect(result.value.signers).toEqual([input.signer]);
        expect([...result.value.policies.keys()]).toEqual([SESSION_POLICY]);
        expect(
            scValToNative(result.value.policies.get(SESSION_POLICY)!),
        ).toEqual({
            allowed_contracts: [TRADING, ROUTER, COLLATERAL],
            allowed_transfer_to: TRADING,
        });
    });

    it('fails closed for multiple destinations or unpinned deployment evidence', () => {
        expect(
            buildSingleMarketSessionRule({
                ...input,
                markets: [
                    ...input.markets,
                    {
                        trading: StrKey.encodeContract(Buffer.alloc(32, 40)),
                        router: ROUTER,
                        collateral: COLLATERAL,
                    },
                ],
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            buildSingleMarketSessionRule({
                ...input,
                deployments: deploymentRegistry(
                    {
                        ...sessionPolicyDeployment,
                        evidence: {
                            ...sessionPolicyDeployment.evidence,
                            uploadedWasmHash: 'ab'.repeat(32),
                        },
                    },
                    smartAccountDeployment,
                    ed25519VerifierDeployment,
                ),
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            buildSingleMarketSessionRule({
                ...input,
                deployments: deploymentRegistry(
                    sessionPolicyDeployment,
                    smartAccountDeployment,
                ),
            }),
        ).toMatchObject({
            kind: 'unavailable',
            reason: expect.stringMatching(/Ed25519 verifier deployment/),
        });
    });

    it('requires complete verified on-chain instance evidence', () => {
        expect(
            buildSingleMarketSessionRule(
                null as unknown as Parameters<
                    typeof buildSingleMarketSessionRule
                >[0],
            ),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            buildSingleMarketSessionRule({
                ...input,
                deployments: deploymentRegistry(
                    sessionPolicyDeployment,
                    {
                        ...smartAccountDeployment,
                        evidence: {
                            ...smartAccountDeployment.evidence,
                            state: 'claimed' as 'verified',
                        },
                    },
                    ed25519VerifierDeployment,
                ),
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            buildSingleMarketSessionRule({
                ...input,
                deployments: deploymentRegistry(
                    sessionPolicyDeployment,
                    {
                        ...smartAccountDeployment,
                        evidence: {
                            ...smartAccountDeployment.evidence,
                            instanceExecutableHash: 'not-a-hash',
                        },
                    },
                    ed25519VerifierDeployment,
                ),
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            buildSingleMarketSessionRule({
                ...input,
                deployments: deploymentRegistry(
                    sessionPolicyDeployment,
                    {
                        ...smartAccountDeployment,
                        evidence: {
                            ...smartAccountDeployment.evidence,
                            instanceExecutableHash: 'ab'.repeat(32),
                        },
                    },
                    ed25519VerifierDeployment,
                ),
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
        expect(
            buildSingleMarketSessionRule({
                ...input,
                deployments: {
                    resolve(contractId: string) {
                        if (contractId !== SMART_ACCOUNT) {
                            return input.deployments.resolve(contractId);
                        }
                        return {
                            ...smartAccountDeployment,
                            contractId: ROUTER,
                        };
                    },
                },
            }),
        ).toMatchObject({ kind: 'unavailable', code: 'INVALID_INPUT' });
    });
});
