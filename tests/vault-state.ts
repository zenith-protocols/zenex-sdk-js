/**
 * Vault State Test
 *
 * Tests loading vault state and debugging total assets loading.
 *
 * Run with: npx ts-node tests/vault-state.ts
 *
 * Or with environment variables:
 *   TRADING_CONTRACT=CA... PRIVATE_KEY=S... npx ts-node tests/vault-state.ts
 */

import { rpc, Address, xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import {
    loadConfig,
    network,
    getKeypair,
    createServer,
    log,
    logSuccess,
    logError,
    logSection,
    formatAmount,
} from './setup.js';

import { TradingConfig } from '../src/trading/config.js';
import { VaultState } from '../src/vault/state.js';
import {
    contractInstanceLedgerKey,
    tokenBalanceLedgerKey,
    decodeEntryKey,
} from '../src/ledger-keys.js';

// Helper to load config from env vars or file
function getConfig(): { privateKey?: string; trading: string } {
    // Try environment variables first
    if (process.env.TRADING_CONTRACT) {
        return {
            privateKey: process.env.PRIVATE_KEY,
            trading: process.env.TRADING_CONTRACT,
        };
    }
    // Fallback to file
    try {
        return loadConfig();
    } catch {
        // Default test contract (no private key - read only)
        return {
            trading: 'CA2S7PBDAGQEZ7DBC7FIX2OQQNKVWUBIZBV3HDR3H6ZVNOPII5PFFFD3',
        };
    }
}

async function main() {
    logSection('Vault State Test');

    // Load configuration
    const config = getConfig();

    const server = createServer();
    let userAddress: string | undefined;
    if (config.privateKey) {
        const keypair = getKeypair(config.privateKey);
        userAddress = keypair.publicKey();
        log(`User Address: ${userAddress}`);
    } else {
        log('Running in read-only mode (no private key)');
    }

    log(`Trading Contract: ${config.trading}`);

    // ============================================================
    // Step 1: Load trading config to get vault address
    // ============================================================
    logSection('Step 1: Load Trading Config');

    let tradingConfig: TradingConfig;
    try {
        tradingConfig = await TradingConfig.load(network, config.trading);
        logSuccess(`Trading contract loaded`);
        log(`  Vault: ${tradingConfig.vault}`);
        log(`  Token: ${tradingConfig.token}`);
    } catch (error) {
        logError(`Failed to load trading config: ${error}`);
        process.exit(1);
    }

    const vaultAddress = tradingConfig.vault;
    const tokenAddress = tradingConfig.token;

    // ============================================================
    // Step 2: Debug - Manually load vault instance storage
    // ============================================================
    logSection('Step 2: Debug Vault Instance Storage');

    const stellarRpc = new rpc.Server(network.rpc, network.opts);

    // Read vault instance storage
    const instanceKey = contractInstanceLedgerKey(vaultAddress);
    const instanceResponse = await stellarRpc.getLedgerEntries(instanceKey);

    if (instanceResponse.entries.length === 0) {
        logError('Vault contract not found');
        process.exit(1);
    }

    const contractData = instanceResponse.entries[0].val.contractData();
    const contractInstance = contractData.val().instance();
    const storage = contractInstance.storage();

    if (!storage) {
        logError('Vault instance storage is empty');
        process.exit(1);
    }

    logSuccess('Vault instance storage loaded');
    log(`  Storage entries: ${storage.length}`);

    // Parse all instance storage entries
    let asset: string | undefined;
    let lockTime: number = 0;
    let totalSupply: bigint = 0n;

    storage.forEach((storageEntry) => {
        const entryKey = decodeEntryKey(storageEntry.key());
        log(`  Key: ${entryKey}`);

        switch (entryKey) {
            case 'AssetAddress':
                asset = Address.fromScVal(storageEntry.val()).toString();
                log(`    -> Asset Address: ${asset}`);
                break;

            case 'LockTime':
                lockTime = Number(scValToBigInt(storageEntry.val()));
                log(`    -> Lock Time: ${lockTime}`);
                break;

            case 'TotalSupply':
                totalSupply = scValToBigInt(storageEntry.val());
                log(`    -> Total Supply (raw): ${totalSupply}`);
                log(`    -> Total Supply (descaled): ${Number(totalSupply) / 1e7}`);
                break;

            default:
                // Log the value type for debugging
                const valType = storageEntry.val().switch().name;
                log(`    -> Value type: ${valType}`);
        }
    });

    // ============================================================
    // Step 3: Debug - Manually load token balance for vault
    // ============================================================
    logSection('Step 3: Debug Token Balance (Total Assets)');

    if (!asset) {
        logError('Asset address not found in vault storage');
        process.exit(1);
    }

    log(`Token Contract: ${asset}`);
    log(`Vault Address: ${vaultAddress}`);

    // Create the balance ledger key
    const balanceKey = tokenBalanceLedgerKey(asset, vaultAddress);
    log(`Balance Key XDR: ${balanceKey.toXDR('base64')}`);

    try {
        const balanceResponse = await stellarRpc.getLedgerEntries(balanceKey);
        log(`Balance entries found: ${balanceResponse.entries.length}`);

        if (balanceResponse.entries.length > 0) {
            const entry = balanceResponse.entries[0];
            const contractDataEntry = entry.val.contractData();
            const val = contractDataEntry.val();

            log(`  Value switch type: ${val.switch().name}`);

            // Debug the raw value structure
            try {
                // Try as i128 directly
                const rawBigInt = scValToBigInt(val);
                log(`  Raw BigInt value (scValToBigInt): ${rawBigInt}`);
                log(`  Descaled (7 decimals): ${Number(rawBigInt) / 1e7}`);
            } catch (e) {
                log(`  scValToBigInt failed: ${e}`);
            }

            // Try scValToNative to see the structure
            try {
                const nativeVal = scValToNative(val);
                log(`  Native value: ${JSON.stringify(nativeVal)}`);
            } catch (e) {
                log(`  scValToNative failed: ${e}`);
            }

            // If it's a map, parse the amount field
            if (val.switch().name === 'scvMap') {
                const map = val.map();
                if (map) {
                    log('  Balance is stored as a map:');
                    map.forEach((mapEntry) => {
                        const key = mapEntry.key();
                        const value = mapEntry.val();
                        let keyStr = 'unknown';
                        try {
                            keyStr = key.sym().toString();
                        } catch {
                            try {
                                keyStr = scValToNative(key) as string;
                            } catch {
                                keyStr = key.switch().name;
                            }
                        }
                        log(`    ${keyStr}: ${value.switch().name}`);

                        // Try to extract the amount field
                        if (keyStr === 'amount') {
                            try {
                                const amount = scValToBigInt(value);
                                log(`      -> Amount: ${amount} (${Number(amount) / 1e7} descaled)`);
                            } catch (e) {
                                log(`      -> Failed to parse amount: ${e}`);
                            }
                        }
                    });
                }
            }

            // Log the XDR for manual inspection
            log(`  Value XDR (base64): ${val.toXDR('base64')}`);
        } else {
            log('  No balance entry found - vault has 0 assets');
        }
    } catch (error) {
        logError(`Failed to load balance: ${error}`);
    }

    // ============================================================
    // Step 4: Load using VaultState.load() and compare
    // ============================================================
    logSection('Step 4: Load VaultState via SDK');

    try {
        const vaultState = await VaultState.load(network, vaultAddress);
        logSuccess(`VaultState loaded`);
        log(`  Asset: ${vaultState.asset}`);
        log(`  Lock Time: ${vaultState.lockTime}`);
        log(`  Total Shares: ${vaultState.totalShares}`);
        log(`  Total Assets: ${vaultState.totalAssets}`);
        log(`  Share Price: ${vaultState.sharePrice()}`);

        // Verify the values match
        if (vaultState.asset !== asset) {
            logError(`Asset mismatch: SDK=${vaultState.asset}, Manual=${asset}`);
        }
        if (vaultState.lockTime !== lockTime) {
            logError(`LockTime mismatch: SDK=${vaultState.lockTime}, Manual=${lockTime}`);
        }
        const expectedShares = Number(totalSupply) / 1e7;
        if (Math.abs(vaultState.totalShares - expectedShares) > 0.0001) {
            logError(`TotalShares mismatch: SDK=${vaultState.totalShares}, Expected=${expectedShares}`);
        }
    } catch (error) {
        logError(`VaultState.load() failed: ${error}`);
    }

    // ============================================================
    // Step 5: Check lockDuration for user
    // ============================================================
    logSection('Step 5: Check User Lock Duration');

    if (userAddress) {
        try {
            const vaultState = await VaultState.load(network, vaultAddress);
            const lockDuration = await vaultState.lockDuration(userAddress);
            if (lockDuration > 0) {
                log(`User shares locked: Yes (${lockDuration} seconds remaining)`);
            } else {
                log(`User shares locked: No`);
            }
        } catch (error) {
            logError(`lockDuration check failed: ${error}`);
        }
    } else {
        log('Skipping lock check (no user address provided)');
    }

    logSection('Test Complete');
}

main().catch((error) => {
    logError(`Unhandled error: ${error}`);
    process.exit(1);
});
