import {
    Account,
    Address,
    Asset,
    Contract,
    rpc,
    scValToNative,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { Network } from './index.js';
import { decodeEntryKey } from './ledger_entry_helper.js';

/**
 * TokenMetadata contains information about a token
 *
 * @property name - The name of the token
 * @property symbol - The symbol of the token
 * @property decimals - The number of decimals the token uses
 * @property asset - The Stellar Asset if the token is a Stellar Asset Contract, undefined otherwise
 */
export class TokenMetadata {
    name: string;
    symbol: string;
    decimals: number;
    asset: Asset | undefined;

    constructor(name: string, symbol: string, decimals: number, asset: Asset | undefined) {
        this.name = name;
        this.symbol = symbol;
        this.decimals = decimals;
        this.asset = asset;
    }

    static async load(network: Network, tokenId: string): Promise<TokenMetadata> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const ledgerKeys: xdr.LedgerKey[] = [this.ledgerKey(tokenId)];
        const tokenMetadataEntry = await stellarRpc.getLedgerEntries(...ledgerKeys);

        // not all reserves have emissions, but the first 3 entries are required
        if (tokenMetadataEntry.entries.length < 1) {
            throw new Error('Unable to load token metadata entry: failed to return entry.');
        }

        let tokenMetadata: TokenMetadata | undefined = undefined;
        for (const entry of tokenMetadataEntry.entries) {
            const ledgerEntry = entry.val;
            const key = decodeEntryKey(ledgerEntry.contractData().key());
            switch (key) {
                case 'ContractInstance':
                    tokenMetadata = this.fromLedgerEntryData(ledgerEntry);
                    break;
                default:
                    throw Error(`Invalid metadata key: should not contain ${key}`);
            }
        }

        if (tokenMetadata == undefined) {
            throw new Error('Unable to load the token metadata.');
        }

        return tokenMetadata;
    }

    /**
     * Create the ledgerKey for the token contract instance
     * @param assetId - The contractId for the asset
     * @returns The ledgerKey for the contract instance
     */
    static ledgerKey(assetId: string): xdr.LedgerKey {
        return xdr.LedgerKey.contractData(
            new xdr.LedgerKeyContractData({
                contract: Address.fromString(assetId).toScAddress(),
                key: xdr.ScVal.scvLedgerKeyContractInstance(),
                durability: xdr.ContractDataDurability.persistent(),
            })
        );
    }

    /**
     * Create a TokenMetadata object from the XDR LedgerEntryData
     * @param ledger_entry_data - A XDR LedgerEntryData object or it's base64 string representation
     */
    static fromLedgerEntryData(ledger_entry_data: xdr.LedgerEntryData | string): TokenMetadata {
        if (typeof ledger_entry_data == 'string') {
            ledger_entry_data = xdr.LedgerEntryData.fromXDR(ledger_entry_data, 'base64');
        }
        const instance_val = ledger_entry_data.contractData().val().instance();
        let name: string | undefined;
        let symbol: string | undefined;
        let decimal: number | undefined;
        instance_val.storage()?.map((entry) => {
            const key = decodeEntryKey(entry.key());
            if (key == 'METADATA') {
                entry
                    .val()
                    .map()
                    ?.forEach((meta_entry) => {
                        const metadataKey = decodeEntryKey(meta_entry.key());
                        switch (metadataKey) {
                            case 'name':
                                name = scValToNative(meta_entry.val());
                                return;
                            case 'symbol':
                                symbol = scValToNative(meta_entry.val());
                                if (symbol == 'native') {
                                    symbol = 'XLM';
                                }
                                return;
                            case 'decimal':
                                decimal = scValToNative(meta_entry.val());
                                return;
                        }
                    });
            }
        });

        if (name == undefined || symbol == undefined || decimal == undefined) {
            throw Error('Token metadata malformed');
        }

        let asset: Asset | undefined;
        if (
            instance_val.executable().toXDR().toString() ==
            xdr.ContractExecutable.contractExecutableStellarAsset().toXDR().toString() &&
            name
        ) {
            if (name == 'native') {
                asset = Asset.native();
            } else {
                const code_issuer = name.split(':');
                asset = new Asset(code_issuer[0], code_issuer[1]);
            }
        }

        return new TokenMetadata(name, symbol, decimal, asset);
    }
}