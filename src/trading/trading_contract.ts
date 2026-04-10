import { Address, Contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../index.js';

// Contract status enum (matches Rust contract)
export enum ContractStatus {
    Active = 0,     // Full operation - all trading actions allowed
    OnIce = 1,      // Permissionless circuit breaker (PnL threshold)
    AdminOnIce = 2, // Admin-set on ice (only admin can lift)
    Frozen = 3,     // Emergency lockdown - no trading actions allowed
}


// Place limit order arguments
export interface PlaceLimitArgs {
    user: string;
    market_id: u32;
    collateral: i128;
    notional_size: i128;
    is_long: boolean;
    entry_price: i128;
    take_profit: i128;
    stop_loss: i128;
}

// Open market order arguments
export interface OpenMarketArgs {
    user: string;
    market_id: u32;
    collateral: i128;
    notional_size: i128;
    is_long: boolean;
    take_profit: i128;
    stop_loss: i128;
    price: Buffer | Uint8Array;
}

// Set triggers arguments
export interface SetTriggersArgs {
    position_id: u32;
    take_profit: i128;
    stop_loss: i128;
}

// Modify collateral arguments
export interface ModifyCollateralArgs {
    position_id: u32;
    new_collateral: i128;
    price: Buffer | Uint8Array;
}

// Execute arguments
export interface ExecuteArgs {
    caller: string;
    market_id: u32;
    position_ids: u32[];
    price: Buffer | Uint8Array;
}

// Deploy arguments (passed to __constructor)
export interface DeployArgs {
    owner: string;
    token: string;
    vault: string;
    price_verifier: string;
    treasury: string;
    config: TradingConfigArgs;
}

// Trading config arguments (raw i128 values for contract calls)
export interface TradingConfigArgs {
    caller_rate: i128;
    min_notional: i128;
    max_notional: i128;
    fee_dom: i128;
    fee_non_dom: i128;
    max_util: i128;
    r_funding: i128;
    r_base: i128;
    r_var: i128;
}

// Market config arguments (raw i128 values for contract calls)
export interface MarketConfigArgs {
    feed_id: u32;
    enabled: boolean;
    max_util: i128;
    r_var_market: i128;
    margin: i128;
    liq_fee: i128;
    impact: i128;
}

/**
 * TradingContract - Operation builder for the Zenex Trading contract
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class TradingContract extends Contract {
    static readonly parsers = {
        // Admin methods (void)
        setConfig: () => {},
        setMarket: () => {},
        delMarket: () => {},
        setStatus: () => {},
        updateStatus: () => {},
        upgrade: () => {},
        applyFunding: () => {},
        // Ownable methods
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
        // Trading methods
        placeLimit: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        openMarket: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancelPosition: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        closePosition: (result: string): i128 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        modifyCollateral: () => {},
        setTriggers: () => {},
        execute: () => {},
        // View / Getter methods
        getPosition: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getUserPositions: (result: string): u32[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getMarketConfig: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getMarketData: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getMarkets: (result: string): u32[] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getConfig: (result: string) =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getStatus: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getVault: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getPriceVerifier: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getToken: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getTreasury: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
    };

    /**
     * Deploy a new instance of the Trading contract
     * Constructor: __constructor(owner, token, vault, price_verifier, treasury, config)
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
                Address.fromString(args.price_verifier).toScVal(),
                Address.fromString(args.treasury).toScVal(),
                TradingContract.tradingConfigToScVal(args.config),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Owner-only Admin Methods
    // ============================================================

    /**
     * Set the trading configuration (owner only)
     */
    setConfig(config: TradingConfigArgs): string {
        return this.call(
            'set_config',
            TradingContract.tradingConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Add or update a market (owner only)
     * @param marketId - Market identifier
     * @param config - Market configuration (includes feed_id for Pyth price feed)
     */
    setMarket(marketId: u32, config: MarketConfigArgs): string {
        return this.call(
            'set_market',
            xdr.ScVal.scvU32(marketId),
            TradingContract.marketConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Remove a market (owner only)
     * Subtracts remaining OI from total_notional. Existing positions
     * are refunded via closePosition or execute.
     * @param marketId - Market identifier
     */
    delMarket(marketId: u32): string {
        return this.call(
            'del_market',
            xdr.ScVal.scvU32(marketId),
        ).toXDR('base64');
    }

    /**
     * Set the contract status (owner only)
     * Active(0), AdminOnIce(2), Frozen(3). Use updateStatus() for OnIce.
     */
    setStatus(status: u32): string {
        return this.call(
            'set_status',
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    /**
     * Upgrade contract WASM (owner only)
     */
    upgrade(wasmHash: Buffer | Uint8Array, operator: string): string {
        const hashBuffer = wasmHash instanceof Buffer ? wasmHash : Buffer.from(wasmHash);
        return this.call(
            'upgrade',
            xdr.ScVal.scvBytes(hashBuffer),
            Address.fromString(operator).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Ownable Methods
    // ============================================================

    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    transferOwnership(newOwner: Address | string, liveUntilLedger: u32): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    // ============================================================
    // Trading Methods
    // ============================================================

    /**
     * Place a pending limit order
     * Returns position_id
     */
    placeLimit(args: PlaceLimitArgs): string {
        return this.call(
            'place_limit',
            Address.fromString(args.user).toScVal(),
            xdr.ScVal.scvU32(args.market_id),
            nativeToScVal(args.collateral, { type: 'i128' }),
            nativeToScVal(args.notional_size, { type: 'i128' }),
            xdr.ScVal.scvBool(args.is_long),
            nativeToScVal(args.entry_price, { type: 'i128' }),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Open a market order (filled immediately at oracle price)
     * Returns position_id
     */
    openMarket(args: OpenMarketArgs): string {
        const priceBuffer = args.price instanceof Buffer ? args.price : Buffer.from(args.price);
        return this.call(
            'open_market',
            Address.fromString(args.user).toScVal(),
            xdr.ScVal.scvU32(args.market_id),
            nativeToScVal(args.collateral, { type: 'i128' }),
            nativeToScVal(args.notional_size, { type: 'i128' }),
            xdr.ScVal.scvBool(args.is_long),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Cancel a position and refund collateral.
     * Pending: always allowed. Filled: only if market deleted.
     */
    cancelPosition(positionId: u32): string {
        return this.call(
            'cancel_position',
            xdr.ScVal.scvU32(positionId),
        ).toXDR('base64');
    }

    /**
     * Close a filled position
     * Returns pnl (i128)
     */
    closePosition(positionId: u32, price: Buffer | Uint8Array): string {
        const priceBuffer = price instanceof Buffer ? price : Buffer.from(price);
        return this.call(
            'close_position',
            xdr.ScVal.scvU32(positionId),
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Modify collateral on a position
     */
    modifyCollateral(args: ModifyCollateralArgs): string {
        const priceBuffer = args.price instanceof Buffer ? args.price : Buffer.from(args.price);
        return this.call(
            'modify_collateral',
            xdr.ScVal.scvU32(args.position_id),
            nativeToScVal(args.new_collateral, { type: 'i128' }),
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Set take profit and stop loss triggers
     */
    setTriggers(args: SetTriggersArgs): string {
        return this.call(
            'set_triggers',
            xdr.ScVal.scvU32(args.position_id),
            nativeToScVal(args.take_profit, { type: 'i128' }),
            nativeToScVal(args.stop_loss, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Execute keeper triggers (auto-detects: fill, liquidation, SL, TP)
     */
    execute(caller: Address | string, marketId: u32, positionIds: u32[], price: Buffer | Uint8Array): string {
        const callerAddress = typeof caller === 'string'
            ? Address.fromString(caller)
            : caller;

        const idsScVal = xdr.ScVal.scvVec(
            positionIds.map(id => xdr.ScVal.scvU32(id))
        );

        const priceBuffer = price instanceof Buffer ? price : Buffer.from(price);

        return this.call(
            'execute',
            callerAddress.toScVal(),
            xdr.ScVal.scvU32(marketId),
            idsScVal,
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    // ============================================================
    // Permissionless Methods
    // ============================================================

    /**
     * Permissionless status update based on price data (circuit breaker / ADL)
     */
    updateStatus(price: Buffer | Uint8Array): string {
        const priceBuffer = price instanceof Buffer ? price : Buffer.from(price);
        return this.call(
            'update_status',
            xdr.ScVal.scvBytes(priceBuffer),
        ).toXDR('base64');
    }

    /**
     * Apply funding across all markets (permissionless, once per hour)
     */
    applyFunding(): string {
        return this.call('apply_funding').toXDR('base64');
    }

    // ============================================================
    // View / Getter Methods
    // ============================================================

    getPosition(positionId: u32): string {
        return this.call(
            'get_position',
            xdr.ScVal.scvU32(positionId),
        ).toXDR('base64');
    }

    getUserPositions(user: Address | string): string {
        const addr = typeof user === 'string' ? Address.fromString(user) : user;
        return this.call(
            'get_user_positions',
            addr.toScVal(),
        ).toXDR('base64');
    }

    getMarketConfig(marketId: u32): string {
        return this.call(
            'get_market_config',
            xdr.ScVal.scvU32(marketId),
        ).toXDR('base64');
    }

    getMarketData(marketId: u32): string {
        return this.call(
            'get_market_data',
            xdr.ScVal.scvU32(marketId),
        ).toXDR('base64');
    }

    getMarkets(): string {
        return this.call('get_markets').toXDR('base64');
    }

    getConfig(): string {
        return this.call('get_config').toXDR('base64');
    }

    getStatus(): string {
        return this.call('get_status').toXDR('base64');
    }

    getVault(): string {
        return this.call('get_vault').toXDR('base64');
    }

    getPriceVerifier(): string {
        return this.call('get_price_verifier').toXDR('base64');
    }

    getToken(): string {
        return this.call('get_token').toXDR('base64');
    }

    getTreasury(): string {
        return this.call('get_treasury').toXDR('base64');
    }

    // ============================================================
    // Internal Helpers
    // ============================================================

    /** @internal */
    static tradingConfigToScVal(config: TradingConfigArgs): xdr.ScVal {
        // Fields must be in alphabetical order for Soroban struct serialization
        return xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('caller_rate'),
                val: nativeToScVal(config.caller_rate, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('fee_dom'),
                val: nativeToScVal(config.fee_dom, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('fee_non_dom'),
                val: nativeToScVal(config.fee_non_dom, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_notional'),
                val: nativeToScVal(config.max_notional, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_util'),
                val: nativeToScVal(config.max_util, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('min_notional'),
                val: nativeToScVal(config.min_notional, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_base'),
                val: nativeToScVal(config.r_base, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_funding'),
                val: nativeToScVal(config.r_funding, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_var'),
                val: nativeToScVal(config.r_var, { type: 'i128' }),
            }),
        ]);
    }

    /** @internal */
    static marketConfigToScVal(config: MarketConfigArgs): xdr.ScVal {
        // Fields must be in alphabetical order for Soroban struct serialization
        return xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('enabled'),
                val: xdr.ScVal.scvBool(config.enabled),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('feed_id'),
                val: xdr.ScVal.scvU32(config.feed_id),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('impact'),
                val: nativeToScVal(config.impact, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('liq_fee'),
                val: nativeToScVal(config.liq_fee, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('margin'),
                val: nativeToScVal(config.margin, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('max_util'),
                val: nativeToScVal(config.max_util, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('r_var_market'),
                val: nativeToScVal(config.r_var_market, { type: 'i128' }),
            }),
        ]);
    }

}
