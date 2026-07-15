import {
    Account,
    Address,
    Asset,
    BASE_FEE,
    Operation,
    SorobanDataBuilder,
    StrKey,
    TransactionBuilder,
    nativeToScVal,
    rpc,
    xdr,
} from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ContractErrorType } from '../../src/errors.js';
import {
    buildRelayCallRequestFromTransaction,
    extractRelayCallAuthorization,
    prepareRelayAuthDiscovery,
    type PreparedRelayAuthDiscovery,
} from '../../src/relay/auth_discovery.js';
import type { RelayContractIdentities } from '../../src/relay/types.js';
import { TradingContract } from '../../src/trading/trading_contract.js';
import { VaultOrderKind } from '../../src/trading/trading_types.js';
import { TradingRouterContract } from '../../src/trading-router/router_contract.js';
import type { Network } from '../../src/index.js';

const REQUEST_ID = '891c52ff-8c33-42b7-a3a3-2211a3f8e1f4';
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 80));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 81));
const FEE_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 82));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 83));
const RECIPIENT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 84));
const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};
const contracts: RelayContractIdentities = {
    router: ROUTER,
    trading: [TRADING],
    feeTokens: [FEE_TOKEN],
};

function operation(amount = 1_000n): xdr.Operation {
    const trading = new TradingContract(TRADING);
    return xdr.Operation.fromXDR(
        new TradingRouterContract(ROUTER).multicallWithFee({
            calls: [
                trading.createVaultOrderCall(
                    USER,
                    VaultOrderKind.Deposit,
                    amount,
                    900n,
                ),
            ],
            user: USER,
            feeToken: FEE_TOKEN,
            maxFeeAmount: 5_000n,
            feeExpiration: 1_050,
            feeAmount: 1n,
            feeRecipient: USER,
        }),
        'base64',
    );
}

function transaction(op = operation()) {
    return new TransactionBuilder(new Account(USER, '1'), {
        fee: BASE_FEE,
        networkPassphrase: network.passphrase,
    })
        .addOperation(op)
        .setTimeout(0)
        .build();
}

function hostFunction(op = operation()): xdr.HostFunction {
    return op.body().invokeHostFunctionOp().hostFunction();
}

function authorization(
    func: xdr.HostFunction,
    nonce: number,
    signature: xdr.ScVal = xdr.ScVal.scvVoid(),
): xdr.SorobanAuthorizationEntry {
    const invoke = func.invokeContract();
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
                nonce: xdr.Int64.fromString(String(nonce)),
                signatureExpirationLedger: 1_050,
                signature,
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
    });
}

function success(
    auth: xdr.SorobanAuthorizationEntry[],
    overrides: Partial<rpc.Api.SimulateTransactionSuccessResponse> = {},
): rpc.Api.SimulateTransactionSuccessResponse {
    return {
        id: '1',
        latestLedger: 1_000,
        events: [],
        _parsed: true,
        transactionData: new SorobanDataBuilder(),
        minResourceFee: '456',
        result: {
            auth,
            retval: nativeToScVal(1, { type: 'u32' }),
        },
        ...overrides,
    };
}

function server(response: rpc.Api.SimulateTransactionResponse) {
    return {
        simulateTransaction: vi.fn().mockResolvedValue(response),
    } as unknown as rpc.Server;
}

async function discovery() {
    const raw = transaction();
    const func = hostFunction();
    const stellarRpc = server(
        success([authorization(func, 1), authorization(func, 2)]),
    );
    const result = await prepareRelayAuthDiscovery({
        network,
        transaction: raw,
        server: stellarRpc,
    });
    if (result.kind !== 'ready') {
        throw new Error('expected relay auth discovery to be ready');
    }
    return { raw, stellarRpc, result };
}

function signedTransaction(
    prepared: PreparedRelayAuthDiscovery,
    entries?: xdr.SorobanAuthorizationEntry[],
) {
    const preparedOperation = prepared.transaction.operations[0];
    if (preparedOperation.type !== 'invokeHostFunction') {
        throw new Error('expected invoke host function operation');
    }
    const auth =
        entries ??
        preparedOperation.auth?.map((entry, index) =>
            authorization(
                preparedOperation.func,
                index + 1,
                xdr.ScVal.scvBytes(Buffer.from([index + 1])),
            ),
        ) ??
        [];
    return TransactionBuilder.cloneFrom(prepared.transaction)
        .clearOperations()
        .addOperation(
            Operation.invokeHostFunction({
                func: preparedOperation.func,
                auth,
            }),
        )
        .build();
}

describe('prepareRelayAuthDiscovery', () => {
    it('bounds auth discovery even when the RPC client never settles', async () => {
        const pendingServer = {
            simulateTransaction: vi.fn().mockReturnValue(new Promise(() => {})),
        } as unknown as rpc.Server;
        const pending = prepareRelayAuthDiscovery({
            network: { ...network, opts: { allowHttp: true, timeout: 1 } },
            transaction: transaction(),
            server: pendingServer,
        }).catch((error: unknown) => error);

        const observed = await Promise.race([
            pending,
            new Promise<'still-pending'>((resolve) =>
                setTimeout(() => resolve('still-pending'), 20),
            ),
        ]);

        expect(observed).toBeInstanceOf(Error);
        expect(observed).toMatchObject({
            message: expect.stringMatching(/timed out after 1ms/i),
        });
    });

    it('records non-root auth once and returns only the assembled success', async () => {
        const { raw, stellarRpc, result } = await discovery();

        expect(result.latestLedger).toBe(1_000);
        expect(result.minResourceFee).toBe(456n);
        expect(result.transaction).not.toBe(raw);
        expect(result.transaction.operations).toHaveLength(1);
        expect(result.transaction.operations[0]).toMatchObject({
            type: 'invokeHostFunction',
            auth: expect.any(Array),
        });
        expect(stellarRpc.simulateTransaction).toHaveBeenCalledTimes(1);
        expect(stellarRpc.simulateTransaction).toHaveBeenCalledWith(
            raw,
            undefined,
            'record_allow_nonroot',
        );
    });

    it('rejects a transaction built for another network before simulation', async () => {
        const stellarRpc = server(success([]));
        await expect(
            prepareRelayAuthDiscovery({
                network: { ...network, passphrase: 'another network' },
                transaction: transaction(),
                server: stellarRpc,
            }),
        ).rejects.toThrow(/network passphrase/);
        expect(stellarRpc.simulateTransaction).not.toHaveBeenCalled();
    });

    it('rejects an RPC response with a non-u32 latest ledger', async () => {
        await expect(
            prepareRelayAuthDiscovery({
                network,
                transaction: transaction(),
                server: server(
                    success([], {
                        latestLedger: 4_294_967_296,
                    }),
                ),
            }),
        ).rejects.toThrow(/ledger sequence/);
    });

    it('fails closed for restore, rejection, or a success with no auth', async () => {
        const restore = success([], {
            restorePreamble: {
                minResourceFee: '12',
                transactionData: new SorobanDataBuilder(),
            },
        }) as rpc.Api.SimulateTransactionRestoreResponse;
        const rejected = {
            id: '2',
            latestLedger: 1_001,
            events: [],
            _parsed: true,
            error: 'HostError: Error(Contract, #704)',
        } as rpc.Api.SimulateTransactionErrorResponse;

        const restored = await prepareRelayAuthDiscovery({
            network,
            transaction: transaction(),
            server: server(restore),
        });
        const failed = await prepareRelayAuthDiscovery({
            network,
            transaction: transaction(),
            server: server(rejected),
        });
        const empty = await prepareRelayAuthDiscovery({
            network,
            transaction: transaction(),
            server: server(success([])),
        });

        expect(restored).toEqual({
            kind: 'restoreRequired',
            latestLedger: 1_000,
        });
        expect(failed).toMatchObject({
            kind: 'rejected',
            latestLedger: 1_001,
            error: { type: 704 },
        });
        expect(empty).toMatchObject({
            kind: 'rejected',
            error: { type: ContractErrorType.UnknownError },
        });
        expect('transaction' in restored).toBe(false);
        expect('transaction' in failed).toBe(false);
        expect('transaction' in empty).toBe(false);
    });
});

describe('signed relay authorization extraction', () => {
    it('preserves signed authorization order byte for byte', async () => {
        const { result } = await discovery();
        const signed = signedTransaction(result);
        const extracted = extractRelayCallAuthorization({
            discovery: result,
            signedTransaction: signed,
        });
        const operation = signed.operations[0];
        if (operation.type !== 'invokeHostFunction') return;

        expect(extracted.func).toBe(operation.func.toXDR('base64'));
        expect(extracted.auth).toEqual(
            operation.auth?.map((entry) => entry.toXDR('base64')),
        );
        expect(Object.isFrozen(extracted)).toBe(true);
        expect(Object.isFrozen(extracted.auth)).toBe(true);
    });

    it('builds a strict relay request only from the post-discovery transaction', async () => {
        const { result } = await discovery();
        const signed = signedTransaction(result);
        const request = buildRelayCallRequestFromTransaction({
            requestId: REQUEST_ID,
            policy: 'restOnly',
            contracts,
            discovery: result,
            signedTransaction: signed,
        });

        expect(request).toEqual({
            requestId: REQUEST_ID,
            policy: 'restOnly',
            func: hostFunction().toXDR('base64'),
            auth:
                signed.operations[0].type === 'invokeHostFunction'
                    ? signed.operations[0].auth?.map((entry) =>
                          entry.toXDR('base64'),
                      )
                    : [],
        });
    });

    it('rejects zero auth, multiple operations, non-invoke operations, and function changes', async () => {
        const { result } = await discovery();
        const valid = signedTransaction(result);
        const empty = signedTransaction(result, []);
        const multiple = TransactionBuilder.cloneFrom(valid)
            .addOperation(operation())
            .build();
        const payment = TransactionBuilder.cloneFrom(valid)
            .clearOperations()
            .addOperation(
                Operation.payment({
                    destination: RECIPIENT,
                    asset: Asset.native(),
                    amount: '1',
                }),
            )
            .build();
        const changedFunction = TransactionBuilder.cloneFrom(valid)
            .clearOperations()
            .addOperation(
                Operation.invokeHostFunction({
                    func: hostFunction(operation(1_001n)),
                    auth:
                        valid.operations[0].type === 'invokeHostFunction'
                            ? valid.operations[0].auth
                            : [],
                }),
            )
            .build();

        for (const candidate of [empty, multiple, payment, changedFunction]) {
            expect(() =>
                extractRelayCallAuthorization({
                    discovery: result,
                    signedTransaction: candidate,
                }),
            ).toThrow();
        }
    });

    it('rejects unsigned recorded auth and a forged discovery object', async () => {
        const { result } = await discovery();
        expect(() =>
            extractRelayCallAuthorization({
                discovery: result,
                signedTransaction: result.transaction,
            }),
        ).toThrow(/signed/);
        expect(() =>
            extractRelayCallAuthorization({
                discovery: { ...result } as PreparedRelayAuthDiscovery,
                signedTransaction: signedTransaction(result),
            }),
        ).toThrow(/discovery/);
    });

    it('rejects a signed auth tree changed after discovery', async () => {
        const { result } = await discovery();
        const signed = signedTransaction(result);
        const operation = signed.operations[0];
        if (operation.type !== 'invokeHostFunction' || !operation.auth) {
            throw new Error('expected signed invoke authorization');
        }
        const first = operation.auth[0];
        const root = first.rootInvocation();
        const changed = new xdr.SorobanAuthorizationEntry({
            credentials: first.credentials(),
            rootInvocation: new xdr.SorobanAuthorizedInvocation({
                function: root.function(),
                subInvocations: [
                    ...root.subInvocations(),
                    root.subInvocations()[0],
                ],
            }),
        });
        const altered = signedTransaction(result, [
            changed,
            ...operation.auth.slice(1),
        ]);

        expect(() =>
            extractRelayCallAuthorization({
                discovery: result,
                signedTransaction: altered,
            }),
        ).toThrow(/authorization tree/);
    });
});
