import {
    Address,
    Networks,
    StrKey,
    hash,
    rpc,
    xdr,
} from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Network } from '../../src/index.js';
import { contractInstanceLedgerKey } from '../../src/ledger-keys.js';
import {
    SMART_ACCOUNT_WASM_SHA256,
    SmartAccountInstanceVerificationError,
    verifySmartAccountInstance,
} from '../../src/relay/smart_account_evidence.js';

const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 71));
const OTHER_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 72));
const TESTNET_ID = hash(Buffer.from(Networks.TESTNET)).toString('hex');
const OBSERVED_LEDGER = 49_000;
const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: Networks.TESTNET,
    opts: { allowHttp: true },
};

interface EntryOptions {
    readonly returnedKey?: xdr.LedgerKey;
    readonly contract?: string;
    readonly dataKey?: xdr.ScVal;
    readonly durability?: xdr.ContractDataDurability;
    readonly executable?: xdr.ContractExecutable;
    readonly value?: xdr.ScVal;
}

function instanceValue(
    executable: xdr.ContractExecutable = xdr.ContractExecutable.contractExecutableWasm(
        Buffer.from(SMART_ACCOUNT_WASM_SHA256, 'hex'),
    ),
): xdr.ScVal {
    return xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({ executable, storage: null }),
    );
}

function instanceEntry(options: EntryOptions = {}) {
    return {
        lastModifiedLedgerSeq: OBSERVED_LEDGER - 1,
        key: options.returnedKey ?? contractInstanceLedgerKey(ACCOUNT),
        val: xdr.LedgerEntryData.contractData(
            new xdr.ContractDataEntry({
                ext: new xdr.ExtensionPoint(0),
                contract: Address.fromString(
                    options.contract ?? ACCOUNT,
                ).toScAddress(),
                key:
                    options.dataKey ?? xdr.ScVal.scvLedgerKeyContractInstance(),
                durability:
                    options.durability ??
                    xdr.ContractDataDurability.persistent(),
                val: options.value ?? instanceValue(options.executable),
            }),
        ),
    };
}

function response(
    entries: readonly ReturnType<typeof instanceEntry>[] = [instanceEntry()],
    latestLedger: number = OBSERVED_LEDGER,
) {
    return { entries, latestLedger } as never;
}

function verify(
    overrides: Partial<Parameters<typeof verifySmartAccountInstance>[0]> = {},
) {
    return verifySmartAccountInstance({
        network,
        networkId: TESTNET_ID,
        contractId: ACCOUNT,
        ...overrides,
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('verifySmartAccountInstance', () => {
    it('returns immutable evidence bound to the canonical ledger entry and snapshot', async () => {
        const getLedgerEntries = vi
            .spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValue(response());

        const verified = await verify();

        expect(verified).toEqual({
            contractId: ACCOUNT,
            networkId: TESTNET_ID,
            networkPassphrase: Networks.TESTNET,
            observedLedger: OBSERVED_LEDGER,
            instanceExecutableHash: SMART_ACCOUNT_WASM_SHA256,
        });
        expect(Object.isFrozen(verified)).toBe(true);
        expect(getLedgerEntries).toHaveBeenCalledTimes(1);
        expect(getLedgerEntries.mock.calls[0][0].toXDR('hex')).toBe(
            contractInstanceLedgerKey(ACCOUNT).toXDR('hex'),
        );
    });

    it('snapshots every validated identity before the asynchronous RPC read', async () => {
        const input = {
            network: { ...network },
            networkId: TESTNET_ID,
            contractId: ACCOUNT,
        };
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockImplementation(
            async () => {
                input.network.passphrase = Networks.PUBLIC;
                input.networkId = hash(Buffer.from(Networks.PUBLIC)).toString(
                    'hex',
                );
                input.contractId = OTHER_ACCOUNT;
                return response();
            },
        );

        const verified = await verifySmartAccountInstance(input);

        expect(verified).toMatchObject({
            contractId: ACCOUNT,
            networkId: TESTNET_ID,
            networkPassphrase: Networks.TESTNET,
        });
    });

    it.each([
        ['non-canonical network ID', TESTNET_ID.toUpperCase()],
        ['mismatched network ID', '00'.repeat(32)],
        ['malformed network ID', 'testnet'],
    ])('rejects a %s before querying RPC', async (_label, networkId) => {
        const getLedgerEntries = vi.spyOn(
            rpc.Server.prototype,
            'getLedgerEntries',
        );

        await expect(verify({ networkId })).rejects.toBeInstanceOf(
            SmartAccountInstanceVerificationError,
        );
        expect(getLedgerEntries).not.toHaveBeenCalled();
    });

    it('rejects a non-contract account identity before querying RPC', async () => {
        const getLedgerEntries = vi.spyOn(
            rpc.Server.prototype,
            'getLedgerEntries',
        );

        await expect(
            verify({
                contractId: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1)),
            }),
        ).rejects.toThrow(/contract ID/i);
        expect(getLedgerEntries).not.toHaveBeenCalled();
    });

    it.each([
        ['missing', []],
        ['ambiguous', [instanceEntry(), instanceEntry()]],
    ])('rejects %s instance evidence', async (_label, entries) => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue(
            response(entries),
        );

        await expect(verify()).rejects.toThrow(/one contract instance/i);
    });

    it.each([-1, 1.5, 4_294_967_296])(
        'rejects non-u32 observation ledger %s',
        async (latestLedger) => {
            vi.spyOn(
                rpc.Server.prototype,
                'getLedgerEntries',
            ).mockResolvedValue(response(undefined, latestLedger));

            await expect(verify()).rejects.toThrow(/latest ledger.*u32/i);
        },
    );

    it('rejects a returned ledger key for a different instance', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue(
            response([
                instanceEntry({
                    returnedKey: contractInstanceLedgerKey(OTHER_ACCOUNT),
                }),
            ]),
        );

        await expect(verify()).rejects.toThrow(/ledger key/i);
    });

    it.each([
        [
            'different contract identity',
            instanceEntry({ contract: OTHER_ACCOUNT }),
            /contract identity/i,
        ],
        [
            'non-instance contract-data key',
            instanceEntry({ dataKey: xdr.ScVal.scvSymbol('Admin') }),
            /instance key/i,
        ],
        [
            'temporary durability',
            instanceEntry({
                durability: xdr.ContractDataDurability.temporary(),
            }),
            /persistent/i,
        ],
        [
            'non-instance contract-data value',
            instanceEntry({ value: xdr.ScVal.scvVoid() }),
            /contract instance value/i,
        ],
    ])('rejects %s', async (_label, entry, error) => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue(
            response([entry]),
        );

        await expect(verify()).rejects.toThrow(error);
    });

    it('rejects a non-contract-data ledger entry', async () => {
        const malformed = {
            ...instanceEntry(),
            val: xdr.ScVal.scvVoid() as unknown as xdr.LedgerEntryData,
        };
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue(
            response([malformed]),
        );

        await expect(verify()).rejects.toThrow(/contract-data ledger entry/i);
    });

    it('rejects a native executable and a non-pinned WASM executable', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce(
                response([
                    instanceEntry({
                        executable:
                            xdr.ContractExecutable.contractExecutableStellarAsset(),
                    }),
                ]),
            )
            .mockResolvedValueOnce(
                response([
                    instanceEntry({
                        executable:
                            xdr.ContractExecutable.contractExecutableWasm(
                                Buffer.alloc(32, 9),
                            ),
                    }),
                ]),
            );

        await expect(verify()).rejects.toThrow(/WASM executable/i);
        await expect(verify()).rejects.toThrow(/reviewed smart-account WASM/i);
    });

    it('wraps malformed RPC evidence and RPC failures in the verification error', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({
                entries: [{ key: null, val: null }],
                latestLedger: OBSERVED_LEDGER,
            } as never)
            .mockRejectedValueOnce(new Error('rpc unavailable'));

        await expect(verify()).rejects.toBeInstanceOf(
            SmartAccountInstanceVerificationError,
        );
        const rpcFailure = verify();
        await expect(rpcFailure).rejects.toBeInstanceOf(
            SmartAccountInstanceVerificationError,
        );
        await expect(rpcFailure).rejects.toThrow(/RPC/i);
    });
});
