# Exact Vault Intent Design

## Scope

Add an exact SDK boundary for deriving a vault order minimum output from a
caller supplied estimate, then prepare either a resting vault order or a
retired-market immediate redeem. Keep the existing
`quoteVaultOrderCreation` and `buildVaultOrderOperation` behavior compatible.
Do not add order-entry Max logic, change the public data API, or alter contract
artifacts.

## Minimum Output Derivation

`deriveVaultMinimumOutput` accepts an estimated atomic output and an exact
rational maximum-slippage bound:

```ts
interface VaultEstimatedOutputReference {
    kind: 'estimate';
    output: bigint;
}

interface VaultRationalSlippageBound {
    numerator: bigint;
    denominator: bigint;
}
```

The estimate must be a nonnegative i128 value. The bound must satisfy
`0 <= numerator <= denominator`, with a positive i128 denominator. The bound
is reduced to a canonical numerator and denominator before it is returned.
The minimum output is:

```text
floor(reference.output * (denominator - numerator) / denominator)
```

The function performs bigint arithmetic only. Its successful result uses the
existing `QuoteResult` estimate variant because the arithmetic is exact but
the caller supplied output is only a reference estimate. The value retains
the reference output, the exact rational bound, the floor-rounding rule, and
the derived `minOut`. Assumptions state that the fill output can change before
keeper execution and that floor rounding is applied in atomic units. Invalid
inputs return `INVALID_INPUT`; an i128 result overflow returns
`CONTRACT_OVERFLOW`.

## Vault Action Execution

`buildVaultActionExecution` consumes an exact result from
`quoteVaultOrderCreation` and returns a `QuoteResult` containing a distinct
prepared vault-action union.

For `resting` outcomes, the builder requires the existing `restOnly` contract
policy. Direct and relay transport continue to follow
`buildVaultOrderOperation`, including relay fee validation and Router
`multicall_with_fee` encoding. The prepared value is discriminated as
`resting` and retains the action, `restOnly` policy, transport, and operation
XDR.

For `retiredImmediateRedeem` outcomes, the builder accepts no execution
policy or Router address. It builds a direct Trading
`create_vault_order(user, Redeem, shares, 0)` invocation. The zero ABI argument
is the required placeholder for the contract method, but the prepared result
does not expose a minimum-output or execution-fee field because the Retired
contract path applies neither. The prepared value is discriminated with both
action and policy `retiredImmediateRedeem`, transport `direct`, and operation
XDR. It is never represented as `restOnly` and cannot use relay transport.

## Validation and Compatibility

The builder validates exact quote provenance, ledger and timestamp bounds,
all action atomics, and the internal consistency of both quote variants. A
retired quote's reference asset amount is not used to construct the call. The
contract calculates the actual assets from the submitted shares. A forged
resting quote continues to fail through the existing builder validation.

The existing quote and resting builder remain exported with their current
signatures and results. New types and functions are additive exports from the
vault, order, and package root barrels. Package versioning is handled by the
parent release branch; this slice does not update API-contract artifacts.

## Tests

Tests cover exact floor boundaries, zero and full slippage, large bigint
inputs above JavaScript's safe integer range, malformed ratios, explicit
estimate provenance, Active and Delisted resting execution over both direct
and relay transports, Retired direct redeem encoding, forged quote rejection,
and compile-time public exports. Existing vault creation and operation tests
must continue to pass unchanged.
