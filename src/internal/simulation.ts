import {
    Account,
    BASE_FEE,
    rpc,
    TimeoutInfinite,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';

// Dummy account for simulations (doesn't need to exist on chain)
const SIMULATION_ACCOUNT = 'GDMVSPSKEUOTRFSJH2SXVUNB2JGORKDTWBMOP5OZJZP4GKRQUQWFJO4Y';
const SIMULATION_SEQUENCE = '123';

/**
 * Simulate a contract call and return the raw ScVal result
 * @param network - Network configuration
 * @param operation - Base64 encoded XDR operation
 * @returns The result ScVal or null if simulation failed
 */
export async function simulateCall(
    network: Network,
    operation: string
): Promise<xdr.ScVal | null> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const account = new Account(SIMULATION_ACCOUNT, SIMULATION_SEQUENCE);

    const txBuilder = new TransactionBuilder(account, {
        networkPassphrase: network.passphrase,
        fee: BASE_FEE,
        timebounds: { maxTime: TimeoutInfinite, minTime: 0 },
    }).addOperation(xdr.Operation.fromXDR(operation, 'base64'));

    const transaction = txBuilder.build();

    try {
        const simulation = await stellarRpc.simulateTransaction(transaction);

        if (rpc.Api.isSimulationSuccess(simulation) && simulation.result?.retval) {
            return simulation.result.retval;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Simulate multiple contract calls in parallel
 * @param network - Network configuration
 * @param operations - Array of base64 encoded XDR operations
 * @returns Array of result ScVals (null for failed simulations)
 */
export async function simulateCalls(
    network: Network,
    operations: string[]
): Promise<(xdr.ScVal | null)[]> {
    return Promise.all(operations.map(op => simulateCall(network, op)));
}

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

/**
 * Check if a simulation was successful
 */
export function isSimulationSuccess(
    simulation: rpc.Api.SimulateTransactionResponse
): simulation is rpc.Api.SimulateTransactionSuccessResponse {
    return rpc.Api.isSimulationSuccess(simulation);
}
