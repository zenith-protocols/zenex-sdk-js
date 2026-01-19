import { rpc, xdr } from '@stellar/stellar-sdk';
import { Network } from '../types/primitives.js';

/**
 * Create an RPC server instance
 */
export function createRpcServer(network: Network): rpc.Server {
    return new rpc.Server(network.rpc, network.opts);
}

/**
 * Get ledger entries from the RPC server
 */
export async function getLedgerEntries(
    network: Network,
    ...keys: xdr.LedgerKey[]
): Promise<rpc.Api.GetLedgerEntriesResponse> {
    const server = createRpcServer(network);
    return server.getLedgerEntries(...keys);
}
