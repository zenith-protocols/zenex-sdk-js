import {
    Account,
    BASE_FEE,
    rpc,
    TimeoutInfinite,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { Network } from './index.js';
import { parseError } from './response_parser.js';

// Dummy account for simulations (doesn't need to exist on chain)
const SIMULATION_ACCOUNT =
    'GDMVSPSKEUOTRFSJH2SXVUNB2JGORKDTWBMOP5OZJZP4GKRQUQWFJO4Y';
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
    parser: (result: string) => T,
): Promise<{ result: T; latestLedger: number }> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const transaction = new TransactionBuilder(
        new Account(SIMULATION_ACCOUNT, SIMULATION_SEQUENCE),
        {
            networkPassphrase: network.passphrase,
            fee: BASE_FEE,
            timebounds: { maxTime: TimeoutInfinite, minTime: 0 },
        },
    )
        .addOperation(xdr.Operation.fromXDR(operation, 'base64'))
        .build();

    const simulation = await stellarRpc.simulateTransaction(transaction);
    if (rpc.Api.isSimulationRestore(simulation)) {
        throw new Error('Simulation failed: restore required');
    }
    if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation failed: ${parseError(simulation).message}`);
    }
    if (!simulation.result?.retval) {
        throw new Error('Simulation failed: no return value');
    }
    return {
        result: parser(simulation.result.retval.toXDR('base64')),
        latestLedger: simulation.latestLedger,
    };
}
