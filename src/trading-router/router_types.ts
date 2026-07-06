import { Address, xdr, nativeToScVal } from '@stellar/stellar-sdk';

// =============================================================================
// Type mirrors and ScVal converters for the v2 TradingRouter contract's types.
//
// Mirrors `zenex-contracts/trading-router/src/types.rs`. Field order in the
// ScVal maps below matches `#[contracttype]`'s alphabetical snake_case
// serialization.
// =============================================================================

/** One contract invocation in a batch. */
export interface Call {
    /** Target contract. */
    contract: string;
    /** Entry-point name. */
    func: string;
    /** Positional arguments, host-encoded. */
    args: xdr.ScVal[];
}

/**
 * The result of one batched call.
 *
 * `value` carries the return value when the call returns an `i128` (keeper
 * payouts), `0n` otherwise. `error` is `0` on success, the contract error
 * code on a typed failure, `u32::MAX` (`4294967295`) on an untyped one.
 */
export interface CallOutcome {
    /** The call landed. */
    ok: boolean;
    /** The return value when the call returns an `i128`; `0n` otherwise. */
    value: bigint;
    /** `0` on success, the contract error code otherwise. */
    error: number;
}

/**
 * The result of a create-and-try-fill flow.
 *
 * `id` is `0` only for a Retired-market redeem that paid out at creation.
 */
export interface FillAttempt {
    /** The created order id; `0` for a Retired-market redeem paid out at creation. */
    id: number;
    /** The immediate fill landed. */
    filled: boolean;
    /** The fill payout when filled (token-dec). */
    payout: bigint;
    /** `0` when filled; the fill's contract error code otherwise. */
    error: number;
}

/** One deleveraging target of an ADL sweep. */
export interface AdlTarget {
    /** Position owner. */
    user: string;
    /** Position side. */
    isLong: boolean;
    /** Notional to close (token-dec); clamped to the contract ceiling. */
    amount: bigint;
}

// =============================================================================
// Converters: TS -> ScVal
// =============================================================================

/** Encode a `Call` as an alphabetically key-ordered `ScMap` (args, contract, func). */
export function callToScVal(call: Call): xdr.ScVal {
    const entry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    return xdr.ScVal.scvMap([
        entry('args', xdr.ScVal.scvVec(call.args)),
        entry('contract', Address.fromString(call.contract).toScVal()),
        entry('func', xdr.ScVal.scvSymbol(call.func)),
    ]);
}

/** Encode an `AdlTarget` as an alphabetically key-ordered `ScMap` (amount, is_long, user). */
export function adlTargetToScVal(target: AdlTarget): xdr.ScVal {
    const entry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    return xdr.ScVal.scvMap([
        entry('amount', nativeToScVal(target.amount, { type: 'i128' })),
        entry('is_long', xdr.ScVal.scvBool(target.isLong)),
        entry('user', Address.fromString(target.user).toScVal()),
    ]);
}

// =============================================================================
// Parsers: scValToNative output (snake_case) -> camelCase interface
// =============================================================================

/** Coerce a decoded numeric (already `bigint`, or occasionally `number`) to `bigint`. */
function big(v: unknown): bigint {
    return typeof v === 'bigint' ? v : BigInt(v as number);
}

/** Parse a `scValToNative`-decoded `CallOutcome` into its camelCase interface. */
export function parseCallOutcome(raw: Record<string, unknown>): CallOutcome {
    return {
        ok: raw.ok as boolean,
        value: big(raw.value),
        error: Number(raw.error),
    };
}

/** Parse a `scValToNative`-decoded `FillAttempt` into its camelCase interface. */
export function parseFillAttempt(raw: Record<string, unknown>): FillAttempt {
    return {
        id: Number(raw.id),
        filled: raw.filled as boolean,
        payout: big(raw.payout),
        error: Number(raw.error),
    };
}
