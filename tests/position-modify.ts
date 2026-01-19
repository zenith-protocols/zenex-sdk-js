/**
 * Position Modify Test
 *
 * Tests modifying an existing position:
 * - Modify collateral (add/remove)
 * - Set triggers (take profit / stop loss)
 *
 * Run with: npx ts-node tests/position-modify.ts
 */

import {
    loadConfig,
    network,
    getKeypair,
    createServer,
    submitTransaction,
    log,
    logSuccess,
    logError,
    logSection,
    formatAmount,
} from './setup.js';

import { TradingContract } from '../src/trading/contract.js';
import { TradingConfig } from '../src/trading/config.js';
import { Position } from '../src/trading/position.js';
import { Market } from '../src/trading/market.js';
import { Oracle } from '../src/trading/oracle.js';
import { PositionStatus } from '../src/types/trading.js';
import { scale } from '../src/internal/scaling.js';

async function main() {
    logSection('Position Modify Test');

    // Load configuration
    const config = loadConfig();
    const keypair = getKeypair(config.privateKey);
    const server = createServer();
    const userAddress = keypair.publicKey();

    log(`User Address: ${userAddress}`);
    log(`Trading Contract: ${config.trading}`);

    // ============================================================
    // Step 1: Load user's positions
    // ============================================================
    logSection('Step 1: Load User Positions');

    const positionIds = await Position.loadUserPositionIds(
        network,
        config.trading,
        userAddress
    );

    if (positionIds.length === 0) {
        logError('No positions found. Run position-open.ts first.');
        process.exit(1);
    }

    log(`Found ${positionIds.length} position(s): ${positionIds.join(', ')}`);

    // Load all positions
    const positions = await Position.loadMultiple(network, config.trading, positionIds);

    // Find an open position to modify
    const openPosition = positions.find((p) => p.status === PositionStatus.Open);

    if (!openPosition) {
        logError('No open positions found. All positions may be closed or pending.');
        log(`Position statuses: ${positions.map((p) => `${p.id}:${p.status}`).join(', ')}`);
        process.exit(1);
    }

    logSuccess(`Found open position #${openPosition.id}`);
    log(`  Direction: ${openPosition.getDirection()}`);
    log(`  Collateral: ${formatAmount(openPosition.collateral)}`);
    log(`  Notional Size: ${formatAmount(openPosition.notionalSize)}`);
    log(`  Leverage: ${formatAmount(openPosition.leverage, 2)}x`);
    log(`  Entry Price: $${formatAmount(openPosition.entryPrice, 2)}`);
    log(`  Take Profit: ${openPosition.takeProfit > 0 ? `$${formatAmount(openPosition.takeProfit, 2)}` : 'Not set'}`);
    log(`  Stop Loss: ${openPosition.stopLoss > 0 ? `$${formatAmount(openPosition.stopLoss, 2)}` : 'Not set'}`);

    // ============================================================
    // Step 2: Load market and oracle data
    // ============================================================
    logSection('Step 2: Load Market & Oracle');

    const tradingConfig = await TradingConfig.load(network, config.trading);
    const market = await Market.load(network, config.trading, openPosition.asset);

    if (!market) {
        logError('Failed to load market data');
        process.exit(1);
    }

    const oracle = await Oracle.loadPrices(
        network,
        tradingConfig.oracle,
        [openPosition.asset]
    );
    const currentPrice = oracle.getPrice(openPosition.asset)!;

    logSuccess(`Market and oracle loaded`);
    log(`  Current Price: $${formatAmount(currentPrice, 2)}`);
    log(`  Maintenance Margin: ${formatAmount(market.maintenanceMargin * 100)}%`);

    // Calculate current state
    const currentPnl = openPosition.calculatePnL(currentPrice, market);
    const currentLiqPrice = openPosition.getLiquidationPrice(market);

    log(`\nCurrent Position State:`);
    log(`  Net PnL: ${formatAmount(currentPnl.netPnl, 4)}`);
    log(`  Liquidation Price: $${formatAmount(currentLiqPrice, 2)}`);

    // ============================================================
    // Step 3: Modify Collateral
    // ============================================================
    logSection('Step 3: Modify Collateral');

    const tradingContract = new TradingContract(config.trading);

    // Add 20% more collateral to reduce leverage
    const additionalCollateral = openPosition.collateral * 0.2;
    const newCollateral = openPosition.collateral + additionalCollateral;

    log(`Adding ${formatAmount(additionalCollateral)} collateral...`);
    log(`  Current Collateral: ${formatAmount(openPosition.collateral)}`);
    log(`  New Collateral: ${formatAmount(newCollateral)}`);
    log(`  New Leverage: ${formatAmount(openPosition.notionalSize / newCollateral, 2)}x`);

    const modifyCollateralOp = tradingContract.modifyCollateral({
        position_id: openPosition.id,
        new_collateral: scale(newCollateral, 7),
    });

    const modifyResult = await submitTransaction(server, keypair, modifyCollateralOp);

    if (!modifyResult.success) {
        logError(`Failed to modify collateral: ${modifyResult.error}`);
        // Continue with trigger test even if collateral modification fails
    } else {
        logSuccess(`Collateral modified!`);
        log(`  Transaction Hash: ${modifyResult.hash}`);

        if (modifyResult.result) {
            const interestFee = TradingContract.parsers.modifyCollateral(modifyResult.result);
            log(`  Interest Fee Charged: ${formatAmount(Number(interestFee) / 1e7, 4)}`);
        }
    }

    // ============================================================
    // Step 4: Set Triggers (Take Profit / Stop Loss)
    // ============================================================
    logSection('Step 4: Set Triggers');

    // Set new triggers based on current price
    const takeProfitPercent = 0.10; // 10% profit target
    const stopLossPercent = 0.05;   // 5% loss limit

    const newTakeProfit = openPosition.isLong
        ? currentPrice * (1 + takeProfitPercent)
        : currentPrice * (1 - takeProfitPercent);

    const newStopLoss = openPosition.isLong
        ? currentPrice * (1 - stopLossPercent)
        : currentPrice * (1 + stopLossPercent);

    log(`Setting new triggers:`);
    log(`  Current Price: $${formatAmount(currentPrice, 2)}`);
    log(`  New Take Profit: $${formatAmount(newTakeProfit, 2)} (${openPosition.isLong ? '+' : '-'}${formatAmount(takeProfitPercent * 100)}%)`);
    log(`  New Stop Loss: $${formatAmount(newStopLoss, 2)} (${openPosition.isLong ? '-' : '+'}${formatAmount(stopLossPercent * 100)}%)`);

    const setTriggersOp = tradingContract.setTriggers({
        position_id: openPosition.id,
        take_profit: scale(newTakeProfit, 7),
        stop_loss: scale(newStopLoss, 7),
    });

    const triggersResult = await submitTransaction(server, keypair, setTriggersOp);

    if (!triggersResult.success) {
        logError(`Failed to set triggers: ${triggersResult.error}`);
    } else {
        logSuccess(`Triggers set successfully!`);
        log(`  Transaction Hash: ${triggersResult.hash}`);
    }

    // ============================================================
    // Step 5: Verify modifications
    // ============================================================
    logSection('Step 5: Verify Modifications');

    const updatedPosition = await Position.load(network, config.trading, openPosition.id);

    if (!updatedPosition) {
        logError(`Failed to load updated position`);
        process.exit(1);
    }

    logSuccess(`Position ${updatedPosition.id} updated`);
    log(`  Collateral: ${formatAmount(openPosition.collateral)} -> ${formatAmount(updatedPosition.collateral)}`);
    log(`  Leverage: ${formatAmount(openPosition.leverage, 2)}x -> ${formatAmount(updatedPosition.leverage, 2)}x`);
    log(`  Take Profit: ${openPosition.takeProfit > 0 ? `$${formatAmount(openPosition.takeProfit, 2)}` : 'Not set'} -> $${formatAmount(updatedPosition.takeProfit, 2)}`);
    log(`  Stop Loss: ${openPosition.stopLoss > 0 ? `$${formatAmount(openPosition.stopLoss, 2)}` : 'Not set'} -> $${formatAmount(updatedPosition.stopLoss, 2)}`);

    // Recalculate risk with new collateral
    const newLiqPrice = updatedPosition.getLiquidationPrice(market);
    log(`\nUpdated Risk Analysis:`);
    log(`  Liquidation Price: $${formatAmount(currentLiqPrice, 2)} -> $${formatAmount(newLiqPrice, 2)}`);
    log(`  Distance to Liq: ${formatAmount(Math.abs(currentPrice - newLiqPrice) / currentPrice * 100, 2)}%`);

    // Check trigger conditions
    log(`\nTrigger Status:`);
    log(`  Take Profit Triggered: ${updatedPosition.checkTakeProfit(currentPrice) ? 'Yes' : 'No'}`);
    log(`  Stop Loss Triggered: ${updatedPosition.checkStopLoss(currentPrice) ? 'Yes' : 'No'}`);

    logSection('Test Complete');
    logSuccess(`Position modify test completed!`);
    log(`\nNext steps:`);
    log(`  - Run position-close.ts to close the position`);
    log(`  - Run position-read.ts to view all positions`);
}

main().catch((error) => {
    logError(`Unhandled error: ${error}`);
    process.exit(1);
});
