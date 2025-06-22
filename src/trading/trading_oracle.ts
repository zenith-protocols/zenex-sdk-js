import {
    Contract,
    scValToNative,
    xdr,
    Address,
} from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { Asset } from './trading_contract.js';
import { descale } from '../utils/scaling.js';
import { simulateAndParse } from '../simulation_helper.js';

export interface PriceData {
    price: number;
    timestamp: number;
}

export class TradingOracle {
    constructor(
        public oracleId: string,
        public prices: Map<Asset, PriceData>,
        public decimals: number
    ) { }

    /**
     * Load oracle with prices for multiple assets
     */
    public static async load(
        network: Network,
        oracleId: string,
        assets: Asset[],
        decimals?: number
    ): Promise<TradingOracle> {
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

        // Load prices for all assets
        const prices = new Map<Asset, PriceData>();

        for (const asset of assets) {
            const contract = new Contract(oracleId);

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

            const result = await simulateAndParse(
                network,
                priceOp,
                (xdrResult) => {
                    const val = xdr.ScVal.fromXDR(xdrResult, 'base64');
                    const native = scValToNative(val);
                    return native;
                }
            );

            // Create PriceData with descaled price
            const rawPrice = result.result.price;
            const descaledPrice = descale(rawPrice, oracleDecimals);

            const priceData: PriceData = {
                price: descaledPrice,
                timestamp: result.result.timestamp
            };

            prices.set(asset, priceData);
        }

        return new TradingOracle(oracleId, prices, oracleDecimals);
    }

    /**
     * Get the price of an asset (automatically descaled)
     */
    public getPrice(asset: Asset): number | undefined {
        return this.prices.get(asset)?.price;
    }
}