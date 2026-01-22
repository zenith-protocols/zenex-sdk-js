import { Address, rpc, xdr, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';
import { Asset } from '../types/asset.js';
import { TradingConfigData, TradingInstanceData, ContractStatus, MarketConfigWithAsset, MarketMap } from '../types/trading.js';
import { descale } from '../scaling.js';
import { contractInstanceLedgerKey, decodeEntryKey, persistentLedgerKey } from '../ledger-keys.js';

/**
 * TradingConfig - Trading contract configuration loader
 *
 * Contains all configuration data from the trading contract's instance storage
 * plus a mapping of market index -> MarketConfig (including asset).
 */
export class TradingConfig implements TradingInstanceData {
    name: string | undefined;
    status: number;
    vault: string;
    token: string;
    config: TradingConfigData;
    marketCounter: number;
    positionCounter: number;
    contractId: string;
    /** Map of asset_index -> MarketConfigWithAsset */
    markets: MarketMap;

    constructor(data: TradingInstanceData, contractId: string, markets: MarketMap) {
        this.name = data.name;
        this.status = data.status;
        this.vault = data.vault;
        this.token = data.token;
        this.config = data.config;
        this.marketCounter = data.marketCounter;
        this.positionCounter = data.positionCounter;
        this.contractId = contractId;
        this.markets = markets;
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

        // Load instance storage first to get marketCounter
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

        // Load all market configs
        const markets = await TradingConfig.loadMarketConfigs(
            stellarRpc,
            contractId,
            instanceData.marketCounter
        );

        return new TradingConfig(instanceData, contractId, markets);
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

                case 'MarketCounter':
                    marketCounter = scValToNative(storageEntry.val()) as number;
                    break;

                case 'PosCtr':
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
            marketCounter,
            positionCounter,
        };
    }

    /**
     * Load all market configurations from persistent storage
     * @internal
     */
    private static async loadMarketConfigs(
        stellarRpc: rpc.Server,
        contractId: string,
        marketCounter: number
    ): Promise<MarketMap> {
        const markets: MarketMap = new Map();

        if (marketCounter === 0) {
            return markets;
        }

        // Build ledger keys for all markets
        const ledgerKeys: xdr.LedgerKey[] = [];
        for (let i = 0; i < marketCounter; i++) {
            // MarketConfig(u32) storage key
            const key = persistentLedgerKey(contractId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                xdr.ScVal.scvU32(i),
            ]);
            ledgerKeys.push(key);
        }

        // Fetch all market configs in one call
        const response = await stellarRpc.getLedgerEntries(...ledgerKeys);

        // Parse each market config
        for (const entry of response.entries) {
            const contractData = entry.val.contractData();
            const keyVec = contractData.key().vec();
            if (!keyVec || keyVec.length < 2) continue;

            const assetIndex = keyVec[1].u32();
            const configVal = contractData.val();
            const marketConfig = TradingConfig.parseMarketConfig(configVal);

            if (marketConfig) {
                markets.set(assetIndex, marketConfig);
            }
        }

        return markets;
    }

    /**
     * Parse a MarketConfig from ScVal
     * @internal
     */
    private static parseMarketConfig(val: xdr.ScVal): MarketConfigWithAsset | undefined {
        const configMap = val.map();
        if (!configMap) return undefined;

        let asset: Asset | undefined;
        let enabled: boolean | undefined;
        let maxPayout: bigint | undefined;
        let minCollateral: bigint | undefined;
        let maxCollateral: bigint | undefined;
        let initMargin: bigint | undefined;
        let maintenanceMargin: bigint | undefined;
        let baseFee: bigint | undefined;
        let priceImpactScalar: bigint | undefined;
        let baseHourlyRate: bigint | undefined;

        configMap.forEach((entry) => {
            const key = entry.key().sym().toString();
            switch (key) {
                case 'asset':
                    asset = TradingConfig.parseAsset(entry.val());
                    break;
                case 'enabled':
                    enabled = scValToNative(entry.val()) as boolean;
                    break;
                case 'max_payout':
                    maxPayout = scValToBigInt(entry.val());
                    break;
                case 'min_collateral':
                    minCollateral = scValToBigInt(entry.val());
                    break;
                case 'max_collateral':
                    maxCollateral = scValToBigInt(entry.val());
                    break;
                case 'init_margin':
                    initMargin = scValToBigInt(entry.val());
                    break;
                case 'maintenance_margin':
                    maintenanceMargin = scValToBigInt(entry.val());
                    break;
                case 'base_fee':
                    baseFee = scValToBigInt(entry.val());
                    break;
                case 'price_impact_scalar':
                    priceImpactScalar = scValToBigInt(entry.val());
                    break;
                case 'base_hourly_rate':
                    baseHourlyRate = scValToBigInt(entry.val());
                    break;
            }
        });

        if (
            asset === undefined ||
            enabled === undefined ||
            maxPayout === undefined ||
            minCollateral === undefined ||
            maxCollateral === undefined ||
            initMargin === undefined ||
            maintenanceMargin === undefined ||
            baseFee === undefined ||
            priceImpactScalar === undefined ||
            baseHourlyRate === undefined
        ) {
            return undefined;
        }

        return {
            asset,
            enabled,
            maxPayout: descale(maxPayout, 7),
            minCollateral: descale(minCollateral, 7),
            maxCollateral: descale(maxCollateral, 7),
            initMargin: descale(initMargin, 7),
            maintenanceMargin: descale(maintenanceMargin, 7),
            baseFee: descale(baseFee, 7),
            priceImpactScalar: descale(priceImpactScalar, 7),
            baseHourlyRate: descale(baseHourlyRate, 18),
        };
    }

    /**
     * Parse Asset from ScVal
     * @internal
     */
    private static parseAsset(val: xdr.ScVal): Asset | undefined {
        const variant = val.vec();
        if (!variant || variant.length < 2) return undefined;

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

        return undefined;
    }

    // === Helper Methods ===

    /**
     * Get the contract status as typed enum
     */
    getStatus(): ContractStatus {
        return this.status as ContractStatus;
    }

    /**
     * Get market config by asset index
     * @param assetIndex - The market's asset index
     * @returns MarketConfigWithAsset or undefined if not found
     */
    getMarket(assetIndex: number): MarketConfigWithAsset | undefined {
        return this.markets.get(assetIndex);
    }

    /**
     * Get asset by index
     * @param assetIndex - The market's asset index
     * @returns Asset or undefined if not found
     */
    getAsset(assetIndex: number): Asset | undefined {
        return this.markets.get(assetIndex)?.asset;
    }

    /**
     * Find asset index by asset
     * @param asset - The asset to find
     * @returns asset index or undefined if not found
     */
    findAssetIndex(asset: Asset): number | undefined {
        for (const [index, config] of this.markets) {
            if (config.asset.tag === asset.tag) {
                if (config.asset.tag === 'Other' && asset.tag === 'Other') {
                    if (config.asset.values[0] === asset.values[0]) {
                        return index;
                    }
                } else if (config.asset.tag === 'Stellar' && asset.tag === 'Stellar') {
                    if (config.asset.values[0].toString() === asset.values[0].toString()) {
                        return index;
                    }
                }
            }
        }
        return undefined;
    }

    /**
     * Check if a specific asset is a valid market
     */
    hasMarket(asset: Asset): boolean {
        return this.findAssetIndex(asset) !== undefined;
    }

    /**
     * Get all market assets as an array (ordered by index)
     */
    getMarketAssets(): Asset[] {
        const assets: Asset[] = [];
        for (let i = 0; i < this.marketCounter; i++) {
            const market = this.markets.get(i);
            if (market) {
                assets.push(market.asset);
            }
        }
        return assets;
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
