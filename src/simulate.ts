import {
    Account,
    BASE_FEE,
    rpc,
    TimeoutInfinite,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { Network } from './index.js';
import { ZenexError, ZenexErrorCode } from './errors.js';
import { parseError } from './response_parser.js';

// Dummy account for simulations (doesn't need to exist on chain)
const SIMULATION_ACCOUNT =
    'GDMVSPSKEUOTRFSJH2SXVUNB2JGORKDTWBMOP5OZJZP4GKRQUQWFJO4Y';
const SIMULATION_SEQUENCE = '123';

/**
 * Simulate `operation` against `network` and decode the return value with
 * `parser`. Nothing is signed or submitted.
 *
 * @param network - Network configuration and RPC connection.
 * @param operation - The contract call, as a base64-encoded XDR operation.
 * @param parser - Function that decodes the base64 XDR return value.
 * @param options - `authMode` sets how the simulation records
 *   authorization. The RPC default records root-level auth only, so a call
 *   whose `require_auth` sits below the root invocation, such as a router
 *   batch that creates an order, fails with `Error(Auth, InvalidAction)`.
 *   Pass `{ authMode: 'record_allow_nonroot' }` for such a call.
 * @returns The parsed result and the ledger sequence the simulation ran
 *   against.
 * @throws {ZenexError} `InvokeHostFunctionEntryArchived` (-4) when the
 *   simulation needs a state restore first. The decoded code when the
 *   simulation fails: its message names the contract error, or the host
 *   error for a failure outside any contract, and `cause` holds the raw RPC
 *   error text. `UnknownError` when the simulation carries no return value.
 */
export async function simulateAndParse<T>(
    network: Network,
    operation: string,
    parser: (result: string) => T,
    options?: { authMode?: rpc.Api.SimulationAuthMode },
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

    const simulation = await stellarRpc.simulateTransaction(
        transaction,
        undefined,
        options?.authMode,
    );
    if (rpc.Api.isSimulationRestore(simulation)) {
        throw new ZenexError(
            ZenexErrorCode.InvokeHostFunctionEntryArchived,
            'Simulation failed: restore required',
        );
    }
    if (rpc.Api.isSimulationError(simulation)) {
        const decoded = parseError(simulation);
        const error = new ZenexError(
            decoded.code,
            `Simulation failed: ${decoded.message}`,
        );
        error.cause = simulation.error;
        throw error;
    }
    if (!simulation.result?.retval) {
        throw new ZenexError(
            ZenexErrorCode.UnknownError,
            'Simulation failed: no return value',
        );
    }
    return {
        result: parser(simulation.result.retval.toXDR('base64')),
        latestLedger: simulation.latestLedger,
    };
}
