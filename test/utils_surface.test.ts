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
    tokenBalanceLedgerKey,
    decodeEntryKey,
    contractInstanceLedgerKey,
} from '../src/ledger-keys.js';
import { toFixed, toFloat, mulDivFloor, mulDivCeil, SCALAR_18 } from '../src/math/index.js';
import { simulateAndParse } from '../src/simulate.js';
import { ContractError } from '../src/errors.js';
import {
    SmartAccountContract,
    signerToScVal,
    contextRuleTypeToScVal,
    sessionConfigToScVal,
} from '../src/contracts/smart-account/smart_account_contract.js';
import { TreasuryContract } from '../src/contracts/treasury/treasury_contract.js';
import { Network } from '../src/index.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 4));

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

describe('ContractError fallback message', () => {
    it('uses the generic message for unmapped codes', () => {
        const err = new ContractError(424242 as never);
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
});

describe('SmartAccountContract surface', () => {
    const account = new SmartAccountContract(CONTRACT_ID);

    function decodeInvoke(op: string) {
        const body = xdr.Operation.fromXDR(op, 'base64')
            .body()
            .invokeHostFunctionOp();
        const invoke = body.hostFunction().invokeContract();
        return { fn: invoke.functionName().toString(), args: invoke.args() };
    }

    const delegated = { tag: 'Delegated' as const, address: USER };
    const external = {
        tag: 'External' as const,
        verifier: VERIFIER,
        keyData: new Uint8Array([1, 2]),
    };

    it('encodes signers, context rule types, and session configs', () => {
        expect(signerToScVal(delegated).vec()![0].sym().toString()).toBe(
            'Delegated',
        );
        expect(signerToScVal(external).vec()![0].sym().toString()).toBe(
            'External',
        );
        expect(
            signerToScVal({ ...external, keyData: Buffer.from([1, 2]) }).vec()!
                .length,
        ).toBe(3);

        expect(contextRuleTypeToScVal({ tag: 'Default' }).vec()!.length).toBe(
            1,
        );
        expect(
            contextRuleTypeToScVal({
                tag: 'CallContract',
                contract: CONTRACT_ID,
            }).vec()!.length,
        ).toBe(2);
        expect(
            contextRuleTypeToScVal({
                tag: 'CreateContract',
                wasmHash: new Uint8Array(32),
            }).vec()!.length,
        ).toBe(2);
        expect(
            contextRuleTypeToScVal({
                tag: 'CreateContract',
                wasmHash: Buffer.alloc(32),
            }).vec()!.length,
        ).toBe(2);

        const session = sessionConfigToScVal({
            allowedContracts: [CONTRACT_ID],
            allowedTransferTo: USER,
        });
        expect(session.map()!.length).toBe(2);
    });

    it('builds context rule, signer, and policy ops', () => {
        const add = decodeInvoke(
            account.addContextRule({
                contextType: { tag: 'Default' },
                name: 'session',
                signers: [delegated, external],
                policies: new Map([[CONTRACT_ID, xdr.ScVal.scvVoid()]]),
            }),
        );
        expect(add.fn).toBe('add_context_rule');
        expect(add.args.length).toBe(5);

        const addWithExpiry = decodeInvoke(
            account.addContextRule({
                contextType: { tag: 'CallContract', contract: CONTRACT_ID },
                name: 'scoped',
                validUntil: 999,
                signers: [],
                policies: new Map(),
            }),
        );
        expect(addWithExpiry.args[2].u32()).toBe(999);

        expect(decodeInvoke(account.removeContextRule(1)).fn).toBe(
            'remove_context_rule',
        );
        expect(decodeInvoke(account.addSigner(1, delegated)).fn).toBe(
            'add_signer',
        );
        expect(decodeInvoke(account.removeSigner(1, 2)).fn).toBe(
            'remove_signer',
        );
        expect(
            decodeInvoke(account.addPolicy(1, CONTRACT_ID, xdr.ScVal.scvVoid()))
                .fn,
        ).toBe('add_policy');
        expect(decodeInvoke(account.removePolicy(1, CONTRACT_ID)).fn).toBe(
            'remove_policy',
        );
    });
});
