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

// =============================================================================
// Argument interfaces
// =============================================================================

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

/** Coerce a `Buffer | Uint8Array` price update into a `Buffer` for `scvBytes`. */
function priceBuffer(price: Buffer | Uint8Array): Buffer {
    return price instanceof Buffer ? price : Buffer.from(price);
}

/** Coerce a 32-byte feed id into a `Buffer` for `scvBytes` (`BytesN<32>`). */
function feedIdBuffer(feedId: Buffer | Uint8Array): Buffer {
    if (feedId.length !== 32) {
        throw new Error(`feedId must be 32 bytes, got ${feedId.length}`);
    }
    return feedId instanceof Buffer ? feedId : Buffer.from(feedId);
}

/**
 * TradingContract - Operation builder for the Zenex Trading contract
 * (order -> keeper-execute flow, single market per contract instance).
 *
 * All methods return base64-encoded XDR operations for transaction building.
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
     * Deploy a new instance of the Trading contract.
     *
     * Constructor: `__constructor(owner, token, vault, oracle, treasury,
     * feed_id, config)`. `MarketData` starts zeroed with its accrual
     * timestamps at `now`; status starts `Status::Active`.
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
     * Replace the global trading configuration.
     *
     * A borrowing-param change requires a same-ledger `accrue`, waived while
     * `Status::Frozen`: the first accrual at unfreeze then prices the entire
     * frozen window at the new rates. Owner only.
     *
     * # Errors
     * - InvalidConfig (700) if a bound or range check fails.
     * - NegativeValueNotAllowed (710) if any rate, fee, or margin is negative.
     * - MarketNotAccrued (703) if a borrowing or funding rate param changed
     *   without a same-ledger accrual (waived while `Status::Frozen`).
     */
    setConfig(config: TradingConfig): string {
        return this.call(
            'set_config',
            tradingConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Set the contract operational status.
     *
     * Transition validity follows the `Status` lifecycle. Entering
     * `Status::Retired` sweeps the funding-pool surplus to the vault. Owner only.
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
     * Set or refresh the flat settlement price of a delisted market.
     *
     * Settable only once the delist grace window has expired. Owner only.
     *
     * # Errors
     * - InvalidStatus (702) unless the status is `Status::Delisted` and the
     *   grace window has expired.
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
     * Create an `Order` for the keeper to fill.
     *
     * The escrow moves by direct `token.transfer` inside this user-authorized
     * call: an increase kind escrows `margin + execFee`, a decrease kind
     * escrows the `execFee` alone. The `execFee` (read from config) pays the
     * keeper on execution and refunds on cancel or on the position closing.
     * A decrease's `notional` above the position size clamps to a full close
     * at fill (`FULL_CLOSE` signals a full close).
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
     *   dust floor, or a limit/stop kind carries a non-positive `triggerPrice`.
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
     * Build the `create_order` invocation as a `Call` (contract, func, args),
     * for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `createOrder`, so a bundled order is
     * byte-identical to a direct one; the only difference is the router
     * executes it (and the user's auth entry nests under the router call).
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
     * Cancel a pending `Order` the caller owns and refund its escrow.
     *
     * # Returns
     * - The refunded escrow: an increase's margin plus its `execFee`, a
     *   decrease's `execFee` (token-dec).
     *
     * # Errors
     * - OrderNotFound (730) if no order `(user, id)` exists.
     */
    cancelOrder(user: string, id: u32): string {
        const call = this.cancelOrderCall(user, id);
        return this.call(call.func, ...call.args).toXDR('base64');
    }

    /**
     * Build the `cancel_order` invocation as a `Call` (contract, func, args),
     * for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `cancelOrder`, so a bundled cancel is
     * byte-identical to a direct one; the only difference is the router
     * executes it (and the user's auth entry nests under the router call).
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
     * Create a `VaultOrder` for the keeper to fill; the deposit assets or
     * redeem shares (plus the `execFee` in the settlement token) are escrowed
     * in the trading contract at creation.
     *
     * On a `Status::Retired` market a redeem skips the order and executes
     * immediately: the vault burns the shares and pays the assets straight
     * out; `minOut` is not applied on this path.
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
     * Build the `create_vault_order` invocation as a `Call` (contract, func,
     * args), for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `createVaultOrder`, so a bundled
     * deposit or redeem is byte-identical to a direct one.
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
     * Cancel a pending `VaultOrder` the caller owns and pay back the escrowed
     * assets or shares.
     *
     * # Returns
     * - The escrowed principal paid back: assets for a deposit (token-dec) or
     *   shares for a redeem (share decimals).
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
     * Build the `cancel_vault_order` invocation as a `Call` (contract, func,
     * args), for batching under the trading-router's `multicall`.
     *
     * Shares its argument encoding with `cancelVaultOrder`, so a bundled
     * cancel is byte-identical to a direct one.
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
     * # Returns
     * - The keeper's payout (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - OrderNotFound (730) if no order `(user, id)` exists.
     * - IncreaseHalted (705) if a size-growing increase runs while the status
     *   does not accept opens or the target side has ADL enabled.
     * - OrderExpired (731) if the order expired before the fill.
     * - StalePrice (740) if the verified price predates the order.
     * - TriggerNotMet (742) if the order's trigger has not been crossed.
     * - PriceBoundExceeded (741) if the fill price is worse than `priceBound`.
     * - PositionNotFound (720) if a decrease targets an absent position.
     * - NotionalBelowMinimum (711) if the resulting position falls under the size floor.
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
     * # Returns
     * - The keeper's payout: the `keeperRate` cut of the trade fee (token-dec).
     *
     * # Errors
     * - MarketFrozen (704) if the market status is `Frozen` or `Retired`.
     * - AdlNotTriggered (770) if the side is not flagged for deleveraging, or
     *   its pending PnL is already at or below `adlClearTarget`.
     * - PositionNotFound (720) if no position exists for `(user, isLong)`.
     * - StalePrice (740) if the verified price is older than the newest price
     *   the market has consumed, or than the price the position was last
     *   marked against.
     * - AdlNotEligible (772) if the close does not reduce the side's pending PnL.
     * - AdlOvershoot (771) if the close lands the side under the clear
     *   allowance re-measured on the settled vault balance.
     * - InvalidOrder (732) if `amount` is not positive.
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

    /** Read the trading configuration. */
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
     * - The stored `Order` row. The read extends the entry's TTL when
     *   submitted on-chain; a simulated call leaves no footprint.
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
     *   submitted on-chain; a simulated call leaves no footprint.
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
     * - The next order id; ids `1..counter` have been allocated, shared by
     *   trade and vault orders (`1` = none yet).
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
     * - `undefined` while the market has never been delisted; otherwise
     *   `[terminalPrice, delistedAt]`, with `terminalPrice` `0` until a flat
     *   settlement price is set (price_scalar units, seconds).
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

    /**
     * Returns the current owner, or `undefined` if ownership has been
     * renounced.
     */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Initiates a 2-step ownership transfer to a new address.
     *
     * Requires authorization from the current owner. The new owner must
     * later call `acceptOwnership()` to complete the transfer.
     *
     * `liveUntilLedger`: ledger number until which the new owner can accept.
     * `0` cancels any pending transfer.
     */
    transferOwnership(newOwner: string, liveUntilLedger: u32): string {
        return this.call(
            'transfer_ownership',
            Address.fromString(newOwner).toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /** Accepts a pending ownership transfer. */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Renounces ownership of the contract.
     *
     * Permanently removes the owner, disabling all owner-only functions.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }
}
