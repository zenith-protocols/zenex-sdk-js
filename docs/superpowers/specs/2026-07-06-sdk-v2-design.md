# Zenex SDK v2 Design

Date: 2026-07-06
Branch: `v2` (cut from `main` @ e82dba3)
Contracts source of truth: `zenex-contracts` branch `v2/dev` @ 920a3ff
Package version: `2.0.0`

## Goal

Make the TypeScript SDK compatible with the v2 trading contracts, which replace
user-driven fills with an order -> keeper-execute flow. This is a clean break:
the v1 trading surface is deleted, no compat layer. Every SDK module is synced
against the pinned contracts commit. The SDK is then consumed locally by
zenex-utils (its own `v2` branch) to deploy the v2 contracts to testnet and
exercise the real actions as live verification.

## What changed in the contracts

- Single market per trading contract. No `marketId`, no per-user position
  counters. Positions are netted, keyed `(user, is_long)`.
- Traders only create and cancel orders (price-free entry points):
  `create_order`, `cancel_order`, `create_vault_order`, `cancel_vault_order`,
  `claim_funding`.
- Keepers fill at verified prices (permissionless, price-bearing):
  `execute_order`, `execute_liquidation`, `update_adl_state`, `execute_adl`,
  `execute_vault_order`, plus maintenance `accrue` / `accrue_funding`.
- TP/SL are plain Decrease orders with a trigger; a Decrease of `i128::MAX`
  means full close. Collateral moves at fill via token allowance.
- Vault deposits/redeems escrow through the trading contract as vault orders.
- New `trading-router` contract batches keeper work: `multicall`,
  `multicall_try`, `create_and_fill`, `create_and_try_fill`,
  `create_and_try_fill_vault_order`, `adl_sweep`.
- Events rewritten with `#[contractevent]`: topic fields (`user`, `id`,
  `is_long`) plus a data map. 14 trading events.

## Architecture

Keep the established SDK style everywhere (approach A):

- `Contract` subclasses whose methods return base64 operation XDR strings.
- Static `contract.Spec` per contract class, extracted from the compiled v2
  WASM by a one-off script (not build tooling), same as the current SDK's spec
  was produced. A test compares the embedded spec against the WASM.
- Static `parsers` decoding simulation/return values.
- Event decoder classes over `base_event.ts` with the RPC, Mercury, and
  Goldsky normalizers architecturally unchanged.

## Section 1: Branch, versioning, module map

| Module | Action |
|---|---|
| `src/trading` | Full rewrite for the order->execute flow |
| `src/trading-router` | New module |
| `src/factory` | Update: `FactoryInitMeta` constructor, changed `deploy`, `is_deployed` |
| `src/vault` | Update against `strategy-vault`: FungibleVault methods gained `operator`, new `strategy_withdraw` |
| `src/price-verifier`, `src/treasury`, `src/governance`, `src/oracle` | Audit against `v2/dev`, fix drift only |
| `src/base_event.ts` + event decoders | New trading event registry; normalizers unchanged |
| `src/math.ts`, `ledger-keys.ts`, `simulate.ts`, `response_parser.ts` | Keep; extend only where new types need it |

The fee-forwarder module exists only on the abandoned `feat/fee-forwarder-sdk`
branch and is not part of v2.

## Section 2: Trading module rewrite (`src/trading`)

**`trading_types.ts` (new).** TS mirrors + ScVal converters for: `Order`,
`OrderKind`, `VaultOrder`, `VaultOrderKind`, `Position`, `Config`,
`MarketData`, `AdlState`, `Status`. All i128 fields are `bigint`. Every field
carries its unit in a doc comment (token-dec, price_scalar, SCALAR_18),
copied from the Rust source. Export the full-close sentinel constant
(`FULL_CLOSE = i128::MAX`).

**`trading_contract.ts`.** `TradingContract extends Contract`:

- 1:1 bindings mirroring the trait exactly: `setConfig`, `setStatus`,
  `setTerminalPrice`, `createOrder`, `cancelOrder`, `createVaultOrder`,
  `cancelVaultOrder`, `claimFunding`, `executeOrder`, `executeLiquidation`,
  `updateAdlState`, `executeAdl`, `executeVaultOrder`, `accrueFunding`,
  `accrue`, all views (`getConfig`, `getMarketData`, `getPosition`,
  `getOrder`, `getStatus`, `getVaultOrder`, `getAdl`,
  `getClaimableFunding`, `getToken`, `getVault`, `getTreasury`,
  `getPriceVerifier`, `getRetirement`, `getFeed`), `deploy` (constructor),
  and the Ownable surface carried over from v1.
- Semantic helpers, frontend parity with v1, all sugar over `createOrder` /
  `createVaultOrder`:
  - `openMarket` (Increase, no trigger, priceBound + expiration)
  - `openLimit` (Increase with trigger)
  - `closePosition` (Decrease, `FULL_CLOSE` notional)
  - `decreasePosition` (partial Decrease)
  - `addCollateral` / `withdrawCollateral` (collateral-only shapes)
  - `placeTakeProfit` / `placeStopLoss` (Decrease with `trigger_above`
    derived from the side)
  - `depositVault` / `redeemVault`
- Static `spec` (WASM-extracted) and `parsers` for every view and the keeper
  payout returns.

**`trading_position.ts` / `trading_market.ts` / `trading_config.ts`.**
Client-side math and loaders reworked to v2 mechanics: implied PnL
(`tokens * price - notional`, inverse for short), equity after
funding/borrowing index deltas, liquidation price, fee preview (skew-split
base fee + impact fee via `impact_divisor`), notional lock accounting, and
the new `Config` shape with client-side validation mirroring the contract's
`require_valid` bounds.

## Section 3: New `src/trading-router` module

`TradingRouterContract` with `multicall`, `multicallTry`, `createAndFill`,
`createAndTryFill`, `createAndTryFillVaultOrder`, `adlSweep`. Types `Call`,
`CallOutcome`, `FillAttempt`, `AdlTarget` with converters and parsers for the
outcome vectors. A `buildCall` helper composes `Call` rows from a contract id,
function name, and ScVal args so consumers batch without touching XDR
internals.

## Section 4: zenex-utils integration and live verification

- New `v2` branch on `zenex-utils`. The SDK is already consumed as
  `file:../zenex-sdk-js`, so the local import needs no wiring, only a
  reinstall/rebuild against the SDK `v2` branch.
- Port `src/deploy.ts` and `src/utils.ts` to the v2 flow: deploy factory with
  `FactoryInitMeta`, deploy markets through it with the new `Config` shape
  read from `deploy.json`, deploy the trading-router, wire the price-verifier.
- Add an action smoke script (`scripts/`) that exercises the real v2 flow on
  testnet through the SDK: create order, keeper execute at a verified price,
  TP/SL order, cancel, vault order create + execute, claim funding, and the
  view parsers on live data.
- Deployment gate (project rule): before any deploy, read
  `zenex-utils/deploy.json`, present the settings, and wait for explicit
  confirmation. Never deploy unreviewed config.

## Section 5: Events layer

Full rewrite of `trading_events.ts` for the 14 v2 events: `create_order`,
`cancel_order`, `create_vault_order`, `cancel_vault_order`,
`execute_vault_order`, `claim_funding`, `adl_update`, `status_update`,
`config_update`, `terminal_price_update`, `increase_fill`, `decrease_fill`,
`liquidation`, `position_update`. Decoders key on the `#[contractevent]`
topic layout (event name symbol, then `user` / `id` / `is_long` topic fields;
remaining fields in the data map). `base_event.ts` registry updated. The RPC,
Mercury, and Goldsky (`normalizeGoldsky`) normalizers stay as-is. Vault,
governance, and factory event decoders get the same drift audit.

## Section 6: Other module audits

Diff each against `v2/dev` and update methods, spec entries, parsers, events,
and types:

- **factory**: `FactoryInitMeta` constructor, changed `deploy`, `is_deployed`.
- **vault** (`strategy-vault`): FungibleVault methods gained an `operator`
  argument; new `strategy_withdraw`.
- **price-verifier**: non-positive verified price rejection and interface drift.
- **treasury**, **governance**, **oracle**: drift audit.

## Section 7: Testing and verification

Vitest throughout, 80% coverage target, `npm run build` + `vitest run` green
as the gate:

- XDR round-trip tests for every binding: build the op, decode it back,
  assert function name, args, and types.
- Semantic helper shape tests (e.g. `closePosition` emits a Decrease with the
  `FULL_CLOSE` sentinel; `placeStopLoss` on a long sets `trigger_above =
  false`).
- Event decoder tests against fixtures matching the `#[contractevent]` layout.
- Math tests for position/market helpers checked against the contract
  formulas.
- Parser tests for all views.
- Spec-consistency check: embedded `contract.Spec` vs the compiled v2 WASM.
- Live verification via the zenex-utils smoke script (Section 4) after the
  gated testnet deploy.

## Section 8: Execution strategy

Implementation runs as parallel subagents, each scoped to fit a context
window, with per-module tests written by the same agent that writes the
module:

1. Trading types + WASM spec extraction (`trading_types.ts`, spec).
2. Trading contract bindings + semantic helpers (`trading_contract.ts`).
3. Trading math/loaders (`trading_position.ts`, `trading_market.ts`,
   `trading_config.ts`).
4. Trading-router module.
5. Events layer (`trading_events.ts`, `base_event.ts` registry).
6. Factory + vault audit and update.
7. Price-verifier + treasury + governance + oracle audit.
8. zenex-utils `v2` branch: deploy script port + action smoke script.
9. Final integration: exports (`src/index.ts`), build, full test run,
   coverage, spec-vs-WASM check.

Agent 1 lands first (agents 2, 3, and 5 consume its types). Agents 4, 6, 7,
and 8 are independent of each other and of 2/3/5. Agent 9 runs once all
others are merged. The gated testnet deploy and live action test run last,
after user confirmation of `deploy.json`.
