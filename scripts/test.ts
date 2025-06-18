import { Loader, Networks, Asset } from '../dist/esm/index.js';;

async function main() {
    const network = Networks.testnet; // Change to Network.mainnet for mainnet deployment
    const loader = new Loader(network);

    const tradingId = "CDNRDUJ5WQ4XLP56TV7DZANITQ74B3KBHWYGTEF6ZBWUPP3YCGRAHE56";
    const vaultId = "CAIWWESC3NLEIDE34MCLUZOTH5BVZEQ4WZOYSXCZLCYVT3IB5JD7JUA6";
    const tokenId = "CAYHS4BPAJKI6BRPJA57LEXTLFFC5LI3DCEGOWR3LHDF7W67TSTIIN42";
    const marketAsset: Asset = {
        tag: "Other",
        values: ["XLM"]
    };

    loader.queryTradingConfig(tradingId);
    loader.queryVaultState(vaultId, tokenId);
    loader.queryTradingMarket(tradingId, marketAsset);
    await loader.load();

    const tradingConfig = loader.getTradingConfig(tradingId);
    const vaultState = loader.getVaultState(vaultId);
    const tradingMarket = loader.getTradingMarket(tradingId, marketAsset);

    console.log("Trading Config:", tradingConfig);
    console.log("Vault State:", vaultState);
    console.log("Trading Market:", tradingMarket);


}

// Run deployment
main();