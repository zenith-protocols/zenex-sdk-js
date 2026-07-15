import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { decodeApiSchema, ZenexDataDecodeError } from '../../src/data/codec.js';
import type { PublicConfig } from '../../src/data/generated.js';
import {
    createZenexTrustBundle,
    ZenexPublicConfigTrustError,
} from '../../src/data/trust.js';
import {
    ED25519_VERIFIER_SPEC_SHA256,
    ED25519_VERIFIER_WASM_SHA256,
    SESSION_POLICY_SPEC_SHA256,
    SESSION_POLICY_WASM_SHA256,
    SMART_ACCOUNT_DEPLOYER,
    SMART_ACCOUNT_SPEC_SHA256,
    SMART_ACCOUNT_WASM_SHA256,
    WEBAUTHN_VERIFIER_SPEC_SHA256,
    WEBAUTHN_VERIFIER_WASM_SHA256,
} from '../../src/relay/policy.js';
import type { VerifiedContractDeployment } from '../../src/relay/types.js';

const ROUTER = 'CDBUEWVNX33GUWYQQIXQHZNABWKJR4NJVHP5TCHVSQOSSVB4IWJBVFIK';
const REFERRAL = 'CAPPKUGOUTMM3JSXLPO2H7HTSA3VRGRMWHYRNE63X43T6LPYIS7RGY4E';
const TRADING = 'CBQ5T5FTPSTADHT6736GP2HXY2RTLT4LYBEB7D24YKAXN6JSQKST5T5O';
const VAULT = 'CAVPDUVFQGAOVSNFGE4CKKMYB2JMXBHNMDKECPVFBEJXP6245XOIBT2B';
const COLLATERAL = 'CDE6MPJXJS6ESAQOGBQMFXIMW6GNDDXUFFZYEUFRWTUMPVIPGL5NEZWW';
const WEBAUTHN = 'CCWWIPG7Q4WXRFAVE3QQYK2RXUUPFAUNYSOTEZMYYYCU4UF3RSEF3Y7V';
const ED25519 = 'CBF3TFCLTFTILVDS2ULNWLKBYJTUW43NXYUT3I7TNJ6VFIEDZIX3WCUU';
const SESSION = 'CA6AXY46QAP33T2ATQ6EXJKJ6JBUPNPRR2YHE5FL6HW65MIPBPGMQABA';

function deployment(
    contractId: string,
    wasmHash: string,
    specHash: string,
): VerifiedContractDeployment {
    return {
        contractId,
        wasmHash,
        evidence: {
            state: 'verified',
            deploymentTransactionHash: 'a'.repeat(64),
            ledger: 99n,
            instanceExecutableHash: wasmHash,
            uploadedWasmHash: wasmHash,
            specHash,
        },
    };
}

function publicConfig(): PublicConfig {
    return {
        network: {
            id: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
            kind: 'testnet',
        },
        contracts: { router: ROUTER, referral: REFERRAL },
        routerFeeMethods: ['multicall_with_fee', 'create_and_fill_with_fee'],
        smartAccount: {
            enabled: true,
            kitVersion: '0.3.0',
            deployer: SMART_ACCOUNT_DEPLOYER,
            accountArtifact: {
                wasmHash: SMART_ACCOUNT_WASM_SHA256,
                specHash: SMART_ACCOUNT_SPEC_SHA256,
            },
            verifiers: {
                webauthn: deployment(
                    WEBAUTHN,
                    WEBAUTHN_VERIFIER_WASM_SHA256,
                    WEBAUTHN_VERIFIER_SPEC_SHA256,
                ),
                ed25519: deployment(
                    ED25519,
                    ED25519_VERIFIER_WASM_SHA256,
                    ED25519_VERIFIER_SPEC_SHA256,
                ),
            },
            sessionPolicy: {
                deployment: deployment(
                    SESSION,
                    SESSION_POLICY_WASM_SHA256,
                    SESSION_POLICY_SPEC_SHA256,
                ),
                capability: 'single-transfer-destination-v1',
                ruleName: 'zenex-session',
                maxDurationLedgers: 17_280n,
                allowedContracts: [TRADING],
                allowedTransferDestinations: [TRADING],
            },
        },
        collateralAssets: [
            {
                id: 'usdc',
                contractId: COLLATERAL,
                symbol: 'USDC',
                decimals: 7,
                classicAsset: {
                    type: 'credit_alphanum4',
                    code: 'USDC',
                    issuer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                },
                relayFeeToken: {
                    collateralAssetId: 'usdc',
                    contractId: COLLATERAL,
                    decimals: 7,
                    pricing: {
                        kind: 'usdPeg',
                        numerator: '1',
                        denominator: '1',
                    },
                    minForwardChargeAtomic: 0n,
                    maxSignedFeeAtomic: 10_000_000n,
                },
            },
        ],
        markets: [
            {
                id: 'xlm-usd',
                symbol: 'XLMUSD',
                trading: TRADING,
                vault: VAULT,
                collateralAssetId: 'usdc',
                feedId: 23n,
                tokenDecimals: 18,
                priceDecimals: 14,
                udfSymbol: 'Crypto.XLM/USD',
            },
        ],
        configHash: '9'.repeat(64),
        coreManifestHash: 'a'.repeat(64),
        externalManifestHash: 'b'.repeat(64),
        evidence: {
            state: 'verified',
            deploymentTransactionHash: 'c'.repeat(64),
            ledger: 99n,
            instanceExecutableHash: 'd'.repeat(64),
            uploadedWasmHash: 'd'.repeat(64),
            specHash: 'e'.repeat(64),
        },
        faucet: { available: true },
    };
}

function wire(value: unknown): unknown {
    return JSON.parse(
        JSON.stringify(value, (_key, child) =>
            typeof child === 'bigint' ? child.toString() : child,
        ),
    );
}

describe('public config trust boundary', () => {
    it('decodes amended fee-token and verified deployment evidence exactly', () => {
        const decoded = decodeApiSchema('PublicConfig', wire(publicConfig()));
        expect(decoded.collateralAssets[0]?.relayFeeToken).toMatchObject({
            minForwardChargeAtomic: 0n,
            maxSignedFeeAtomic: 10_000_000n,
        });
        expect(decoded.smartAccount.sessionPolicy.maxDurationLedgers).toBe(
            17_280n,
        );
        expect(decoded.smartAccount.verifiers.webauthn.evidence.ledger).toBe(
            99n,
        );
        expect(decoded.routerFeeMethods).toEqual([
            'multicall_with_fee',
            'create_and_fill_with_fee',
        ]);
    });

    it('rejects cross-field identity and executable-hash mismatches', () => {
        const badFee = wire(publicConfig()) as any;
        badFee.collateralAssets[0].relayFeeToken.contractId = ROUTER;
        expect(() => decodeApiSchema('PublicConfig', badFee)).toThrow(
            ZenexDataDecodeError,
        );

        const badEvidence = wire(publicConfig()) as any;
        badEvidence.smartAccount.verifiers.webauthn.evidence.uploadedWasmHash =
            'f'.repeat(64);
        expect(() => decodeApiSchema('PublicConfig', badEvidence)).toThrow(
            ZenexDataDecodeError,
        );

        const negativeMinimum = wire(publicConfig()) as any;
        negativeMinimum.collateralAssets[0].relayFeeToken.minForwardChargeAtomic =
            '-1';
        expect(() => decodeApiSchema('PublicConfig', negativeMinimum)).toThrow(
            ZenexDataDecodeError,
        );
    });

    it('builds immutable Router identities and deployment registry records', () => {
        const userAccount = deployment(
            StrKey.encodeContract(Buffer.alloc(32, 71)),
            SMART_ACCOUNT_WASM_SHA256,
            SMART_ACCOUNT_SPEC_SHA256,
        );
        const trust = createZenexTrustBundle(publicConfig(), [userAccount]);

        expect(trust.relayContracts).toEqual({
            router: ROUTER,
            trading: [TRADING],
            feeTokens: [COLLATERAL],
            referral: REFERRAL,
            markets: [{ trading: TRADING, collateral: COLLATERAL }],
            sessionPolicy: {
                contractId: SESSION,
                ed25519Verifier: ED25519,
                ruleName: 'zenex-session',
                maximumDurationLedgers: 17_280n,
            },
        });
        expect(trust.priceFree).toMatchObject({
            router: ROUTER,
            referral: REFERRAL,
            markets: [{ trading: TRADING, collateral: COLLATERAL }],
            feeTokens: [COLLATERAL],
            sessionPolicy: {
                contractId: SESSION,
                ed25519Verifier: ED25519,
                ruleName: 'zenex-session',
                maximumDurationLedgers: 17_280n,
            },
        });
        expect(trust.deployments.resolve(SESSION)?.wasmHash).toBe(
            SESSION_POLICY_WASM_SHA256,
        );
        expect(
            trust.deployments.resolve(userAccount.contractId)?.wasmHash,
        ).toBe(SMART_ACCOUNT_WASM_SHA256);
        expect(trust.smartAccountDeployment).toMatchObject({
            kitVersion: '0.3.0',
            deployer: SMART_ACCOUNT_DEPLOYER,
            webauthnVerifier: WEBAUTHN,
            networkPassphrase: 'Test SDF Network ; September 2015',
        });
        expect(Object.isFrozen(trust)).toBe(true);
        expect(Object.isFrozen(trust.relayContracts.trading)).toBe(true);
    });

    it('does not trust claimed config or a per-user unverified artifact', () => {
        const claimed: PublicConfig = {
            ...publicConfig(),
            evidence: { state: 'claimed' },
        };
        expect(() => createZenexTrustBundle(claimed)).toThrow(
            ZenexPublicConfigTrustError,
        );

        const userAccount = deployment(
            StrKey.encodeContract(Buffer.alloc(32, 72)),
            'f'.repeat(64),
            SMART_ACCOUNT_SPEC_SHA256,
        );
        expect(() =>
            createZenexTrustBundle(publicConfig(), [userAccount]),
        ).toThrow(ZenexPublicConfigTrustError);
    });

    it('rejects mismatched SAC metadata and overlapping relay identities', () => {
        const badSac = publicConfig() as any;
        badSac.collateralAssets[0].classicAsset.code = 'EURC';
        expect(() => createZenexTrustBundle(badSac)).toThrowError(
            expect.objectContaining({
                path: '/collateralAssets/0/classicAsset',
            }),
        );

        const badSacType = publicConfig() as any;
        badSacType.collateralAssets[0].classicAsset.type = 'credit_alphanum12';
        expect(() => createZenexTrustBundle(badSacType)).toThrowError(
            expect.objectContaining({
                path: '/collateralAssets/0/classicAsset/type',
            }),
        );

        const overlapping = publicConfig() as any;
        overlapping.collateralAssets[0].relayFeeToken.contractId = ROUTER;
        expect(() => createZenexTrustBundle(overlapping)).toThrowError(
            expect.objectContaining({
                path: '/collateralAssets/0/relayFeeToken',
            }),
        );

        const assetOverlap = publicConfig() as any;
        assetOverlap.collateralAssets[0].contractId = ROUTER;
        assetOverlap.collateralAssets[0].relayFeeToken.contractId = ROUTER;
        expect(() => createZenexTrustBundle(assetOverlap)).toThrowError(
            expect.objectContaining({
                path: '/collateralAssets/0/contractId',
            }),
        );

        const verifierOverlap = publicConfig() as any;
        verifierOverlap.smartAccount.verifiers.webauthn.contractId = TRADING;
        expect(() => createZenexTrustBundle(verifierOverlap)).toThrowError(
            expect.objectContaining({
                path: '/smartAccount/verifiers/webauthn/contractId',
            }),
        );

        const userCollision = deployment(
            TRADING,
            SMART_ACCOUNT_WASM_SHA256,
            SMART_ACCOUNT_SPEC_SHA256,
        );
        expect(() =>
            createZenexTrustBundle(publicConfig(), [userCollision]),
        ).toThrowError(
            expect.objectContaining({
                path: '/userSmartAccounts/0/contractId',
            }),
        );
    });
});
