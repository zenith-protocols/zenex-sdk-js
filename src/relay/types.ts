export type RelayExecutionPolicy =
    | 'fillOrKill'
    | 'restOnly'
    | 'priceFree'
    | 'smartAccountDeployment';

export type RelayCallPolicy = Exclude<
    RelayExecutionPolicy,
    'smartAccountDeployment'
>;

type RelayCallRequestPayload = {
    [Policy in RelayCallPolicy]: {
        readonly requestId: string;
        readonly policy: Policy;
        readonly func: string;
        readonly auth: readonly string[];
    };
}[RelayCallPolicy];

type RelayRequestPayload =
    | RelayCallRequestPayload
    | {
          readonly requestId: string;
          readonly policy: 'smartAccountDeployment';
          readonly envelopeXdr: string;
      };

declare const VALIDATED_RELAY_REQUEST: unique symbol;

/** Opaque relay payload emitted only by the strict request builders. */
export type RelayRequest = RelayRequestPayload & {
    readonly [VALIDATED_RELAY_REQUEST]: true;
};

export const RELAY_REQUEST_STATES = [
    'preparing',
    'submitting',
    'submitted',
    'confirmed_success',
    'confirmed_failure',
    'failed_no_submit',
    'unknown',
] as const;

export type RelayRequestState = (typeof RELAY_REQUEST_STATES)[number];

/** Trusted configured identities used only to validate a relay request. */
export interface RelayContractIdentities {
    /** Deployment metadata: the one configured v2 Router contract ID. */
    router: string;
    /** Deployment metadata: configured Trading contract IDs. */
    trading: readonly string[];
    /** Deployment metadata: enabled collateral fee-token contract IDs. */
    feeTokens: readonly string[];
    /** Deployment metadata: the configured Referral contract ID. */
    referral?: string;
    /** Exact Trading-to-collateral relationships used by session rules. */
    markets?: readonly {
        readonly trading: string;
        readonly collateral: string;
    }[];
    /** Exact deployed identities and name accepted for session rule calls. */
    sessionPolicy?: {
        readonly contractId: string;
        readonly ed25519Verifier: string;
        readonly ruleName: string;
        readonly maximumDurationLedgers: bigint;
    };
}

/**
 * Evidence copied from the authoritative public deployment record.
 *
 * `deploymentTransactionHash` and `ledger` identify the on-chain deployment.
 * `instanceExecutableHash` is the WASM hash fetched from the deployed contract
 * instance. `uploadedWasmHash` and `specHash` are independently verified
 * artifact evidence. Both WASM fields must match the pinned deployment hash.
 */
export interface VerifiedInstanceEvidence {
    state: 'verified';
    deploymentTransactionHash: string;
    ledger: bigint;
    instanceExecutableHash: string;
    uploadedWasmHash: string;
    specHash: string;
}

/** Configured identity plus its pinned artifact and on-chain evidence. */
export interface VerifiedContractDeployment {
    /** Deployment metadata. */
    contractId: string;
    /** Pinned reviewed artifact hash from deployment metadata. */
    wasmHash: string;
    /** On-chain fetched and verified instance evidence. */
    evidence: VerifiedInstanceEvidence;
}

/**
 * Independent trust boundary for deployment evidence.
 *
 * Applications must back this resolver with authenticated public config or a
 * ledger-verified registry. Request data and user-supplied JSON must never be
 * used as its source.
 */
export interface TrustedDeploymentRegistry {
    resolve(contractId: string): VerifiedContractDeployment | undefined;
}

/** Metadata required to recognize a smart-account-kit 0.3.0 deployment. */
export interface SmartAccountDeploymentMetadata {
    kitVersion: '0.3.0';
    deployer: string;
    accountWasmSha256: string;
    webauthnVerifier: string;
    networkPassphrase: string;
}

export interface SingleMarketSessionInput {
    sessionPolicy: string;
    smartAccount: string;
    deployments: TrustedDeploymentRegistry;
    capability: 'single-transfer-destination-v1';
    markets: readonly {
        trading: string;
        router: string;
        collateral: string;
    }[];
    signer: {
        tag: 'External';
        verifier: string;
        keyData: Uint8Array;
    };
    name: string;
    /** Ledger of the snapshot used to construct this rule. */
    currentLedger: number;
    /** Configured maximum session lifetime from the snapshot. */
    maximumDurationLedgers: bigint;
    validUntil: number;
}

export type PolicyBuildResult<T> =
    | { kind: 'ready'; value: T }
    | { kind: 'unavailable'; code: 'INVALID_INPUT'; reason: string };
