import {
    Account,
    BASE_FEE,
    SorobanDataBuilder,
    TransactionBuilder,
    nativeToScVal,
    rpc,
    xdr,
} from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ContractErrorType } from '../../src/errors.js';
import { prepareStrictTransaction } from '../../src/order/simulation.js';
import { TreasuryContract } from '../../src/treasury/treasury_contract.js';
import type { Network } from '../../src/index.js';

const ACCOUNT = 'GDMVSPSKEUOTRFSJH2SXVUNB2JGORKDTWBMOP5OZJZP4GKRQUQWFJO4Y';
const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};

function transaction() {
    return new TransactionBuilder(new Account(ACCOUNT, '1'), {
        fee: BASE_FEE,
        networkPassphrase: network.passphrase,
    })
        .addOperation(
            xdr.Operation.fromXDR(
                new TreasuryContract(CONTRACT).getRate(),
                'base64',
            ),
        )
        .setTimeout(0)
        .build();
}

function success(
    overrides: Partial<rpc.Api.SimulateTransactionSuccessResponse> = {},
): rpc.Api.SimulateTransactionSuccessResponse {
    return {
        id: '1',
        latestLedger: 77,
        events: [],
        _parsed: true,
        transactionData: new SorobanDataBuilder(),
        minResourceFee: '456',
        result: {
            auth: [],
            retval: nativeToScVal(123n, { type: 'i128' }),
        },
        ...overrides,
    };
}

function server(response: rpc.Api.SimulateTransactionResponse) {
    return {
        simulateTransaction: vi.fn().mockResolvedValue(response),
    } as unknown as rpc.Server;
}

describe('prepareStrictTransaction', () => {
    it('returns only the transaction assembled from one exact successful simulation', async () => {
        const raw = transaction();
        const stellarRpc = server(success());
        const result = await prepareStrictTransaction({
            network,
            transaction: raw,
            parser: (value) =>
                BigInt(
                    xdr.ScVal.fromXDR(value, 'base64').i128().lo().toString(),
                ),
            server: stellarRpc,
        });
        expect(result.kind).toBe('ready');
        if (result.kind !== 'ready') return;
        expect(result.result).toBe(123n);
        expect(result.latestLedger).toBe(77);
        expect(result.minResourceFee).toBe(456n);
        expect(result.transaction).not.toBe(raw);
        expect(stellarRpc.simulateTransaction).toHaveBeenCalledTimes(1);
        expect(stellarRpc.simulateTransaction).toHaveBeenCalledWith(raw);
    });

    it('returns a typed rejection with diagnostics and no transaction', async () => {
        const response = {
            id: '2',
            latestLedger: 88,
            events: [],
            _parsed: true,
            error: 'HostError: Error(Contract, #704)',
        } as rpc.Api.SimulateTransactionErrorResponse;
        const result = await prepareStrictTransaction({
            network,
            transaction: transaction(),
            parser: () => 1,
            server: server(response),
        });
        expect(result).toMatchObject({
            kind: 'rejected',
            latestLedger: 88,
            error: { type: 704 },
            diagnosticEvents: [],
        });
        expect('transaction' in result).toBe(false);
    });

    it('returns restoreRequired without exposing a restore transaction or preamble', async () => {
        const response = success({
            restorePreamble: {
                minResourceFee: '12',
                transactionData: new SorobanDataBuilder(),
            },
        }) as rpc.Api.SimulateTransactionRestoreResponse;
        const result = await prepareStrictTransaction({
            network,
            transaction: transaction(),
            parser: () => 1,
            server: server(response),
        });
        expect(result).toEqual({ kind: 'restoreRequired', latestLedger: 77 });
        expect('transaction' in result).toBe(false);
        expect('restorePreamble' in result).toBe(false);
    });

    it('fails closed when success has no return value or the parser rejects it', async () => {
        const missing = await prepareStrictTransaction({
            network,
            transaction: transaction(),
            parser: () => 1,
            server: server(success({ result: undefined })),
        });
        expect(missing).toMatchObject({
            kind: 'rejected',
            error: { type: ContractErrorType.UnknownError },
        });
        expect('transaction' in missing).toBe(false);

        const malformed = await prepareStrictTransaction({
            network,
            transaction: transaction(),
            parser: () => {
                throw new TypeError('malformed return');
            },
            server: server(success()),
        });
        expect(malformed).toMatchObject({
            kind: 'rejected',
            error: { type: ContractErrorType.UnknownError },
        });
        expect('transaction' in malformed).toBe(false);
    });
});
