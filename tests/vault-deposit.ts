/**
 * Vault Deposit Test
 *
 * Tests depositing assets into the vault to provide liquidity for trading.
 *
 * Run with: npx ts-node tests/vault-deposit.ts
 */

import { rpc, Contract, nativeToScVal, Address, scValToBigInt, xdr } from '@stellar/stellar-sdk';
import {
    loadConfig,
    network,
    getKeypair,
    createServer,
    submitTransaction,
    simulateOperation,
    log,
    logSuccess,
    logError,
    logSection,
    formatAmount,
} from './setup.js';

import { TradingConfig } from '../src/trading/config.js';
import { ContractStatus } from '../src/types/trading.js';
import { VaultContract } from '../src/vault/contract.js';
import { VaultState } from '../src/vault/state.js';
import { scale } from '../src/internal/scaling.js';

async function main() {
    logSection('Vault Deposit Test');

    // Load configuration
    const config = loadConfig();
    const keypair = getKeypair(config.privateKey);
    const server = createServer();
    const userAddress = keypair.publicKey();

    log(`User Address: ${userAddress}`);
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
        log(`  Status: ${tradingConfig.getStatus() === ContractStatus.Active ? 'Active' : 'Paused'}`);
        log(`  Markets: ${tradingConfig.marketList.length}`);
    } catch (error) {
        logError(`Failed to load trading config: ${error}`);
        process.exit(1);
    }

    const vaultAddress = tradingConfig.vault;
    const tokenAddress = tradingConfig.token;

    // ============================================================
    // Step 2: Load current vault state
    // ============================================================
    logSection('Step 2: Load Vault State (Before)');

    let vaultStateBefore: VaultState;
    try {
        vaultStateBefore = await VaultState.load(network, vaultAddress);
        logSuccess(`Vault state loaded`);
        log(`  Total Assets: ${formatAmount(vaultStateBefore.totalAssets)}`);
        log(`  Total Shares: ${formatAmount(vaultStateBefore.totalShares)}`);
        log(`  Share Price: ${formatAmount(vaultStateBefore.sharePrice(), 4)}`);
        log(`  Lock Time: ${vaultStateBefore.lockTime} seconds`);
    } catch (error) {
        logError(`Failed to load vault state: ${error}`);
        process.exit(1);
    }
    // ============================================================
    // Step 4: Deposit to vault
    // ============================================================
    logSection('Step 4: Deposit to Vault');

    const depositAmount = 10000; // 10 tokens
    const depositAmountScaled = scale(depositAmount, 7);

    log(`Depositing ${depositAmount} tokens to vault...`);

    const vault = new VaultContract(vaultAddress);
    const depositOp = vault.deposit(
        depositAmountScaled,
        userAddress, // receiver (gets shares)
        userAddress, // from (provides assets)
        userAddress  // operator
    );

    const depositResult = await submitTransaction(server, keypair, depositOp);

    if (!depositResult.success) {
        logError(`Deposit failed: ${depositResult.error}`);
        process.exit(1);
    }

    logSuccess(`Deposit successful!`);
    log(`  Transaction Hash: ${depositResult.hash}`);

    // Parse the result to get shares received
    if (depositResult.result) {
        const sharesReceived = VaultContract.parsers.deposit(depositResult.result);
        log(`  Shares Received: ${formatAmount(Number(sharesReceived) / 1e7)}`);
    }

    // ============================================================
    // Step 5: Verify vault state after deposit
    // ============================================================
    logSection('Step 5: Load Vault State (After)');

    try {
        const vaultStateAfter = await VaultState.load(network, vaultAddress);
        logSuccess(`Vault state updated`);
        log(`  Total Assets: ${formatAmount(vaultStateBefore.totalAssets)} -> ${formatAmount(vaultStateAfter.totalAssets)}`);
        log(`  Total Shares: ${formatAmount(vaultStateBefore.totalShares)} -> ${formatAmount(vaultStateAfter.totalShares)}`);
        log(`  Share Price: ${formatAmount(vaultStateAfter.sharePrice(), 4)}`);

        const assetIncrease = vaultStateAfter.totalAssets - vaultStateBefore.totalAssets;
        log(`  Assets Deposited: ${formatAmount(assetIncrease)}`);
    } catch (error) {
        logError(`Failed to load vault state after deposit: ${error}`);
    }

    // ============================================================
    // Step 6: Check if user shares are locked
    // ============================================================
    logSection('Step 6: Check Lock Status');

    try {
        const isLocked = await VaultState.isLocked(network, vaultAddress, userAddress);
        log(`User shares locked: ${isLocked ? 'Yes' : 'No'}`);
        if (isLocked) {
            log(`  Shares will be locked for ${vaultStateBefore.lockTime} seconds after deposit`);
        }
    } catch (error) {
        logError(`Failed to check lock status: ${error}`);
    }

    logSection('Test Complete');
    logSuccess('Vault deposit test completed successfully!');
}

main().catch((error) => {
    logError(`Unhandled error: ${error}`);
    process.exit(1);
});
