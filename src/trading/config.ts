import { Address, rpc, xdr, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';
import { Asset } from '../types/asset.js';
import { TradingConfigData, TradingInstanceData, ContractStatus } from '../types/trading.js';
import { descale } from '../internal/scaling.js';
import { contractInstanceLedgerKey, decodeEntryKey } from '../internal/ledger-keys.js';

/**
 * TradingConfig - Trading contract configuration loader
 *
 * Contains all configuration data from the trading contract's instance storage.
 */
export class TradingConfig implements TradingInstanceData {
    name: string | undefined;
    status: number;
    vault: string;
    token: string;
    config: TradingConfigData;
    marketList: Asset[];
    positionCounter: number;

    constructor(data: TradingInstanceData) {
        this.name = data.name;
        this.status = data.status;
        this.vault = data.vault;
        this.token = data.token;
        this.config = data.config;
        this.marketList = data.marketList;
        this.positionCounter = data.positionCounter;
    }

    /**
     * Load trading configuration from the blockchain
     * @param network - The Stellar network to connect to
     * @param contractId - The trading contract address
     * @returns A new TradingConfig instance with current data
     */
    public static async load(
        network: Network,
        contractId: string
    ): Promise<TradingConfig> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const instanceKey = contractInstanceLedgerKey(contractId);
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
     */
    static fromInstanceStorage(storage: xdr.ScMapEntry[]): TradingConfig {
        let name: string | undefined;
        let status: number = 0;
        let vault: string | undefined;
        let token: string | undefined;
        let config: TradingConfigData | undefined;
        let marketList: Asset[] = [];
        let positionCounter: number = 0;

        storage.forEach((storageEntry) => {
            const instanceKey = decodeEntryKey(storageEntry.key());

            switch (instanceKey) {
                case 'Name':
                    name = scValToNative(storageEntry.val()) as string;
                    break;

                case 'Status':
                    status = scValToNative(storageEntry.val()) as number;
                    break;

                case 'Vault':
                    vault = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'Token':
                    token = Address.fromScVal(storageEntry.val()).toString();
                    break;

                case 'Config':
                    // Config is TradingConfig struct
                    const configMap = storageEntry.val().map();
                    if (configMap) {
                        let oracle: string | undefined;
                        let callerTakeRate: bigint | undefined;
                        let maxPositions: number | undefined;
                        let maxUtilization: bigint | undefined;

                        configMap.forEach((configEntry) => {
                            const configKey = configEntry.key().sym().toString();
                            switch (configKey) {
                                case 'oracle':
                                    oracle = Address.fromScVal(configEntry.val()).toString();
                                    break;
                                case 'caller_take_rate':
                                    callerTakeRate = scValToBigInt(configEntry.val());
                                    break;
                                case 'max_positions':
                                    maxPositions = scValToNative(configEntry.val()) as number;
                                    break;
                                case 'max_utilization':
                                    maxUtilization = scValToBigInt(configEntry.val());
                                    break;
                            }
                        });

                        if (oracle && callerTakeRate !== undefined && maxPositions !== undefined && maxUtilization !== undefined) {
                            config = {
                                oracle,
                                callerTakeRate: descale(callerTakeRate, 7),
                                maxPositions,
                                maxUtilization: descale(maxUtilization, 7),
                            };
                        }
                    }
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
                    positionCounter = scValToNative(storageEntry.val()) as number;
                    break;
            }
        });

        if (!vault || !token || !config) {
            throw new Error('Missing required trading configuration fields');
        }

        return new TradingConfig({
            name,
            status,
            vault,
            token,
            config,
            marketList,
            positionCounter,
        });
    }

    // === Helper Methods ===

    /**
     * Get the contract status as typed enum
     */
    getStatus(): ContractStatus {
        return this.status as ContractStatus;
    }

    /**
     * Check if a specific asset is a valid market
     */
    hasMarket(asset: Asset): boolean {
        return this.marketList.some(m => {
            if (m.tag !== asset.tag) return false;
            if (m.tag === 'Other' && asset.tag === 'Other') {
                return m.values[0] === asset.values[0];
            }
            if (m.tag === 'Stellar' && asset.tag === 'Stellar') {
                return m.values[0].toString() === asset.values[0].toString();
            }
            return false;
        });
    }

    /**
     * Get the oracle address
     */
    get oracle(): string {
        return this.config.oracle;
    }

    /**
     * Get caller take rate
     */
    get callerTakeRate(): number {
        return this.config.callerTakeRate;
    }

    /**
     * Get max positions per user
     */
    get maxPositions(): number {
        return this.config.maxPositions;
    }

    /**
     * Get max utilization
     */
    get maxUtilization(): number {
        return this.config.maxUtilization;
    }
}
