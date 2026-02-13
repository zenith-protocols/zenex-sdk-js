import { Address, rpc, xdr, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { ContractStatus } from './trading_contract.js';
import { toFloat } from '../math.js';
import { contractInstanceLedgerKey, decodeEntryKey } from '../ledger-keys.js';

// Trading configuration (matches Rust TradingConfig)
export interface TradingConfigData {
    oracle: string;
    maxPriceAge: number;
    callerTakeRate: number;
    maxPositions: number;
    maxUtilization: number;
    minOpenTime: number;
}

// Contract instance storage data
export interface TradingInstanceData {
    name: string | undefined;
    status: number;
    vault: string;
    token: string;
    config: TradingConfigData;
    priceDecimals: number;
    tokenDecimals: number;
    marketCounter: number;
    positionCounter: number;
}

/**
 * TradingConfig - Trading contract configuration loader
 *
 * Contains all configuration data from the trading contract's instance storage.
 * Use Market.loadMultiple() with marketCounter to load market data.
 */
export class TradingConfig implements TradingInstanceData {
    name: string | undefined;
    status: number;
    vault: string;
    token: string;
    config: TradingConfigData;
    priceDecimals: number;
    tokenDecimals: number;
    marketCounter: number;
    positionCounter: number;
    contractId: string;

    constructor(data: TradingInstanceData, contractId: string) {
        this.name = data.name;
        this.status = data.status;
        this.vault = data.vault;
        this.token = data.token;
        this.config = data.config;
        this.priceDecimals = data.priceDecimals;
        this.tokenDecimals = data.tokenDecimals;
        this.marketCounter = data.marketCounter;
        this.positionCounter = data.positionCounter;
        this.contractId = contractId;
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

        const instanceData = TradingConfig.parseInstanceStorage(storage);

        return new TradingConfig(instanceData, contractId);
    }

    /**
     * Parse trading configuration from instance storage
     * @internal
     */
    private static parseInstanceStorage(storage: xdr.ScMapEntry[]): TradingInstanceData {
        let name: string | undefined;
        let status: number = 0;
        let vault: string | undefined;
        let token: string | undefined;
        let config: TradingConfigData | undefined;
        let priceDecimals: number = 0;
        let tokenDecimals: number = 0;
        let marketCounter: number = 0;
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
                    const configMap = storageEntry.val().map();
                    if (configMap) {
                        let oracle: string | undefined;
                        let maxPriceAge: number | undefined;
                        let callerTakeRate: bigint | undefined;
                        let maxPositions: number | undefined;
                        let maxUtilization: bigint | undefined;
                        let minOpenTime: bigint | undefined;

                        configMap.forEach((configEntry) => {
                            const configKey = configEntry.key().sym().toString();
                            switch (configKey) {
                                case 'oracle':
                                    oracle = Address.fromScVal(configEntry.val()).toString();
                                    break;
                                case 'max_price_age':
                                    maxPriceAge = scValToNative(configEntry.val()) as number;
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
                                case 'min_open_time':
                                    minOpenTime = scValToBigInt(configEntry.val());
                                    break;
                            }
                        });

                        if (oracle && callerTakeRate !== undefined && maxPositions !== undefined && maxUtilization !== undefined) {
                            config = {
                                oracle,
                                maxPriceAge: maxPriceAge ?? 0,
                                callerTakeRate: toFloat(callerTakeRate, 7),
                                maxPositions,
                                maxUtilization: toFloat(maxUtilization, 7),
                                minOpenTime: Number(minOpenTime ?? 0n),
                            };
                        }
                    }
                    break;

                case 'PriceDecimals':
                    priceDecimals = scValToNative(storageEntry.val()) as number;
                    break;

                case 'TokenDecimals':
                    tokenDecimals = scValToNative(storageEntry.val()) as number;
                    break;

                case 'MarketCounter':
                    marketCounter = scValToNative(storageEntry.val()) as number;
                    break;

                case 'PositionCounter':
                    positionCounter = scValToNative(storageEntry.val()) as number;
                    break;
            }
        });

        if (!vault || !token || !config) {
            throw new Error('Missing required trading configuration fields');
        }

        return {
            name,
            status,
            vault,
            token,
            config,
            priceDecimals,
            tokenDecimals,
            marketCounter,
            positionCounter,
        };
    }

    // === Helper Methods ===

    /**
     * Get the contract status as typed enum
     */
    getStatus(): ContractStatus {
        return this.status as ContractStatus;
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

    /**
     * Get max price age
     */
    get maxPriceAge(): number {
        return this.config.maxPriceAge;
    }

    /**
     * Get min open time
     */
    get minOpenTime(): number {
        return this.config.minOpenTime;
    }
}
