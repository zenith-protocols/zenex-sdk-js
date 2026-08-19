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
 * Simulate `operation` against `network` and decode the return value with
 * `parser`.
 *
 * Throws when the simulation needs a state restore instead of returning a
 * result. The caller must restore the archived ledger entries and retry.
 * Throws with the decoded message when the simulation itself fails. Throws
 * when the simulation succeeds but carries no return value.
 * @param network - Network configuration and RPC connection.
 * @param operation - The contract call, as a base64-encoded XDR operation.
 * @param parser - Function that decodes the base64 XDR return value.
 * @returns The parsed result and the ledger sequence the simulation ran
 * against.
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
