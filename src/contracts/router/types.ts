import { Address, xdr, scValToNative, nativeToScVal } from '@stellar/stellar-sdk';
import type { i128, u32 } from '../../index.js';
import { OrderKind } from '../market/types.js';

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
 * The trading contract's `create_order` arguments, in a shape the router
 * builders can turn into a fillable [`Call`] (see [`createOrderCall`]).
 *
 * Mirrors `create_order` one-for-one, plus the `trading` target the `Call`
 * runs against.
 */
export interface OrderParams {
    /** The target trading contract the `create_order` runs on. */
    trading: string;
    /** The order owner. */
    user: string;
    /** Side the order targets. */
    isLong: boolean;
    /** The order kind. See `OrderKind`. */
    kind: OrderKind;
    /** Size change magnitude (>= 0), token-dec. */
    notional: i128;
    /** Margin change magnitude (>= 0), token-dec. */
    margin: i128;
    /** Crossing level for a trigger kind (price_scalar, 18-dec); unread for a market kind. */
    triggerPrice: i128;
    /** Fill slippage limit (price_scalar, 18-dec); 0 = unbounded. */
    priceBound: i128;
    /** Ledger sequence; eligible while the current sequence <= expiration. */
    expiration: u32;
}

/**
 * Build a `create_order`-shaped [`Call`] from [`OrderParams`], for router
 * batches (`multicall`, `create_and_fill`, and their kin).
 *
 * The encoding matches the trading contract's `create_order` exactly, so a
 * bundled order is byte-identical to a direct call. Put it at `calls[0]` of
 * a create-and-fill batch: the router treats the first call as the order to
 * fill.
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
            nativeToScVal(params.margin, { type: 'i128' }),
            nativeToScVal(params.triggerPrice, { type: 'i128' }),
            nativeToScVal(params.priceBound, { type: 'i128' }),
            xdr.ScVal.scvU32(params.expiration),
        ],
    };
}

/** `error` marker for a failure that carries no contract error code. */
export const UNTYPED_FAILURE = 0xffffffff;

/**
 * The decoded result of one batched call from `multicall_try`.
 *
 * Holds the call's return value when it lands, or the failure code when it
 * does not; the two cannot collide.
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

/** Encode a `Call` as an `ScVal` for a router batch argument. */
export function callToScVal(call: Call): xdr.ScVal {
    const entry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    return xdr.ScVal.scvMap([
        entry('args', xdr.ScVal.scvVec(call.args)),
        entry('contract', Address.fromString(call.contract).toScVal()),
        entry('func', xdr.ScVal.scvSymbol(call.func)),
    ]);
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
