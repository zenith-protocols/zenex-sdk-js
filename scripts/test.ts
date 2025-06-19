import {
    Networks,
    Network,
    loadTradingConfig,
    loadVaultState,
    loadTradingMarket,
    Asset,
    loadVaultWithdrawal
} from '../dist/esm/index.js';

// Contract addresses from zenex-ui/.env.local
const CONTRACTS = {
    TRADING_CONTRACT: "CAVGUXGSLGR7W6Y3IVHN66WTLGATPFHEDGKHKGHVEPTTZYKFTTJVBLID",
    VAULT_CONTRACT: "CBUTJBCHZVVLPEPAXQSP2KFRSVMOVUKUNVZNZEE6HMALTLW4FKZZMTN4",
    TOKEN_CONTRACT: "CAYHS4BPAJKI6BRPJA57LEXTLFFC5LI3DCEGOWR3LHDF7W67TSTIIN42",
    TOKEN_ASSET: "oUSD",
    TOKEN_ISSUER: "GAQPDDMR5DI3KKNQSMSYSTCOSJAV7462QS436NUW6TVYGX3ACKEUS42E"
};

async function main() {
    console.log('🚀 Testing Zenex SDK Contract Loading\n');

    const network: Network = Networks.testnet; // Change to Networks.mainnet for mainnet

    // Define the market asset we want to query
    const marketAsset: Asset = {
        tag: "Other",
        values: ["XLM"]
    };

    try {
        // 1. Load Trading Configuration
        console.log('📋 Loading Trading Configuration...');
        const tradingConfig = await loadTradingConfig(network, CONTRACTS.TRADING_CONTRACT);

        console.log('\n✅ Trading Config Loaded:');
        console.log('   Status:', tradingConfig.status);
        console.log('   Oracle:', tradingConfig.oracle);
        console.log('   Caller Take Rate:', (tradingConfig.callerTakeRate * 100).toFixed(2) + '%');
        console.log('   Max Positions:', tradingConfig.maxPositions);
        console.log('   Vault:', tradingConfig.vault);
        console.log('   Token:', tradingConfig.token);
        console.log('   Admin:', tradingConfig.admin);
        console.log('   Name:', tradingConfig.name || 'N/A');
        console.log('   Market Count:', tradingConfig.marketList.length);
        console.log('   Position Counter:', tradingConfig.positionCounter);

        // 2. Load Vault State
        console.log('\n📋 Loading Vault State...');
        const vaultState = await loadVaultState(
            network,
            CONTRACTS.VAULT_CONTRACT,
            CONTRACTS.TOKEN_CONTRACT
        );

        console.log('\n✅ Vault State Loaded:');
        console.log('   Token:', vaultState.token);
        console.log('   Share Token:', vaultState.shareToken);
        console.log('   Total Shares:', vaultState.totalShares.toFixed(2));
        console.log('   Total Balance:', vaultState.balance.toFixed(2));
        console.log('   Lock Time:', vaultState.lockTime / 60, 'minutes');
        console.log('   Penalty Rate:', (vaultState.penaltyRate * 100).toFixed(1) + '%');
        console.log('   Strategies:', vaultState.strategies.length);

        // Calculate share price
        const sharePrice = vaultState.totalShares > 0
            ? vaultState.balance / vaultState.totalShares
            : 1;
        console.log('   Share Price:', sharePrice.toFixed(4), CONTRACTS.TOKEN_ASSET);

        // 3. Load Trading Market
        console.log('\n📋 Loading Trading Market for', marketAsset.values[0] + '...');
        const tradingMarket = await loadTradingMarket(
            network,
            CONTRACTS.TRADING_CONTRACT,
            marketAsset
        );

        if (tradingMarket) {
            console.log('\n✅ Trading Market Loaded:');
            console.log('   Asset:', marketAsset.values[0]);
            console.log('   Enabled:', tradingMarket.enabled);
            console.log('   Max Leverage:', tradingMarket.maxLeverage + 'x');
            console.log('   Max Payout:', (tradingMarket.maxPayout * 100).toFixed(1) + '%');
            console.log('   Min Collateral:', tradingMarket.minCollateral.toFixed(0));
            console.log('   Max Collateral:', tradingMarket.maxCollateral.toFixed(0));
            console.log('   Liquidation Threshold:', (tradingMarket.liquidationThreshold * 100).toFixed(1) + '%');
            console.log('   Total Available:', (tradingMarket.totalAvailable * 100).toFixed(0));

            // Market data
            console.log('\n   Market Data:');
            console.log('   - Long Positions:', tradingMarket.longCount);
            console.log('   - Long Collateral:', tradingMarket.longCollateral.toFixed(0));
            console.log('   - Long Borrowed:', tradingMarket.longBorrowed.toFixed(0));
            console.log('   - Short Positions:', tradingMarket.shortCount);
            console.log('   - Short Collateral:', tradingMarket.shortCollateral.toFixed(0));
            console.log('   - Short Borrowed:', tradingMarket.shortBorrowed.toFixed(0));

            // Calculate utilization
            const totalCollateral = tradingMarket.longCollateral + tradingMarket.shortCollateral;
            const totalBorrowed = tradingMarket.longBorrowed + tradingMarket.shortBorrowed;
            const utilization = totalBorrowed > 0
                ? (totalBorrowed / (totalCollateral + totalBorrowed)) * 100
                : 0;
            console.log('   - Utilization:', utilization.toFixed(1) + '%');

            // Fee structure
            console.log('\n   Fee Structure:');
            console.log('   - Base Fee:', (tradingMarket.baseFee * 100).toFixed(3) + '%');
            console.log('   - Price Impact Scalar:', tradingMarket.priceImpactScalar.toFixed(0));
            console.log('   - Min Hourly Rate:', (tradingMarket.minHourlyRate * 100).toFixed(4) + '%');
            console.log('   - Max Hourly Rate:', (tradingMarket.maxHourlyRate * 100).toFixed(4) + '%');
            console.log('   - Target Hourly Rate:', (tradingMarket.targetHourlyRate * 100).toFixed(4) + '%');
            console.log('   - Target Utilization:', (tradingMarket.targetUtilization * 100).toFixed(1) + '%');
        } else {
            console.log('\n❌ Trading Market not found for', marketAsset.values[0]);
        }

        // Summary
        console.log('\n📊 Summary:');
        console.log('   Network:', network.passphrase.includes('Test') ? 'Testnet' : 'Mainnet');
        console.log('   Trading Contract:', CONTRACTS.TRADING_CONTRACT);
        console.log('   Vault Contract:', CONTRACTS.VAULT_CONTRACT);
        console.log('   Token Contract:', CONTRACTS.TOKEN_CONTRACT);
        console.log('   Token Asset:', CONTRACTS.TOKEN_ASSET);
        console.log('   Token Issuer:', CONTRACTS.TOKEN_ISSUER);
        console.log('   All data loaded successfully! ✨');

        const withdrawal = await loadVaultWithdrawal(network, CONTRACTS.VAULT_CONTRACT, "GA7ABH5TCTZ4KHR3KLAFHONMWHLOYX5NFFYZNTS5L27XEDF3S6ITRAAH");
        console.log('\n💰 Withdrawal Details:')
        console.log(withdrawal);

    } catch (error) {
        console.error('\n❌ Error loading contract data:', error);
        if (error instanceof Error) {
            console.error('   Message:', error.message);
            console.error('   Stack:', error.stack);
        }
    }
}

// Run the script
main().catch(console.error);