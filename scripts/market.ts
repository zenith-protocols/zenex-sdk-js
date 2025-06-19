// scripts/test-market-estimates.ts
import {
    Networks,
    Network,
    loadTradingConfig,
    loadVaultState,
    loadTradingMarket,
    loadUserPositionIds,
    loadPositions,
    Asset,
    TradingMarketEstimates
} from '../dist/esm/index.js';

// Test configuration
const TEST_CONFIG = {
    TRADING_CONTRACT: "CBSJ7C63AJTMKMWZCDIKRJUD7MESCKCWB5HERFAXGMK4FMMZ6K2LLL7D",
    TEST_USER: "GD27AAZKK4OXBJSB6EV327A5HA2RWRMVXGNHJOAYDWQUAABMS4CASINO",
    // Mock oracle price for testing
    MOCK_BTC_PRICE: 45000,
    MOCK_ETH_PRICE: 2500,
    MOCK_XLM_PRICE: 0.12
};

async function main() {
    console.log('🧪 Testing Trading Market Estimates\n');

    const network: Network = Networks.testnet;

    try {
        // 1. Load Trading Configuration
        console.log('📋 Loading Trading Configuration...');
        const tradingConfig = await loadTradingConfig(network, TEST_CONFIG.TRADING_CONTRACT);

        console.log('✅ Trading Config loaded');
        console.log('   Markets available:', tradingConfig.marketList.length);
        console.log('   Vault:', tradingConfig.vault);
        console.log('   Token:', tradingConfig.token);

        // 2. Load Vault State for balance
        console.log('\n📋 Loading Vault State...');
        const vaultState = await loadVaultState(
            network,
            tradingConfig.vault,
            tradingConfig.token
        );
        console.log('✅ Vault Balance:', vaultState.balance.toFixed(2));

        // 3. Load all markets and analyze
        console.log('\n🏪 Analyzing All Markets:');
        console.log('═'.repeat(80));

        for (const asset of tradingConfig.marketList) {
            const assetName = asset.tag === 'Other' ? asset.values[0] : 'Stellar Asset';
            console.log(`\n📊 Market: ${assetName}`);
            console.log('─'.repeat(40));

            const market = await loadTradingMarket(network, TEST_CONFIG.TRADING_CONTRACT, asset);

            if (!market) {
                console.log('   ❌ Market not found');
                continue;
            }

            console.log('   Status:', market.enabled ? '🟢 Enabled' : '🔴 Disabled');
            console.log('   Max Leverage:', market.maxLeverage + 'x');
            console.log('   Long Positions:', market.longCount);
            console.log('   Short Positions:', market.shortCount);

            // Create estimates calculator
            const estimates = new TradingMarketEstimates(tradingConfig, market);

            // Calculate interest rates
            const rates = estimates.calculateInterestRate(vaultState.balance);

            console.log('\n   💰 Interest Rates:');
            console.log('   - Utilization:', (rates.utilization * 100).toFixed(1) + '%');
            console.log('   - Average Leverage:', rates.averageLeverage.toFixed(2) + 'x');
            console.log('   - Long/Short Ratio:', rates.longShortRatio.toFixed(2));
            console.log('   - Long APR:', rates.longAPR.toFixed(2) + '%');
            console.log('   - Short APR:', rates.shortAPR.toFixed(2) + '%');
            console.log('   - TVL:', rates.totalValueLocked.toFixed(0));
            console.log('   - Available Liquidity:', rates.availableLiquidity.toFixed(0));
        }

        // 4. Load user positions
        console.log('\n\n👤 User Positions Analysis:');
        console.log('═'.repeat(80));
        console.log('User:', TEST_CONFIG.TEST_USER);

        const positionIds = await loadUserPositionIds(
            network,
            TEST_CONFIG.TRADING_CONTRACT,
            TEST_CONFIG.TEST_USER
        );

        if (positionIds.length === 0) {
            console.log('   No positions found');
        } else {
            console.log(`   Found ${positionIds.length} position(s)\n`);

            const positions = await loadPositions(
                network,
                TEST_CONFIG.TRADING_CONTRACT,
                positionIds
            );

            for (const [id, position] of positions) {
                if (!position) continue;

                const assetName = position.asset.tag === 'Other'
                    ? position.asset.values[0]
                    : 'Stellar Asset';

                console.log(`\n📈 Position #${id}`);
                console.log('─'.repeat(40));
                console.log('   Asset:', assetName);
                console.log('   Status:', position.status);
                console.log('   Type:', position.isLong ? '🟢 LONG' : '🔴 SHORT');
                console.log('   Leverage:', position.leverage + 'x');
                console.log('   Collateral:', position.collateral.toFixed(2));
                console.log('   Entry Price:', '$' + position.entryPrice.toFixed(2));

                // Only calculate P&L for open positions
                if (position.status === 'Open') {
                    // Get market for this position
                    const positionMarket = await loadTradingMarket(
                        network,
                        TEST_CONFIG.TRADING_CONTRACT,
                        position.asset
                    );

                    if (positionMarket) {
                        const estimates = new TradingMarketEstimates(tradingConfig, positionMarket);

                        // Use mock price based on asset
                        let currentPrice = position.entryPrice; // Default to entry
                        if (assetName === 'BTC') currentPrice = TEST_CONFIG.MOCK_BTC_PRICE;
                        else if (assetName === 'ETH') currentPrice = TEST_CONFIG.MOCK_ETH_PRICE;
                        else if (assetName === 'XLM') currentPrice = TEST_CONFIG.MOCK_XLM_PRICE;

                        const pnl = estimates.calculatePnL(position, currentPrice);

                        console.log('\n   💵 P&L Analysis:');
                        console.log('   - Current Price:', '$' + currentPrice.toFixed(2));
                        console.log('   - Raw P&L:', pnl.pnl >= 0 ? '+' : '', pnl.pnl.toFixed(2));
                        console.log('   - Interest Paid:', pnl.interest.toFixed(2));
                        console.log('   - Net P&L:', pnl.netPnl >= 0 ? '+' : '', pnl.netPnl.toFixed(2));
                        console.log('   - P&L %:', pnl.netPnlPercent >= 0 ? '+' : '', pnl.netPnlPercent.toFixed(2) + '%');
                        console.log('   - Remaining Collateral:', pnl.remainingCollateral.toFixed(2));
                        console.log('   - Can Liquidate:', pnl.canLiquidate ? '⚠️ YES' : '✅ NO');
                    }
                }

                if (position.stopLoss > 0) {
                    console.log('   Stop Loss:', '$' + position.stopLoss.toFixed(2));
                }
                if (position.takeProfit > 0) {
                    console.log('   Take Profit:', '$' + position.takeProfit.toFixed(2));
                }
            }
        }

        console.log('\n\n✅ Test completed successfully!');

    } catch (error) {
        console.error('\n❌ Error:', error);
        if (error instanceof Error) {
            console.error('   Message:', error.message);
            console.error('   Stack:', error.stack);
        }
    }
}

// Run the test
main().catch(console.error);