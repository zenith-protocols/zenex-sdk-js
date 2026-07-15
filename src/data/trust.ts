import { Asset, StrKey } from '@stellar/stellar-sdk';
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
} from '../relay/policy.js';
import type {
    RelayContractIdentities,
    SmartAccountDeploymentMetadata,
    TrustedDeploymentRegistry,
    VerifiedContractDeployment,
} from '../relay/types.js';
import {
    verifiedSmartAccountInstanceIssue,
    type TrustedSmartAccountRegistry,
    type VerifiedSmartAccountInstance,
} from '../relay/smart_account_evidence.js';
import type { PriceFreeRelayConfiguration } from '../relay/price_free.js';
import type { TradingDeployment } from '../trading/trading_snapshot.js';
import type { PublicConfig } from './generated.js';

const NETWORKS = {
    testnet: {
        id: 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
        passphrase: 'Test SDF Network ; September 2015',
    },
    mainnet: {
        id: '7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979',
        passphrase: 'Public Global Stellar Network ; September 2015',
    },
} as const;
const SHA256 = /^[0-9a-f]{64}$/i;
const U32_MAX = 4_294_967_295n;
const MAX_DECIMAL_PLACES = 38;
const MAX_PRICE_AGE_MS = 60_000;

export class ZenexPublicConfigTrustError extends Error {
    constructor(
        readonly path: string,
        reason: string,
    ) {
        super(`Untrusted public config at ${path}: ${reason}`);
        this.name = 'ZenexPublicConfigTrustError';
    }
}

export interface ZenexTrustBundle {
    readonly relayContracts: RelayContractIdentities;
    readonly deployments: TrustedDeploymentRegistry;
    /** Live, ledger-observed per-user smart-account instances. */
    readonly smartAccounts: TrustedSmartAccountRegistry;
    readonly smartAccountDeployment: SmartAccountDeploymentMetadata;
    /** Complete public-only configuration for the safe price-free builder. */
    readonly priceFree: PriceFreeRelayConfiguration;
    /** Exact, independently validated execution metadata for each market. */
    readonly tradingDeployments: readonly TrustedTradingDeployment[];
    readonly sessionPolicy: {
        readonly contractId: string;
        readonly capability: 'single-transfer-destination-v1';
        readonly ruleName: string;
        readonly maxDurationLedgers: bigint;
        readonly allowedContracts: readonly string[];
        readonly allowedTransferDestinations: readonly string[];
    };
}

export interface TrustedTradingDeployment extends TradingDeployment {
    readonly marketId: string;
    readonly collateralAssetId: string;
    readonly collateralDecimals: number;
    readonly tokenDecimals: number;
    readonly priceDecimals: number;
    readonly maxPriceAgeMs: number;
    /** Conservative whole-second freshness bound for `loadTradingSnapshot`. */
    readonly maxPriceAge: bigint;
}

function fail(path: string, reason: string): never {
    throw new ZenexPublicConfigTrustError(path, reason);
}

function sameHash(actual: string, expected: string): boolean {
    return actual.toLowerCase() === expected;
}

function cloneVerifiedDeployment(
    deployment: VerifiedContractDeployment,
    expectedWasm: string,
    expectedSpec: string,
    path: string,
): VerifiedContractDeployment {
    if (!StrKey.isValidContract(deployment.contractId)) {
        fail(`${path}/contractId`, 'must be a valid contract ID');
    }
    if (!sameHash(deployment.wasmHash, expectedWasm)) {
        fail(`${path}/wasmHash`, 'does not match the reviewed artifact');
    }
    const evidence = deployment.evidence;
    if (
        evidence.state !== 'verified' ||
        !SHA256.test(evidence.deploymentTransactionHash) ||
        typeof evidence.ledger !== 'bigint' ||
        evidence.ledger <= 0n ||
        evidence.ledger > U32_MAX ||
        !sameHash(evidence.instanceExecutableHash, expectedWasm) ||
        !sameHash(evidence.uploadedWasmHash, expectedWasm) ||
        !sameHash(evidence.specHash, expectedSpec)
    ) {
        fail(`${path}/evidence`, 'does not match the reviewed deployment');
    }
    return Object.freeze({
        contractId: deployment.contractId,
        wasmHash: expectedWasm,
        evidence: Object.freeze({
            state: 'verified' as const,
            deploymentTransactionHash:
                evidence.deploymentTransactionHash.toLowerCase(),
            ledger: evidence.ledger,
            instanceExecutableHash: expectedWasm,
            uploadedWasmHash: expectedWasm,
            specHash: expectedSpec,
        }),
    });
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
    return (
        left.length === right.length &&
        new Set(left).size === left.length &&
        left.every((value) => right.includes(value))
    );
}

function checkedInteger(
    value: number,
    minimum: number,
    maximum: number,
    path: string,
): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}

function checkedFeedId(value: bigint, path: string): number {
    if (typeof value !== 'bigint' || value < 0n || value > U32_MAX) {
        fail(path, 'must be a u32 bigint');
    }
    const parsed = parseInt(value.toString(), 10);
    if (BigInt(parsed) !== value) {
        fail(path, 'cannot be represented as an exact u32 number');
    }
    return parsed;
}

function requireUniqueIds(
    values: readonly { readonly id: string }[],
    path: string,
): void {
    const indexes = new Map<string, number>();
    values.forEach((value, index) => {
        const previous = indexes.get(value.id);
        if (previous !== undefined) {
            fail(
                `${path}/${index}/id`,
                `duplicates the logical ID at ${path}/${previous}/id`,
            );
        }
        indexes.set(value.id, index);
    });
}

/**
 * Convert decoded public config into the independent relay trust boundaries.
 * Per-user smart-account instances are accepted only as separately verified
 * records and are never inferred from the global public config.
 */
export function createZenexTrustBundle(
    config: PublicConfig,
    userSmartAccounts: readonly VerifiedSmartAccountInstance[] = [],
): ZenexTrustBundle {
    const network = NETWORKS[config.network.kind];
    if (!sameHash(config.network.id, network.id)) {
        fail(
            '/network/id',
            `does not match the ${config.network.kind} passphrase`,
        );
    }
    if (config.evidence.state !== 'verified') {
        fail('/evidence', 'core deployment evidence is not verified');
    }
    if (
        config.evidence.ledger <= 0n ||
        config.evidence.ledger > U32_MAX ||
        !SHA256.test(config.evidence.deploymentTransactionHash)
    ) {
        fail('/evidence', 'core deployment evidence is invalid');
    }
    if (!config.smartAccount.enabled) {
        fail('/smartAccount/enabled', 'smart-account deployment is disabled');
    }
    if (
        config.smartAccount.kitVersion !== '0.3.0' ||
        config.smartAccount.deployer !== SMART_ACCOUNT_DEPLOYER ||
        !StrKey.isValidEd25519PublicKey(config.smartAccount.deployer)
    ) {
        fail(
            '/smartAccount/deployer',
            'does not match smart-account-kit 0.3.0',
        );
    }
    if (
        !sameHash(
            config.smartAccount.accountArtifact.wasmHash,
            SMART_ACCOUNT_WASM_SHA256,
        ) ||
        !sameHash(
            config.smartAccount.accountArtifact.specHash,
            SMART_ACCOUNT_SPEC_SHA256,
        )
    ) {
        fail(
            '/smartAccount/accountArtifact',
            'does not match the reviewed account artifact',
        );
    }

    const maxPriceAgeMs = checkedInteger(
        config.relay.maxPriceAgeMs,
        1,
        MAX_PRICE_AGE_MS,
        '/relay/maxPriceAgeMs',
    );
    const maxPriceAge = BigInt(maxPriceAgeMs) / 1_000n;
    requireUniqueIds(config.collateralAssets, '/collateralAssets');
    requireUniqueIds(config.markets, '/markets');

    const webauthn = cloneVerifiedDeployment(
        config.smartAccount.verifiers.webauthn,
        WEBAUTHN_VERIFIER_WASM_SHA256,
        WEBAUTHN_VERIFIER_SPEC_SHA256,
        '/smartAccount/verifiers/webauthn',
    );
    const ed25519 = cloneVerifiedDeployment(
        config.smartAccount.verifiers.ed25519,
        ED25519_VERIFIER_WASM_SHA256,
        ED25519_VERIFIER_SPEC_SHA256,
        '/smartAccount/verifiers/ed25519',
    );
    const session = cloneVerifiedDeployment(
        config.smartAccount.sessionPolicy.deployment,
        SESSION_POLICY_WASM_SHA256,
        SESSION_POLICY_SPEC_SHA256,
        '/smartAccount/sessionPolicy/deployment',
    );

    const configuredIdentities: readonly (readonly [string, string])[] = [
        ['/contracts/router', config.contracts.router],
        ['/contracts/referral', config.contracts.referral],
        ['/contracts/priceVerifier', config.contracts.priceVerifier],
        ['/contracts/treasury', config.contracts.treasury],
        ...config.collateralAssets.map(
            (asset, index) =>
                [
                    `/collateralAssets/${index}/contractId`,
                    asset.contractId,
                ] as const,
        ),
        ...config.markets.flatMap((market, index) => [
            [`/markets/${index}/trading`, market.trading] as const,
            [`/markets/${index}/vault`, market.vault] as const,
        ]),
        ['/smartAccount/verifiers/webauthn/contractId', webauthn.contractId],
        ['/smartAccount/verifiers/ed25519/contractId', ed25519.contractId],
        [
            '/smartAccount/sessionPolicy/deployment/contractId',
            session.contractId,
        ],
    ];
    const configuredIdentityPaths = new Map<string, string>();
    for (const [path, contractId] of configuredIdentities) {
        if (!StrKey.isValidContract(contractId)) {
            fail(path, 'must be a valid contract ID');
        }
        const previous = configuredIdentityPaths.get(contractId);
        if (previous !== undefined) {
            fail(path, `duplicates the configured identity at ${previous}`);
        }
        configuredIdentityPaths.set(contractId, path);
    }

    const marketContracts = config.markets.map((market) => market.trading);
    if (
        !sameSet(
            config.smartAccount.sessionPolicy.allowedContracts,
            marketContracts,
        ) ||
        !sameSet(
            config.smartAccount.sessionPolicy.allowedTransferDestinations,
            marketContracts,
        )
    ) {
        fail(
            '/smartAccount/sessionPolicy',
            'allowed contracts and destinations must match configured Trading identities',
        );
    }
    if (
        config.smartAccount.sessionPolicy.maxDurationLedgers <= 0n ||
        config.smartAccount.sessionPolicy.maxDurationLedgers > U32_MAX
    ) {
        fail(
            '/smartAccount/sessionPolicy/maxDurationLedgers',
            'must be a positive u32 duration',
        );
    }

    const trading = [...new Set(marketContracts)];
    const collateralById = new Map(
        config.collateralAssets.map((asset) => [asset.id, asset]),
    );
    const relayMarkets = config.markets.map((market, index) => {
        const collateral = collateralById.get(market.collateralAssetId);
        if (collateral === undefined) {
            fail(
                `/markets/${index}/collateralAssetId`,
                'does not identify a configured collateral asset',
            );
        }
        return Object.freeze({
            trading: market.trading,
            collateral: collateral.contractId,
        });
    });
    const tradingDeployments = config.markets.map((market, index) => {
        const path = `/markets/${index}`;
        const collateral = collateralById.get(market.collateralAssetId);
        if (collateral === undefined) {
            fail(
                `${path}/collateralAssetId`,
                'does not identify a configured collateral asset',
            );
        }
        const collateralDecimals = checkedInteger(
            collateral.decimals,
            0,
            MAX_DECIMAL_PLACES,
            `/collateralAssets/${config.collateralAssets.indexOf(collateral)}/decimals`,
        );
        const tokenDecimals = checkedInteger(
            market.tokenDecimals,
            0,
            MAX_DECIMAL_PLACES,
            `${path}/tokenDecimals`,
        );
        const priceDecimals = checkedInteger(
            market.priceDecimals,
            0,
            MAX_DECIMAL_PLACES,
            `${path}/priceDecimals`,
        );
        const exponent = checkedInteger(
            market.exponent,
            -MAX_DECIMAL_PLACES,
            0,
            `${path}/exponent`,
        );
        if (exponent !== -priceDecimals) {
            fail(
                `${path}/exponent`,
                'must be the signed inverse of price decimals',
            );
        }
        const vaultDecimalsOffset = checkedInteger(
            market.vaultDecimalsOffset,
            0,
            MAX_DECIMAL_PLACES,
            `${path}/vaultDecimalsOffset`,
        );
        const vaultShareDecimals = checkedInteger(
            market.vaultShareDecimals,
            0,
            MAX_DECIMAL_PLACES,
            `${path}/vaultShareDecimals`,
        );
        if (vaultShareDecimals !== collateralDecimals + vaultDecimalsOffset) {
            fail(
                `${path}/vaultShareDecimals`,
                'must equal collateral decimals plus the vault offset',
            );
        }
        return Object.freeze({
            marketId: market.id,
            collateralAssetId: market.collateralAssetId,
            collateralDecimals,
            tokenDecimals,
            priceDecimals,
            maxPriceAgeMs,
            maxPriceAge,
            trading: market.trading,
            router: config.contracts.router,
            vault: market.vault,
            priceVerifier: config.contracts.priceVerifier,
            treasury: config.contracts.treasury,
            feedId: checkedFeedId(market.feedId, `${path}/feedId`),
            exponent,
            vaultDecimalsOffset,
            vaultShareDecimals,
        });
    });
    const feeTokens = [
        ...new Set(
            config.collateralAssets.flatMap((asset) =>
                asset.relayFeeToken === undefined
                    ? []
                    : [asset.relayFeeToken.contractId],
            ),
        ),
    ];
    if (!StrKey.isValidContract(config.contracts.router)) {
        fail('/contracts/router', 'must be a valid contract ID');
    }
    if (
        trading.length === 0 ||
        trading.some((id) => !StrKey.isValidContract(id))
    ) {
        fail('/markets', 'must contain valid Trading contract identities');
    }
    if (
        feeTokens.length === 0 ||
        feeTokens.some((id) => !StrKey.isValidContract(id))
    ) {
        fail('/collateralAssets', 'must contain an enabled relay fee token');
    }
    config.collateralAssets.forEach((asset, index) => {
        if (
            asset.relayFeeToken !== undefined &&
            (asset.relayFeeToken.collateralAssetId !== asset.id ||
                asset.relayFeeToken.contractId !== asset.contractId ||
                asset.relayFeeToken.decimals !== asset.decimals)
        ) {
            fail(
                `/collateralAssets/${index}/relayFeeToken`,
                'must identify its containing collateral asset exactly',
            );
        }
        if (asset.classicAsset === undefined) return;
        const expectedType =
            asset.classicAsset.code.length <= 4
                ? 'credit_alphanum4'
                : 'credit_alphanum12';
        if (asset.classicAsset.type !== expectedType) {
            fail(
                `/collateralAssets/${index}/classicAsset/type`,
                `must be ${expectedType} for this asset code`,
            );
        }
        let derived: string;
        try {
            derived = new Asset(
                asset.classicAsset.code,
                asset.classicAsset.issuer,
            ).contractId(network.passphrase);
        } catch {
            fail(
                `/collateralAssets/${index}/classicAsset`,
                'is not valid Stellar classic-asset metadata',
            );
        }
        if (derived !== asset.contractId) {
            fail(
                `/collateralAssets/${index}/classicAsset`,
                'does not derive to the declared SAC contract',
            );
        }
    });
    const relayIdentityList = [
        config.contracts.router,
        ...trading,
        ...feeTokens,
    ];
    if (new Set(relayIdentityList).size !== relayIdentityList.length) {
        fail(
            '/contracts',
            'Router, Trading, and fee-token identities must be disjoint',
        );
    }

    const records = new Map<string, VerifiedContractDeployment>();
    for (const record of [webauthn, ed25519, session]) {
        if (records.has(record.contractId)) {
            fail(
                '/smartAccount',
                'verified deployment identities must be unique',
            );
        }
        records.set(record.contractId, record);
    }
    const smartAccountRecords = new Map<string, VerifiedSmartAccountInstance>();
    userSmartAccounts.forEach((record, index) => {
        const path = `/userSmartAccounts/${index}`;
        const issue = verifiedSmartAccountInstanceIssue(record);
        if (issue !== undefined) {
            fail(path, issue);
        }
        if (record.networkId !== network.id) {
            fail(
                `${path}/networkId`,
                `does not match the ${config.network.kind} network`,
            );
        }
        if (record.networkPassphrase !== network.passphrase) {
            fail(
                `${path}/networkPassphrase`,
                `does not match the ${config.network.kind} network`,
            );
        }
        const configuredPath = configuredIdentityPaths.get(record.contractId);
        if (configuredPath !== undefined) {
            fail(
                `${path}/contractId`,
                `duplicates the configured identity at ${configuredPath}`,
            );
        }
        if (smartAccountRecords.has(record.contractId)) {
            fail(`${path}/contractId`, 'smart account identity is duplicated');
        }
        smartAccountRecords.set(record.contractId, record);
    });

    const relayContracts = Object.freeze({
        router: config.contracts.router,
        trading: Object.freeze(trading),
        feeTokens: Object.freeze(feeTokens),
        referral: config.contracts.referral,
        markets: Object.freeze(relayMarkets),
        sessionPolicy: Object.freeze({
            contractId: session.contractId,
            ed25519Verifier: ed25519.contractId,
            ruleName: config.smartAccount.sessionPolicy.ruleName,
            maximumDurationLedgers:
                config.smartAccount.sessionPolicy.maxDurationLedgers,
        }),
    });
    const deployments = Object.freeze({
        resolve(contractId: string) {
            return records.get(contractId);
        },
    });
    const smartAccounts = Object.freeze({
        networkId: network.id,
        networkPassphrase: network.passphrase,
        resolve(contractId: string) {
            return smartAccountRecords.get(contractId);
        },
    });
    return Object.freeze({
        relayContracts,
        deployments,
        smartAccounts,
        tradingDeployments: Object.freeze(tradingDeployments),
        smartAccountDeployment: Object.freeze({
            kitVersion: '0.3.0' as const,
            deployer: SMART_ACCOUNT_DEPLOYER,
            accountWasmSha256: SMART_ACCOUNT_WASM_SHA256,
            webauthnVerifier: webauthn.contractId,
            networkPassphrase: network.passphrase,
        }),
        priceFree: Object.freeze({
            router: config.contracts.router,
            referral: config.contracts.referral,
            markets: Object.freeze(relayMarkets),
            feeTokens: Object.freeze(feeTokens),
            sessionPolicy: Object.freeze({
                contractId: session.contractId,
                ed25519Verifier: ed25519.contractId,
                ruleName: config.smartAccount.sessionPolicy.ruleName,
                maximumDurationLedgers:
                    config.smartAccount.sessionPolicy.maxDurationLedgers,
            }),
            deployments,
            smartAccounts,
        }),
        sessionPolicy: Object.freeze({
            contractId: session.contractId,
            capability: 'single-transfer-destination-v1' as const,
            ruleName: config.smartAccount.sessionPolicy.ruleName,
            maxDurationLedgers:
                config.smartAccount.sessionPolicy.maxDurationLedgers,
            allowedContracts: Object.freeze([
                ...config.smartAccount.sessionPolicy.allowedContracts,
            ]),
            allowedTransferDestinations: Object.freeze([
                ...config.smartAccount.sessionPolicy
                    .allowedTransferDestinations,
            ]),
        }),
    });
}
