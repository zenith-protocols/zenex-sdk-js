/**
 * Position Open Test
 *
 * Tests opening a new trading position (long or short).
 *
 * Run with: npx ts-node tests/position-open.ts
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
import { Asset } from '../src/types/asset.js';
import { ContractStatus } from '../src/types/trading.js';
import { scale } from '../src/internal/scaling.js';

async function main() {
    logSection('Position Open Test');

    // Load configuration
    const config = loadConfig();
    const keypair = getKeypair(config.privateKey);
    const server = createServer();
    const userAddress = keypair.publicKey();

    log(`User Address: ${userAddress}`);
    log(`Trading Contract: ${config.trading}`);

    // ============================================================
    // Step 1: Load trading configuration
    // ============================================================
    logSection('Step 1: Load Trading Config');

    let tradingConfig: TradingConfig;
    try {
        tradingConfig = await TradingConfig.load(network, config.trading);
        logSuccess(`Trading contract loaded`);
        log(`  Status: ${tradingConfig.getStatus() === ContractStatus.Active ? 'Active' : 'Paused'}`);
        log(`  Position Counter: ${tradingConfig.positionCounter}`);
        log(`  Max Positions: ${tradingConfig.maxPositions}`);
        log(`  Available Markets: ${tradingConfig.marketList.length}`);

        tradingConfig.marketList.forEach((asset, i) => {
            const assetName = asset.tag === 'Stellar'
                ? `Stellar:${asset.values[0].slice(0, 10)}...`
                : `Other:${asset.values[0]}`;
            log(`    ${i + 1}. ${assetName}`);
        });
    } catch (error) {
        logError(`Failed to load trading config: ${error}`);
        process.exit(1);
    }

    // if (tradingConfig.getStatus() !== ContractStatus.Active) {
    //     logError('Trading contract is paused. Cannot open positions.');
    //     process.exit(1);
    // }

    if (tradingConfig.marketList.length === 0) {
        logError('No markets available for trading.');
        process.exit(1);
    }

    // ============================================================
    // Step 2: Select market and load market data
    // ============================================================
    logSection('Step 2: Load Market Data');

    // Use the first available market
    const selectedAsset: Asset = tradingConfig.marketList[0];
    const assetDisplay = selectedAsset.tag === 'Stellar'
        ? `Stellar:${selectedAsset.values[0].slice(0, 10)}...`
        : `Other:${selectedAsset.values[0]}`;

    log(`Selected Market: ${assetDisplay}`);

    let market: Market | null;
    try {
        market = await Market.load(network, config.trading, selectedAsset);
        if (!market) {
            throw new Error('Market not found');
        }
        logSuccess(`Market data loaded`);
        log(`  Enabled: ${market.enabled}`);
        log(`  Min Collateral: ${formatAmount(market.minCollateral)}`);
        log(`  Max Collateral: ${formatAmount(market.maxCollateral)}`);
        log(`  Init Margin: ${formatAmount(market.initMargin * 100)}%`);
        log(`  Maintenance Margin: ${formatAmount(market.maintenanceMargin * 100)}%`);
        log(`  Base Fee: ${formatAmount(market.baseFee * 100, 4)}%`);
        log(`  Long Collateral: ${formatAmount(market.longCollateral)}`);
        log(`  Short Collateral: ${formatAmount(market.shortCollateral)}`);
        log(`  Market Skew: ${formatAmount(market.getSkew())}`);
    } catch (error) {
        logError(`Failed to load market: ${error}`);
        process.exit(1);
    }

    if (!market.enabled) {
        logError('Selected market is disabled.');
        process.exit(1);
    }

    // ============================================================
    // Step 3: Load oracle prices
    // ============================================================
    logSection('Step 3: Load Oracle Price');

    let oracle: Oracle;
    let currentPrice: number;
    try {
        oracle = await Oracle.loadPrices(
            network,
            tradingConfig.oracle,
            [selectedAsset]
        );

        const price = oracle.getPrice(selectedAsset);
        if (!price) {
            throw new Error('Price not found');
        }
        currentPrice = price;

        logSuccess(`Oracle price loaded`);
        log(`  Current Price: $${formatAmount(currentPrice, 2)}`);

        const priceData = oracle.getPriceData(selectedAsset);
        if (priceData) {
            const timestamp = Number(priceData.timestamp);
            const age = Math.floor(Date.now() / 1000) - timestamp;
            log(`  Price Age: ${age} seconds`);
        }
    } catch (error) {
        logError(`Failed to load oracle price: ${error}`);
        process.exit(1);
    }

    // ============================================================
    // Step 4: Check user's existing positions
    // ============================================================
    logSection('Step 4: Check Existing Positions');

    let existingPositionIds: number[];
    try {
        existingPositionIds = await Position.loadUserPositionIds(
            network,
            config.trading,
            userAddress
        );
        log(`User has ${existingPositionIds.length} existing positions`);
        if (existingPositionIds.length > 0) {
            log(`  Position IDs: ${existingPositionIds.join(', ')}`);
        }
    } catch (error) {
        logError(`Failed to load user positions: ${error}`);
        existingPositionIds = [];
    }

    if (existingPositionIds.length >= tradingConfig.maxPositions) {
        logError(`Max positions reached (${tradingConfig.maxPositions}). Close some positions first.`);
        process.exit(1);
    }

    // ============================================================
    // Step 5: Open a new position
    // ============================================================
    logSection('Step 5: Open Position');

    // Position parameters
    const collateral = Math.max(market.minCollateral, 5); // At least 5 tokens or min collateral
    const leverage = 5; // 5x leverage
    const notionalSize = collateral * leverage;
    const isLong = true; // Long position
    const entryPrice = 0; // Market order (0 = current oracle price)

    // Calculate trigger prices
    const takeProfitPercent = 0.05; // 5% profit target
    const stopLossPercent = 0.03; // 3% loss limit

    const takeProfit = isLong
        ? currentPrice * (1 + takeProfitPercent)
        : currentPrice * (1 - takeProfitPercent);

    const stopLoss = isLong
        ? currentPrice * (1 - stopLossPercent)
        : currentPrice * (1 + stopLossPercent);

    log(`Opening ${isLong ? 'LONG' : 'SHORT'} position:`);
    log(`  Collateral: ${formatAmount(collateral)} tokens`);
    log(`  Notional Size: ${formatAmount(notionalSize)} tokens`);
    log(`  Leverage: ${leverage}x`);
    log(`  Entry Price: Market (~$${formatAmount(currentPrice, 2)})`);
    log(`  Take Profit: $${formatAmount(takeProfit, 2)} (${isLong ? '+' : '-'}${formatAmount(takeProfitPercent * 100)}%)`);
    log(`  Stop Loss: $${formatAmount(stopLoss, 2)} (${isLong ? '-' : '+'}${formatAmount(stopLossPercent * 100)}%)`);

    // Estimate opening fee
    const estimatedFee = market.estimateOpenFee(notionalSize, isLong);
    log(`  Estimated Fee: ${formatAmount(estimatedFee, 4)} tokens`);

    const tradingContract = new TradingContract(config.trading);
    const openPositionOp = tradingContract.openPosition({
        user: userAddress,
        asset: selectedAsset,
        collateral: scale(collateral, 7),
        notional_size: scale(notionalSize, 7),
        is_long: isLong,
        entry_price: scale(entryPrice, 7), // 0 for market order
        take_profit: scale(takeProfit, 7),
        stop_loss: scale(stopLoss, 7),
    });

    log(`\nSubmitting transaction...`);
    const result = await submitTransaction(server, keypair, openPositionOp);

    if (!result.success) {
        logError(`Failed to open position: ${result.error}`);
        process.exit(1);
    }

    logSuccess(`Position opened successfully!`);
    log(`  Transaction Hash: ${result.hash}`);

    // Parse the result
    if (result.result) {
        const [positionId, openingFee] = TradingContract.parsers.openPosition(result.result);
        log(`  Position ID: ${positionId}`);
        log(`  Opening Fee: ${formatAmount(Number(openingFee) / 1e7, 4)} tokens`);
    }

    // ============================================================
    // Step 6: Verify the position was created
    // ============================================================
    logSection('Step 6: Verify Position');

    // Get updated position IDs
    const updatedPositionIds = await Position.loadUserPositionIds(
        network,
        config.trading,
        userAddress
    );

    // Find the new position ID
    const newPositionId = updatedPositionIds.find(
        (id) => !existingPositionIds.includes(id)
    );

    if (!newPositionId) {
        logError('Could not find new position ID');
        process.exit(1);
    }

    // Load the position details
    const position = await Position.load(network, config.trading, newPositionId);

    if (!position) {
        logError(`Failed to load position ${newPositionId}`);
        process.exit(1);
    }

    logSuccess(`Position ${newPositionId} loaded`);
    log(`  Status: ${position.status}`);
    log(`  Direction: ${position.getDirection()}`);
    log(`  Collateral: ${formatAmount(position.collateral)}`);
    log(`  Notional Size: ${formatAmount(position.notionalSize)}`);
    log(`  Leverage: ${formatAmount(position.leverage, 2)}x`);
    log(`  Entry Price: $${formatAmount(position.entryPrice, 2)}`);
    log(`  Take Profit: $${formatAmount(position.takeProfit, 2)}`);
    log(`  Stop Loss: $${formatAmount(position.stopLoss, 2)}`);

    // Calculate current PnL
    const pnl = position.calculatePnL(currentPrice, market);
    log(`\nCurrent P&L:`);
    log(`  Raw PnL: ${formatAmount(pnl.pnl, 4)}`);
    log(`  Interest: ${formatAmount(pnl.interest, 4)}`);
    log(`  Est. Fee: ${formatAmount(pnl.fee, 4)}`);
    log(`  Net PnL: ${formatAmount(pnl.netPnl, 4)}`);

    // Calculate liquidation price
    const liquidationPrice = position.getLiquidationPrice(market);
    log(`\nRisk Analysis:`);
    log(`  Liquidation Price: $${formatAmount(liquidationPrice, 2)}`);
    log(`  Distance to Liq: ${formatAmount(Math.abs(currentPrice - liquidationPrice) / currentPrice * 100, 2)}%`);
    log(`  Is Liquidatable: ${position.isLiquidatable(currentPrice, market) ? 'Yes' : 'No'}`);

    logSection('Test Complete');
    logSuccess(`Position open test completed! Position ID: ${newPositionId}`);
    log(`\nNext steps:`);
    log(`  - Run position-modify.ts to modify the position`);
    log(`  - Run position-close.ts to close the position`);
}

main().catch((error) => {
    logError(`Unhandled error: ${error}`);
    process.exit(1);
});
