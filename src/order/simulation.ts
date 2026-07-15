import { rpc, type Transaction, type xdr } from '@stellar/stellar-sdk';
import {
    ContractError,
    ContractErrorType,
    parseError,
} from '../response_parser.js';
import type { Network } from '../index.js';

export type StrictSimulationResult<T> =
    | {
          kind: 'ready';
          transaction: Transaction;
          result: T;
          latestLedger: number;
          minResourceFee: bigint;
      }
    | {
          kind: 'rejected';
          error: ContractError;
          latestLedger: number;
          diagnosticEvents: xdr.DiagnosticEvent[];
      }
    | { kind: 'restoreRequired'; latestLedger: number };

export interface PrepareStrictTransactionInput<T> {
    network: Network;
    transaction: Transaction;
    parser: (resultXdr: string) => T;
    server?: rpc.Server;
}

function unknownRejection<T>(
    simulation: rpc.Api.SimulateTransactionSuccessResponse,
): StrictSimulationResult<T> {
    return {
        kind: 'rejected',
        error: new ContractError(ContractErrorType.UnknownError),
        latestLedger: simulation.latestLedger,
        diagnosticEvents: [...simulation.events],
    };
}

/**
 * Simulate the final transaction exactly once and assemble only that success.
 * Restore requirements and failures never return a transaction.
 */
export async function prepareStrictTransaction<T>(
    input: PrepareStrictTransactionInput<T>,
): Promise<StrictSimulationResult<T>> {
    const stellarRpc =
        input.server ?? new rpc.Server(input.network.rpc, input.network.opts);
    const simulation = await stellarRpc.simulateTransaction(input.transaction);

    if (rpc.Api.isSimulationRestore(simulation)) {
        return {
            kind: 'restoreRequired',
            latestLedger: simulation.latestLedger,
        };
    }
    if (rpc.Api.isSimulationError(simulation)) {
        return {
            kind: 'rejected',
            error: parseError(simulation),
            latestLedger: simulation.latestLedger,
            diagnosticEvents: [...simulation.events],
        };
    }
    if (!simulation.result?.retval) return unknownRejection(simulation);

    try {
        const result = input.parser(simulation.result.retval.toXDR('base64'));
        const minResourceFee = BigInt(simulation.minResourceFee);
        if (minResourceFee < 0n) return unknownRejection(simulation);
        const transaction = rpc
            .assembleTransaction(input.transaction, simulation)
            .build();
        return {
            kind: 'ready',
            transaction,
            result,
            latestLedger: simulation.latestLedger,
            minResourceFee,
        };
    } catch {
        return unknownRejection(simulation);
    }
}
