import { Address, Networks, hash, rpc, xdr } from '@stellar/stellar-sdk';
import { vi } from 'vitest';
import type { Network } from '../../src/index.js';
import { contractInstanceLedgerKey } from '../../src/ledger-keys.js';
import {
    SMART_ACCOUNT_WASM_SHA256,
    verifySmartAccountInstance,
    type VerifiedSmartAccountInstance,
} from '../../src/relay/smart_account_evidence.js';

export const TESTNET_NETWORK_ID = hash(Buffer.from(Networks.TESTNET)).toString(
    'hex',
);
export const TESTNET_NETWORK: Network = {
    rpc: 'http://localhost:1337',
    passphrase: Networks.TESTNET,
    opts: { allowHttp: true },
};

export async function verifiedSmartAccountFixture(
    contractId: string,
    observedLedger: number,
    options: {
        readonly network?: Network;
        readonly networkId?: string;
    } = {},
): Promise<VerifiedSmartAccountInstance> {
    const key = contractInstanceLedgerKey(contractId);
    const executable = xdr.ContractExecutable.contractExecutableWasm(
        Buffer.from(SMART_ACCOUNT_WASM_SHA256, 'hex'),
    );
    const entry = {
        lastModifiedLedgerSeq: observedLedger,
        key,
        val: xdr.LedgerEntryData.contractData(
            new xdr.ContractDataEntry({
                ext: new xdr.ExtensionPoint(0),
                contract: Address.fromString(contractId).toScAddress(),
                key: xdr.ScVal.scvLedgerKeyContractInstance(),
                durability: xdr.ContractDataDurability.persistent(),
                val: xdr.ScVal.scvContractInstance(
                    new xdr.ScContractInstance({
                        executable,
                        storage: null,
                    }),
                ),
            }),
        ),
    };
    const spy = vi.spyOn(rpc.Server.prototype, 'getLedgerEntries');
    spy.mockResolvedValueOnce({
        entries: [entry],
        latestLedger: observedLedger,
    } as never);
    try {
        return await verifySmartAccountInstance({
            network: options.network ?? TESTNET_NETWORK,
            networkId: options.networkId ?? TESTNET_NETWORK_ID,
            contractId,
        });
    } finally {
        spy.mockRestore();
    }
}
