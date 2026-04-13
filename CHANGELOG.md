# Changelog

## 2.0.0 — 2026-04-13

### Breaking

- **Trading event payloads rewritten as delta-only.** Each event now carries
  only the fields it changes. Field renames + structural changes:
  - `SetTriggers` uses `sl` / `tp` (was `stop_loss` / `take_profit`).
  - `ModifyCollateral` carries `col` only.
  - `OpenMarket` carries the full new state in one event.
  - `RefundPosition` has empty data.
  - `PlaceLimit` carries `long`, `col`, `notional`, `entryPrice`, `sl`, `tp`.

  Consumers parsing event fields directly must update. Consumers that go
  through `decodeEvent()` get the new shapes back.

- **`Position.id` semantics changed** — now a per-user counter (`userId,
  positionId`) rather than a contract-global sequence. Code keying off `id`
  alone across users will collide.

- **`Position.load` API restructured** — split into a `PositionRaw` loader +
  decode pass, allowing event-driven projection without a full chain
  re-read.

### Added

- `TradingContract.getUserCounter(user)` — read the user's position counter.
- `PositionRaw` exported for indexer/keeper use.

### Migration

A consumer pinned to `^1.8.0` will compile against `2.0.0` but emit garbage
at runtime once the new contract is deployed (event field names won't
match). Bump dependents to `^2.0.0` in lockstep with the contract redeploy.

In-tree consumers updated:
- `zenex-indexer`, `zenex-keeper`, `zenex-guardian`, `zenex-phantom`,
  `zenex-backend` (proxy mode).
