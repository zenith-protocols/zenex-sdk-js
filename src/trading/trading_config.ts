import { Address, rpc, xdr, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { Network, i128, u32 } from '../index.ts';
import { decodeEntryKey, contractInstanceLedgerKey } from '../ledger_entry_helper.js';
import { Asset } from './trading_contract.js';
import { descale } from '../utils/scaling.js';

/**
 * TradingConfig contains the immutable or rarely-changing configuration for the trading contract.
 * This data is stored in instance storage.
 */
export class TradingConfig {
    constructor(
        /** Contract status (0: Normal, 1: Paused, etc.) */
        public status: number,
        /** Oracle contract address */
        public oracle: string,
        /** Percentage of fee that callers get for executing trades (0-1) */
        public callerTakeRate: number,
        /** Maximum number of positions per user */
        public maxPositions: number,
        /** Vault contract address */
        public vault: string,
        /** Token address used for collateral */
        public token: string,
        /** Admin address */
        public admin: string,
        /** Trading platform name (optional) */
        public name: string | undefined,
        /** List of available markets */
        public marketList: Asset[],
        /** Current position counter */
        public positionCounter: number,
    ) { }

    /**
     * Load trading configuration from the blockchain
     * @param network - The Stellar network to connect to
     * @param tradingId - The trading contract address
     * @returns A new TradingConfig instance with current data
     */
    public static async load(
        network: Network,
        tradingId: string
    ): Promise<TradingConfig> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        // Load trading instance storage
        const instanceKey = contractInstanceLedgerKey(tradingId);
        const response = await stellarRpc.getLedgerEntries(instanceKey);

        if (response.entries.length === 0) {
            throw new Error('Trading contract not found');
        }

        const contractData = response.entries[0].val.contractData();
        const contractInstance = contractData.val().instance();
        const storage = contractInstance.storage();
        if (!storage) {
            throw new Error('Trading instance storage is empty');
        }

        return TradingConfig.fromInstanceStorage(storage);
    }

    /**
     * Parse trading configuration from instance storage
     * @internal
     * @param storage - The instance storage ScMap
     * @returns Parsed TradingConfig
     */
    static fromInstanceStorage(storage: xdr.ScMapEntry[]): TradingConfig {
        let status: u32 | undefined;
        let oracle: string | undefined;
        let callerTakeRate: i128 | undefined;
        let maxPositions: u32 | undefined;
        let vault: string | undefined;
        let token: string | undefined;
        let admin: string | undefined;
        let name: string | undefined;
        let marketList: Asset[] = [];
        let positionCounter: u32 = 0;

        storage.map((storageEntry) => {
            const instanceKey = decodeEntryKey(storageEntry.key());

            switch (instanceKey) {
                case 'Oracle':
                    oracle = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'Config':
                    // Config is a map with oracle, caller_take_rate, max_positions
                    const configMap = storageEntry.val().map();
                    if (configMap) {
                        configMap.forEach((configEntry) => {
                            const configKey = configEntry.key().sym().toString();
                            switch (configKey) {
                                case 'status':
                                    status = scValToNative(configEntry.val()) as u32;
                                    break;
                                case 'oracle':
                                    oracle = Address.fromScVal(configEntry.val()).toString();
                                    break;
                                case 'caller_take_rate':
                                    callerTakeRate = scValToBigInt(configEntry.val());
                                    break;
                                case 'max_positions':
                                    maxPositions = scValToNative(configEntry.val()) as u32;
                                    break;
                            }
                        });
                    }
                    break;

                case 'Vault':
                    vault = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'Token':
                    token = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'Admin':
                    admin = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'Name':
                    name = scValToNative(storageEntry.val()) as string;
                    break;

                case 'MarketList':
                    const vec = storageEntry.val().vec();
                    if (vec) {
                        marketList = vec.map((assetVal) => {
                            const variant = assetVal.vec();
                            if (variant) {
                                const variantName = variant[0].sym().toString();
                                const variantEntry = variant[1];

                                if (variantName === 'Stellar' && variantEntry) {
                                    return {
                                        tag: 'Stellar',
                                        values: [Address.fromScVal(variantEntry).toString()]
                                    } as Asset;
                                } else if (variantName === 'Other' && variantEntry) {
                                    return {
                                        tag: 'Other',
                                        values: [variantEntry.sym().toString()]
                                    } as Asset;
                                }
                            }
                            throw new Error('Invalid Asset in MarketList');
                        });
                    }
                    break;

                case 'PosCtr':
                    positionCounter = scValToNative(storageEntry.val()) as u32;
                    break;

                default:
                    // Ignore other instance storage keys that might exist
                    break;
            }
        });

        // Validate all required fields are loaded
        if (
            status === undefined ||
            oracle === undefined ||
            callerTakeRate === undefined ||
            maxPositions === undefined ||
            vault === undefined ||
            token === undefined ||
            admin === undefined
        ) {
            throw new Error('Missing required trading configuration fields');
        }

        return new TradingConfig(
            Number(status),
            oracle!,
            descale(callerTakeRate, 7),
            Number(maxPositions),
            vault!,
            token!,
            admin!,
            name,
            marketList,
            Number(positionCounter)
        );
    }
}