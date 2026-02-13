import {
    Account,
    Contract,
    rpc,
    scValToNative,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { Network } from './index.js';
import { Asset, assetToScVal } from './asset.js';

// Price data from oracle
export interface PriceData {
    /** The price as a fixed point number with the oracle's decimals */
    price: bigint;
    /** The timestamp of the price in seconds */
    timestamp: number;
}

// Dummy account for simulations (doesn't need to exist on chain)
const SIMULATION_ACCOUNT = 'GANXGJV2RNOFMOSQ2DTI3RKDBAVERXUVFC27KW3RLVQCLB3RYNO3AAI4';

/**
 * Fetch the `lastprice` from an oracle contract for the given asset.
 * @param network - The network to use
 * @param oracleId - The oracle contract ID
 * @param asset - The asset to fetch the price for
 * @returns The PriceData (price as bigint, timestamp as number)
 * @throws Will throw an error if `None` is returned or if the simulation fails.
 */
export async function getOraclePrice(
    network: Network,
    oracleId: string,
    asset: Asset
): Promise<PriceData> {
    const account = new Account(SIMULATION_ACCOUNT, '123');
    const txBuilder = new TransactionBuilder(account, {
        fee: '1000',
        timebounds: { minTime: 0, maxTime: 0 },
        networkPassphrase: network.passphrase,
    });

    txBuilder.addOperation(new Contract(oracleId).call('lastprice', assetToScVal(asset)));

    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const result = await stellarRpc.simulateTransaction(txBuilder.build());

    if (rpc.Api.isSimulationSuccess(result)) {
        const xdrStr = result.result?.retval.toXDR('base64');
        if (xdrStr) {
            const priceResult = xdr.ScVal.fromXDR(xdrStr, 'base64')?.value();
            if (priceResult) {
                const entries = priceResult as { val: () => xdr.ScVal }[];
                return {
                    price: scValToNative(entries[0]?.val()),
                    timestamp: Number(scValToNative(entries[1]?.val())),
                };
            }
        }
        throw new Error('Unable to decode oracle price result');
    } else {
        throw new Error(`Failed to fetch oracle price: ${result.error}`);
    }
}

/**
 * Fetch the `decimals` from an oracle contract.
 * @param network - The network to use
 * @param oracleId - The oracle contract ID
 * @returns The decimals and latest ledger number
 * @throws Will throw an error if the simulation fails.
 */
export async function getOracleDecimals(
    network: Network,
    oracleId: string
): Promise<{ decimals: number; latestLedger: number }> {
    const account = new Account(SIMULATION_ACCOUNT, '123');
    const txBuilder = new TransactionBuilder(account, {
        fee: '1000',
        timebounds: { minTime: 0, maxTime: 0 },
        networkPassphrase: network.passphrase,
    });

    txBuilder.addOperation(new Contract(oracleId).call('decimals'));

    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const result = await stellarRpc.simulateTransaction(txBuilder.build());

    if (rpc.Api.isSimulationSuccess(result) && result.result) {
        const val = scValToNative(result.result.retval);
        return {
            decimals: val,
            latestLedger: result.latestLedger,
        };
    } else {
        throw new Error(`Failed to fetch oracle decimals: ${result}`);
    }
}
