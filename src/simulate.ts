import {
    Account,
    BASE_FEE,
    rpc,
    TimeoutInfinite,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { Network } from './index.js';

// Dummy account for simulations (doesn't need to exist on chain)
const SIMULATION_ACCOUNT = 'GDMVSPSKEUOTRFSJH2SXVUNB2JGORKDTWBMOP5OZJZP4GKRQUQWFJO4Y';
const SIMULATION_SEQUENCE = '123';

/**
 * Simulate a contract call and parse the result
 * @param network - Network configuration
 * @param operation - Base64 encoded XDR operation
 * @param parser - Function to parse the result
 * @returns Parsed result and latest ledger
 */
export async function simulateAndParse<T>(
    network: Network,
    operation: string,
    parser: (result: string) => T
): Promise<{ result: T; latestLedger: number }> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const account = new Account(SIMULATION_ACCOUNT, SIMULATION_SEQUENCE);

    const txBuilder = new TransactionBuilder(account, {
        networkPassphrase: network.passphrase,
        fee: BASE_FEE,
        timebounds: { maxTime: TimeoutInfinite, minTime: 0 },
    }).addOperation(xdr.Operation.fromXDR(operation, 'base64'));

    const transaction = txBuilder.build();
    const simulation = await stellarRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(simulation) && simulation.result && simulation.result.retval) {
        return {
            result: parser(simulation.result.retval.toXDR('base64')),
            latestLedger: simulation.latestLedger,
        };
    }

    throw new Error(`Simulation failed: ${JSON.stringify(simulation)}`);
}
