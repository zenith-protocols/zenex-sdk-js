# @zenith-protocols/zenex-sdk

TypeScript SDK for the Zenex perpetuals DEX on Stellar (Soroban). It binds
every deployed Zenex contract, loads market and user state straight from the
ledger, and quotes orders with an exact engine that mirrors the on-chain math:
a preview that says an order fills, fills on chain with the same numbers.

3.0.0 binds the mainnet contracts: the core release (market, strategy vault,
factory, oracle, treasury, governance) and the market router and fee
forwarder from zenex-util-contracts v0.0.2.

## Install

```bash
npm install @zenith-protocols/zenex-sdk @stellar/stellar-sdk@^16
```

- `@stellar/stellar-sdk` is a peer dependency, `>=16.0.0 <17.0.0`. Version
  17 changed the XDR API the SDK calls.
- Node 22 or later, the same floor as stellar-sdk 16.
- Browsers need no Node polyfills: the SDK imports `Buffer` from the
  `buffer` package.
- ESM and CommonJS, each with its own type declarations.
  `@zenith-protocols/zenex-sdk/errors` is a standalone, import-free error
  catalog.

## Conventions

- Amounts, prices and rates are `bigint`. Token amounts carry the token's
  decimals (7 for the settlement token), prices are 18-decimal, and rates and
  fractions are `SCALAR_18` fixed point. Estimates and previews also report
  `number` fields for display. Never feed a display number back into a
  transaction.
- A `Price` carries the bid and ask the market fills at. The oracle narrows
  every report's spread before the market sees it, so build a price from a raw
  report with `market.priceFromReport(bid, ask, publishTime)`. A bare `bigint`
  is a mid price with no spread.
- Every contract method returns a base64 XDR operation. You build, sign and
  submit the transaction with stellar-sdk.
- The SDK ships no contract addresses. You pass them in, and
  `Market.resolveContracts` derives the rest of a market's wiring from its id.

## Load a market

```ts
import { Networks } from '@stellar/stellar-sdk';
import { Market } from '@zenith-protocols/zenex-sdk';

const network = { rpc: RPC_URL, passphrase: Networks.PUBLIC };

// One read: the market instance names its own vault, token, oracle and treasury.
const contracts = await Market.resolveContracts(network, MARKET_ID);

// One getLedgerEntries round trip for the market and the user together.
const { market, user } = await Market.loadWithUser(network, contracts, USER);
```

`Market.load(network, contracts)` reads the market alone. Pass the full
wiring that `resolveContracts` returns: without `oracle` and `treasury` the
load needs a second round trip to find them.

A `Market` holds the config, the market data, the status, the vault balance
and share supply, the treasury rate and the oracle's spread reduction factor.
On a market that is winding down it also holds `delistedAt` and, once set,
`terminalPrice`. A load fails closed with a `MarketStateError`: `MISSING_STATE`
if market-level state is absent or archived, `IDENTITY_MISMATCH` if an address
you passed disagrees with the market's own wiring.

A `MarketUser` holds both positions (`user.long`, `user.short`), the order
counter, and claimable credit. After about 120 idle days a user's entries
archive. They still load from the archived values and are listed in
`user.archived`; the next transaction that touches them restores them.
`user.loadOrders(network)` lists pending orders straight from the chain.

## Preview an order

`OrderIntent` builds complete `OrderParams` for one market, owner and side:
the expiration comes from `market.ledger + ttlLedgers`, and the fill bound
from `slippageBps`. `previewOrder` runs the exact engine over it.

```ts
import { OrderIntent, previewOrder } from '@zenith-protocols/zenex-sdk';

const price = market.priceFromReport(report.bid, report.ask, report.publishTime);

// 60-ledger lifetime, 1% maximum slippage.
const intent = new OrderIntent(market, USER, true, 60, 100n);
const order = intent.openMarket({
    notional: 1_000_0000000n, // 1,000 USDC of size
    margin: 100_0000000n, // 100 USDC of margin
    price,
});

const preview = previewOrder(market, user.long, order, price);
if (preview.outcome === 'gate') throw preview.gate; // a ZenexError with the contract's code
// 'fills': preview.position is the exact position after the fill.
// 'rests': the order is valid but does not fill at this price (preview.reason).
```

The engine checks the contract's gates in the contract's order and returns
the contract's error code. Creating an order succeeds even when it can never
fill (for example a decrease that would break the margin floor, error 713),
so the preview is where you find out. Sign exactly the `OrderParams` you
previewed.

The other builders are `openLimit`, `openStop`, `closePosition`
(`FULL_CLOSE`, so the close stays whole if the size changes), `decrease`,
`addMargin`, `withdrawMargin`, `takeProfit` and `stopLoss`.
`maxMarginForBalance` sizes the largest margin a wallet balance affords at a
leverage.

## Submit an order

There are three ways to put an order on chain.

**Resting order.** The user calls the market directly, and a keeper fills the
order once it is eligible.

```ts
import { MarketContract } from '@zenith-protocols/zenex-sdk';

const createOp = new MarketContract(order.market).createOrder(
    order.user, order.isLong, order.kind, order.notional, order.margin,
    order.triggerPrice, order.priceBound, order.expiration,
);
```

**Create and fill in one transaction.** The market router creates the order
and fills it against a signed price report. The router has two variants:
`createAndFill` is fill-or-kill, and `createAndTryFill` leaves the order
resting if the fill misses.

```ts
import { MarketRouterContract, createOrderCall, simulateAndParse } from '@zenith-protocols/zenex-sdk';

const router = new MarketRouterContract(ROUTER);
const fillOp = router.createAndFill([createOrderCall(order)], USER, USER, priceReport);

// The user's create_order authorization sits below the router's root call,
// so simulate with record_allow_nonroot.
const simulated = await simulateAndParse(
    network,
    fillOp,
    MarketRouterContract.parsers.createAndFill,
    { authMode: 'record_allow_nonroot' },
);
```

The same auth tree means stellar-sdk's `prepareTransaction` cannot prepare
this call. Simulate with `record_allow_nonroot` and assemble with
`rpc.assembleTransaction`. Passing the user as the keeper returns the fill
reward to the user.

**Relayed (gasless).** The fee forwarder wraps a router call, and a relayer
submits it and takes a fee from the user in the same transaction.

```ts
import { FeeForwarderContract, createOrderCall } from '@zenith-protocols/zenex-sdk';

const fee = {
    feeToken: TOKEN,
    feeAmount: 1_0000000n, // set by the relayer
    maxFeeAmount: 2_0000000n, // signed by the user
    expirationLedger: market.ledger + 100,
    feeRecipient: RELAYER,
};
const relayOp = new FeeForwarderContract(FORWARDER).forwardCreateAndFill(
    ROUTER, [createOrderCall(order)], USER, USER, priceReport, fee,
);
// The arguments the user signs:
const signed = FeeForwarderContract.authorizedArgs('create_and_fill', ROUTER, [createOrderCall(order)], fee);
```

`forwardMulticall` relays a plain batch such as cancels, and the user signs
the calls themselves. The create-and-fill routes go through
`forward_dynamic`: the user signs the fee terms and the router target but not
the calls, the keeper or the price. A relayer can change those and still
collect the fee. The order's own authorization and its `priceBound` still
bind the fill.

## Vault orders

Deposits and redeems are orders that a keeper fills.

```ts
import { VaultOrderIntent, VaultOrderKind } from '@zenith-protocols/zenex-sdk';

// 100 USDC in, at most 0.5% below the expected share output.
const deposit = VaultOrderIntent.create(market, USER, VaultOrderKind.Deposit, 100_0000000n, 50n, price);
const advice = deposit.fills(market, price);
const depositOp = deposit.toOperation();
```

`minOut` is what the fill must pay, net of the vault fee: the shares a
deposit mints, or the assets a redeem pays. A keeper fill quoted below it
rejects the order. The principal returns to the user, the escrowed execution
fee goes to the keeper, and the market emits `reject_vault_order`. The vault
balance cap and the redeem exit gates revert instead, and the order keeps
resting. `fills` is advisory: it reports whether a fill at `price` would
succeed, be rejected or revert. A redeem on a `Retired` market fills at
creation, with no execution fee and no `minOut`.

## Estimates

`estimateMarket(market, price)` and `estimatePosition(market, position, price)`
report display values at one price: utilization, funding and borrowing rates,
open capacity, share price, equity, health factor, liquidation price and the
maximum withdrawable amounts. `MarketPosition` and `Market` expose the same
quantities as methods. They are estimates for display; transactions quote
through `previewOrder`.

## Errors

`ZenexError` carries a `ZenexErrorCode`. The catalog covers every contract
the SDK binds:

| Range | Source |
|---|---|
| 1-13, 100-114, 400-410 | token and vault-share contracts |
| 600 | shared admin |
| 700-772 | market |
| 780-793 | oracle |
| 800-801 | strategy vault |
| 810-812 | governance |
| 900 | treasury |
| 2100-2102, 2200-2203 | ownership and role transfer |
| 3000-3016 | smart account |
| 4002-4007 | session policy |
| 5000-5006 | fee abstraction |
| 6001-6002 | fee forwarder |
| 7001 | referral |

The catalog also covers host and transaction codes and a few SDK-side
sentinels (negative codes).

```ts
import { parseError, ZenexErrorCode } from '@zenith-protocols/zenex-sdk';

const sent = await server.sendTransaction(tx);
if (sent.status === 'ERROR') {
    const error = parseError(sent); // never throws
    if (error.code === ZenexErrorCode.InsufficientMargin) { /* ... */ }
}
```

`simulateAndParse` throws a `ZenexError` with the decoded code, and the raw
RPC text on `cause`. `parseContractErrorCode` pulls a code out of any
diagnostic string.

## Events

Every event the bound contracts emit has a TypeScript type: `MarketEvent`,
`VaultEvent`, `FactoryEvent`, `GovernanceEvent`, `OracleEvent`,
`TreasuryEvent`, `FeeForwarderEvent` and `OwnableEvent`, all collected in
`ZenexEvent` and keyed by an `eventType` enum. The SDK ships types only, with
no decoder: you read events from RPC or an indexer and map them onto these
shapes. The mapping rules:

- Wire field names become camelCase.
- A market event's `id` becomes `orderId`.
- Some fields are derived rather than on the wire. For example, `source`
  tells a keeper fill from an ADL close by whether `id` is 0.

Each event's doc states its topics and fields.

## Contract bindings

| Class | Contract |
|---|---|
| `MarketContract` | market: orders, vault orders, keeper fills, liquidations, ADL, views, admin |
| `VaultContract` | strategy vault (the share token) |
| `FactoryContract` | factory: deploys a market with its vault |
| `OracleContract` | oracle: report verification and its settings |
| `TreasuryContract` | treasury: protocol fee rate and withdrawals |
| `GovernanceContract` | governance: timelocked calls |
| `MarketRouterContract` | market router: batches and create-and-fill |
| `FeeForwarderContract` | fee forwarder: relayed router calls |

Each class decodes results through `Class.parsers` and exposes its contract
spec as `Class.spec`. Ledger key builders (`marketPositionLedgerKey` and the
others) and instance parsers (`parseMarketInstance` and the others) support
custom reads.

## Versioning

3.0.0 is the first release of this line. Earlier 1.x and 2.x releases were
unpublished and are not an upgrade path. Breaking changes bump the major
version. [CHANGELOG.md](./CHANGELOG.md) lists each release and the contract
releases it binds.

## Development

```bash
npm test
npm run architecture:check
npm run specs:check   # needs ../zenex-contracts and ../zenex-util-contracts
npm run build
```

`specs:check` compares the committed contract specs with the release WASMs:
`../zenex-contracts/wasm/` for the core contracts, and the market router and
fee forwarder built in `../zenex-util-contracts` (run `make build` there at
the released tag). `npm run live:check` validates a build read-only against a
live market; set `ZENEX_RPC` and the other `ZENEX_*` variables listed in
`scripts/live-check.mjs`.

## License

MIT
