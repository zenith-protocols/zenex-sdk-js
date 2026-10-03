import { feeForwarderSpec } from '../contract_specs.js';
import { Address, Contract, contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { i128, u32 } from '../../index.js';
import { MarketRouterContract } from '../router/contract.js';
import { Call, CallOutcome, callToScVal, parseCallOutcome } from '../router/types.js';

/**
 * The fee terms of one relayed router call. The user signs every field
 * except `feeAmount`, which the relayer sets.
 */
export interface RelayFee {
    /** Token the fee is paid in. */
    feeToken: string;
    /** Fee paid to `feeRecipient`, token-dec. Must be above 0 and at most `maxFeeAmount`. */
    feeAmount: i128;
    /** Fee cap the user signs, token-dec. The call pulls the whole cap from the user and refunds the rest, so the user needs at least this balance. */
    maxFeeAmount: i128;
    /** Last ledger sequence of the fee allowance. A passed ledger fails in the fee token's `approve`: a Stellar Asset Contract raises AllowanceError (9). */
    expirationLedger: u32;
    /** Account the fee is paid to. Must not be the forwarder itself. */
    feeRecipient: string;
}

/** The router entry points the forwarder relays. */
export type ForwardTarget = 'multicall' | 'create_and_fill' | 'create_and_try_fill';

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/** The router batch argument, as `MarketRouterContract` encodes it. */
function callsToScVal(calls: Call[]): xdr.ScVal {
    return xdr.ScVal.scvVec(calls.map(callToScVal));
}

/** The router arguments of a create-and-fill target: `(calls, user, keeper, price)`. */
function fillTargetArgs(
    calls: Call[],
    user: string,
    keeper: string,
    price: Buffer | Uint8Array,
): xdr.ScVal[] {
    return [
        callsToScVal(calls),
        Address.fromString(user).toScVal(),
        Address.fromString(keeper).toScVal(),
        xdr.ScVal.scvBytes(priceBuffer(price)),
    ];
}

/**
 * The nine arguments of `forward` and `forward_dynamic`: `(fee_token,
 * fee_amount, max_fee_amount, expiration_ledger, target_contract, target_fn,
 * target_args, user, fee_recipient)`.
 */
function forwardArgs(
    router: string,
    target: ForwardTarget,
    targetArgs: xdr.ScVal[],
    user: string,
    fee: RelayFee,
): xdr.ScVal[] {
    return [
        Address.fromString(fee.feeToken).toScVal(),
        nativeToScVal(fee.feeAmount, { type: 'i128' }),
        nativeToScVal(fee.maxFeeAmount, { type: 'i128' }),
        xdr.ScVal.scvU32(fee.expirationLedger),
        Address.fromString(router).toScVal(),
        xdr.ScVal.scvSymbol(target),
        xdr.ScVal.scvVec(targetArgs),
        Address.fromString(user).toScVal(),
        Address.fromString(fee.feeRecipient).toScVal(),
    ];
}

/**
 * Operation builder for the Zenex fee forwarder (zenex-util-contracts
 * `fee-forwarder`), scoped to the market router. Each method relays one
 * router call and pays `fee.feeAmount` to `fee.feeRecipient` in the same
 * invocation. A failing router call also reverts the fee. Every method
 * returns a base64-encoded XDR operation.
 */
export class FeeForwarderContract extends Contract {
    /** Parsed spec for the fee forwarder contract; used to encode and decode invocations. */
    static spec: contract.Spec = new contract.Spec(feeForwarderSpec);

    /**
     * Result decoders, keyed to the method of the same name. The forwarder
     * returns the router's result unchanged, so each one decodes like the
     * router entry point it relays.
     */
    static readonly parsers = {
        forwardMulticall: MarketRouterContract.parsers.multicall,
        forwardCreateAndFill: MarketRouterContract.parsers.createAndFill,
        forwardCreateAndTryFill: (result: string): CallOutcome[] =>
            (xdr.ScVal.fromXDR(result, 'base64').vec() ?? []).map(
                parseCallOutcome,
            ),
    };

    /**
     * Relay the router's `multicall(calls)` through `forward`. `user` signs
     * the whole batch and every fee term except `fee.feeAmount`.
     *
     * @param router - The market router the forwarder calls.
     * @param user - The fee payer, who authorizes the call.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.forwardMulticall`.
     *
     * # Errors
     * - FeeAbstractionInvalidFeeBounds (5003) if `fee.feeAmount` is not above
     *   0 or exceeds `fee.maxFeeAmount`.
     * - FeeForwarderInvalidRecipient (6002) if `fee.feeRecipient` is the
     *   forwarder.
     * - The fee token's errors if the user cannot cover `fee.maxFeeAmount`,
     *   or `fee.expirationLedger` has passed.
     * - Propagates the router's `multicall` errors.
     */
    forwardMulticall(router: string, calls: Call[], user: string, fee: RelayFee): string {
        return this.call(
            'forward',
            ...forwardArgs(router, 'multicall', [callsToScVal(calls)], user, fee),
        ).toXDR('base64');
    }

    /**
     * Relay the router's strict `create_and_fill(calls, user, keeper, price)`
     * through `forward_dynamic`. `user` pays the fee and owns the order that
     * `calls[0]` creates.
     *
     * `user` signs the router target and every fee term except
     * `fee.feeAmount`, but not `calls`, `keeper` or `price`. A relayer can
     * submit other values for those and still collect the fee. A call that
     * takes tokens from the user still needs the user's own authorization,
     * and the order's `priceBound` caps the fill price.
     *
     * @param router - The market router the forwarder calls.
     * @param keeper - The fill reward recipient.
     * @param price - The signed price update for the fill.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.forwardCreateAndFill`.
     *
     * # Errors
     * - FeeAbstractionInvalidFeeBounds (5003) if `fee.feeAmount` is not above
     *   0 or exceeds `fee.maxFeeAmount`.
     * - FeeForwarderInvalidRecipient (6002) if `fee.feeRecipient` is the
     *   forwarder.
     * - The fee token's errors if the user cannot cover `fee.maxFeeAmount`,
     *   or `fee.expirationLedger` has passed.
     * - Propagates the router's `create_and_fill` errors.
     */
    forwardCreateAndFill(
        router: string,
        calls: Call[],
        user: string,
        keeper: string,
        price: Buffer | Uint8Array,
        fee: RelayFee,
    ): string {
        return this.call(
            'forward_dynamic',
            ...forwardArgs(
                router,
                'create_and_fill',
                fillTargetArgs(calls, user, keeper, price),
                user,
                fee,
            ),
        ).toXDR('base64');
    }

    /**
     * Relay the router's `create_and_try_fill(calls, user, keeper, price)`
     * through `forward_dynamic`. If the fill fails, the orders rest, the last
     * outcome carries the error, and the fee is still collected.
     *
     * The signed terms and the relayer's freedom are those of
     * `forwardCreateAndFill`.
     *
     * @param router - The market router the forwarder calls.
     * @param keeper - The fill reward recipient.
     * @param price - The signed price update for the fill.
     *
     * @returns base64 XDR operation. Parse the result with
     * `parsers.forwardCreateAndTryFill`.
     *
     * # Errors
     * - FeeAbstractionInvalidFeeBounds (5003) if `fee.feeAmount` is not above
     *   0 or exceeds `fee.maxFeeAmount`.
     * - FeeForwarderInvalidRecipient (6002) if `fee.feeRecipient` is the
     *   forwarder.
     * - The fee token's errors if the user cannot cover `fee.maxFeeAmount`,
     *   or `fee.expirationLedger` has passed.
     * - Propagates the router's `create_and_try_fill` errors, except a failed
     *   fill.
     */
    forwardCreateAndTryFill(
        router: string,
        calls: Call[],
        user: string,
        keeper: string,
        price: Buffer | Uint8Array,
        fee: RelayFee,
    ): string {
        return this.call(
            'forward_dynamic',
            ...forwardArgs(
                router,
                'create_and_try_fill',
                fillTargetArgs(calls, user, keeper, price),
                user,
                fee,
            ),
        ).toXDR('base64');
    }

    /**
     * The arguments `user` signs for a relayed router call, the root of the
     * user's auth tree: `[feeToken, maxFeeAmount, expirationLedger,
     * feeRecipient, router, target]`. For `'multicall'`, `forward` also signs
     * `[calls]` as a seventh element. The create-and-fill targets sign the six
     * through `forward_dynamic`.
     *
     * The Zenex session policy reads the fee recipient at index 3. It raises
     * SessionForwardNotAllowed (4006) for a recipient other than its own.
     *
     * @param calls - The batch. Signed for `'multicall'` only.
     */
    static authorizedArgs(
        target: ForwardTarget,
        router: string,
        calls: Call[],
        fee: Omit<RelayFee, 'feeAmount'>,
    ): xdr.ScVal[] {
        const signed = [
            Address.fromString(fee.feeToken).toScVal(),
            nativeToScVal(fee.maxFeeAmount, { type: 'i128' }),
            xdr.ScVal.scvU32(fee.expirationLedger),
            Address.fromString(fee.feeRecipient).toScVal(),
            Address.fromString(router).toScVal(),
            xdr.ScVal.scvSymbol(target),
        ];
        return target === 'multicall'
            ? [...signed, xdr.ScVal.scvVec([callsToScVal(calls)])]
            : signed;
    }
}
