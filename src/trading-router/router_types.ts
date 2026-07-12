import { Address, xdr, scValToNative, nativeToScVal } from '@stellar/stellar-sdk';
import type { i128, u32 } from '../index.js';
import { OrderKind } from '../trading/trading_types.js';

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
 * The trading-contract `create_order` arguments, in a shape the router
 * builders can turn into a fillable [`Call`] (see [`createOrderCall`]).
 *
 * Mirrors `trading::create_order` one-for-one, plus the `trading` target the
 * `Call` runs against. `kind` crosses the ABI as a plain `u32` discriminant.
 */
export interface OrderParams {
    /** The target trading contract the `create_order` runs on. */
    trading: string;
    /** The order owner. */
    user: string;
    /** Side the order targets. */
    isLong: boolean;
    /** OrderKind discriminant (0 = MarketIncrease .. 5 = StopDecrease). */
    kind: OrderKind;
    /** Size change magnitude (>= 0), token-dec. */
    notional: i128;
    /** Margin change magnitude (>= 0), token-dec. */
    collateral: i128;
    /** Crossing level for a trigger kind (price_scalar); unread for a market kind. */
    triggerPrice: i128;
    /** Fill slippage limit (price_scalar); 0 = unbounded. */
    priceBound: i128;
    /** Ledger sequence; eligible while the current sequence <= expiration. */
    expiration: u32;
}

/**
 * Build a `create_order`-shaped [`Call`] from [`OrderParams`], for composing
 * router batches (`multicall`, `create_and_fill`, and their kin).
 *
 * The encoding mirrors `TradingContract.createOrderCall` exactly, so a bundled
 * order is byte-identical to a direct one; only the router executes it (and
 * the user's auth entry nests under the router call). The router's fill
 * convention treats the FIRST call in a batch as the order to fill, so this
 * helper's output is what belongs at `calls[0]` of a create-and-fill batch.
 */
export function createOrderCall(params: OrderParams): Call {
    return {
        contract: params.trading,
        func: 'create_order',
        args: [
            Address.fromString(params.user).toScVal(),
            xdr.ScVal.scvBool(params.isLong),
            xdr.ScVal.scvU32(params.kind),
            nativeToScVal(params.notional, { type: 'i128' }),
            nativeToScVal(params.collateral, { type: 'i128' }),
            nativeToScVal(params.triggerPrice, { type: 'i128' }),
            nativeToScVal(params.priceBound, { type: 'i128' }),
            xdr.ScVal.scvU32(params.expiration),
        ],
    };
}

/** `error` marker for a failure that carries no contract error code. */
export const UNTYPED_FAILURE = 0xffffffff;

/**
 * The decoded result of one batched call.
 *
 * On the wire `multicall_try` returns raw values, one per call: the call's
 * return value when it lands, or the failure as a host `Error` value when it
 * does not (the two cannot collide; the host turns an error-tagged return
 * into a failure). This interface is the SDK's decoded view of one element.
 */
export interface CallOutcome {
    /** The call landed. */
    ok: boolean;
    /**
     * The call's decoded return value when ok (`scValToNative`; `null` for a
     * void return); `undefined` on failure.
     */
    value: unknown;
    /**
     * `0` on success, the contract error code on a typed failure,
     * `UNTYPED_FAILURE` on a non-contract (host) one.
     */
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

// =============================================================================
// Parsers: scValToNative output (snake_case) -> camelCase interface
// =============================================================================

/** Coerce a decoded numeric (already `bigint`, or occasionally `number`) to `bigint`. */
function big(v: unknown): bigint {
    return typeof v === 'bigint' ? v : BigInt(v as number);
}

/** Parse one raw `multicall_try` outcome `ScVal` into a [`CallOutcome`]. */
export function parseCallOutcome(raw: xdr.ScVal): CallOutcome {
    if (raw.switch() === xdr.ScValType.scvError()) {
        const error = raw.error();
        const code = error.switch() === xdr.ScErrorType.sceContract()
            ? error.contractCode()
            : UNTYPED_FAILURE;
        return { ok: false, value: undefined, error: code };
    }
    return { ok: true, value: scValToNative(raw), error: 0 };
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
