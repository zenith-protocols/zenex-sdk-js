# @zenith-protocols/zenex-sdk

TypeScript SDK for the Zenex protocol on Stellar Soroban: contract bindings,
ledger-state loaders, exact transaction quotes, and transaction building.

## Installation

```bash
npm install @zenith-protocols/zenex-sdk
```

Atomic token, price, ledger, and source-time values are `bigint`. Convert them
to decimal display text only at the UI boundary. Never convert a transaction
input through `number`, `parseFloat`, or display formatting.

## Load market state

A market's full contract state (trading instance, market data, position, vault,
treasury rate) collapses to six ledger entries, read in one
`getLedgerEntries` round trip. Project the read onto a `TradingSnapshot` with
the market's current numeric price to feed the quote layer:

```ts
import {
    loadTradingEntries,
    snapshotFromEntries,
} from '@zenith-protocols/zenex-sdk';

const entries = await loadTradingEntries(network, {
    trading,
    vault,
    treasury,
    collateralToken,
    user,
    isLong: true,
});

const snapshot = snapshotFromEntries({
    entries,
    router,
    ledgerTime,
    price, // numeric feed price: { feedId, exponent, price, bid, ask, ... }
});
```

`loadTradingEntriesBatch` reads many markets in one request.
`loadTradingSnapshot` is the simulation-backed alternative: it runs the same
state views through a Router `multicall_try` simulation and can serve as a
low-frequency cross-check against the ledger reads
(`crossCheckVaultTotalAssets`).

## Apply an order

The SDK models trading exactly the way the chain does: you hold the chain's
own nouns (`Position`, `MarketData`, `TradingConfig`, `OrderParams`,
`PriceData`) and one verb. `applyOrder(snapshot, order)` applies an
`OrderParams` to the snapshot's position at the current (or a what-if) price
and reports what the chain would do:

```ts
import {
    applyOrder,
    orderPriceBound,
    buildOrderOperation,
    OrderKind,
} from '@zenith-protocols/zenex-sdk';

const order = {
    trading,
    user,
    isLong: true,
    kind: OrderKind.MarketIncrease,
    notional: 1_000_0000000n,
    margin: 100_0000000n,
    triggerPrice: 0n,
    priceBound: orderPriceBound(
        snapshot.price,
        true,
        OrderKind.MarketIncrease,
        100n, // 1% maximum slippage in basis points
    ),
    expiration: snapshot.ledger + 60,
};

const result = applyOrder(snapshot, order);
// result.kind === 'fills' → exact post-position, fees, and payout
// result.kind === 'rests' → creates but does not fill at this price
// result.kind === 'gate'  → can never fill: result.code is the contract gate
```

This is the only validation the SDK performs: creation would succeed on-chain
even for an order that can never fill (for example a decrease that would break
the margin gate — `#713`), so `applyOrder` is the pre-flight that predicts the
fill outcome. What you preview is exactly what you sign: pass the same
`OrderParams` to `buildOrderOperation`.

Margin adjustments are orders with `notional: 0n` — `margin` is the amount,
`MarketIncrease` adds, `MarketDecrease` withdraws. A full close is
`notional: FULL_CLOSE`. `maxWithdrawableMargin(snapshot)` binary-searches the
largest withdrawal that still fills.

## Execute

Resting orders build as direct `Trading.create_order` /
`Trading.create_vault_order` operations. Atomic fill-or-kill builds as
`Router.create_and_fill`, which creates the order and fills it against the
keeper's verified price in one transaction. `simulateAndParse` runs any built
operation through a simulation and decodes the result with the matching
contract parser.

## Vault orders

Keep a vault fill estimate explicit when deriving `minOut`. The SDK applies a
basis-point slippage bound with bigint floor rounding, but returns estimate
provenance because a keeper fills the order against later state.

```ts
import {
    buildVaultActionExecution,
    deriveVaultMinimumOutput,
    quoteVaultOrderCreation,
} from '@zenith-protocols/zenex-sdk';

const minimum = deriveVaultMinimumOutput({
    reference: { kind: 'estimate', output: estimatedOutputAtomic },
    maximumSlippageBps: 50n, // 0.5%
});
if (minimum.kind === 'unavailable') throw new Error(minimum.reason);
if (minimum.kind !== 'estimate') throw new Error('unexpected vault provenance');

const creation = quoteVaultOrderCreation({
    ...creationContext,
    minOut: minimum.value.minOut,
});
if (creation.kind === 'unavailable') throw new Error(creation.reason);
if (creation.kind !== 'exact') throw new Error('exact vault state is required');

const execution = buildVaultActionExecution(
    creation.value.kind === 'retiredImmediateRedeem'
        ? { ...executionContext, quote: creation }
        : {
              ...executionContext,
              quote: creation,
              policy: { kind: 'restOnly', transport: 'direct' },
          },
);
if (execution.kind === 'unavailable') throw new Error(execution.reason);
```

Active, OnIce, and Delisted vault actions create resting orders. A Retired
redeem is a distinct direct-only action. It charges no execution fee and does
not apply the estimate-derived minimum output.

## Display estimates

`positionPnl`, `positionEquity`, `pendingFunding`, `pendingBorrowing`,
`liquidationPrice`, and `unlockedNotional` mark a stored position at a single
price without settling accruals. They are display estimates, not transaction
inputs; transaction code quotes through `applyOrder`.

## Events

Every contract event ships as a typed interface (discriminated unions keyed on
the `TradingEventType` / `VaultEventType` / `GovernanceEventType` enums).
The surface is types-only: consumers reading events from RPC or an indexer own
their decode path and import the types to stay aligned with the on-chain
schemas.

## Build verification

```bash
npm run specs:check
npm run architecture:check
npm test
npm run build
```

## License

MIT
