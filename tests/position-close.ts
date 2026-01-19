/**
 * Position Close Test
 *
 * Tests closing an existing position and verifying the realized PnL.
 *
 * Run with: npx ts-node tests/position-close.ts
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

async function main() {
    logSection('Position Close Test');

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

    // Find an open position to close
    const openPosition = positions.find((p) => p.status === PositionStatus.Open);

    if (!openPosition) {
        logError('No open positions found. All positions may already be closed.');
        log(`Position statuses:`);
        positions.forEach((p) => {
            log(`  Position #${p.id}: ${p.status}`);
        });
        process.exit(1);
    }

    logSuccess(`Found open position #${openPosition.id} to close`);
    log(`  Direction: ${openPosition.getDirection()}`);
    log(`  Collateral: ${formatAmount(openPosition.collateral)}`);
    log(`  Notional Size: ${formatAmount(openPosition.notionalSize)}`);
    log(`  Leverage: ${formatAmount(openPosition.leverage, 2)}x`);
    log(`  Entry Price: $${formatAmount(openPosition.entryPrice, 2)}`);

    // ============================================================
    // Step 2: Load market and oracle for PnL calculation
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
    log(`  Entry Price: $${formatAmount(openPosition.entryPrice, 2)}`);

    const priceChange = currentPrice - openPosition.entryPrice;
    const priceChangePercent = (priceChange / openPosition.entryPrice) * 100;
    log(`  Price Change: ${priceChange >= 0 ? '+' : ''}$${formatAmount(priceChange, 2)} (${priceChangePercent >= 0 ? '+' : ''}${formatAmount(priceChangePercent, 2)}%)`);

    // ============================================================
    // Step 3: Calculate expected PnL before closing
    // ============================================================
    logSection('Step 3: Calculate Expected PnL');

    const expectedPnl = openPosition.calculatePnL(currentPrice, market);

    log(`Expected PnL Breakdown:`);
    log(`  Raw PnL (price movement): ${formatAmount(expectedPnl.pnl, 4)}`);
    log(`  Interest/Funding: ${formatAmount(expectedPnl.interest, 4)}`);
    log(`  Estimated Closing Fee: ${formatAmount(expectedPnl.fee, 4)}`);
    log(`  Net PnL: ${formatAmount(expectedPnl.netPnl, 4)}`);

    const returnPercent = (expectedPnl.netPnl / openPosition.collateral) * 100;
    log(`\n  Return on Collateral: ${returnPercent >= 0 ? '+' : ''}${formatAmount(returnPercent, 2)}%`);

    // ============================================================
    // Step 4: Close the position
    // ============================================================
    logSection('Step 4: Close Position');

    const tradingContract = new TradingContract(config.trading);
    const closePositionOp = tradingContract.closePosition(openPosition.id);

    log(`Closing position #${openPosition.id}...`);

    const result = await submitTransaction(server, keypair, closePositionOp);

    if (!result.success) {
        logError(`Failed to close position: ${result.error}`);
        process.exit(1);
    }

    logSuccess(`Position closed successfully!`);
    log(`  Transaction Hash: ${result.hash}`);

    // Parse the result to get actual PnL
    if (result.result) {
        const [realizedPnl, closingFee] = TradingContract.parsers.closePosition(result.result);
        const pnlNumber = Number(realizedPnl) / 1e7;
        const feeNumber = Number(closingFee) / 1e7;

        log(`\nRealized Results:`);
        log(`  Realized PnL: ${formatAmount(pnlNumber, 4)}`);
        log(`  Closing Fee: ${formatAmount(feeNumber, 4)}`);

        const finalReturn = pnlNumber - feeNumber;
        const finalReturnPercent = (finalReturn / openPosition.collateral) * 100;
        log(`  Final Return: ${formatAmount(finalReturn, 4)} (${finalReturnPercent >= 0 ? '+' : ''}${formatAmount(finalReturnPercent, 2)}%)`);

        // Compare expected vs actual
        log(`\nExpected vs Actual:`);
        log(`  Expected Net PnL: ${formatAmount(expectedPnl.netPnl, 4)}`);
        log(`  Actual Net PnL: ${formatAmount(pnlNumber - feeNumber, 4)}`);
        log(`  Difference: ${formatAmount((pnlNumber - feeNumber) - expectedPnl.netPnl, 4)}`);
    }

    // ============================================================
    // Step 5: Verify position is closed
    // ============================================================
    logSection('Step 5: Verify Position Closed');

    // Check if position still exists in user's list
    const updatedPositionIds = await Position.loadUserPositionIds(
        network,
        config.trading,
        userAddress
    );

    const positionRemoved = !updatedPositionIds.includes(openPosition.id);

    if (positionRemoved) {
        logSuccess(`Position #${openPosition.id} removed from user's positions`);
    } else {
        log(`Position #${openPosition.id} still in user's list (may be marked as closed)`);

        // Try to load the position to check status
        const closedPosition = await Position.load(network, config.trading, openPosition.id);
        if (closedPosition) {
            log(`  Position Status: ${closedPosition.status}`);
        }
    }

    log(`\nRemaining positions: ${updatedPositionIds.length}`);
    if (updatedPositionIds.length > 0) {
        log(`  Position IDs: ${updatedPositionIds.join(', ')}`);
    }

    // ============================================================
    // Step 6: Show market state after close
    // ============================================================
    logSection('Step 6: Market State After Close');

    const updatedMarket = await Market.load(network, config.trading, openPosition.asset);

    if (updatedMarket) {
        log(`Market State:`);
        log(`  Long Collateral: ${formatAmount(market.longCollateral)} -> ${formatAmount(updatedMarket.longCollateral)}`);
        log(`  Short Collateral: ${formatAmount(market.shortCollateral)} -> ${formatAmount(updatedMarket.shortCollateral)}`);
        log(`  Long Notional: ${formatAmount(market.longNotionalSize)} -> ${formatAmount(updatedMarket.longNotionalSize)}`);
        log(`  Short Notional: ${formatAmount(market.shortNotionalSize)} -> ${formatAmount(updatedMarket.shortNotionalSize)}`);
        log(`  Market Skew: ${formatAmount(market.getSkew())} -> ${formatAmount(updatedMarket.getSkew())}`);
    }

    logSection('Test Complete');
    logSuccess(`Position close test completed!`);
    log(`\nThe position cycle is complete:`);
    log(`  1. Open position (position-open.ts)`);
    log(`  2. Modify position (position-modify.ts)`);
    log(`  3. Close position (position-close.ts)`);
}

main().catch((error) => {
    logError(`Unhandled error: ${error}`);
    process.exit(1);
});
