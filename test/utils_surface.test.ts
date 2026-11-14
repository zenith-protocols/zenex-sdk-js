import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    Address,
    SorobanDataBuilder,
    StrKey,
    nativeToScVal,
    rpc,
    xdr,
} from '@stellar/stellar-sdk';
import {
    enumStorageKeyWithAddress,
    decodeEntryKey,
    contractInstanceLedgerKey,
} from '../src/contracts/keys.js';
import { tokenBalanceLedgerKey } from '../src/token.js';
import { toFixed, toFloat, mulDivFloor, mulDivCeil, SCALAR_18 } from '../src/math/index.js';
import { simulateAndParse } from '../src/simulate.js';
import { ZenexError, ZenexErrorCode } from '../src/errors.js';
import { TreasuryContract } from '../src/contracts/treasury/contract.js';
import { Network } from '../src/index.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ledger-keys generic builders', () => {
    it('enumStorageKeyWithAddress accepts string and Address', () => {
        const fromString = enumStorageKeyWithAddress('Balance', USER);
        const fromAddress = enumStorageKeyWithAddress(
            'Balance',
            Address.fromString(USER),
        );
        expect(fromString.toXDR('base64')).toBe(fromAddress.toXDR('base64'));
        expect(decodeEntryKey(fromString)).toBe('Balance');
    });

    it('tokenBalanceLedgerKey builds a persistent contract-data key', () => {
        const key = tokenBalanceLedgerKey(TOKEN, USER);
        const data = key.contractData();
        expect(Address.fromScAddress(data.contract()).toString()).toBe(TOKEN);
        expect(data.durability()).toEqual(
            xdr.ContractDataDurability.persistent(),
        );
        expect(decodeEntryKey(data.key())).toBe('Balance');
    });

    it('decodeEntryKey handles symbol, vec, instance, and rejects others', () => {
        expect(decodeEntryKey(xdr.ScVal.scvSymbol('Config'))).toBe('Config');
        expect(decodeEntryKey(xdr.ScVal.scvLedgerKeyContractInstance())).toBe(
            'ContractInstance',
        );
        expect(() => decodeEntryKey(xdr.ScVal.scvU32(1))).toThrow(
            /Invalid ledger entry key type/,
        );
        expect(() => decodeEntryKey(xdr.ScVal.scvVec([]))).toThrow(
            /vec or its first element/,
        );
    });

    it('contractInstanceLedgerKey targets the instance entry', () => {
        const key = contractInstanceLedgerKey(CONTRACT_ID);
        expect(decodeEntryKey(key.contractData().key())).toBe(
            'ContractInstance',
        );
    });
});

describe('math extras', () => {
    it('toFixed / toFloat round-trip with explicit decimals', () => {
        expect(toFixed(1.5, 7)).toBe(15000000n);
        expect(toFloat(SCALAR_18, 18)).toBe(1);
        expect(toFixed(2, 2)).toBe(200n);
        expect(toFloat(200n, 2)).toBe(2);
    });

    it('mulDivFloor and mulDivCeil divide with true floor and ceil', () => {
        expect(mulDivFloor(7n, 1n, 2n)).toBe(3n);
        expect(mulDivCeil(7n, 1n, 2n)).toBe(4n);
    });
});

describe('ZenexError fallback message', () => {
    it('uses the generic message for unmapped codes', () => {
        const err = new ZenexError(424242 as never);
        expect(err.message).toBe('Contract error 424242');
    });
});

describe('simulateAndParse', () => {
    const network: Network = {
        rpc: 'http://localhost:1337',
        passphrase: 'Test SDF Network ; September 2015',
        opts: { allowHttp: true },
    };
    const op = new TreasuryContract(CONTRACT_ID).getRate();

    it('parses a successful simulation', async () => {
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue(
            {
                id: '1',
                latestLedger: 42,
                events: [],
                _parsed: true,
                transactionData: new SorobanDataBuilder(),
                minResourceFee: '0',
                result: {
                    auth: [],
                    xdr: '',
                    retval: nativeToScVal(9n, { type: 'i128' }),
                },
            } as never,
        );
        const { result, latestLedger } = await simulateAndParse(
            network,
            op,
            TreasuryContract.parsers.getRate,
        );
        expect(result).toBe(9n);
        expect(latestLedger).toBe(42);
    });

    it('throws on a failed simulation', async () => {
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue(
            {
                latestLedger: 42,
                events: [],
                error: 'host error',
            } as never,
        );
        await expect(
            simulateAndParse(network, op, TreasuryContract.parsers.getRate),
        ).rejects.toThrow(/Simulation failed/);
    });

    it('throws a ZenexError that keeps the decoded code and the raw error', async () => {
        const raw = 'HostError: Error(Contract, #713)\n\nEvent log ...';
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue(
            { id: '1', latestLedger: 42, events: [], error: raw } as never,
        );
        const error = await simulateAndParse(
            network,
            op,
            TreasuryContract.parsers.getRate,
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ZenexError);
        expect((error as ZenexError).code).toBe(ZenexErrorCode.InsufficientMargin);
        expect((error as ZenexError).message).toBe(
            `Simulation failed: ${new ZenexError(ZenexErrorCode.InsufficientMargin).message}`,
        );
        expect((error as ZenexError).cause).toBe(raw);
    });

    it('names a host error outside any contract', async () => {
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue(
            {
                id: '1',
                latestLedger: 42,
                events: [],
                error: 'HostError: Error(Storage, MissingValue)',
            } as never,
        );
        await expect(
            simulateAndParse(network, op, TreasuryContract.parsers.getRate),
        ).rejects.toMatchObject({
            code: ZenexErrorCode.UnknownError,
            message: 'Simulation failed: Host error Error(Storage, MissingValue)',
        });
    });

    it('passes the auth mode through to the RPC', async () => {
        const spy = vi
            .spyOn(rpc.Server.prototype, 'simulateTransaction')
            .mockResolvedValue({
                id: '1',
                latestLedger: 42,
                events: [],
                _parsed: true,
                transactionData: new SorobanDataBuilder(),
                minResourceFee: '0',
                result: { auth: [], xdr: '', retval: nativeToScVal(9n, { type: 'i128' }) },
            } as never);
        await simulateAndParse(network, op, TreasuryContract.parsers.getRate, {
            authMode: 'record_allow_nonroot',
        });
        expect(spy.mock.calls[0][2]).toBe('record_allow_nonroot');
        await simulateAndParse(network, op, TreasuryContract.parsers.getRate);
        expect(spy.mock.calls[1][2]).toBeUndefined();
    });

    it('reports a needed restore as an archived-entry error', async () => {
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
            id: '1',
            latestLedger: 42,
            events: [],
            _parsed: true,
            transactionData: new SorobanDataBuilder(),
            minResourceFee: '0',
            result: { auth: [], xdr: '', retval: nativeToScVal(9n, { type: 'i128' }) },
            restorePreamble: {
                minResourceFee: '1',
                transactionData: new SorobanDataBuilder(),
            },
        } as never);
        await expect(
            simulateAndParse(network, op, TreasuryContract.parsers.getRate),
        ).rejects.toMatchObject({
            code: ZenexErrorCode.InvokeHostFunctionEntryArchived,
            message: 'Simulation failed: restore required',
        });
    });
});
