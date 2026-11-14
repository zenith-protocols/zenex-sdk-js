# Changelog

## 3.0.0

The first release of the 3.x line. Versions 1.x and 2.x were unpublished
from npm and are not an upgrade path.

### Contracts

- Core contracts at zenex-contracts `201a2f0` (market, strategy vault,
  factory, oracle, treasury, governance): release `644a4c4` plus the
  borrowing NAV change (zenex-contracts #223). The committed specs are
  generated from that build's WASMs.
- Market router and fee forwarder from zenex-util-contracts v0.0.2.

### Requirements

- `@stellar/stellar-sdk` `>=16.0.0 <17.0.0` (peer). Version 17 changed the XDR
  API the SDK calls.
- Node 22 or later.

### Changes for consumers installing from git `main`

These are the changes since the code that `github:zenith-protocols/zenex-sdk-js#main`
installs resolved to before this release.

**Breaking**

- `MarketRouterContract.multicallWithFee`, `createAndFillWithFee` and
  `createAndTryFillWithFee` are removed, with their argument types. The
  deployed router has no fee legs. Relay through `FeeForwarderContract`
  instead.
- `ZenexErrorCode.MinOutNotMet` (752) is removed. A vault fill quoted below
  `min_out` now rejects the order (`reject_vault_order`).
- `Market.retirement` is replaced by `Market.terminalPrice` and
  `Market.delistedAt`. The `Market` constructor takes both in its place, so
  the arguments after it shift.
- `Market.load` and `Market.loadWithUser` also read the oracle and treasury
  instances. Pass `oracle` and `treasury` in `MarketContracts` (as
  `Market.resolveContracts` returns them) to keep a load at one round trip.
- `MarketUser.orderCounter` reads `1` for a user who has never ordered, as the
  contract's `get_order_counter` does. It used to read `0`.
- `simulateAndParse` throws a `ZenexError` (decoded code, raw RPC text on
  `cause`) instead of a plain `Error`.
- `VaultOrderIntent.fills` can return `{ fills: false, invalid }` for an order
  that creation would refuse.
- Stop-loss and take-profit orders no longer inherit the intent's
  `slippageBps`. They fill unbounded unless the call passes its own.
- Event unions include the ownership events and the vault share
  transfer/approve events, so exhaustive switches need new cases.
- `@stellar/stellar-sdk` 17 no longer satisfies the peer range.
- `MarketData` has a required `borrowingWeight: SidePair`, decoded from the
  contract's `borrowing_weight`. A `MarketData` entry written by an earlier
  contract build does not decode: `parseMarketData` and `Market.load` throw a
  `MarketStateError` with code `MISSING_STATE`.
- Share pricing counts the vault's share of pending borrowing. `Market.netPnl`,
  `assetsToShares`, `sharesToAssets`, `VaultOrderIntent.expectedOut` and
  `create`, and `estimateMarket`'s `sharePrice`, `netPnl` and
  `maxRedeemableShares` change by that income, as do the `net_pnl` values of
  the `deposit_fill`, `redeem_fill` and `reject_vault_order` events.
- A deposit fill gates with `PendingPnlExceeded` (754) while either side's
  unrealized profit is above `maxPnlTrader` of half the vault, so
  `VaultOrderIntent.fills` can return a `block` with code 754 for a deposit.
- A redeem quoted above the vault balance gates with
  `StrategyPayoutExceedsAssets` (803). `fills` used to block it with
  `QuoteInvalidInput`.
- `VaultOrderIntent.create` and `expectedOut` accrue the market to the quote
  time before they price, as `fills` and the fill do, so a bound cut by
  `create` counts the borrowing accrued since the last on-chain accrual. Both
  take an optional trailing `now` (unix seconds, default the wall clock), so
  without it their result moves with the clock on a market that has open
  positions. They used to price on the snapshot as loaded.
- `FactoryContract.deployMarket` no longer takes `vaultDecimalsOffset`, and
  `VaultConstructorArgs` has no `decimals_offset`. The vault fixes its offset
  at 6, so shares carry 13 decimals.

**Added**

- `Market.pendingBorrowing`: the borrowing accrued and not yet settled, which
  mirrors the contract's `pending_borrowing`.
- Error codes `StrategySupplyLimitExceeded` (802) and
  `StrategyPayoutExceedsAssets` (803).
- `VIRTUAL_SHARES`: the vault's virtual shares, `10^6`, which mirrors the
  contract's constant. Share pricing uses it whatever offset the vault
  instance stores.

- `FeeForwarderContract`: `forwardMulticall`, `forwardCreateAndFill`,
  `forwardCreateAndTryFill`, `authorizedArgs` and parsers, with the
  `RelayFee` and `ForwardTarget` types and the fee forwarder event types.
- `reduceSpread`, `Price.fromReport`, `Market.priceFromReport` and
  `Market.spreadReductionFactor`. Together they mirror the oracle's spread
  reduction.
- `MarketUser.archived` and `PendingOrder.archived`, for entries read from
  archived state.
- `OrderIntent.openStop`, for stop (breakout) entries.
- An `authMode` option on `simulateAndParse`. Use `'record_allow_nonroot'`
  for router calls that carry user authorization.
- Event types for every contract event: ownership, oracle, treasury, factory
  init-meta, vault share transfer and approve, and the fee forwarder.
- Error codes: smart account 3000-3016, session policy 4002-4007, fee
  forwarder 6001-6002, referral 7001.
- Constants: `MAX_ORDERS_PER_SIDE`, `DELIST_GRACE`, `DELIST_DEADLINE`.
- The `./package.json` export.

**Fixed**

- A short's entry size rounds up, as on chain, and an increase that buys no
  size gates with `SizeRoundsToZero` (716).
- Quotes on a wound-down market price at the terminal price, and
  `isLiquidatable` honours the forced liquidation past the delist deadline.
- Quotes use the loaded treasury rate, and model `VaultInsolvent` (755) and
  the contract's gate order.
- Previews no longer gate falsely when the client clock lags chain time.
- Archived user entries no longer make `Market.loadWithUser`,
  `MarketUser.load` or `loadOrders` throw.
- The health factor and liquidation price measure on the liquidation gate's
  line, close fee included. `Market.borrowingRate` returns 0 for the side
  that pays none, and `Market.netPnl` is capped as share pricing caps it.
- `parseError` never throws, and names host errors such as
  `Error(Auth, InvalidAction)`.
- `formatTokenFloor` never formats above the balance. `parseAtomic` and
  `formatAtomic` reject invalid decimals.
- Browser bundles no longer need a `Buffer` polyfill.
- CommonJS consumers get CommonJS type declarations, and node10 resolves
  `./errors`.
- Binding, event and error docs are corrected against the contracts, and
  every public export is documented.
