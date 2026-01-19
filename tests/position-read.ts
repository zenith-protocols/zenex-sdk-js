/**
 * Position Read Test
 *
 * Read-only tests for loading and analyzing positions, markets, and oracle prices.
 * Does not submit any transactions.
 *
 * Run with: npx ts-node tests/position-read.ts
 */

import {
    loadConfig,
    network,
    getKeypair,
    log,
    logSuccess,
    logError,
    logSection,
    formatAmount,
} from './setup.js';

import { TradingConfig } from '../src/trading/config.js';
import { Position } from '../src/trading/position.js';
import { Market } from '../src/trading/market.js';
import { Oracle } from '../src/trading/oracle.js';
import { VaultState } from '../src/vault/state.js';
import { PositionStatus, ContractStatus } from '../src/types/trading.js';
import { getAssetKey } from '../src/types/asset.js';

async function main() {
    logSection('Position Read Test (Read-Only)');

    // Load configuration
    const config = loadConfig();
    const keypair = getKeypair(config.privateKey);
    const userAddress = keypair.publicKey();

    log(`User Address: ${userAddress}`);
    log(`Trading Contract: ${config.trading}`);

    // ============================================================
    // Step 1: Load Trading Configuration
    // ============================================================
    logSection('Step 1: Trading Configuration');

    let tradingConfig: TradingConfig;
    try {
        tradingConfig = await TradingConfig.load(network, config.trading);
        logSuccess(`Trading configuration loaded`);
        log(`  Name: ${tradingConfig.name || 'N/A'}`);
        log(`  Status: ${tradingConfig.getStatus() === ContractStatus.Active ? 'Active' : 'Paused'} (${tradingConfig.status})`);
        log(`  Vault: ${tradingConfig.vault}`);
        log(`  Token: ${tradingConfig.token}`);
        log(`  Oracle: ${tradingConfig.oracle}`);
        log(`  Position Counter: ${tradingConfig.positionCounter}`);
        log(`  Max Positions per User: ${tradingConfig.maxPositions}`);
        log(`  Caller Take Rate: ${formatAmount(tradingConfig.callerTakeRate * 100, 2)}%`);
        log(`  Max Utilization: ${formatAmount(tradingConfig.maxUtilization * 100, 2)}%`);
    } catch (error) {
        logError(`Failed to load trading config: ${error}`);
        process.exit(1);
    }

    // ============================================================
    // Step 2: Load Vault State
    // ============================================================
    logSection('Step 2: Vault State');

    try {
        const vaultState = await VaultState.load(network, tradingConfig.vault);
        logSuccess(`Vault state loaded`);
        log(`  Asset: ${vaultState.asset}`);
        log(`  Total Assets: ${formatAmount(vaultState.totalAssets)}`);
        log(`  Total Shares: ${formatAmount(vaultState.totalShares)}`);
        log(`  Share Price: ${formatAmount(vaultState.sharePrice(), 6)}`);
        log(`  Lock Time: ${vaultState.lockTime} seconds`);
    } catch (error) {
        logError(`Failed to load vault state: ${error}`);
    }

    // ============================================================
    // Step 3: Load All Markets
    // ============================================================
    logSection('Step 3: Markets');

    if (tradingConfig.marketList.length === 0) {
        log(`No markets configured`);
    } else {
        log(`Loading ${tradingConfig.marketList.length} market(s)...\n`);

        const markets = await Market.loadMultiple(
            network,
            config.trading,
            tradingConfig.marketList
        );

        markets.forEach((market, i) => {
            const assetKey = getAssetKey(market.asset);
            log(`Market ${i + 1}: ${assetKey}`);
            log(`  Status: ${market.enabled ? 'Enabled' : 'Disabled'}`);
            log(`  Collateral Range: ${formatAmount(market.minCollateral)} - ${formatAmount(market.maxCollateral)}`);
            log(`  Max Payout: ${formatAmount(market.maxPayout)}`);
            log(`  Init Margin: ${formatAmount(market.initMargin * 100, 2)}%`);
            log(`  Maintenance Margin: ${formatAmount(market.maintenanceMargin * 100, 2)}%`);
            log(`  Base Fee: ${formatAmount(market.baseFee * 100, 4)}%`);
            log(`  Price Impact Scalar: ${formatAmount(market.priceImpactScalar)}`);
            log(`  Base Hourly Rate: ${formatAmount(market.baseHourlyRate * 100, 6)}%`);
            log(`  --- Market Data ---`);
            log(`  Long Collateral: ${formatAmount(market.longCollateral)}`);
            log(`  Long Notional: ${formatAmount(market.longNotionalSize)}`);
            log(`  Short Collateral: ${formatAmount(market.shortCollateral)}`);
            log(`  Short Notional: ${formatAmount(market.shortNotionalSize)}`);
            log(`  Total Collateral: ${formatAmount(market.getTotalCollateral())}`);
            log(`  Market Skew: ${formatAmount(market.getSkew())}`);
            log('');
        });
    }

    // ============================================================
    // Step 4: Load Oracle Prices
    // ============================================================
    logSection('Step 4: Oracle Prices');

    if (tradingConfig.marketList.length === 0) {
        log(`No assets to fetch prices for`);
    } else {
        try {
            const oracle = await Oracle.loadPrices(
                network,
                tradingConfig.oracle,
                tradingConfig.marketList
            );

            logSuccess(`Oracle prices loaded (decimals: ${oracle.decimals})`);

            tradingConfig.marketList.forEach((asset) => {
                const assetKey = getAssetKey(asset);
                const priceData = oracle.getPriceData(asset);

                if (priceData) {
                    const timestamp = Number(priceData.timestamp);
                    const age = Math.floor(Date.now() / 1000) - timestamp;
                    const stale = age > 60; // Consider stale if older than 60 seconds
                    log(`  ${assetKey}: $${formatAmount(priceData.price, 2)} (${age}s old${stale ? ', STALE' : ''})`);
                } else {
                    log(`  ${assetKey}: Price not found`);
                }
            });
        } catch (error) {
            logError(`Failed to load oracle prices: ${error}`);
        }
    }

    // ============================================================
    // Step 5: Load User Positions
    // ============================================================
    logSection('Step 5: User Positions');

    const positionIds = await Position.loadUserPositionIds(
        network,
        config.trading,
        userAddress
    );

    if (positionIds.length === 0) {
        log(`No positions found for this user`);
        log(`Run position-open.ts to create a position`);
    } else {
        log(`Found ${positionIds.length} position(s)\n`);

        const positions = await Position.loadMultiple(network, config.trading, positionIds);

        // Load oracle and markets for PnL calculation
        let oracle: Oracle | null = null;
        const marketMap = new Map<string, Market>();

        try {
            oracle = await Oracle.loadPrices(
                network,
                tradingConfig.oracle,
                tradingConfig.marketList
            );

            const markets = await Market.loadMultiple(
                network,
                config.trading,
                tradingConfig.marketList
            );

            markets.forEach((m) => {
                marketMap.set(getAssetKey(m.asset), m);
            });
        } catch (error) {
            log(`Warning: Could not load oracle/markets for PnL calculation`);
        }

        // Display each position
        positions.forEach((position, i) => {
            const assetKey = getAssetKey(position.asset);
            const market = marketMap.get(assetKey);
            const currentPrice = oracle?.getPrice(position.asset);

            log(`Position #${position.id}`);
            log(`  Status: ${position.status}`);
            log(`  Asset: ${assetKey}`);
            log(`  Direction: ${position.getDirection()}`);
            log(`  Collateral: ${formatAmount(position.collateral)}`);
            log(`  Notional Size: ${formatAmount(position.notionalSize)}`);
            log(`  Leverage: ${formatAmount(position.leverage, 2)}x`);
            log(`  Entry Price: $${formatAmount(position.entryPrice, 2)}`);
            log(`  Take Profit: ${position.takeProfit > 0 ? `$${formatAmount(position.takeProfit, 2)}` : 'Not set'}`);
            log(`  Stop Loss: ${position.stopLoss > 0 ? `$${formatAmount(position.stopLoss, 2)}` : 'Not set'}`);
            log(`  Created: ${new Date(position.createdAt * 1000).toISOString()}`);

            if (position.status === PositionStatus.Open && currentPrice && market) {
                log(`  --- Live Analysis ---`);
                log(`  Current Price: $${formatAmount(currentPrice, 2)}`);

                const priceChange = currentPrice - position.entryPrice;
                const priceChangePercent = (priceChange / position.entryPrice) * 100;
                log(`  Price Change: ${priceChange >= 0 ? '+' : ''}$${formatAmount(priceChange, 2)} (${priceChangePercent >= 0 ? '+' : ''}${formatAmount(priceChangePercent, 2)}%)`);

                const pnl = position.calculatePnL(currentPrice, market);
                log(`  Raw PnL: ${formatAmount(pnl.pnl, 4)}`);
                log(`  Interest: ${formatAmount(pnl.interest, 4)}`);
                log(`  Est. Fee: ${formatAmount(pnl.fee, 4)}`);
                log(`  Net PnL: ${formatAmount(pnl.netPnl, 4)}`);

                const returnPercent = (pnl.netPnl / position.collateral) * 100;
                log(`  ROI: ${returnPercent >= 0 ? '+' : ''}${formatAmount(returnPercent, 2)}%`);

                const liqPrice = position.getLiquidationPrice(market);
                log(`  Liquidation Price: $${formatAmount(liqPrice, 2)}`);
                log(`  Distance to Liq: ${formatAmount(Math.abs(currentPrice - liqPrice) / currentPrice * 100, 2)}%`);
                log(`  Is Liquidatable: ${position.isLiquidatable(currentPrice, market) ? 'YES!' : 'No'}`);

                // Check triggers
                if (position.takeProfit > 0) {
                    log(`  TP Triggered: ${position.checkTakeProfit(currentPrice) ? 'YES' : 'No'}`);
                }
                if (position.stopLoss > 0) {
                    log(`  SL Triggered: ${position.checkStopLoss(currentPrice) ? 'YES' : 'No'}`);
                }
            }

            log('');
        });

        // Summary statistics
        const openPositions = positions.filter((p) => p.status === PositionStatus.Open);
        const totalCollateral = openPositions.reduce((sum, p) => sum + p.collateral, 0);
        const totalNotional = openPositions.reduce((sum, p) => sum + p.notionalSize, 0);

        logSection('Position Summary');
        log(`Total Positions: ${positions.length}`);
        log(`  Open: ${openPositions.length}`);
        log(`  Pending: ${positions.filter((p) => p.status === PositionStatus.Pending).length}`);
        log(`  Closed: ${positions.filter((p) => p.status === PositionStatus.Closed).length}`);

        if (openPositions.length > 0) {
            log(`\nOpen Position Totals:`);
            log(`  Total Collateral: ${formatAmount(totalCollateral)}`);
            log(`  Total Notional: ${formatAmount(totalNotional)}`);
            log(`  Avg Leverage: ${formatAmount(totalNotional / totalCollateral, 2)}x`);

            // Calculate total PnL if possible
            if (oracle && marketMap.size > 0) {
                let totalPnl = 0;
                openPositions.forEach((position) => {
                    const market = marketMap.get(getAssetKey(position.asset));
                    const price = oracle!.getPrice(position.asset);
                    if (market && price) {
                        totalPnl += position.calculatePnL(price, market).netPnl;
                    }
                });
                log(`  Total Unrealized PnL: ${formatAmount(totalPnl, 4)}`);
            }
        }
    }

    logSection('Test Complete');
    logSuccess(`Read-only test completed!`);
}

main().catch((error) => {
    logError(`Unhandled error: ${error}`);
    process.exit(1);
});
