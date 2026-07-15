import { Transaction, rpc, xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import {
    ContractError,
    ContractErrorType,
    parseError,
} from '../response_parser.js';
import { decodeLedgerSequence } from '../quote/result.js';
import { buildRelayCallRequest } from './policy.js';
import type {
    RelayCallPolicy,
    RelayContractIdentities,
    RelayRequest,
} from './types.js';

declare const PREPARED_RELAY_AUTH_DISCOVERY: unique symbol;

export interface PreparedRelayAuthDiscovery {
    readonly kind: 'ready';
    readonly transaction: Transaction;
    readonly latestLedger: number;
    readonly minResourceFee: bigint;
    readonly [PREPARED_RELAY_AUTH_DISCOVERY]: true;
}

export type RelayAuthDiscoveryResult =
    | PreparedRelayAuthDiscovery
    | {
          readonly kind: 'rejected';
          readonly error: ContractError;
          readonly latestLedger: number;
          readonly diagnosticEvents: readonly xdr.DiagnosticEvent[];
      }
    | { readonly kind: 'restoreRequired'; readonly latestLedger: number };

export interface PrepareRelayAuthDiscoveryInput {
    network: Network;
    transaction: Transaction;
    server?: rpc.Server;
}

export interface RelayCallAuthorization {
    readonly func: string;
    readonly auth: readonly string[];
}

export interface ExtractRelayCallAuthorizationInput {
    discovery: PreparedRelayAuthDiscovery;
    signedTransaction: Transaction;
}

export interface BuildRelayCallRequestFromTransactionInput extends ExtractRelayCallAuthorizationInput {
    requestId: string;
    policy: RelayCallPolicy;
    contracts: RelayContractIdentities;
    currentLedger?: number;
}

interface DiscoveryMetadata {
    functionXdr: string;
    networkPassphrase: string;
    authorizationShapes: readonly string[];
}

const preparedDiscoveries = new WeakMap<object, DiscoveryMetadata>();
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

function rpcTimeoutMs(options: rpc.Server.Options | undefined): number {
    const configured = options?.timeout;
    if (configured === undefined || configured === 0) {
        return DEFAULT_RPC_TIMEOUT_MS;
    }
    if (!Number.isSafeInteger(configured) || configured < 1) {
        throw new TypeError('relay auth discovery RPC timeout must be positive');
    }
    return configured;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `relay auth discovery RPC timed out after ${timeoutMs}ms`,
                            ),
                        ),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function unknownRejection(
    simulation: rpc.Api.SimulateTransactionSuccessResponse,
    latestLedger: number,
): RelayAuthDiscoveryResult {
    return {
        kind: 'rejected',
        error: new ContractError(ContractErrorType.UnknownError),
        latestLedger,
        diagnosticEvents: Object.freeze([...simulation.events]),
    };
}

function singleInvokeOperation(
    transaction: Transaction,
    label: string,
): Extract<Transaction['operations'][number], { type: 'invokeHostFunction' }> {
    if (!(transaction instanceof Transaction)) {
        throw new TypeError(`${label} must be a Stellar transaction`);
    }
    if (transaction.operations.length !== 1) {
        throw new TypeError(`${label} must contain exactly one operation`);
    }
    const operation = transaction.operations[0];
    if (operation.type !== 'invokeHostFunction') {
        throw new TypeError(`${label} must contain one invoke-host operation`);
    }
    return operation;
}

function exactFunction(left: xdr.HostFunction, rightXdr: string): boolean {
    return left.toXDR('base64') === rightXdr;
}

function hasSignedAddressCredentials(
    entry: xdr.SorobanAuthorizationEntry,
): boolean {
    const credentials = entry.credentials();
    if (credentials.switch().name !== 'sorobanCredentialsAddress') {
        return false;
    }
    const address = credentials.address();
    if (address.signatureExpirationLedger() === 0) return false;
    const signature = address.signature();
    if (signature.switch().name === 'scvVoid') return false;
    return (
        signature.switch().name !== 'scvBytes' ||
        signature.bytes().byteLength > 0
    );
}

function authorizationShape(entry: xdr.SorobanAuthorizationEntry): string {
    const credentials = entry.credentials();
    const normalizedCredentials =
        credentials.switch().name === 'sorobanCredentialsAddress'
            ? xdr.SorobanCredentials.sorobanCredentialsAddress(
                  new xdr.SorobanAddressCredentials({
                      address: credentials.address().address(),
                      nonce: credentials.address().nonce(),
                      signatureExpirationLedger: 0,
                      signature: xdr.ScVal.scvVoid(),
                  }),
              )
            : xdr.SorobanCredentials.sorobanCredentialsSourceAccount();
    return new xdr.SorobanAuthorizationEntry({
        credentials: normalizedCredentials,
        rootInvocation: entry.rootInvocation(),
    }).toXDR('base64');
}

/** Record the complete non-root Soroban auth tree for one relay operation. */
export async function prepareRelayAuthDiscovery(
    input: PrepareRelayAuthDiscoveryInput,
): Promise<RelayAuthDiscoveryResult> {
    if (input.transaction.networkPassphrase !== input.network.passphrase) {
        throw new TypeError(
            'relay auth discovery transaction network passphrase does not match the configured network',
        );
    }
    const rawOperation = singleInvokeOperation(
        input.transaction,
        'relay auth discovery transaction',
    );
    const functionXdr = rawOperation.func.toXDR('base64');
    const timeoutMs = rpcTimeoutMs(input.network.opts);
    const stellarRpc =
        input.server ??
        new rpc.Server(input.network.rpc, {
            ...input.network.opts,
            timeout: timeoutMs,
        });
    const simulation = await withTimeout(
        stellarRpc.simulateTransaction(
            input.transaction,
            undefined,
            'record_allow_nonroot',
        ),
        timeoutMs,
    );
    const latestLedger = decodeLedgerSequence(simulation.latestLedger);

    if (rpc.Api.isSimulationRestore(simulation)) {
        return {
            kind: 'restoreRequired',
            latestLedger,
        };
    }
    if (rpc.Api.isSimulationError(simulation)) {
        return {
            kind: 'rejected',
            error: parseError(simulation),
            latestLedger,
            diagnosticEvents: Object.freeze([...simulation.events]),
        };
    }
    if (!simulation.result?.retval) {
        return unknownRejection(simulation, latestLedger);
    }

    try {
        const minResourceFee = BigInt(simulation.minResourceFee);
        if (minResourceFee < 0n) {
            return unknownRejection(simulation, latestLedger);
        }
        const transaction = rpc
            .assembleTransaction(input.transaction, simulation)
            .build();
        const assembled = singleInvokeOperation(
            transaction,
            'assembled relay auth discovery transaction',
        );
        const authorizationEntries = assembled.auth ?? [];
        if (
            !exactFunction(assembled.func, functionXdr) ||
            authorizationEntries.length === 0
        ) {
            return unknownRejection(simulation, latestLedger);
        }
        const prepared = Object.freeze({
            kind: 'ready' as const,
            transaction,
            latestLedger,
            minResourceFee,
        }) as PreparedRelayAuthDiscovery;
        preparedDiscoveries.set(prepared, {
            functionXdr,
            networkPassphrase: input.transaction.networkPassphrase,
            authorizationShapes: Object.freeze(
                authorizationEntries.map(authorizationShape),
            ),
        });
        return prepared;
    } catch {
        return unknownRejection(simulation, latestLedger);
    }
}

/** Extract the canonical signed function and ordered auth from one discovery. */
export function extractRelayCallAuthorization(
    input: ExtractRelayCallAuthorizationInput,
): RelayCallAuthorization {
    const metadata = preparedDiscoveries.get(input.discovery);
    if (metadata === undefined) {
        throw new TypeError('relay auth discovery proof is invalid');
    }
    if (
        input.signedTransaction.networkPassphrase !== metadata.networkPassphrase
    ) {
        throw new TypeError(
            'signed relay transaction uses a different network passphrase',
        );
    }
    const operation = singleInvokeOperation(
        input.signedTransaction,
        'signed relay transaction',
    );
    if (!exactFunction(operation.func, metadata.functionXdr)) {
        throw new TypeError(
            'signed relay function does not match its auth discovery transaction',
        );
    }
    const entries = operation.auth ?? [];
    if (entries.length === 0) {
        throw new TypeError(
            'signed relay transaction must contain recorded authorization',
        );
    }
    const submittedShapes = entries.map(authorizationShape);
    if (
        submittedShapes.length !== metadata.authorizationShapes.length ||
        submittedShapes.some(
            (shape, index) => shape !== metadata.authorizationShapes[index],
        )
    ) {
        throw new TypeError(
            'signed relay authorization tree does not match its discovery result',
        );
    }
    if (entries.some((entry) => !hasSignedAddressCredentials(entry))) {
        throw new TypeError(
            'signed relay transaction must contain signed address authorization',
        );
    }
    const auth = Object.freeze(entries.map((entry) => entry.toXDR('base64')));
    return Object.freeze({
        func: operation.func.toXDR('base64'),
        auth,
    });
}

/** Build a strict relay request from the signed post-discovery transaction. */
export function buildRelayCallRequestFromTransaction(
    input: BuildRelayCallRequestFromTransactionInput,
): RelayRequest {
    const extracted = extractRelayCallAuthorization(input);
    return buildRelayCallRequest({
        requestId: input.requestId,
        policy: input.policy,
        func: extracted.func,
        auth: [...extracted.auth],
        contracts: input.contracts,
        currentLedger: input.currentLedger,
    });
}
