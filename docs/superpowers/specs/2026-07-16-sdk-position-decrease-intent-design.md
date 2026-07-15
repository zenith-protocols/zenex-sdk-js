# Exact Position-Decrease Intent Design

## Scope

Add one high-level SDK boundary for quoting and preparing a single position
decrease from one coherent `TradingSnapshot`. The boundary supports a full
close, an explicit atomic notional, or an exact rational fraction. It resolves
all contract atomics, collateral withdrawal, slippage protection, and order
expiration inside the SDK.

The same quote is suitable for a single close flow or for one step in a
sequential close-all flow. It does not create a multi-market call batch.

This feature excludes position opens and increases, desired-post-fee sizing,
wallet balance `Max`, display strings, batch close construction, and data API
changes.

## Public API

The position module exposes:

```ts
const POSITION_DECREASE_MAX_VALIDITY_LEDGERS = 60;

type PositionDecreaseSizeIntent =
    | { kind: 'full' }
    | { kind: 'notional'; notional: bigint }
    | { kind: 'fraction'; ratio: ExactRatio };

type PositionDecreaseCollateralReturnIntent =
    | { kind: 'explicit'; amount: bigint }
    | { kind: 'proRata' };

type PositionDecreaseExecutionIntent =
    | {
          transport: 'direct';
          executionFee: bigint;
      }
    | {
          transport: 'relay';
          executionFee: bigint;
          relayFee: bigint;
      };

function quotePositionDecreaseIntent(
    input: QuotePositionDecreaseIntentInput,
): QuoteResult<PositionDecreaseIntentOutcome>;
```

The input is a discriminated union. A full size forbids `collateralReturn`.
Both partial size forms require it. Runtime validation rejects a
`collateralReturn` property on a full request even when JavaScript or a type
cast bypasses the TypeScript union.

The order module exposes:

```ts
function buildPositionDecreaseIntentExecution(
    input: BuildPositionDecreaseIntentExecutionInput,
): QuoteResult<PreparedExecution>;
```

The builder accepts only an exact intent quote, the same coherent snapshot, a
user address, and a fill-or-kill direct or relay policy. It does not accept
caller-supplied trading addresses, Router addresses, sides, atomics, price
bounds, expirations, or trailing calls.

## Shared Exact Ratio

Add a public `ExactRatio` interface with `bigint` numerator and denominator.
Keep `VaultRationalSlippageBound` as a public interface extending
`ExactRatio`, preserving its existing name and structural compatibility.
Vault and position intent code share checked normalization while retaining
their distinct range rules.

Every accepted ratio is reduced by its greatest common divisor before it is
retained in a result.

## Exact Size and Collateral Resolution

An explicit notional must be positive and no larger than the snapshot
position notional. A size fraction must satisfy
`0 < numerator <= denominator`.

Fractional notional resolves as:

```text
floor(position.notional * numerator / denominator)
```

A fraction that resolves to zero atomic units is rejected. An explicit
notional equal to the full position and a fraction equal to one are
canonicalized to `{ kind: 'close' }`. A full request always uses that close
action. The execution builder therefore always encodes `FULL_CLOSE` for every
whole-position result and never relies on an explicit notional to trigger the
contract's implicit full-close branch.

For a partial request, explicit collateral may be zero but must not exceed the
snapshot position collateral. Pro-rata collateral resolves as:

```text
floor(
    position.collateral
    * resolvedAtomicNotional
    / position.notional
)
```

Using the already resolved atomic notional avoids independently rounding the
original fraction twice. The SDK does not pre-approve the surviving position.
It passes the resolved decrease into `quotePositionAction`, whose contract
mirror applies fee settlement and all surviving-position validity gates.

A full request rejects collateral intent instead of silently ignoring it. The
full quote's exact `walletPayout` describes returned equity after settlement;
there is no separate requested collateral amount for a close.

## Fees and Transport

Every quote includes an exact nonnegative execution fee. A direct quote has a
zero relay fee. A relay quote requires an exact nonnegative relay fee. The
execution intent binds the quote to its transport so a direct economic quote
cannot be submitted through relay, or the reverse.

The existing `quotePositionAction` receives these exact fees. Relay fee is the
external wallet leg represented by the existing position quote model.

## Exact Price Bound

Maximum slippage must satisfy
`0 <= numerator < denominator`. Zero means the execution price itself is the
bound, not an unbounded order.

A long decrease sells at the snapshot bid and needs a lower bound:

```text
ceil(bid * (denominator - numerator) / denominator)
```

This is evaluated equivalently as
`bid - floor(bid * numerator / denominator)`.

A short decrease buys at the snapshot ask and needs an upper bound:

```text
floor(ask * (denominator + numerator) / denominator)
```

This is evaluated equivalently as
`ask + floor(ask * numerator / denominator)`.

These directions and rounding rules never permit an integer execution price
outside the requested exact rational tolerance.

## Bounded Expiration

The caller supplies `validForLedgers`, a positive integer no greater than
`POSITION_DECREASE_MAX_VALIDITY_LEDGERS`, which is exactly 60. The SDK computes:

```text
expiration = snapshot.ledger + validForLedgers
```

The sum must remain a u32. Contract expiration is inclusive, so the order is
valid while the execution ledger is less than or equal to this value. The
frontend performs no absolute-ledger arithmetic.

For relay execution, `policy.feeExpiration` must equal the quoted order
expiration. The quoted relay fee must be no greater than the signed
`policy.maxFeeAmount`.

## Provenance and Identity

The quote calls `quotePositionAction` with only fields from the supplied
snapshot, the supplied side, the canonical action, and exact fee intent. The
returned `QuoteResult` preserves `snapshot.ledger` and
`snapshot.price.publishTime` exactly.

The exact outcome retains:

- normalized requested intent;
- the snapshot trading and Router contract identities and side;
- canonical close or partial-decrease action;
- resolved atomic notional and partial collateral;
- exact price bound and expiration;
- the complete existing `PositionActionOutcome`.

The builder fails closed. It reconstructs the intent quote against the
supplied snapshot and requires complete structural equality, including no
unknown fields. This binds current position, market, config, price, ledger,
deployment, side, fee intent, resolved atomics, and quote outcome.

Both transports require a `fillOrKill` policy. The policy transport must equal
the quote transport. A direct policy's serialized price update must byte-match
the snapshot update. A relay build uses the snapshot update, requires its
quoted relay fee within the signed maximum, and requires exact fee-expiration
identity. Any malformed, estimated, stale, mismatched, or forged quote returns
`INVALID_INPUT` without creating an operation.

After identity checks, the builder derives `OrderValidationContext` entirely
from the supplied snapshot and delegates operation creation to the existing
`buildOrderOperation` path.

## Versioning

This is additive public API and requires a minor package version increment at
integration or release time. It changes the generated API report but makes no
data API, schema, vector, or generated protocol-data changes.
