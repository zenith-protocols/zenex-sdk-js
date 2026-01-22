import { i128, u32, u64 } from './primitives.js';
import { Asset } from './asset.js';

// Contract status enum (matches Rust contract constants)
export enum ContractStatus {
    Active = 0,  // Full operation - all trading actions allowed
    OnIce = 1,   // Blocks new positions, allows closing/modifying existing positions
    Frozen = 2,  // Emergency lockdown - no trading actions allowed
    Setup = 99,  // Initial setup mode - no trading, config changes immediate
}

// Position status enum (matches Rust contract)
export enum PositionStatus {
    Pending = 'Pending', // Limit order not yet filled
    Open = 'Open',       // Position is open
    Closed = 'Closed',   // Position closed
}

// PnL calculation result
export interface PositionPnL {
    pnl: number;
    interest: number;
    fee: number;
    netPnl: number;
}

// Position data for SDK consumers (descaled)
export interface PositionData {
    id: number;
    user: string;
    status: PositionStatus;
    assetIndex: number;
    isLong: boolean;
    stopLoss: number;
    takeProfit: number;
    entryPrice: number;
    collateral: number;
    notionalSize: number;
    interestIndex: bigint; // Keep as bigint for precision
    createdAt: number;
}

// Trading configuration (matches Rust TradingConfig)
export interface TradingConfigData {
    oracle: string;
    callerTakeRate: number;
    maxPositions: number;
    maxUtilization: number;
}

// Market configuration (matches Rust MarketConfig)
export interface MarketConfig {
    enabled: boolean;
    maxPayout: number;
    minCollateral: number;
    maxCollateral: number;
    initMargin: number;
    maintenanceMargin: number;
    baseFee: number;
    priceImpactScalar: number;
    baseHourlyRate: number; // In SCALAR_18
}

// Market data (matches Rust MarketData)
export interface MarketData {
    longCollateral: number;
    longNotionalSize: number;
    shortCollateral: number;
    shortNotionalSize: number;
    longInterestIndex: bigint;
    shortInterestIndex: bigint;
    lastUpdate: number;
}

// Combined market info
export interface MarketInfo extends MarketConfig, MarketData {
    asset: Asset;
}

// Contract instance storage data
export interface TradingInstanceData {
    name: string | undefined;
    status: number;
    vault: string;
    token: string;
    config: TradingConfigData;
    marketCounter: number;
    positionCounter: number;
}

// Market configuration with asset (matches Rust MarketConfig which now includes asset)
export interface MarketConfigWithAsset extends MarketConfig {
    asset: Asset;
}

// Market mapping: index -> MarketConfig (including asset)
export type MarketMap = Map<number, MarketConfigWithAsset>;

// Execute request types (matches Rust ExecuteRequestType)
export enum ExecuteRequestType {
    Fill = 0,
    StopLoss = 1,
    TakeProfit = 2,
    Liquidate = 3,
}

// Execute request structure (matches Rust ExecuteRequest)
export interface ExecuteRequest {
    request_type: ExecuteRequestType;
    position_id: u32;
}

// Open position arguments (matches contract function)
export interface OpenPositionArgs {
    user: string;
    asset_index: u32;
    collateral: i128;
    notional_size: i128;
    is_long: boolean;
    entry_price: i128;
    take_profit: i128;
    stop_loss: i128;
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
}

// Execute arguments
export interface ExecuteArgs {
    caller: string;
    requests: ExecuteRequest[];
}

// Price data from oracle
export interface PriceData {
    /** The price as a fixed point number with the oracle's decimals */
    price: bigint;
    /** The timestamp of the price in seconds */
    timestamp: number;
}

// Initialize arguments (owner only)
export interface InitializeArgs {
    name: string;
    vault: string;
    config: TradingConfigArgs;
}

// Trading config arguments (raw i128 values for contract calls)
export interface TradingConfigArgs {
    oracle: string;
    caller_take_rate: i128;
    max_positions: u32;
    max_utilization: i128;
}

// Market config arguments (raw i128 values for contract calls)
export interface MarketConfigArgs {
    enabled: boolean;
    max_payout: i128;
    min_collateral: i128;
    max_collateral: i128;
    init_margin: i128;
    maintenance_margin: i128;
    base_fee: i128;
    price_impact_scalar: i128;
    base_hourly_rate: i128;
}

// Queue set market arguments
export interface QueueSetMarketArgs {
    asset: Asset;
    config: MarketConfigArgs;
}
