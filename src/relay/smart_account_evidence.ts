import { Address, StrKey, hash, rpc, xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import { contractInstanceLedgerKey } from '../ledger-keys.js';

const SHA256 = /^[0-9a-f]{64}$/;
const U32_MAX = 4_294_967_295;

/** Pinned smart-account-kit 0.3.0 account artifact. */
export const SMART_ACCOUNT_WASM_SHA256 =
    '9cd9b828e8723b4d21ede1ceb4bb9327310a807bfc3697bf8060f3d90b9446b4';

declare const VERIFIED_SMART_ACCOUNT_INSTANCE: unique symbol;

/**
 * Live smart-account instance evidence observed through Stellar RPC.
 *
 * The type is compile-time opaque and its object identity is registered in a
 * module-private WeakSet. Copies made through object spread or JSON therefore
 * cannot cross the live-evidence trust boundary.
 */
export type VerifiedSmartAccountInstance = Readonly<{
    readonly contractId: string;
    readonly networkId: string;
    readonly networkPassphrase: string;
    readonly observedLedger: number;
    readonly instanceExecutableHash: string;
    readonly [VERIFIED_SMART_ACCOUNT_INSTANCE]: true;
}>;

/** Resolver containing only live, runtime-authenticated account evidence. */
export interface TrustedSmartAccountRegistry {
    readonly networkId: string;
    readonly networkPassphrase: string;
    resolve(contractId: string): VerifiedSmartAccountInstance | undefined;
}

export interface VerifySmartAccountInstanceInput {
    readonly network: Network;
    /** Lower-case SHA-256 of the exact network passphrase. */
    readonly networkId: string;
    /** Deployed smart-account contract identity. */
    readonly contractId: string;
}

export class SmartAccountInstanceVerificationError extends Error {
    readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'SmartAccountInstanceVerificationError';
        this.cause = cause;
    }
}

const verifiedInstances = new WeakSet<object>();

function fail(message: string, cause?: unknown): never {
    throw new SmartAccountInstanceVerificationError(message, cause);
}

function validU32(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= U32_MAX
    );
}

export interface VerifiedSmartAccountInstanceExpectation {
    readonly contractId?: string;
    readonly networkId?: string;
    readonly networkPassphrase?: string;
    readonly observedLedger?: number;
}

/** Internal sibling-module check for the private runtime evidence identity. */
export function verifiedSmartAccountInstanceIssue(
    value: unknown,
    expected: VerifiedSmartAccountInstanceExpectation = {},
): string | undefined {
    if (
        value === null ||
        typeof value !== 'object' ||
        !verifiedInstances.has(value)
    ) {
        return 'smart account instance is not live verified evidence';
    }
    const instance = value as VerifiedSmartAccountInstance;
    if (
        !StrKey.isValidContract(instance.contractId) ||
        !SHA256.test(instance.networkId) ||
        typeof instance.networkPassphrase !== 'string' ||
        instance.networkPassphrase.length === 0 ||
        !validU32(instance.observedLedger) ||
        instance.instanceExecutableHash !== SMART_ACCOUNT_WASM_SHA256
    ) {
        return 'smart account instance evidence is malformed';
    }
    if (
        expected.contractId !== undefined &&
        instance.contractId !== expected.contractId
    ) {
        return 'smart account instance has a different contract identity';
    }
    if (
        expected.networkId !== undefined &&
        instance.networkId !== expected.networkId
    ) {
        return 'smart account instance belongs to a different network';
    }
    if (
        expected.networkPassphrase !== undefined &&
        instance.networkPassphrase !== expected.networkPassphrase
    ) {
        return 'smart account instance uses a different network passphrase';
    }
    if (
        expected.observedLedger !== undefined &&
        instance.observedLedger !== expected.observedLedger
    ) {
        return 'smart account instance was observed at a different ledger';
    }
    return undefined;
}

/** Resolve and validate exact live smart-account evidence from a registry. */
export function trustedSmartAccountInstanceIssue(
    registry: TrustedSmartAccountRegistry,
    contractId: string,
    observedLedger: number,
): string | undefined {
    if (!StrKey.isValidContract(contractId)) {
        return 'smart account identity must be a contract ID';
    }
    if (!registry || typeof registry.resolve !== 'function') {
        return 'trusted smart account instance registry is required';
    }
    if (
        !SHA256.test(registry.networkId) ||
        typeof registry.networkPassphrase !== 'string' ||
        registry.networkPassphrase.length === 0
    ) {
        return 'trusted smart account instance registry network is invalid';
    }
    let instance: VerifiedSmartAccountInstance | undefined;
    try {
        instance = registry.resolve(contractId);
    } catch {
        return 'smart account instance registry lookup failed';
    }
    if (instance === undefined) {
        return 'smart account instance is absent from the trusted registry';
    }
    return verifiedSmartAccountInstanceIssue(instance, {
        contractId,
        networkId: registry.networkId,
        networkPassphrase: registry.networkPassphrase,
        observedLedger,
    });
}

/**
 * Verify one deployed account against the exact live contract-instance entry.
 *
 * This intentionally performs one snapshot read and does not retry. Callers
 * must use `observedLedger` when building a session mutation so the evidence
 * cannot silently cross ledger snapshots.
 */
export async function verifySmartAccountInstance(
    input: VerifySmartAccountInstanceInput,
): Promise<VerifiedSmartAccountInstance> {
    if (!input || typeof input !== 'object') {
        fail('smart account verification input must be an object');
    }
    const network = input.network;
    const rpcUrl = network?.rpc;
    const rpcOptions = network?.opts;
    const networkPassphrase = network?.passphrase;
    const networkId = input.networkId;
    const contractId = input.contractId;
    if (
        !network ||
        typeof network !== 'object' ||
        typeof rpcUrl !== 'string' ||
        rpcUrl.length === 0 ||
        typeof networkPassphrase !== 'string' ||
        networkPassphrase.length === 0
    ) {
        fail('smart account verification network is invalid');
    }
    const expectedNetworkId = hash(
        Buffer.from(networkPassphrase, 'utf8'),
    ).toString('hex');
    if (
        typeof networkId !== 'string' ||
        !SHA256.test(networkId) ||
        networkId !== expectedNetworkId
    ) {
        fail(
            'smart account verification network ID must be the canonical passphrase hash',
        );
    }
    if (typeof contractId !== 'string' || !StrKey.isValidContract(contractId)) {
        fail('smart account identity must be a contract ID');
    }

    const requestedKey = contractInstanceLedgerKey(contractId);
    let response: Awaited<ReturnType<rpc.Server['getLedgerEntries']>>;
    try {
        const server = new rpc.Server(rpcUrl, rpcOptions);
        response = await server.getLedgerEntries(requestedKey);
    } catch (error) {
        fail('smart account instance RPC lookup failed', error);
    }

    if (!validU32(response.latestLedger)) {
        fail('smart account instance latest ledger must be a u32');
    }
    if (!Array.isArray(response.entries) || response.entries.length !== 1) {
        fail('RPC must return exactly one contract instance entry');
    }

    try {
        const entry = response.entries[0];
        if (
            !(entry.key instanceof xdr.LedgerKey) ||
            !(entry.val instanceof xdr.LedgerEntryData)
        ) {
            fail(
                'contract instance must be a parsed contract-data ledger entry',
            );
        }
        if (
            entry.lastModifiedLedgerSeq !== undefined &&
            !validU32(entry.lastModifiedLedgerSeq)
        ) {
            fail('contract instance last-modified ledger must be a u32');
        }
        if (entry.key.toXDR('hex') !== requestedKey.toXDR('hex')) {
            fail(
                'returned contract instance ledger key does not match request',
            );
        }
        if (entry.val.switch().name !== 'contractData') {
            fail('contract instance must be a contract-data ledger entry');
        }
        const contractData = entry.val.contractData();
        if (
            Address.fromScAddress(contractData.contract()).toString() !==
            contractId
        ) {
            fail('contract-data entry has a different contract identity');
        }
        if (
            contractData.key().switch().name !== 'scvLedgerKeyContractInstance'
        ) {
            fail('contract-data entry must use the contract instance key');
        }
        if (contractData.durability().name !== 'persistent') {
            fail('contract instance entry must use persistent durability');
        }
        if (contractData.val().switch().name !== 'scvContractInstance') {
            fail('contract-data entry must contain a contract instance value');
        }
        const executable = contractData.val().instance().executable();
        if (executable.switch().name !== 'contractExecutableWasm') {
            fail('smart account instance must use a WASM executable');
        }
        const executableHash = executable.wasmHash().toString('hex');
        if (executableHash !== SMART_ACCOUNT_WASM_SHA256) {
            fail(
                'smart account executable does not match the reviewed smart-account WASM',
            );
        }

        const verified = Object.freeze({
            contractId,
            networkId,
            networkPassphrase,
            observedLedger: response.latestLedger,
            instanceExecutableHash: executableHash,
        }) as VerifiedSmartAccountInstance;
        verifiedInstances.add(verified);
        return verified;
    } catch (error) {
        if (error instanceof SmartAccountInstanceVerificationError) {
            throw error;
        }
        fail('smart account instance RPC evidence is malformed', error);
    }
}
