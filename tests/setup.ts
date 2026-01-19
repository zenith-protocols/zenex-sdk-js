/**
 * Test Setup - Shared utilities for Zenex SDK tests
 *
 * Run individual tests with: npx ts-node tests/<test-name>.ts
 */

import {
    Keypair,
    Networks,
    TransactionBuilder,
    rpc,
    xdr,
} from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { Network } from '../src/types/primitives.js';

// ============================================================
// Configuration
// ============================================================

export interface TestConfig {
    privateKey: string;
    trading: string;
}

export function loadConfig(): TestConfig {
    const configPath = path.join(__dirname, '..', 'test-contract.json');
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
}

export const network: Network = {
    rpc: 'https://soroban-testnet.stellar.org',
    passphrase: Networks.TESTNET,
};

// ============================================================
// Keypair & Account Helpers
// ============================================================

export function getKeypair(secretKey: string): Keypair {
    return Keypair.fromSecret(secretKey);
}

export async function getAccount(
    server: rpc.Server,
    publicKey: string
): Promise<rpc.Api.GetAccountResult> {
    return server.getAccount(publicKey);
}

// ============================================================
// Transaction Helpers
// ============================================================

export interface TransactionResult {
    success: boolean;
    hash: string;
    result?: string;
    events?: xdr.DiagnosticEvent[];
    error?: string;
}

/**
 * Build, sign, and submit a transaction with the given operation
 */
export async function submitTransaction(
    server: rpc.Server,
    keypair: Keypair,
    operationXdr: string,
    timeout: number = 30
): Promise<TransactionResult> {
    const account = await server.getAccount(keypair.publicKey());

    // Decode the operation from base64 XDR
    const operation = xdr.Operation.fromXDR(operationXdr, 'base64');

    // Build the transaction
    const transaction = new TransactionBuilder(account, {
        fee: '10000000', // 1 XLM max fee
        networkPassphrase: network.passphrase,
    })
        .addOperation(operation)
        .setTimeout(timeout)
        .build();

    // Simulate to get auth and resource info
    const simResult = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationError(simResult)) {
        return {
            success: false,
            hash: '',
            error: `Simulation failed: ${simResult.error}`,
        };
    }

    // Prepare the transaction (adds auth and resources)
    const preparedTx = rpc.assembleTransaction(transaction, simResult).build();

    // Sign the transaction
    preparedTx.sign(keypair);

    // Submit and wait for result
    try {
        const sendResult = await server.sendTransaction(preparedTx);

        if (sendResult.status === 'ERROR') {
            return {
                success: false,
                hash: sendResult.hash,
                error: `Send failed: ${sendResult.errorResult?.toXDR('base64')}`,
            };
        }

        // Poll for result with timeout
        let getResult = await server.getTransaction(sendResult.hash);
        let attempts = 0;
        const maxAttempts = 60; // 60 second timeout

        while (getResult.status === 'NOT_FOUND') {
            if (attempts >= maxAttempts) {
                return {
                    success: false,
                    hash: sendResult.hash,
                    error: 'Transaction timeout: not found after 60 seconds',
                };
            }
            await sleep(1000);
            getResult = await server.getTransaction(sendResult.hash);
            attempts++;
        }

        if (getResult.status === 'SUCCESS') {
            // Safely extract events if available
            let events: xdr.DiagnosticEvent[] | undefined;
            try {
                events = getResult.resultMetaXdr?.v3()?.sorobanMeta()?.events();
            } catch {
                // v3 format not available, skip events
            }

            return {
                success: true,
                hash: sendResult.hash,
                result: getResult.returnValue?.toXDR('base64'),
                events,
            };
        } else {
            return {
                success: false,
                hash: sendResult.hash,
                error: `Transaction failed: ${getResult.status}`,
            };
        }
    } catch (error) {
        return {
            success: false,
            hash: '',
            error: `Submit error: ${error}`,
        };
    }
}

/**
 * Simulate a read-only operation (no transaction submission)
 */
export async function simulateOperation(
    server: rpc.Server,
    publicKey: string,
    operationXdr: string
): Promise<{ success: boolean; result?: string; error?: string }> {
    const account = await server.getAccount(publicKey);
    const operation = xdr.Operation.fromXDR(operationXdr, 'base64');

    const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: network.passphrase,
    })
        .addOperation(operation)
        .setTimeout(30)
        .build();

    const simResult = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationError(simResult)) {
        return {
            success: false,
            error: `Simulation failed: ${simResult.error}`,
        };
    }

    if (rpc.Api.isSimulationSuccess(simResult) && simResult.result) {
        return {
            success: true,
            result: simResult.result.retval.toXDR('base64'),
        };
    }

    return {
        success: false,
        error: 'No result from simulation',
    };
}

// ============================================================
// Utility Functions
// ============================================================

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatAmount(amount: number, decimals: number = 2): string {
    return amount.toFixed(decimals);
}

export function log(message: string): void {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

export function logSuccess(message: string): void {
    console.log(`[${new Date().toISOString()}] ✓ ${message}`);
}

export function logError(message: string): void {
    console.error(`[${new Date().toISOString()}] ✗ ${message}`);
}

export function logSection(title: string): void {
    console.log('\n' + '='.repeat(60));
    console.log(` ${title}`);
    console.log('='.repeat(60) + '\n');
}

// ============================================================
// Export Server Creator
// ============================================================

export function createServer(): rpc.Server {
    return new rpc.Server(network.rpc, network.opts);
}
