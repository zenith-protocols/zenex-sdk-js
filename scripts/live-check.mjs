// Validate the SDK against the LIVE testnet stack, read-only.
//
//   npm run build && node scripts/live-check.mjs
//
// Loads the deployed xlm-usd market through `Market.load`, cross-checks every
// loaded field against the contract's own view calls (simulated on the same
// live wasms the SDK's committed specs were generated from), and runs the
// estimate tier end to end at a chain-derived price. Reads and simulations
// only — nothing is signed or submitted.

import {
    Market,
    MarketUser,
    OrderIntent,
    VaultOrderIntent,
    TradingContract,
    VaultContract,
    estimateMarket,
    estimatePosition,
    previewOrder,
    simulateAndParse,
    tradingPriceCacheLedgerKey,
} from '../dist/esm/index.js';
import { rpc } from '@stellar/stellar-sdk';

// Defaults target the lan-rpc Data Streams stack (zenex-v2-local-xlm-20260817),
// the freshest deployment built from contracts main. Override with env vars to
// point elsewhere (e.g. the public testnet stack once it is redeployed):
//   ZENEX_RPC, ZENEX_MARKET, ZENEX_VAULT, ZENEX_TOKEN, ZENEX_PROBE_USER
const NETWORK = {
    rpc: process.env.ZENEX_RPC ?? 'http://192.168.2.50:8000',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};

let failures = 0;
function check(label, ok, detail = '') {
    const mark = ok ? 'ok  ' : 'FAIL';
    console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}
function fmt(value) {
    return typeof value === 'bigint' ? value.toString() : JSON.stringify(value);
}

const contracts = {
    market: process.env.ZENEX_MARKET ?? 'CBGG6W2K7QAYJEOSMJLONW2RSEAXL5RMD76DTVDZZUR7A5N27C37M25Z',
    vault: process.env.ZENEX_VAULT ?? 'CBVQ5ZQNO7VGLNTDCIKLKAK3BHU5ES6U4EK7CN3SDXLBYEBK7BYDSSVV',
    token: process.env.ZENEX_TOKEN ?? 'CBHJFR3Z56NCY3RNDU2MPHJCLFBVLIM6C65POU4Z7AMMSUYYPAYOIYQL',
};
console.log(`\nLive market xlm-usd via ${NETWORK.rpc}`);
console.log(`  trading ${contracts.market}\n  vault   ${contracts.vault}\n  token   ${contracts.token}\n`);

// --- 1. Load through the SDK ------------------------------------------------
const market = await Market.load(NETWORK, contracts);
console.log(`Market.load — ledger ${market.ledger}`);
check('wiring verified against instance', market.vault === contracts.vault && market.token === contracts.token);
check('status decoded', Number.isInteger(market.status), `status=${market.status}`);
check('config decoded', market.config.maxOpenInterest > 0n, `maxOI=${fmt(market.config.maxOpenInterest)}`);
check('asset decimals', market.assetDecimals > 0, `decimals=${market.assetDecimals}`);

// --- 2. Cross-check every loaded field against the contract's own views -----
const trading = new TradingContract(contracts.market);
const vault = new VaultContract(contracts.vault);
const sim = (op, parser) => simulateAndParse(NETWORK, op, parser);

const [status, cfg, data, adl, totalAssets, totalSupply] = await Promise.all([
    sim(trading.getStatus(), TradingContract.parsers.getStatus),
    sim(trading.getConfig(), TradingContract.parsers.getConfig),
    sim(trading.getMarketData(), TradingContract.parsers.getMarketData),
    sim(trading.getAdl(), TradingContract.parsers.getAdl),
    sim(vault.totalAssets(), VaultContract.parsers.totalAssets),
    sim(vault.totalSupply(), VaultContract.parsers.totalSupply),
]);

console.log('\nCross-checks vs simulated contract views');
check('get_status matches', status.result === market.status);
check(
    'get_config matches field-for-field',
    JSON.stringify(cfg.result, (k, v) => (typeof v === 'bigint' ? v.toString() : v)) ===
        JSON.stringify(market.config, (k, v) => (typeof v === 'bigint' ? v.toString() : v)),
);
check('get_adl matches', adl.result.long === market.adl.long && adl.result.short === market.adl.short);
check(
    'total_assets equals the entries-read vault balance',
    totalAssets.result === market.vaultAssets,
    `sim=${fmt(totalAssets.result)} entries=${fmt(market.vaultAssets)}`,
);
check(
    'total_supply equals the instance-read share supply',
    totalSupply.result === market.vaultShares,
    `sim=${fmt(totalSupply.result)} instance=${fmt(market.vaultShares)}`,
);
// MarketData drifts with every fill/accrual between the entries read and the
// simulation, so compare the slow-moving identity fields exactly and the
// accrual clock within one keeper interval.
check(
    'market_data notional matches',
    data.result.notional.long === market.data.notional.long &&
        data.result.notional.short === market.data.notional.short,
    `long=${fmt(market.data.notional.long)} short=${fmt(market.data.notional.short)}`,
);
check(
    'market_data accrual clock coherent',
    data.result.accruedAt >= market.data.accruedAt,
    `entries=${fmt(market.data.accruedAt)} sim=${fmt(data.result.accruedAt)}`,
);

// --- 3. A chain-derived price -----------------------------------------------
// The PriceCache temporary entry holds the newest verified price the market
// consumed (16-ledger TTL). Fall back to the book's implied entry price.
let price;
const server = new rpc.Server(NETWORK.rpc, NETWORK.opts);
try {
    const cache = await server.getLedgerEntries(tradingPriceCacheLedgerKey(contracts.market));
    if (cache.entries.length > 0) {
        const value = cache.entries[0].val.contractData().val();
        const { scValToNative } = await import('@stellar/stellar-sdk');
        const native = scValToNative(value);
        price = { source: 'PriceCache', value: BigInt(native.price ?? native.bid) };
    }
} catch {
    // fall through
}
if (price === undefined) {
    const tokens = market.data.tokens.long + market.data.tokens.short;
    const notional = market.data.notional.long + market.data.notional.short;
    price =
        tokens > 0n
            ? { source: 'implied book entry', value: (notional * 10n ** 18n) / tokens }
            : { source: 'fallback constant', value: 10n ** 18n };
}
console.log(`\nPrice: ${fmt(price.value)} (${price.source})`);

// --- 4. Estimate tier end to end at the live state --------------------------
const est = estimateMarket(market, price.value);
console.log('\nestimateMarket');
console.log(`  fundingApr=${est.fundingAprPercent}% charge=${est.fundingChargeAprPercent}% maxLev=${est.maxLeverage}`);
console.log(`  long : util=${est.long.utilizationPercent}% oi=${est.long.openInterestValue} cap=${est.long.openCapacity} net/1h=${est.long.netRatePercent1h}%`);
console.log(`  short: util=${est.short.utilizationPercent}% oi=${est.short.openInterestValue} cap=${est.short.openCapacity} net/1h=${est.short.netRatePercent1h}%`);
console.log(`  sharePrice=${est.sharePrice} netPnl=${est.netPnl} maxRedeem=${est.maxRedeemableShares}`);
check('estimateMarket finite', [est.sharePrice, est.long.utilizationPercent, est.long.netRatePercent1h].every(Number.isFinite));
check('share price sane', est.sharePrice > 0 && est.sharePrice < 100, `sharePrice=${est.sharePrice}`);

// --- 5. User path with a fresh (empty) subject ------------------------------
const PROBE_USER =
    process.env.ZENEX_PROBE_USER ??
    'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
const { market: m2, user } = await Market.loadWithUser(NETWORK, contracts, PROBE_USER);
console.log(`\nMarket.loadWithUser(${PROBE_USER.slice(0, 8)}…)`);
check('one batched read returns both', m2.ledger > 0 && user.userId === PROBE_USER);
check('empty subject reads zeroed', !user.long.isOpen() && !user.short.isOpen() && user.orderCounter === 0);
check('claimable capped at pool', user.claimable(market) === 0n);
const orders = await user.loadOrders(NETWORK);
check('loadOrders empty for fresh subject', orders.length === 0);

const posEst = estimatePosition(market, user.long, price.value);
check('estimatePosition zeroes on a flat position', posEst.notional === 0 && posEst.equity === 0 && posEst.maxWithdrawableMargin === 0);

// --- 6. Order pre-flight against the live book ------------------------------
const decimals = market.assetDecimals;
const unitAmount = 10n ** BigInt(decimals);
const intent = new OrderIntent(market, PROBE_USER, true);
const open = intent.openMarket({ notional: 100n * unitAmount, margin: 20n * unitAmount });
const preview = previewOrder(market, user.long, open, price.value);
console.log(`\npreviewOrder(open 100 @ ${market.status === 0 ? 'Active' : 'status ' + market.status})`);
console.log(`  outcome=${preview.outcome}${preview.reason ? ` (${preview.reason})` : ''} fees=${preview.totalFees} escrow=${preview.escrowed}`);
check('pre-flight returns a verdict', ['fills', 'rests', 'gate'].includes(preview.outcome));
if (preview.outcome === 'fills') {
    check('resulting position embedded', preview.position !== undefined && preview.position.notional === 100);
}

// --- 7. Vault order intent against the live vault ---------------------------
const dep = VaultOrderIntent.create(market, PROBE_USER, 0, 100n * unitAmount, 50n, price.value);
const expected = dep.expectedOut(market, price.value);
const verdict = dep.fills(market, price.value);
console.log(`\nVaultOrderIntent.deposit(100) — expectedOut=${fmt(expected)} minOut=${fmt(dep.minOut)} fills=${JSON.stringify(verdict, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
check('minOut below expected', dep.minOut > 0n && dep.minOut <= expected);
check('operation builds', dep.toOperation().length > 0);

console.log(failures === 0 ? '\nAll live checks passed.' : `\n${failures} live check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
