import { tradingSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../../index.js';
import type { Call } from '../router/router_types.js';
import {
    OrderKind, VaultOrderKind, TradingConfig,
    Order, VaultOrder, Position, MarketData, AdlState,
    tradingConfigToScVal,
    parseOrder, parseVaultOrder, parsePosition, parseMarketData, parseAdlState, parseTradingConfig,
} from './trading_types.js';

/** Deploy-time constructor arguments (`__constructor`). */
export interface DeployArgs {
    owner: string;
    token: string;
    vault: string;
    oracle: string;
    treasury: string;
    /** 32-byte Data Streams stream id (`BytesN<32>`); must be a V3 (`0x0003…`) stream. */
    feedId: Buffer | Uint8Array;
    config: TradingConfig;
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
 * Every method returns a base64 XDR `Operation` string, not a result.
 */
export class TradingContract extends Contract {
    static spec: contract.Spec = new contract.Spec(tradingSpec);

    static readonly parsers = {
        // --- admin (void) ---
        setConfig: () => {},
        setStatus: () => {},
        setTerminalPrice: () => {},
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
        claimFunding: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeLiquidation: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeAdl: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        executeVaultOrder: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getClaimableFunding: (result: string): i128 =>
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
        getConfig: (result: string): TradingConfig =>
            parseTradingConfig(scValToNative(xdr.ScVal.fromXDR(result, 'base64'))),
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
     * - NegativeValueNotAllowed (710) if any rate, fee, or margin is negative.
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
                tradingConfigToScVal(args.config),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Admin (owner only)
    // ============================================================

    /**
     * Replace the global market configuration. Owner only.
     *
     * Call `accrue` in the same ledger as a borrowing or funding rate change,
     * unless the market is `Frozen`. The first accrual after unfreeze then
     * prices the whole frozen window at the new rates.
     *
     * # Errors
     * - InvalidConfig (700) if a bound or range check fails.
     * - NegativeValueNotAllowed (710) if any rate, fee, or margin is negative.
     * - MarketNotAccrued (703) if a borrowing or funding rate param changes
     *   without a same-ledger accrual.
     */
    setConfig(config: TradingConfig): string {
        return this.call(
            'set_config',
            tradingConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Set the contract operational status. Owner only.
     *
     * Entering `Status::Retired` sweeps the funding-pool surplus to the vault.
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
     * and refunds on cancel or when the position closes. A decrease that
     * reaches or passes the position size, or that would leave a dust
     * remainder behind, clamps to a full close at fill (`FULL_CLOSE` signals
     * a full close).
     *
     * @param kind - A market kind fills immediately; a limit or stop kind
     *   waits on `triggerPrice`, unread by a market kind.
     * @param notional - Size-change magnitude (token-dec).
     * @param margin - Margin-change magnitude (token-dec).
     * @param triggerPrice - Crossing level for a limit or stop kind (price_scalar, 18-dec).
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
     * - InvalidOrder (732) if the shape is a no-op, a moved value is below a
     *   dust floor, or a limit or stop kind carries a non-positive `triggerPrice`.
     * - TooManyOrders (733) if the side already holds the maximum
     *   (`MAX_ORDERS_PER_SIDE` = 8) pending decrease orders.
     * - NotionalAboveMaximum (712) if an increase's `notional` exceeds `maxPositionNotional`.
     * - OrderExpired (731) if `expiration` is already behind the current ledger.
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
     * byte-identical to a direct one. The router executes the call, and
     * `user`'s auth entry nests under the router's.
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
     * byte-identical to a direct one. The router executes the call, and
     * `user`'s auth entry nests under the router's.
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
     *   means unset.
     *
     * # Returns
     * - The allocated vault order id, or `0` for a Retired-market instant redeem.
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - InvalidStatus (702) if a deposit is created on a `Retired` market.
     * - UnknownKind (734) if `kind` is not a known discriminant.
     * - NegativeValueNotAllowed (710) if `minOut` is negative.
     * - InvalidOrder (732) if the deposited assets fall under `minDeposit`,
     *   or a redeem's share `amount` is not positive.
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
     * deposit or redeem is byte-identical to a direct one. The router
     * executes the call, and `user`'s auth entry nests under the router's.
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
     * assets or shares. `user` authorizes.
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
     * cancel is byte-identical to a direct one. The router executes the
     * call, and `user`'s auth entry nests under the router's.
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
     * Pay out `user`'s accrued claimable funding balance from the pool.
     * `user` authorizes.
     *
     * # Returns
     * - The amount paid out (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen`.
     * - NothingToClaim (760) if `user` has no claimable balance.
     */
    claimFunding(user: string): string {
        return this.call(
            'claim_funding',
            Address.fromString(user).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Keeper (permissionless, price-bearing)
    // ============================================================

    /**
     * Fill a pending `Order` at a verified price and settle it.
     *
     * @param price - The keeper's signed price update for this market's feed.
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
     * - StalePrice (740) if the verified price predates the order, or the
     *   price the position was last marked against.
     * - TriggerNotMet (742) if the order's trigger has not been crossed.
     * - PriceBoundExceeded (741) if the fill price is worse than `priceBound`.
     * - PositionNotFound (720) if a decrease targets an absent position.
     * - PositionLiquidatable (723) if a decrease targets a position whose
     *   settled equity is already below the maintenance margin. Call
     *   `executeLiquidation` instead.
     * - NotionalBelowMinimum (711) if the resulting position falls under the size floor.
     * - VaultInsolvent (755) if a decrease settlement's vault draw exceeds the vault balance.
     * - NotionalAboveMaximum (712) if the resulting position exceeds the size ceiling.
     * - OpenInterestExceeded (715) if the side's open interest would exceed `maxOpenInterest`.
     * - UtilizationExceeded (714) if the reserved value would exceed the utilization cap.
     * - InsufficientMargin (713) if margin falls below the initial-margin
     *   requirement or equity below the maintenance requirement.
     * - NotionalLocked (721) if the close exceeds the position's unlocked notional.
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
     * Force-close the `Position` `(user, isLong)` at a verified price and
     * settle it.
     *
     * Eligible when equity has fallen below the maintenance margin, or
     * regardless of margin health once a `Delisted` market's 7-day delist
     * deadline has passed.
     *
     * @param price - The keeper's signed price update for this market's feed.
     *
     * # Returns
     * - The keeper's payout (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - StalePrice (740) if the verified price is older than the price the
     *   position was last marked against.
     * - NotLiquidatable (722) if equity still covers the maintenance margin
     *   and the wind-down waiver does not apply.
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
     * Recompute both sides' pending PnL at a keeper-verified price and set or
     * clear the `AdlState` flags.
     *
     * A flagged side blocks its increases and is eligible for `executeAdl`.
     *
     * @param price - The keeper's signed price update for this market's feed.
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
     * Deleverage the winning `Position` `(user, isLong)` at a keeper-verified
     * price, reducing its side's pending PnL toward `adlClearTarget` of half
     * the vault balance.
     *
     * Fires only on a side flagged by `updateAdlState`.
     *
     * @param amount - Notional to close (token-dec). Clamped to the whole
     *   position, or to a partial slice that leaves at least the minimum
     *   position size behind.
     * @param price - The keeper's signed price update for this market's feed.
     *
     * # Returns
     * - The keeper's payout: the `keeperRate` cut of the trade fee (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - AdlNotTriggered (770) if the side is not flagged for deleveraging, or
     *   its pending PnL is already at or below `adlClearTarget` of half the
     *   vault balance.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - StalePrice (740) if the effective price is older than the price the
     *   position was last marked against.
     * - AdlNotEligible (772) if the close does not reduce the side's pending PnL.
     * - AdlOvershoot (771) if the close lands the side under the clear
     *   allowance re-measured on the settled vault balance.
     * - PositionLiquidatable (723) if the position's settled equity is
     *   already below the maintenance margin. Call `executeLiquidation`
     *   instead.
     * - InvalidOrder (732) if `amount` is not positive.
     * - VaultInsolvent (755) if the settlement's vault draw exceeds the vault balance.
     * - NotionalLocked (721) or NotionalBelowMinimum (711) from the
     *   underlying decrease.
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
     * Fill the `VaultOrder` `(user, id)` at a keeper-verified price.
     *
     * The whole order fills at once and is removed. The fill deducts the
     * vault fill fee (the `depositFee` or `redeemFee` cut of the moved assets
     * by kind), split between the keeper, the treasury, and the vault.
     *
     * @param price - The keeper's signed price update for this market's feed.
     *
     * # Returns
     * - The keeper's payout: the `keeperRate` cut of the vault fill fee (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - VaultOrderNotFound (750) if no vault order `(user, id)` exists.
     * - StalePrice (740) if the effective price's `publish_time` predates the
     *   order's `createdAt`, or the fill runs in the order's creation ledger.
     * - VaultOrderLocked (751) if a redeem's `redeemLock` cooldown from
     *   `createdAt` has not elapsed.
     * - MinOutNotMet (752) if the fill returns less than the order's `minOut`.
     * - VaultBalanceExceeded (753) if a deposit would push the vault above `maxVaultBalance`.
     * - UtilizationExceeded (714) if a redeem would leave the vault under-reserved.
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
     * to the current timestamp at a keeper-verified price.
     *
     * @param price - The keeper's signed price update for this market's feed.
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
     * Read `user`'s claimable funding balance.
     *
     * # Returns
     * - The funding owed to `user`, `0` if none (token-dec).
     */
    getClaimableFunding(user: string): string {
        return this.call(
            'get_claimable_funding',
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
     * - `undefined` if the market was never delisted. Otherwise
     *   `[terminalPrice, delistedAt]`, with `terminalPrice` at `0` until a
     *   flat settlement price is set (price_scalar units, seconds).
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
    // Ownable
    // ============================================================

    /** Read the current owner. `undefined` means ownership was renounced. */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Start a 2-step ownership transfer to a new address. Owner only.
     *
     * The new owner must call `acceptOwnership` to finish the transfer.
     *
     * @param liveUntilLedger - Last ledger sequence the new owner can accept
     *   by. `0` cancels any pending transfer.
     */
    transferOwnership(newOwner: string, liveUntilLedger: u32): string {
        return this.call(
            'transfer_ownership',
            Address.fromString(newOwner).toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /** Accept a pending ownership transfer. New owner authorizes. */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Renounce ownership of the contract. Owner only.
     *
     * This permanently removes the owner and disables every owner-only method.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }
}
