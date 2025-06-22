import {
    Networks,
    Network,
    Asset,
    TradingConfig,
    TradingOracle,
} from '../dist/esm/index.js';


async function main() {
    console.log('🚀 Testing Zenex SDK Contract Loading\n');

    const network: Network = Networks.testnet; // Change to Networks.mainnet for mainnet

    // Define the market asset we want to query
    const marketAsset: Asset = {
        tag: "Other",
        values: ["XLM"]
    };

    try {
        const tradingConfig = await TradingConfig.load(network, "CBSJ7C63AJTMKMWZCDIKRJUD7MESCKCWB5HERFAXGMK4FMMZ6K2LLL7D");
        const oracle = await TradingOracle.load(network, tradingConfig.oracle, [marketAsset]);
        console.log('✅ Trading Config and Oracle Loaded Successfully\n');

        let price = oracle.getPrice(marketAsset);
        console.log(`Price for ${marketAsset.values[0]}:`, price);
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