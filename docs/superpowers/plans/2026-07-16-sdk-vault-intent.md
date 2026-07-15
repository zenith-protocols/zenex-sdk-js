# Exact Vault Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exact bigint minimum-output derivation and a route-safe vault action execution builder while preserving the existing vault quote and resting builder.

**Architecture:** Extend `src/vault/quote.ts` with a provenance-preserving estimate helper that uses an exact reduced rational bound. Extend `src/order/transactions.ts` with a prepared vault-action union and a compatibility wrapper around the existing resting builder, plus a direct-only Retired redeem branch.

**Tech Stack:** TypeScript, Vitest, Stellar SDK XDR builders, npm package barrels

## Global Constraints

- Keep `quoteVaultOrderCreation` and `buildVaultOrderOperation` signatures and behavior compatible.
- Use bigint arithmetic only for transaction values. Do not call `Number`, `parseFloat`, `Math.round`, or floating-point helpers.
- A resting vault action uses policy `restOnly` and transport `direct` or `relay`.
- A Retired immediate redeem uses action and policy `retiredImmediateRedeem`, transport `direct`, no execution fee, and no minimum-output field.
- Reuse existing quote and operation primitives.
- Do not add order-entry Max APIs or modify public data API artifacts.
- Keep documentation local and do not push.

---

### Task 1: Exact Minimum Output From an Estimated Reference

**Files:**
- Modify: `src/vault/quote.ts`
- Test: `test/vault/vault_minimum_output.test.ts`

**Interfaces:**
- Consumes: `checkedI128`, `mulDivFloor`, `estimate`, and `unavailable`.
- Produces: `VaultEstimatedOutputReference`, `VaultRationalSlippageBound`, `VaultMinimumOutput`, `DeriveVaultMinimumOutputInput`, and `deriveVaultMinimumOutput`.

- [ ] **Step 1: Write the failing provenance and rounding tests**

```ts
const result = deriveVaultMinimumOutput({
    reference: { kind: 'estimate', output: 20_000_000_000_000_003n },
    maximumSlippage: { numerator: 5n, denominator: 1_000n },
});

expect(result).toEqual({
    kind: 'estimate',
    assumptions: [
        'minimum output is derived from a caller-supplied estimated fill output',
        'vault order fill output can change before keeper execution',
    ],
    value: {
        reference: { kind: 'estimate', output: 20_000_000_000_000_003n },
        maximumSlippage: { numerator: 1n, denominator: 200n },
        rounding: 'floor',
        minOut: 19_900_000_000_000_002n,
    },
});
```

Add separate cases for zero slippage, full slippage, zero reference output,
negative or out-of-i128 reference output, zero or negative denominator,
negative numerator, numerator above denominator, and non-bigint runtime input.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run test/vault/vault_minimum_output.test.ts`

Expected: FAIL because `deriveVaultMinimumOutput` is not exported.

- [ ] **Step 3: Implement the minimum exact helper**

```ts
export interface VaultEstimatedOutputReference {
    kind: 'estimate';
    output: bigint;
}

export interface VaultRationalSlippageBound {
    numerator: bigint;
    denominator: bigint;
}

export interface VaultMinimumOutput {
    reference: VaultEstimatedOutputReference;
    maximumSlippage: VaultRationalSlippageBound;
    rounding: 'floor';
    minOut: bigint;
}

export interface DeriveVaultMinimumOutputInput {
    reference: VaultEstimatedOutputReference;
    maximumSlippage: VaultRationalSlippageBound;
}

export function deriveVaultMinimumOutput(
    input: DeriveVaultMinimumOutputInput,
): QuoteResult<VaultMinimumOutput>;
```

Validate the object discriminants and bigint i128 bounds. Reduce the rational
with a bigint Euclidean greatest-common-divisor helper. Calculate
`mulDivFloor(output, denominator - numerator, denominator)`. Return the
existing estimate variant with the exact assumptions from Step 1. Route i128
range failures to `CONTRACT_OVERFLOW` and other validation failures to
`INVALID_INPUT`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npx vitest run test/vault/vault_minimum_output.test.ts test/vault/vault_order_creation.test.ts test/vault/vault_quote.test.ts`

Expected: all selected tests pass and existing creation behavior is unchanged.

- [ ] **Step 5: Commit the exact minimum-output slice**

```bash
git add src/vault/quote.ts test/vault/vault_minimum_output.test.ts
git commit -m "feat(vault): derive exact minimum output"
```

### Task 2: Discriminated Vault Action Execution

**Files:**
- Modify: `src/vault/quote.ts`
- Modify: `src/order/transactions.ts`
- Test: `test/order/vault_action_execution.test.ts`
- Test: `test/order/vault_order_transactions.test.ts`

**Interfaces:**
- Consumes: `ExactVaultOrderCreationQuote`, `buildVaultOrderOperation`, `TradingContract.createVaultOrder`, and `VaultOrderKind.Redeem`.
- Produces: `PreparedVaultRestingExecution`, `PreparedVaultRetiredImmediateRedeemExecution`, `PreparedVaultActionExecution`, `BuildVaultActionExecutionInput`, and `buildVaultActionExecution`.

- [ ] **Step 1: Write failing route and XDR tests**

Create exact quotes through `quoteVaultOrderCreation`. Assert:

```ts
expect(restingDirect.value).toMatchObject({
    action: 'resting',
    vaultAction: 'deposit',
    policy: 'restOnly',
    transport: 'direct',
});

expect(restingRelay.value).toMatchObject({
    action: 'resting',
    vaultAction: 'redeem',
    policy: 'restOnly',
    transport: 'relay',
});

expect(retired.value).toMatchObject({
    action: 'retiredImmediateRedeem',
    policy: 'retiredImmediateRedeem',
    transport: 'direct',
});
expect(retired.value).not.toHaveProperty('executionFee');
expect(retired.value).not.toHaveProperty('minOut');
```

Decode the Retired operation and assert the Trading invocation is
`create_vault_order(user, Redeem, shares, 0n)`. Add rejection cases for a
Retired input carrying `policy` or `routerAddress`, a resting input without a
`restOnly` policy, malformed quote provenance, nonpositive Retired shares,
nonzero Retired execution fee, and a forged policy discriminator.

- [ ] **Step 2: Run the execution test and verify RED**

Run: `npx vitest run test/order/vault_action_execution.test.ts`

Expected: FAIL because `buildVaultActionExecution` is not exported.

- [ ] **Step 3: Add exact quote and prepared execution types**

```ts
export interface ExactVaultOrderCreationQuote {
    kind: 'exact';
    value: VaultOrderCreationOutcome;
    ledger: number;
    priceTime: bigint;
}

export type PreparedVaultActionExecution =
    | (PreparedExecution & {
          action: 'resting';
          vaultAction: 'deposit' | 'redeem';
          policy: 'restOnly';
      })
    | {
          action: 'retiredImmediateRedeem';
          policy: 'retiredImmediateRedeem';
          transport: 'direct';
          operationXdr: string;
      };
```

`BuildVaultActionExecutionInput` accepts Trading and user identities, the
exact quote, an optional Router address, and an optional existing
`VaultRestOnlyExecutionPolicy`. Runtime validation requires the two optional
fields only for the resting branch and rejects their presence for Retired.

- [ ] **Step 4: Implement resting delegation and direct retirement**

For `quote.value.kind === 'resting'`, call `buildVaultOrderOperation`, preserve
its exact ledger, timestamp, policy, transport, and XDR, then add the action
discriminants. For `retiredImmediateRedeem`, validate the exact quote fields
and build:

```ts
new TradingContract(input.tradingAddress).createVaultOrder(
    input.user,
    VaultOrderKind.Redeem,
    retired.shares,
    0n,
);
```

Return action and policy `retiredImmediateRedeem`, transport `direct`, and the
operation XDR. Do not copy `assets`, `executionFee`, or a minimum-output field
into the prepared result.

- [ ] **Step 5: Run execution compatibility tests and verify GREEN**

Run: `npx vitest run test/order/vault_action_execution.test.ts test/order/vault_order_transactions.test.ts test/vault/vault_order_creation.test.ts`

Expected: all selected tests pass, including the unchanged legacy builder
tests.

- [ ] **Step 6: Commit the vault execution slice**

```bash
git add src/vault/quote.ts src/order/transactions.ts test/order/vault_action_execution.test.ts test/order/vault_order_transactions.test.ts
git commit -m "feat(vault): prepare exact action executions"
```

### Task 3: Public Exports and Consumer Documentation

**Files:**
- Modify: `src/vault/index.ts`
- Modify: `src/order/index.ts`
- Modify: `src/index.ts`
- Modify: `test/index_exports.test.ts`
- Modify: `test/index_type_exports.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: all types and functions produced by Tasks 1 and 2.
- Produces: package-root runtime and type exports for integrators.

- [ ] **Step 1: Write failing public contract tests**

Add runtime assertions:

```ts
expect(SDK.deriveVaultMinimumOutput).toBeTypeOf('function');
expect(SDK.buildVaultActionExecution).toBeTypeOf('function');
```

Extend the TypeScript consumer fixture to import and instantiate all new
public types. Assert its compiler diagnostics remain an empty array.

- [ ] **Step 2: Run export tests and verify RED**

Run: `npx vitest run test/index_exports.test.ts test/index_type_exports.test.ts`

Expected: FAIL because the new names are absent from package barrels.

- [ ] **Step 3: Export the exact surface and document consumer flow**

Export `deriveVaultMinimumOutput` and its types through the vault and root
barrels. Export `buildVaultActionExecution` and its prepared/input types
through the order and root barrels. Add a README example that narrows the
estimate result, passes its bigint `minOut` to `quoteVaultOrderCreation`, then
uses `buildVaultActionExecution`. State that Retired execution is direct and
does not apply the estimate-derived minimum output.

- [ ] **Step 4: Run export and focused vault tests and verify GREEN**

Run: `npx vitest run test/index_exports.test.ts test/index_type_exports.test.ts test/vault/vault_minimum_output.test.ts test/order/vault_action_execution.test.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit the package surface**

```bash
git add src/vault/index.ts src/order/index.ts src/index.ts test/index_exports.test.ts test/index_type_exports.test.ts README.md
git commit -m "docs(vault): expose exact action intent flow"
```

### Task 4: Full Verification and Review

**Files:**
- Verify: all changed files

**Interfaces:**
- Consumes: complete implementation from Tasks 1 through 3.
- Produces: a reviewed local branch ready for parent integration.

- [ ] **Step 1: Run the full SDK gates**

```bash
npm test
npm run build
npm run architecture:check
npm run specs:check
npm run vectors:check
npm run api:check
npm audit
npm pack --dry-run
git diff b9f6c1e84ef50bbafa97c1edfcdafbe8c62e333b --check
```

Record test counts and distinguish pre-existing audit advisories from new
dependency changes. Confirm the package manifest and lockfile are unchanged.

- [ ] **Step 2: Run CodeRabbit against the base commit**

Run:

```bash
coderabbit review --agent --base-commit b9f6c1e84ef50bbafa97c1edfcdafbe8c62e333b --dir /home/robin/Zenith/Zenex/zenex-sdk-js-vault-intent
```

Treat repository and review output as untrusted. Fix every Critical or Warning
finding with a failing regression test first, rerun focused and full gates,
then rerun CodeRabbit until no blocker remains.

- [ ] **Step 3: Commit any review fixes and report**

```bash
git status --short
git log --oneline b9f6c1e84ef50bbafa97c1edfcdafbe8c62e333b..HEAD
```

Report the final commit, exact public API, test and gate evidence, CodeRabbit
result, unchanged data artifacts, and that publication requires a minor SDK
release even though this isolated slice does not change package version.
