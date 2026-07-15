# @zenith-protocols/zenex-sdk

TypeScript SDK for Zenex v2 contracts, exact transaction quotes, Router relay
policies, and the public platform API on Stellar.

## Installation

```bash
npm install @zenith-protocols/zenex-sdk
```

Atomic token, price, ledger, and source-time values are `bigint`. Convert them
to decimal display text only at the UI boundary. Never convert a transaction
input through `number`, `parseFloat`, or display formatting.

## Exact margin adjustment

Load one coherent snapshot, quote the action, and pass the quote directly to
the operation builder. A Max withdrawal is an exact contract-gated search, not
a percentage of the displayed balance.

```ts
import {
    buildMarginAdjustmentExecution,
    quoteMarginAdjustment,
} from '@zenith-protocols/zenex-sdk';

const quote = quoteMarginAdjustment({
    ...marginQuoteContext, // coherent ledger, market, position, vault, and price state
    direction: 'withdraw',
    amount: { kind: 'max' },
    executionFee: 0n,
    relayFee: 0n,
});
if (quote.kind !== 'exact') throw new Error(quote.reason);

const requestedAtomicDelta = quote.value.requestedAtomicDelta;
const execution = buildMarginAdjustmentExecution({
    ...executionContext,
    quote: quote.value,
});
if (execution.kind !== 'exact') throw new Error(execution.reason);
```

`positionEquity`, `liquidationPrice`, `MarketView.utilization`, and the numeric
`VaultState` conversion methods remain available for display estimates. They
are not transaction inputs. Use the exact position, margin, market-capacity,
and vault quote APIs for transaction construction.

## Public data

`ZenexDataClient` validates the exact v1 response schema for each route. It
converts only declared atomic fields to `bigint` and fails closed on missing,
invented, or malformed data.

```ts
import { ZenexDataClient } from '@zenith-protocols/zenex-sdk';

const data = new ZenexDataClient({ baseUrl: 'https://api.zenex.example' });
const [config, leaderboard, price] = await Promise.all([
    data.getConfig(),
    data.getRollingStandings('7d'),
    data.getLatestPrice(23n),
]);

console.log(config.data.markets);
console.log(leaderboard.data.items);
console.log(price.data.price); // bigint
```

JSON requests have a 30-second default timeout and an 8 MiB response ceiling.
Set `requestTimeoutMs` or `maxResponseBytes` on the client, or pass
`{ signal, timeoutMs }` as the final argument of an individual route call. A
timeout or caller cancellation during relay submission is still an ambiguous
handoff and must be resolved through relay status.

Call `createZenexTrustBundle(config.data)` before using public identities for
relay or smart-account construction. It pins the known network passphrase,
Router capabilities, smart-account-kit artifacts, verifier deployments, and
session-policy evidence. A user's smart-account instance is never inferred
from global config; pass its separately verified deployment record explicitly.
The returned `priceFree` configuration contains only verified public contract
identities and can be passed directly to the safe price-free builder.

The scoped event stream emits resource invalidations and exact `price.tick`
events. Invalidations never alter SDK state. If the durable cursor is outside
retention, the stream either executes a complete caller-declared REST resync
plan or throws `ZenexResyncRequiredError`.

## Relay handoff

Relay requests are built by the strict policy builders and submitted through
the one policy-scoped endpoint. The SDK never retries a POST after an ambiguous
transport handoff.

```ts
import {
    RelaySubmissionAmbiguousError,
    buildRelayCallRequest,
} from '@zenith-protocols/zenex-sdk';

const request = buildRelayCallRequest({
    requestId: crypto.randomUUID(),
    policy: 'fillOrKill',
    func,
    auth,
    contracts: trust.relayContracts,
});

try {
    await data.submitRelayRequest(request);
} catch (error) {
    if (!(error instanceof RelaySubmissionAmbiguousError)) throw error;
    const authoritative = await data.getRelayRequest(error.requestId);
    console.log(authoritative.data.state);
}
```

Execution policy maps directly to the v2 Router contract:

- `fillOrKill` uses `Router.create_and_fill_with_fee` for relayed execution.
- `restOnly` uses `Router.multicall_with_fee` for relayed resting orders.
- `priceFree` uses `Router.multicall_with_fee` with the exact public action
  allowlist: order or vault-order cancellation, funding claim, configured
  collateral transfer, referral attribution, and verified session-rule add or
  removal.
- `smartAccountDeployment` accepts only the dedicated signed deployment envelope
  with an active time bound expiring within 30 seconds.

The high-level execution API exposes no generic transaction submitter, try-fill
path, restore builder, Fee Forwarder identity, or unsafe call escape hatch.
Deprecated low-level Router try-fill bindings remain only for ABI compatibility;
new integrations should use the strict `fillOrKill` builders.

Relayed order policies accept only the exact public fee token, maximum fee, and
fee expiration. The SDK encodes the structural unsigned fee amount as `1`, the fee
recipient as the user, and, for fill-or-kill, the keeper as the user. Strict
fill authorization discovery uses the verified public `priceUpdate` from
`getLatestPrice`, decoded with `decodeLatestPriceUpdate`. The relay replaces
that unsigned update with its fresher update after signing. Callers never
provide the relay's private fee recipient, keeper, or Pyth source. Address
authorization signs exactly `(calls, feeToken, maxFeeAmount, feeExpiration)`;
the outer user selects the credential and is not duplicated in the signed
argument prefix.

```ts
import { buildPriceFreeRelayOperation } from '@zenith-protocols/zenex-sdk';

const prepared = buildPriceFreeRelayOperation({
    user: smartAccount,
    currentLedger,
    configuration: trust.priceFree,
    feeToken,
    maxFeeAmount,
    feeExpiration,
    actions: [
        { kind: 'cancelOrder', trading, id: orderId },
        { kind: 'claimFunding', trading },
    ],
});
if (prepared.kind !== 'ready') throw new Error(prepared.reason);
```

The action union has no raw contract/function/argument variant. Price-bearing
operations use the normal relay submission route; there is no public
`/v1/relay/price` endpoint.

## Close all positions

Close all is an application controller sequence, not one atomic cross-market
batch. Take a deterministic snapshot of visible positions, assign a unique UUID
to one `fillOrKill` request per position, submit them one at a time, and record
each result. After every ambiguous handoff, read the durable relay status before
continuing or retrying. Keep prior successes and failures in the final result.

The smart-account session capability is
`single-transfer-destination-v1`. Multi-market session setup is unavailable
under that capability and must not be represented as a valid request.

## Build verification

```bash
npm run specs:check
npm run vectors:check
npm run api:check
npm test
npm run build
```

## License

MIT
