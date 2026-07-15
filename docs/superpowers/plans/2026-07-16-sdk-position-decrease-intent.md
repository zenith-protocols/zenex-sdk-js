# Exact Position-Decrease Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an exact snapshot-bound position-decrease quote and fill-or-kill execution builder that removes size, collateral, slippage, and expiration math from integrating frontends.

**Architecture:** Add a shared exact-ratio type and checked normalizer, then implement position-specific intent resolution as a focused wrapper around `quotePositionAction`. Add a strict builder that re-quotes against the supplied `TradingSnapshot`, fails closed on structural or policy mismatch, and delegates XDR creation to `buildOrderOperation`.

**Tech Stack:** TypeScript, bigint fixed-point math, Stellar SDK XDR, Vitest, API Extractor report generation, Prettier.

## Global Constraints

- Use only one coherent `TradingSnapshot` for quote state and builder validation.
- Export `POSITION_DECREASE_MAX_VALIDITY_LEDGERS` with the exact value `60`.
- Full size rejects `collateralReturn`; partial size requires explicit or pro-rata collateral intent.
- Fraction and pro-rata resolution use documented bigint floor rounding.
- Execution fee must equal `snapshot.config.execFee` and is an escrow leg, not a margin debit.
- Relay fee must equal the signed `policy.maxFeeAmount`; fee expiration must equal order expiration.
- Snapshot price updates must be nonempty and no larger than 32 KiB.
- Only `{ kind: 'full' }` may request the whole position; it uses `{ kind: 'close' }` and `FULL_CLOSE` on the wire.
- Explicit notional or fraction inputs resolving to the whole position fail closed so their collateral intent is never ignored.
- Price-bound rounding is conservative: long lower bound uses ceil, short upper bound uses floor.
- Both transports require `fillOrKill`; transport, relay-fee bound, and relay expiration fail closed on mismatch.
- Preserve exact snapshot ledger and price timestamp provenance.
- Do not add open, increase, desired-post-fee, wallet `Max`, UI strings, batch close, or data API behavior.
- Keep all commits local and do not push.

---

### Task 1: Shared Exact Ratio

**Files:**
- Create: `src/math/ratio.ts`
- Modify: `src/math/index.ts`
- Modify: `src/vault/quote.ts`
- Create: `test/math/ratio.test.ts`
- Test: `test/vault/vault_minimum_output.test.ts`

**Interfaces:**
- Consumes: `checkedI128` from `src/math/fixed.ts`.
- Produces: public `ExactRatio` and internal `normalizeExactRatio(input, options)` with an exact reduced bigint result.

- [ ] **Step 1: Write the failing exact-ratio tests**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeExactRatio } from '../../src/math/ratio.js';

describe('normalizeExactRatio', () => {
    it('reduces an exact bigint ratio', () => {
        expect(
            normalizeExactRatio(
                { numerator: 50n, denominator: 10_000n },
                { label: 'maximum slippage', minimum: 0n, allowOne: false },
            ),
        ).toEqual({ numerator: 1n, denominator: 200n });
    });

    it.each([
        [{ numerator: -1n, denominator: 2n }, 'nonnegative'],
        [{ numerator: 1n, denominator: 0n }, 'positive'],
        [{ numerator: 1n, denominator: 1n }, 'less than one'],
    ])('rejects an invalid ratio', (ratio, reason) => {
        expect(() =>
            normalizeExactRatio(ratio, {
                label: 'maximum slippage',
                minimum: 0n,
                allowOne: false,
            }),
        ).toThrow(reason);
    });
});
```

- [ ] **Step 2: Run the ratio test and verify RED**

Run: `npx vitest run test/math/ratio.test.ts`

Expected: FAIL because `src/math/ratio.ts` does not exist.

- [ ] **Step 3: Implement the exact-ratio type and normalizer**

```ts
export interface ExactRatio {
    readonly numerator: bigint;
    readonly denominator: bigint;
}

export interface NormalizeExactRatioOptions {
    readonly label: string;
    readonly minimum: 0n | 1n;
    readonly allowOne: boolean;
}

export function normalizeExactRatio(
    input: ExactRatio,
    options: NormalizeExactRatioOptions,
): ExactRatio {
    const numerator = checkedI128(input.numerator);
    const denominator = checkedI128(input.denominator);
    if (denominator <= 0n) {
        throw new RangeError(`${options.label} denominator must be positive`);
    }
    if (numerator < options.minimum) {
        throw new RangeError(
            `${options.label} numerator must be ${
                options.minimum === 0n ? 'nonnegative' : 'positive'
            }`,
        );
    }
    if (
        numerator > denominator ||
        (!options.allowOne && numerator === denominator)
    ) {
        throw new RangeError(
            `${options.label} must be ${
                options.allowOne ? 'at most one' : 'less than one'
            }`,
        );
    }
    const divisor = greatestCommonDivisor(numerator, denominator);
    return {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
    };
}
```

Export only `ExactRatio` through `src/math/index.ts`. Change
`VaultRationalSlippageBound` to `extends ExactRatio` and replace its local gcd
and range validation with the shared normalizer while keeping vault's inclusive
one boundary.

- [ ] **Step 4: Run ratio and vault tests and verify GREEN**

Run: `npx vitest run test/math/ratio.test.ts test/vault/vault_minimum_output.test.ts`

Expected: both files pass and existing vault results remain unchanged.

- [ ] **Step 5: Commit the shared ratio slice**

```bash
git add src/math/ratio.ts src/math/index.ts src/vault/quote.ts test/math/ratio.test.ts
git commit -m "feat(math): share exact ratio normalization"
```

### Task 2: Exact Position-Decrease Quote

**Files:**
- Create: `src/position/decrease.ts`
- Modify: `src/position/index.ts`
- Create: `test/position/decrease_intent.test.ts`

**Interfaces:**
- Consumes: `ExactRatio`, `normalizeExactRatio`, `mulDivFloor`, `addI128`, `subI128`, `quotePositionAction`, and `TradingSnapshot`.
- Produces: `POSITION_DECREASE_MAX_VALIDITY_LEDGERS`, intent unions, `PositionDecreaseIntentOutcome`, `ExactPositionDecreaseIntentQuote`, and `quotePositionDecreaseIntent`.

- [ ] **Step 1: Write failing tests for canonical size and collateral resolution**

Use a real `TradingSnapshot` fixture with position notional `1_001n`,
collateral `503n`, bid `9_901n`, ask `10_099n`, ledger `10_000`, and price time
`19_999n`. Assert:

```ts
const quote = quotePositionDecreaseIntent({
    snapshot,
    isLong: true,
    size: { kind: 'fraction', ratio: { numerator: 1n, denominator: 3n } },
    collateralReturn: { kind: 'proRata' },
    execution: { transport: 'direct', executionFee: 2n },
    maximumSlippage: { numerator: 1n, denominator: 100n },
    validForLedgers: 60,
});
expect(quote).toMatchObject({
    kind: 'exact',
    ledger: 10_000,
    priceTime: 19_999n,
    value: {
        action: { kind: 'decrease', notional: 333n, collateral: 167n },
        resolvedNotional: 333n,
        resolvedCollateralReturn: 167n,
        expiration: 10_060,
    },
});
```

Add separate assertions that explicit zero collateral is accepted, explicit
collateral above the position is rejected, `full` with a `collateralReturn`
property is rejected, and a partial form without collateral intent is rejected.

- [ ] **Step 2: Run the quote test and verify RED**

Run: `npx vitest run test/position/decrease_intent.test.ts`

Expected: FAIL because `quotePositionDecreaseIntent` is not implemented.

- [ ] **Step 3: Implement input types and exact intent resolution**

```ts
export const POSITION_DECREASE_MAX_VALIDITY_LEDGERS = 60;

export type QuotePositionDecreaseIntentInput =
    | (PositionDecreaseIntentBase & {
          readonly size: { readonly kind: 'full' };
          readonly collateralReturn?: never;
      })
    | (PositionDecreaseIntentBase & {
          readonly size: Exclude<PositionDecreaseSizeIntent, { kind: 'full' }>;
          readonly collateralReturn: PositionDecreaseCollateralReturnIntent;
      });

export function quotePositionDecreaseIntent(
    input: QuotePositionDecreaseIntentInput,
): QuoteResult<PositionDecreaseIntentOutcome> {
    try {
        const resolved = resolvePositionDecreaseRequest(input);
        const positionQuote = quotePositionAction({
            ledger: input.snapshot.ledger,
            now: input.snapshot.ledgerTime,
            isLong: input.isLong,
            position: input.snapshot.position,
            market: input.snapshot.market,
            config: input.snapshot.config,
            price: input.snapshot.price,
            vaultAssets: input.snapshot.vault.totalAssets,
            treasuryRate: input.snapshot.treasuryRate,
            action: resolved.action,
            executionFee: resolved.execution.executionFee,
            relayFee:
                resolved.execution.transport === 'relay'
                    ? resolved.execution.relayFee
                    : 0n,
        });
        if (positionQuote.kind !== 'exact') return positionQuote;
        return exact(
            outcomeFromResolvedRequest(input, resolved, positionQuote.value),
            positionQuote.ledger,
            positionQuote.priceTime,
        );
    } catch (error) {
        return unavailable(
            'INVALID_INPUT',
            error instanceof Error ? error.message : 'invalid decrease intent',
        );
    }
}
```

Do not duplicate the position transition. Pass the canonical action and exact
fees into `quotePositionAction`. Return its unavailable result unchanged when
the surviving position fails a protocol gate.

- [ ] **Step 4: Run the focused quote tests and verify GREEN**

Run: `npx vitest run test/position/decrease_intent.test.ts test/position/quote.test.ts`

Expected: all focused position tests pass.

- [ ] **Step 5: Write failing tests for slippage, expiration, and provenance**

Assert a 1 percent long bound at bid `9_901n` is `9_802n`, a 1 percent short
bound at ask `10_099n` is `10_199n`, normalized zero slippage equals the exact
execution price, and `validForLedgers` rejects `0`, `61`, non-integers, and u32
overflow. Assert fraction `1/1` and explicit full notional both fail closed
with guidance to use `{ kind: 'full' }`. Assert an explicit full intent yields
`{ kind: 'close' }`, while the nested quote retains exact ledger and price time.

- [ ] **Step 6: Run the new cases and verify RED**

Run: `npx vitest run test/position/decrease_intent.test.ts`

Expected: the new slippage, expiration, or whole-size assertions fail.

- [ ] **Step 7: Implement conservative bounds and bounded expiration**

```ts
const adverse = mulDivFloor(
    executionPrice,
    maximumSlippage.numerator,
    maximumSlippage.denominator,
);
const priceBound = isLong
    ? subI128(executionPrice, adverse)
    : addI128(executionPrice, adverse);
const expiration = snapshot.ledger + validForLedgers;
```

Reject malformed snapshot identity, side, fee intent, ratios, delta, u32 sum,
or empty/oversized price update as `INVALID_INPUT`. Require execution fee to
equal snapshot config. Reject Frozen and Retired order creation as a contract
gate. Retain normalized request, deployment identity, canonical action,
resolved atomics, bound, expiration, and full nested action outcome.

- [ ] **Step 8: Run focused quote tests and verify GREEN**

Run: `npx vitest run test/position/decrease_intent.test.ts test/position/quote.test.ts test/trading/trading_snapshot.test.ts`

Expected: all files pass.

- [ ] **Step 9: Commit the quote slice**

```bash
git add src/position/decrease.ts src/position/index.ts test/position/decrease_intent.test.ts
git commit -m "feat(position): quote exact decrease intents"
```

### Task 3: Strict Position-Decrease Execution Builder

**Files:**
- Modify: `src/order/transactions.ts`
- Modify: `src/order/index.ts`
- Create: `test/order/position_decrease_intent_execution.test.ts`

**Interfaces:**
- Consumes: `ExactPositionDecreaseIntentQuote`, `quotePositionDecreaseIntent`, `buildOrderOperation`, `TradingSnapshot`, `FULL_CLOSE`, and fill-or-kill policy variants.
- Produces: `PositionDecreaseFillOrKillPolicy`, `BuildPositionDecreaseIntentExecutionInput`, and `buildPositionDecreaseIntentExecution` returning `QuoteResult<PreparedExecution>`.

- [ ] **Step 1: Write failing direct and relay builder tests**

Quote one direct full close and one relay partial decrease. Decode the real
Router operation XDR and assert:

```ts
expect(decoded.fn).toBe('create_and_fill');
expect(primary.kind).toBe(OrderKind.MarketDecrease);
expect(primary.notional).toBe(FULL_CLOSE);
expect(primary.collateral).toBe(0n);
expect(primary.priceBound).toBe(quoted.value.priceBound);
expect(primary.expiration).toBe(quoted.value.expiration);
```

For relay, assert `create_and_fill_with_fee`, exact partial atomics, the
snapshot price bytes, and exact fee expiration.

- [ ] **Step 2: Run the builder test and verify RED**

Run: `npx vitest run test/order/position_decrease_intent_execution.test.ts`

Expected: FAIL because the builder is not implemented.

- [ ] **Step 3: Implement exact re-quote identity and operation creation**

```ts
export type PositionDecreaseFillOrKillPolicy = Extract<
    ContractExecutionPolicy,
    { kind: 'fillOrKill' }
>;

export interface BuildPositionDecreaseIntentExecutionInput {
    readonly snapshot: TradingSnapshot;
    readonly user: string;
    readonly quote: ExactPositionDecreaseIntentQuote;
    readonly policy: PositionDecreaseFillOrKillPolicy;
}
```

Re-run `quotePositionDecreaseIntent` using the retained normalized request and
supplied snapshot. Compare the complete expected and supplied exact quote with
a browser-safe structural equality helper that checks object keys, arrays,
`Uint8Array`, bigints, and primitives. Unknown keys fail equality. Then call
`buildOrderOperation` with identities and validation context derived only from
the snapshot.

- [ ] **Step 4: Run direct and relay builder tests and verify GREEN**

Run: `npx vitest run test/order/position_decrease_intent_execution.test.ts test/order/transactions.test.ts`

Expected: all focused order tests pass.

- [ ] **Step 5: Write failing fail-closed identity tests**

Table-test every mismatch: estimated quote, changed ledger, ledger time, price,
position, config, trading ID, Router ID, side, action, resolved collateral,
bound, expiration, nested outcome, extra quote key, rest-only policy, transport
mismatch, direct price bytes mismatch, relay fee greater than max, and relay
fee expiration different from the quote.

- [ ] **Step 6: Run identity cases and verify RED**

Run: `npx vitest run test/order/position_decrease_intent_execution.test.ts`

Expected: at least one newly added mismatch is not yet rejected.

- [ ] **Step 7: Complete strict policy and identity validation**

Return `unavailable('INVALID_INPUT', reason)` for every malformed or mismatched
quote or policy. Require `fillOrKill` at runtime despite the public narrowed
type. Require direct policy bytes to equal `snapshot.priceUpdate`. Require
relay transport identity, `quotedRelayFee === policy.maxFeeAmount`, and
`policy.feeExpiration === quote.value.expiration` before operation creation.

- [ ] **Step 8: Run focused builder and validation tests and verify GREEN**

Run: `npx vitest run test/order/position_decrease_intent_execution.test.ts test/order/transactions.test.ts test/order/validation.test.ts`

Expected: all files pass.

- [ ] **Step 9: Commit the builder slice**

```bash
git add src/order/transactions.ts src/order/index.ts test/order/position_decrease_intent_execution.test.ts
git commit -m "feat(position): prepare exact decrease executions"
```

### Task 4: Public Exports, Integration Documentation, and Verification

**Files:**
- Modify: `README.md`
- Modify: `test/index_exports.test.ts`
- Modify: `test/index_type_exports.test.ts`
- Regenerate: `etc/zenex-sdk.api.md`

**Interfaces:**
- Consumes: all Task 1 through Task 3 public names.
- Produces: package-root runtime and type exports plus integrator examples.

- [ ] **Step 1: Write failing public export tests**

```ts
expect(SDK.quotePositionDecreaseIntent).toBeTypeOf('function');
expect(SDK.buildPositionDecreaseIntentExecution).toBeTypeOf('function');
expect(SDK.POSITION_DECREASE_MAX_VALIDITY_LEDGERS).toBe(60);
```

Add compile-time imports for `ExactRatio`, all intent types,
`ExactPositionDecreaseIntentQuote`, and builder input/policy types.

- [ ] **Step 2: Run export tests and verify RED**

Run: `npx vitest run test/index_exports.test.ts test/index_type_exports.test.ts`

Expected: FAIL until every new public name is reachable from package root.

- [ ] **Step 3: Complete barrels and README example**

Ensure the math, position, order, and package barrels expose only the intended
public names. Add an `Exact position decrease intent` README section showing a
fractional pro-rata quote and direct builder. State the exact rounding, 60
ledger cap, full-collateral rejection, fill-or-kill requirement, relay fee
bound/expiration identity, and sequential close-all usage.

- [ ] **Step 4: Run export tests and API generation**

Run:

```bash
npx vitest run test/index_exports.test.ts test/index_type_exports.test.ts
npm run build
npm run api:generate
npm run api:check
```

Expected: tests, build, and API check pass with the additive API report change.

- [ ] **Step 5: Commit exports, docs, and API artifact**

```bash
git add README.md test/index_exports.test.ts test/index_type_exports.test.ts etc/zenex-sdk.api.md
git commit -m "docs(position): expose exact decrease intent flow"
```

- [ ] **Step 6: Run clean and full verification**

Run:

```bash
rm -rf node_modules dist
npm ci
npm run api:check
npm test
npm run build
npm run architecture:check
npm run specs:check
npm run vectors:check
npm audit --omit=dev
npm pack --dry-run
git diff --check b9f6c1e84ef50bbafa97c1edfcdafbe8c62e333b..HEAD
git status --short
```

Expected: install, all tests, build, API report, architecture, specs, vectors,
production audit, pack dry run, and whitespace check pass. Only documented
development-only audit advisories may remain in a separate full audit.

- [ ] **Step 7: Run cumulative CodeRabbit review and address findings**

Run:

```bash
coderabbit review --agent --base-commit b9f6c1e84ef50bbafa97c1edfcdafbe8c62e333b --dir /home/robin/Zenith/Zenex/zenex-sdk-js-vault-intent
```

Expected: no unresolved CRITICAL or WARNING findings. For each accepted
finding, add a failing regression test before changing production code, then
repeat the relevant focused and full gates. Record any intentionally rejected
finding and its evidence.

- [ ] **Step 8: Report integration impact**

Report local branch and commits, API report changes, unchanged package version
`3.3.0`, recommended next minor `3.4.0`, unchanged data artifacts, exact clean
verification commands, CodeRabbit result, and no push.
