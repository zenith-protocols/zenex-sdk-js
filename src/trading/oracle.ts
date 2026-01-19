import {
    Contract,
    scValToNative,
    xdr,
    Address,
} from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';
import { Asset, getAssetKey } from '../types/asset.js';
import { PriceData } from '../types/trading.js';
import { descale } from '../internal/scaling.js';
import { simulateAndParse } from '../internal/simulation.js';

/**
 * Oracle - Price feed loader for Zenex trading
 *
 * Loads prices from the oracle contract and provides easy access methods.
 */
export class Oracle {
    private prices: Map<string, PriceData>;
    public oracleId: string;
    public decimals: number;

    constructor(oracleId: string, decimals: number = 7) {
        this.oracleId = oracleId;
        this.decimals = decimals;
        this.prices = new Map();
    }

    /**
     * Load oracle prices for multiple assets
     * @param network - Network configuration
     * @param oracleId - Oracle contract address
     * @param assets - Assets to load prices for
     * @param decimals - Optional decimals override (will query oracle if not provided)
     * @returns Oracle instance with loaded prices
     */
    public static async loadPrices(
        network: Network,
        oracleId: string,
        assets: Asset[],
        decimals?: number
    ): Promise<Oracle> {
        // Get decimals if not provided
        let oracleDecimals: number;

        if (decimals !== undefined) {
            oracleDecimals = decimals;
        } else {
            const contract = new Contract(oracleId);
            const decimalsOp = contract.call('decimals').toXDR('base64');

            const result = await simulateAndParse(
                network,
                decimalsOp,
                (val) => scValToNative(xdr.ScVal.fromXDR(val, 'base64'))
            );

            oracleDecimals = Number(result.result);
        }

        const oracle = new Oracle(oracleId, oracleDecimals);

        // Load prices for all assets
        for (const asset of assets) {
            const priceData = await oracle.fetchPrice(network, asset);
            if (priceData) {
                oracle.setPrice(asset, priceData);
            }
        }

        return oracle;
    }

    /**
     * Fetch a single price from the oracle
     * @param network - Network configuration
     * @param asset - Asset to fetch price for
     * @returns Price data or null if not found
     */
    public async fetchPrice(network: Network, asset: Asset): Promise<PriceData | null> {
        const contract = new Contract(this.oracleId);

        // Convert Asset to ScVal
        let assetScVal: xdr.ScVal;
        if (asset.tag === 'Stellar') {
            assetScVal = xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Stellar'),
                Address.fromString(asset.values[0] as string).toScVal(),
            ]);
        } else {
            assetScVal = xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Other'),
                xdr.ScVal.scvSymbol(asset.values[0] as string),
            ]);
        }

        const priceOp = contract.call('lastprice', assetScVal).toXDR('base64');

        try {
            const result = await simulateAndParse(
                network,
                priceOp,
                (xdrResult) => {
                    const val = xdr.ScVal.fromXDR(xdrResult, 'base64');
                    return scValToNative(val);
                }
            );

            const rawPrice = result.result.price;
            const descaledPrice = descale(rawPrice, this.decimals);

            return {
                price: descaledPrice,
                timestamp: result.result.timestamp
            };
        } catch (error) {
            console.error(`Failed to fetch price for ${getAssetKey(asset)}:`, error);
            return null;
        }
    }

    /**
     * Get the price of an asset (automatically descaled)
     */
    public getPrice(asset: Asset): number | undefined {
        const key = getAssetKey(asset);
        return this.prices.get(key)?.price;
    }

    /**
     * Get the full price data of an asset
     */
    public getPriceData(asset: Asset): PriceData | undefined {
        const key = getAssetKey(asset);
        return this.prices.get(key);
    }

    /**
     * Set the price data for an asset
     */
    public setPrice(asset: Asset, priceData: PriceData): void {
        const key = getAssetKey(asset);
        this.prices.set(key, priceData);
    }

    /**
     * Check if a price is stale (older than maxAge seconds)
     * @param asset - Asset to check
     * @param maxAge - Maximum age in seconds (default: 60)
     */
    public isPriceStale(asset: Asset, maxAge: number = 60): boolean {
        const priceData = this.getPriceData(asset);
        if (!priceData) return true;

        const now = Math.floor(Date.now() / 1000);
        return (now - priceData.timestamp) > maxAge;
    }

    /**
     * Get all loaded prices
     */
    public getAllPrices(): Map<string, PriceData> {
        return new Map(this.prices);
    }

    /**
     * Clear all cached prices
     */
    public clearPrices(): void {
        this.prices.clear();
    }
}
