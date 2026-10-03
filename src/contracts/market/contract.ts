import { marketSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../../index.js';
import type { Call } from '../router/types.js';
import {
    OrderKind, VaultOrderKind, MarketConfig,
    Order, VaultOrder, Position, MarketData, AdlState,
    marketConfigToScVal,
    parseOrder, parseVaultOrder, parsePosition, parseMarketData, parseAdlState, parseMarketConfig,
} from './types.js';
import { Buffer } from 'buffer';

/** Deploy-time constructor arguments (`__constructor`). */
export interface DeployArgs {
    /** Owner of the new market, the authority for its owner-only methods. */
    owner: string;
    /** Settlement token, the collateral every token-dec amount is in. */
    token: string;
    /** Strategy vault that backs the market. */
    vault: string;
    /** Oracle contract that verifies price updates for `feedId`. */
    oracle: string;
    /** Treasury contract, the protocol fee sink. */
    treasury: string;
    /** 32-byte Data Streams stream id (`BytesN<32>`); must be a V3 (`0x0003…`) stream. */
    feedId: Buffer | Uint8Array;
    /** Initial market configuration. */
    config: MarketConfig;
}

/** Coerce a price update to a `Buffer`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/** Coerce a 32-byte feed id to a `Buffer`. Throws if it is not 32 bytes long. */
function feedIdBuffer(feedId: Buffer | Uint8Array): Buffer {
    if (feedId.length !== 32) {
        throw new Error(`feedId must be 32 bytes, got ${feedId.length}`);
    }
    return feedId instanceof Buffer ? feedId : Buffer.from(feedId);
}

/**
 * Builds unsigned operations for one market: order creation, keeper fill
 * and liquidation, and reads of position and market state.
 *
 * Every method returns a base64 XDR `Operation` string, not a result. The
 * `*Call` builders return a router `Call` instead.
 */
export class MarketContract extends Contract {
    /** Parsed spec for the market contract; used to encode and decode invocations. */
    static spec: contract.Spec = new contract.Spec(marketSpec);

    /** Result decoders for each method's simulated result (base64 XDR), keyed by JS method name. */
    static readonly parsers = {
        // --- admin (void) ---
        setConfig: () => {},
        setStatus: () => {},
        setTerminalPrice: () => {},
        upgrade: () => {},
        // --- Ownable ---
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
        // --- trader / keeper (numeric) ---
        createOrder: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancelOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        createVaultOrder: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancelVaultOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        claimCredit: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeLiquidation: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeAdl: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeVaultOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getClaimableCredit: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // --- struct-decoding views ---
        updateAdlState: (result: string): AdlState =>
            parseAdlState(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getAdl: (result: string): AdlState =>
            parseAdlState(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        accrue: (result: string): MarketData =>
            parseMarketData(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getMarketData: (result: string): MarketData =>
            parseMarketData(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getPosition: (result: string): Position =>
            parsePosition(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        // A missing order traps OrderNotFound (730) on-chain; the result here
        // is always a stored row.
        getOrder: (result: string): Order =>
            parseOrder(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        // A missing vault order traps VaultOrderNotFound (750) on-chain; the
        // result here is always a stored row.
        getVaultOrder: (result: string): VaultOrder =>
            parseVaultOrder(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        getConfig: (result: string): MarketConfig =>
            parseMarketConfig(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
        // --- plain scalar / address / tuple views (passthrough) ---
        getStatus: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getOrderCounter: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getToken: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getVault: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getTreasury: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getOracle: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getRetirement: (result: string): [i128, u64] | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        getFeed: (result: string): Buffer =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
    };

    /**
     * Build the constructor operation for a new market.
     *
     * `MarketData` starts zeroed with accrual timestamps at `now`; status
     * starts `Status::Active`.
     *
     * # Errors
     * - InvalidConfig (700) if `feedId` is not a V3 (`0x0003…`) stream id, or
     *   a config bound or range check fails.
     * - NegativeValueNotAllowed (710) if a fee, margin, borrowing, funding,
     *   ADL or PnL field, `minOrderMargin`, `minDeposit` or `execFee` is
     *   negative. Any other negative field fails its own bound as 700.
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: DeployArgs,
        salt?: Buffer,
        format: 'hex' | 'base64' = 'hex'
    ): string {
        return Operation.createCustomContract({
            address: Address.fromString(deployer),
            wasmHash: typeof wasmHash === 'string'
                ? Buffer.from(wasmHash, format)
                : wasmHash,
            salt,
            constructorArgs: [
                Address.fromString(args.owner).toScVal(),
                Address.fromString(args.token).toScVal(),
                Address.fromString(args.vault).toScVal(),
                Address.fromString(args.oracle).toScVal(),
                Address.fromString(args.treasury).toScVal(),
                xdr.ScVal.scvBytes(feedIdBuffer(args.feedId)),
                marketConfigToScVal(args.config),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Admin (owner only)
    // ============================================================

    /**
     * Replace the global market configuration. Owner only.
     *
     * Call `accrue` in the same ledger when `targetUtil`, `borrowRate`,
     * `increasedBorrowRate`, `maxUtilOpen` or a funding parameter changes,
     * unless the market is `Frozen`. The first accrual after unfreeze then
     * prices the whole frozen window at the new values.
     *
     * # Errors
     * - InvalidConfig (700) if a bound or range check fails.
     * - NegativeValueNotAllowed (710) if a fee, margin, borrowing, funding,
     *   ADL or PnL field, `minOrderMargin`, `minDeposit` or `execFee` is
     *   negative. Any other negative field fails its own bound as 700.
     * - MarketNotAccrued (703) if one of those accrual parameters changes
     *   without a same-ledger accrual on a market that is not `Frozen`.
     */
    setConfig(config: MarketConfig): string {
        return this.call(
            'set_config',
            marketConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Set the contract operational status. Owner only.
     *
     * Entering `Status::Retired` sweeps the credit-pool surplus
     * (`creditPool - creditOwed`) to the vault.
     *
     * # Errors
     * - InvalidStatus (702) on an unknown status value or an invalid transition.
     * - MarketNotCleared (706) on `Status::Retired` while any position remains open.
     */
    setStatus(status: u32): string {
        return this.call(
            'set_status',
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Set or refresh the flat settlement price of a delisted market. Owner only.
     *
     * From the first set on, every fill and accrual prices flat at it and
     * ignores the submitted price update.
     *
     * @param price - Flat settlement price (price_scalar).
     *
     * # Errors
     * - InvalidStatus (702) unless the status is `Status::Delisted` and the
     *   delist grace window has expired.
     * - InvalidPrice (701) if `price` <= 0.
     */
    setTerminalPrice(price: i128): string {
        return this.call(
            'set_terminal_price',
            nativeToScVal(price, { type: 'i128' }),
        ).toXDR('base64');
    }

    // ============================================================
    // Trader (auth = user, price-free)
    // ============================================================

    /**
     * Create an `Order` for the keeper to fill. `user` authorizes.
     *
     * An increase escrows `margin` plus `execFee`; a decrease escrows
     * `execFee` alone. `execFee` (read from config) pays the keeper at fill
     * and refunds on cancel. When the position closes, every pending decrease
     * order on its side is cancelled and refunded. A pending increase stays
     * and can still fill.
     *
     * @param kind - A market kind is eligible at once; a limit or stop kind
     *   waits for `triggerPrice` to be crossed. A keeper fills either kind.
     * @param notional - Size-change magnitude (token-dec). A decrease at or
     *   above the position size, or one that leaves less than
     *   `minPositionNotional` behind, clamps to a full close at fill.
     *   `FULL_CLOSE` signals a full close.
     * @param margin - Margin-change magnitude (token-dec).
     * @param triggerPrice - Crossing level for a limit or stop kind
     *   (price_scalar, 18-dec). A market kind does not read it, but a
     *   negative value still traps.
     * @param priceBound - Fill slippage limit (price_scalar, 18-dec). `0` means unbounded.
     * @param expiration - Last ledger sequence the order can still fill at.
     *
     * # Returns
     * - The allocated order id.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - UnknownKind (734) if `kind` is not a known discriminant.
     * - NegativeValueNotAllowed (710) if a magnitude, `triggerPrice`, or
     *   `priceBound` is negative.
     * - InvalidOrder (732) if the shape is a no-op, a moved value is below
     *   its dust floor (`minOrderNotional` or `minOrderMargin`), a limit or
     *   stop kind carries a zero `triggerPrice`, or an increase's
     *   `margin + execFee` escrow overflows.
     * - NotionalAboveMaximum (712) if an increase's `notional` exceeds `maxPositionNotional`.
     * - OrderExpired (731) if `expiration` is already behind the current ledger.
     * - TooManyOrders (733) if a decrease targets a side that already holds
     *   `MAX_ORDERS_PER_SIDE` pending decrease orders.
     */
    createOrder(
        user: string,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        margin: i128,
        triggerPrice: i128,
        priceBound: i128,
        expiration: u32,
    ): string {
        const call = this.createOrderCall(
            user, isLong, kind, notional, margin, triggerPrice, priceBound, expiration,
        );
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `create_order` invocation as a `Call`, for batching under
     * the router's `multicall`.
     *
     * Produces the same arguments as `createOrder`, so a batched order is
     * byte-identical to a direct one. The router needs no authorization:
     * `user` authorizes this call in its own auth entry. `MarketRouterContract`
     * says how to simulate a direct batch.
     */
    createOrderCall(
        user: string,
        isLong: boolean,
        kind: OrderKind,
        notional: i128,
        margin: i128,
        triggerPrice: i128,
        priceBound: i128,
        expiration: u32,
    ): Call {
        return {
            contract: this.contractId(),
            func: 'create_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvBool(isLong),
                xdr.ScVal.scvU32(kind),
                nativeToScVal(notional, { type: 'i128' }),
                nativeToScVal(margin, { type: 'i128' }),
                nativeToScVal(triggerPrice, { type: 'i128' }),
                nativeToScVal(priceBound, { type: 'i128' }),
                xdr.ScVal.scvU32(expiration),
            ],
        };
    }

    /**
     * Cancel a pending `Order` `user` owns and refund its escrow. `user`
     * authorizes.
     *
     * # Returns
     * - The refunded escrow: an increase's margin plus its `execFee`, a
     *   decrease's `execFee` (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - OrderNotFound (730) if no order `(user, id)` exists.
     */
    cancelOrder(user: string, id: u32): string {
        const call = this.cancelOrderCall(user, id);
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `cancel_order` invocation as a `Call`, for batching under
     * the router's `multicall`.
     *
     * Produces the same arguments as `cancelOrder`, so a batched cancel is
     * byte-identical to a direct one. The router needs no authorization:
     * `user` authorizes this call in its own auth entry. `MarketRouterContract`
     * says how to simulate a direct batch.
     */
    cancelOrderCall(user: string, id: u32): Call {
        return {
            contract: this.contractId(),
            func: 'cancel_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvU32(id),
            ],
        };
    }

    /**
     * Create a `VaultOrder` for the keeper to fill. `user` authorizes.
     *
     * The deposit assets or redeem shares, plus `execFee`, are escrowed at
     * creation. On a `Status::Retired` market a redeem skips the order and
     * pays out right away: the vault burns the shares and sends the assets
     * straight to `user`, and `minOut` does not apply.
     *
     * @param kind - `Deposit` moves assets in for shares; `Redeem` moves
     *   shares in for assets.
     * @param amount - Assets to deposit (token-dec), or shares to redeem
     *   (share-dec: token-dec plus the vault's decimals offset).
     * @param minOut - Minimum received at fill, net of the vault fee: shares
     *   for a deposit (share-dec), assets for a redeem (token-dec). `0`
     *   means unset. A fill quoted below it rejects the order rather than
     *   leaving it to wait.
     *
     * # Returns
     * - The allocated vault order id, or `0` for a Retired-market instant redeem.
     *
     * # Errors
     * - UnknownKind (734) if `kind` is not a known discriminant.
     * - NegativeValueNotAllowed (710) if `amount` or `minOut` is negative.
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - InvalidStatus (702) if a deposit is created on a `Retired` market.
     * - InvalidOrder (732) if `amount` is zero, a deposit falls under
     *   `minDeposit`, or a deposit's `amount + execFee` escrow overflows.
     */
    createVaultOrder(user: string, kind: VaultOrderKind, amount: i128, minOut: i128): string {
        const call = this.createVaultOrderCall(user, kind, amount, minOut);
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `create_vault_order` invocation as a `Call`, for batching
     * under the router's `multicall`.
     *
     * Produces the same arguments as `createVaultOrder`, so a batched
     * deposit or redeem is byte-identical to a direct one. The router needs
     * no authorization: `user` authorizes this call in its own auth entry.
     * `MarketRouterContract` says how to simulate a direct batch.
     */
    createVaultOrderCall(user: string, kind: VaultOrderKind, amount: i128, minOut: i128): Call {
        return {
            contract: this.contractId(),
            func: 'create_vault_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvU32(kind),
                nativeToScVal(amount, { type: 'i128' }),
                nativeToScVal(minOut, { type: 'i128' }),
            ],
        };
    }

    /**
     * Cancel a pending `VaultOrder` `user` owns and pay back the escrowed
     * assets or shares. `user` authorizes. The escrowed `execFee` refunds
     * too, in the settlement token, and is not part of the return.
     *
     * # Returns
     * - The escrowed principal paid back: assets for a deposit (token-dec) or
     *   shares for a redeem (share-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - VaultOrderNotFound (750) if no vault order `(user, id)` exists.
     */
    cancelVaultOrder(user: string, id: u32): string {
        const call = this.cancelVaultOrderCall(user, id);
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `cancel_vault_order` invocation as a `Call`, for batching
     * under the router's `multicall`.
     *
     * Produces the same arguments as `cancelVaultOrder`, so a batched
     * cancel is byte-identical to a direct one. The router needs no
     * authorization: `user` authorizes this call in its own auth entry.
     * `MarketRouterContract` says how to simulate a direct batch.
     */
    cancelVaultOrderCall(user: string, id: u32): Call {
        return {
            contract: this.contractId(),
            func: 'cancel_vault_order',
            args: [
                Address.fromString(user).toScVal(),
                xdr.ScVal.scvU32(id),
            ],
        };
    }

    /**
     * Pay out `user`'s claimable credit balance from the credit pool: earned
     * funding, plus any payout whose direct transfer failed. `user`
     * authorizes.
     *
     * The payout is the balance capped at the pool's holdings, and an unpaid
     * remainder stays claimable. `MarketUser.claimable(market)` quotes the
     * capped amount.
     *
     * # Returns
     * - The amount paid out (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - NothingToClaim (760) if `user` has no claimable balance, or the pool
     *   holds nothing to pay it with.
     */
    claimCredit(user: string): string {
        return this.call(
            'claim_credit',
            Address.fromString(user).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Keeper (permissionless, price-bearing)
    // ============================================================

    /**
     * Fill a pending `Order` and settle it. Permissionless: `keeper` takes
     * the payout and is not authenticated.
     *
     * @param price - The keeper's signed price update for this market's feed.
     *   The fill prices at this report, never at the cached price. Once a
     *   terminal price is set, the fill uses it and ignores this report.
     *
     * # Returns
     * - The keeper's payout (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - OrderNotFound (730) if no order `(user, id)` exists.
     * - IncreaseHalted (705) if a size-growing increase runs while the status
     *   does not accept opens or the target side has ADL enabled.
     * - OrderExpired (731) if the order expired before the fill.
     * - StalePrice (740) if the price predates the order or the price the
     *   position was last marked against. A market kind filled in its
     *   creation ledger is exempt from the order check.
     * - TriggerNotMet (742) if the order's trigger has not been crossed.
     * - PriceBoundExceeded (741) if the fill price is worse than `priceBound`.
     * - PositionNotFound (720) if a decrease targets an absent position.
     * - PositionLiquidatable (723) if a decrease targets a position whose
     *   settled equity is already below the maintenance margin, or any fill
     *   leaves the position's settled equity below it. For the first case,
     *   call `executeLiquidation` instead.
     * - NotionalLocked (721) if the close exceeds the position's unlocked notional.
     * - NotionalBelowMinimum (711) if the resulting position falls under `minPositionNotional`.
     * - NotionalAboveMaximum (712) if the resulting position exceeds `maxPositionNotional`.
     * - InsufficientMargin (713) if the posted margin left after the fill is
     *   below `ceil(initMargin * notional)`. Unrealized PnL does not count.
     * - OpenInterestExceeded (715) if a size-growing increase takes the
     *   side's open interest above `maxOpenInterest`.
     * - SizeRoundsToZero (716) if an increase's notional buys no base size at
     *   the entry price.
     * - UtilizationExceeded (714) if a size-growing increase leaves its
     *   side's reserve above `maxUtilOpen` of half the vault. The opposite
     *   side is not checked.
     * - VaultInsolvent (755) if a decrease settlement's vault draw exceeds the vault balance.
     */
    executeOrder(keeper: string, user: string, id: u32, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_order',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Force-close the `Position` `(user, isLong)` and settle it.
     * Permissionless: `keeper` takes the payout and is not authenticated.
     *
     * Eligible when settled equity has fallen below the maintenance margin,
     * or regardless of margin health once a `Delisted` market's 7-day delist
     * deadline has passed.
     *
     * @param price - The keeper's signed price update for this market's feed.
     *   The call prices at the newer of this report and the market's cached
     *   price. Once a terminal price is set, it uses that and ignores this
     *   report.
     *
     * # Returns
     * - The keeper's payout (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - StalePrice (740) if the price is older than the price the position
     *   was last marked against.
     * - NotLiquidatable (722) if equity is at or above the maintenance margin
     *   and the delist deadline has not passed.
     * - VaultInsolvent (755) if the settlement's vault draw exceeds the vault balance.
     */
    executeLiquidation(keeper: string, user: string, isLong: boolean, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_liquidation',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Recompute both sides' pending PnL and set or clear the `AdlState`
     * flags. Permissionless.
     *
     * A side is flagged once its pending PnL exceeds `adlMaxPnl` of half the
     * vault balance. It stays flagged until the PnL falls to `adlClearTarget`
     * of half the vault or below. A flagged side rejects increases that add
     * notional, and is eligible for `executeAdl`. A margin-only increase
     * still fills.
     *
     * @param price - The keeper's signed price update for this market's feed.
     *   The call prices at the newer of this report and the market's cached
     *   price. Once a terminal price is set, it uses that and ignores this
     *   report.
     *
     * # Returns
     * - The resulting `AdlState`.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     */
    updateAdlState(price: Buffer | Uint8Array): string {
        return this.call(
            'update_adl_state',
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Deleverage the winning `Position` `(user, isLong)`, reducing its side's
     * pending PnL toward `adlClearTarget` of half the vault balance.
     * Permissionless: `keeper` takes the payout and is not authenticated.
     *
     * Fires only on a side flagged by `updateAdlState`. The remainder of a
     * partial close skips the initial-margin check.
     *
     * @param amount - Notional to close (token-dec), at least
     *   `minOrderNotional`. A request at or above the position notional, or
     *   one whose remainder would fall below `minPositionNotional`, closes
     *   the whole position.
     * @param price - The keeper's signed price update for this market's feed.
     *   The call prices at the newer of this report and the market's cached
     *   price. Once a terminal price is set, it uses that and ignores this
     *   report.
     *
     * # Returns
     * - The keeper's payout: the `keeperRate` cut of the trade fee (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - InvalidOrder (732) if `amount` is below `minOrderNotional`.
     * - AdlNotTriggered (770) if the side is not flagged for deleveraging, or
     *   its pending PnL is already at or below `adlClearTarget` of half the
     *   vault balance.
     * - StalePrice (740) if the price is older than the price the position
     *   was last marked against.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - PositionLiquidatable (723) if the position's settled equity is below
     *   the maintenance margin, before the close or for the remainder of a
     *   partial close. Call `executeLiquidation` instead.
     * - NotionalLocked (721) if the close touches notional still under the
     *   decrease lock.
     * - NotionalAboveMaximum (712) if the remainder of a partial close
     *   exceeds `maxPositionNotional`.
     * - VaultInsolvent (755) if the settlement's vault draw exceeds the vault balance.
     * - AdlNotEligible (772) if the close does not reduce the side's pending PnL.
     * - AdlOvershoot (771) if the close lands the side under the clear
     *   allowance re-measured on the settled vault balance.
     */
    executeAdl(keeper: string, user: string, isLong: boolean, amount: i128, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_adl',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
            nativeToScVal(amount, { type: 'i128' }),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    /**
     * Fill the `VaultOrder` `(user, id)`. Permissionless: `keeper` takes the
     * payout and is not authenticated.
     *
     * The whole order fills at once and is removed. The fill deducts the
     * vault fill fee (the `depositFee` or `redeemFee` cut of the moved assets
     * by kind), split between the keeper, the treasury, and the vault.
     *
     * A fill quoted below the order's `minOut` rejects the order instead and
     * emits `reject_vault_order` with no fill receipt: the order is removed,
     * the principal returns to `user` (a deposit refund `user` cannot receive
     * parks as claimable credit), and the escrowed `execFee` pays the keeper.
     * The capacity gates (753, 714, 754) revert instead and leave the order
     * pending.
     *
     * @param price - The keeper's signed price update for this market's feed.
     *   The fill prices at the newer of this report and the market's cached
     *   price. Once a terminal price is set, it uses that and ignores this
     *   report.
     *
     * # Returns
     * - The keeper's payout, token-dec: the `keeperRate` cut of the vault
     *   fill fee plus the order's `execFee`, or the `execFee` alone on a
     *   rejection.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - VaultOrderNotFound (750) if no vault order `(user, id)` exists.
     * - StalePrice (740) if the price's `publish_time` predates the order's
     *   `createdAt`, or the fill runs in the order's creation ledger.
     * - VaultOrderLocked (751) if a redeem's `redeemLock` cooldown from
     *   `createdAt` has not elapsed.
     * - VaultBalanceExceeded (753) if a deposit would push the vault above `maxVaultBalance`.
     * - UtilizationExceeded (714) if a redeem would leave either side's
     *   reserve above `maxUtilWithdraw` of half the remaining vault balance.
     * - PendingPnlExceeded (754) if a redeem would leave a side's pending PnL
     *   above `maxPnlWithdraw` of half the remaining balance.
     */
    executeVaultOrder(keeper: string, user: string, id: u32, price: Buffer | Uint8Array): string {
        return this.call(
            'execute_vault_order',
            Address.fromString(keeper).toScVal(),
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    // ============================================================
    // Maintenance (permissionless)
    // ============================================================

    /**
     * Advance both of the market's accrual indices (borrowing and funding)
     * to the current timestamp. Permissionless.
     *
     * @param price - The keeper's signed price update for this market's feed.
     *   The call prices at the newer of this report and the market's cached
     *   price. Once a terminal price is set, it uses that and ignores this
     *   report.
     *
     * Emits a payload-free `accrual_update` marker event; read the
     * post-accrual state from the returned market data or `get_market_data`.
     *
     * # Returns
     * - The accrued market data.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     */
    accrue(price: Buffer | Uint8Array): string {
        return this.call(
            'accrue',
            xdr.ScVal.scvBytes(priceBuffer(price)),
        ).toXDR('base64');
    }

    // ============================================================
    // Views
    // ============================================================

    /** Read the market configuration. */
    getConfig(): string {
        return this.call('get_config').toXDR('base64');
    }

    /** Read the market state, as of its last accrual. */
    getMarketData(): string {
        return this.call('get_market_data').toXDR('base64');
    }

    /**
     * Look up the netted position for `(user, isLong)`.
     *
     * # Returns
     * - The stored `Position`, or a zeroed one if none is open on that side.
     */
    getPosition(user: string, isLong: boolean): string {
        return this.call(
            'get_position',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(isLong),
        ).toXDR('base64');
    }

    /**
     * Look up the pending keeper order `(user, id)`.
     *
     * # Returns
     * - The stored `Order` row. The read extends the entry's time-to-live
     *   (TTL) when submitted on-chain. A simulated call leaves no footprint.
     *
     * # Errors
     * - OrderNotFound (730) if no such order exists.
     */
    getOrder(user: string, id: u32): string {
        return this.call(
            'get_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
    }

    /** Read the contract operational status, as its `Status` `u32` discriminant. */
    getStatus(): string {
        return this.call('get_status').toXDR('base64');
    }

    /**
     * Look up the pending vault order `(user, id)`.
     *
     * # Returns
     * - The stored `VaultOrder` row. The read extends the entry's TTL when
     *   submitted on-chain. A simulated call leaves no footprint.
     *
     * # Errors
     * - VaultOrderNotFound (750) if no such vault order exists.
     */
    getVaultOrder(user: string, id: u32): string {
        return this.call(
            'get_vault_order',
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvU32(id),
        ).toXDR('base64');
    }

    /**
     * Read `user`'s order counter.
     *
     * # Returns
     * - The next order id. Ids `1..counter` are already allocated, shared
     *   between trade and vault orders (`1` means none allocated yet).
     */
    getOrderCounter(user: string): string {
        return this.call(
            'get_order_counter',
            Address.fromString(user).toScVal(),
        ).toXDR('base64');
    }

    /** Read the ADL state, zeroed until the first recompute. */
    getAdl(): string {
        return this.call('get_adl').toXDR('base64');
    }

    /**
     * Read `user`'s claimable credit balance.
     *
     * # Returns
     * - The funding owed to `user`, plus any payout whose direct transfer
     *   failed, `0` if none (token-dec). A claim pays at most what the credit
     *   pool holds, so `claimCredit` can pay less than this balance.
     */
    getClaimableCredit(user: string): string {
        return this.call(
            'get_claimable_credit',
            Address.fromString(user).toScVal(),
        ).toXDR('base64');
    }

    /** Read the settlement token address. */
    getToken(): string {
        return this.call('get_token').toXDR('base64');
    }

    /** Read the strategy-vault address backing this market. */
    getVault(): string {
        return this.call('get_vault').toXDR('base64');
    }

    /** Read the treasury address (the protocol fee sink). */
    getTreasury(): string {
        return this.call('get_treasury').toXDR('base64');
    }

    /** Read the oracle contract address. */
    getOracle(): string {
        return this.call('get_oracle').toXDR('base64');
    }

    /**
     * Read the wind-down anchors.
     *
     * # Returns
     * - `undefined` if the market was never delisted, or the owner reverted
     *   its last delist within the grace window. Otherwise
     *   `[terminalPrice, delistedAt]`: the flat settlement price
     *   (price_scalar), `0` until set, and the first-delist time (unix
     *   seconds).
     */
    getRetirement(): string {
        return this.call('get_retirement').toXDR('base64');
    }

    /**
     * Read the oracle feed anchor.
     *
     * # Returns
     * - The constructor-set 32-byte price stream id (`BytesN<32>`).
     */
    getFeed(): string {
        return this.call('get_feed').toXDR('base64');
    }


    // ============================================================
    // Upgrade
    // ============================================================

    /**
     * Replace the contract's WASM executable (owner only). Storage is
     * untouched; the host emits a SYSTEM `executable_update` event.
     *
     * @param newWasmHash - Hash of the already-uploaded replacement WASM.
     * @param operator - Must equal the owner. The trait shape mandates the
     *   argument; it carries no authority of its own.
     *
     * # Errors
     * - `OwnerNotSet` (2100) once ownership is renounced.
     * - `UpgradeNotOwner` (600) if `operator` is not the owner.
     */
    upgrade(newWasmHash: Buffer | Uint8Array, operator: string): string {
        const hash = newWasmHash instanceof Buffer ? newWasmHash : Buffer.from(newWasmHash);
        return this.call(
            'upgrade',
            xdr.ScVal.scvBytes(hash),
            Address.fromString(operator).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Ownable
    // ============================================================

    /** Read the current owner. `undefined` means ownership was renounced. */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Start a 2-step ownership transfer to `newOwner`. Owner only.
     *
     * The current owner keeps control until `newOwner` calls
     * `acceptOwnership`. A new call replaces any pending transfer.
     *
     * @param liveUntilLedger - Last ledger sequence `newOwner` can accept by.
     *   `0` cancels the pending transfer to `newOwner` instead, and
     *   `newOwner` must then equal the pending owner.
     *
     * # Errors
     * - OwnerNotSet (2100) once ownership is renounced.
     * - TransferInvalidLiveUntilLedger (2201) if `liveUntilLedger` is in the
     *   past or beyond the maximum entry TTL.
     * - NoPendingTransfer (2200) on a cancel with no pending transfer.
     * - InvalidPendingAccount (2202) on a cancel that names another address.
     */
    transferOwnership(newOwner: string, liveUntilLedger: u32): string {
        return this.call(
            'transfer_ownership',
            Address.fromString(newOwner).toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /**
     * Accept a pending ownership transfer. The pending owner authorizes.
     *
     * # Errors
     * - NoPendingTransfer (2200) if no transfer is pending.
     * - TransferExpired (2203) if the transfer's `liveUntilLedger` has passed.
     */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Renounce ownership of the contract. Owner only.
     *
     * This permanently removes the owner and disables every owner-only
     * method: `setConfig`, `setStatus`, `setTerminalPrice`, `upgrade` and
     * `transferOwnership`.
     *
     * # Errors
     * - OwnerNotSet (2100) if ownership is already renounced.
     * - OwnershipTransferInProgress (2101) if an unexpired transfer is pending.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }
}
