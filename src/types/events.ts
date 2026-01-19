import { i128, u32, u64 } from './primitives.js';
import { Asset } from './asset.js';
import { MarketConfig, ContractStatus } from './trading.js';

// Contract type enum
export enum ZenexContractType {
    Vault = 'vault',
    Trading = 'trading',
}

// Trading event types (matches Rust events)
export enum TradingEventType {
    SetConfig = 'set_config',
    QueueSetConfig = 'queue_set_config',
    CancelSetConfig = 'cancel_set_config',
    QueueSetMarket = 'queue_set_market',
    CancelSetMarket = 'cancel_set_market',
    SetMarket = 'set_market',
    SetStatus = 'set_status',
    OpenPosition = 'open_position',
    ClosePosition = 'close_position',
    FillPosition = 'fill_position',
    Liquidation = 'liquidation',
    TakeProfit = 'take_profit',
    StopLoss = 'stop_loss',
    CancelPosition = 'cancel_position',
    ModifyRisk = 'modify_risk',
    UpgradeWasm = 'upgrade_wasm',
}

// Vault event types
export enum VaultEventType {
    StrategyWithdraw = 'StrategyWithdraw',
    StrategyDeposit = 'StrategyDeposit',
}

// Base event interface
export interface BaseZenexEvent {
    id: string;
    contractId: string;
    contractType: ZenexContractType;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
}

// Trading Events
export interface BaseTradingEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Trading;
    eventType: TradingEventType;
}

export interface TradingSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetConfig;
    admin: string;
    oracle: string;
    callerTakeRate: i128;
    maxPositions: u32;
}

export interface TradingQueueSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.QueueSetConfig;
    admin: string;
    oracle: string;
    callerTakeRate: i128;
    maxPositions: u32;
    unlockTime: u64;
}

export interface TradingCancelSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelSetConfig;
}

export interface TradingQueueSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.QueueSetMarket;
    admin: string;
    asset: Asset;
    config: MarketConfig;
}

export interface TradingCancelSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelSetMarket;
    asset: Asset;
}

export interface TradingSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetMarket;
    asset: Asset;
}

export interface TradingSetStatusEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetStatus;
    admin: string;
    status: ContractStatus;
}

export interface TradingOpenPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.OpenPosition;
    user: string;
    asset?: Asset;
    positionId: u32;
    collateral: i128;
    leverage: i128;
    isLong: boolean;
    entryPrice: i128;
}

export interface TradingClosePositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClosePosition;
    user: string;
    asset?: Asset;
    positionId: u32;
    pnl: i128;
    fee: i128;
    exitPrice: i128;
}

export interface TradingFillPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.FillPosition;
    user: string;
    asset?: Asset;
    caller: string;
    positionId: u32;
    fillPrice: i128;
    callerFee: i128;
}

export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    user: string;
    asset?: Asset;
    liquidator: string;
    positionId: u32;
    collateral: i128;
    loss: i128;
    liquidatorFee: i128;
}

export interface TradingCancelPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelPosition;
    user: string;
    asset?: Asset;
    positionId: u32;
    collateralReturned: i128;
}

export interface TradingModifyRiskEvent extends BaseTradingEvent {
    eventType: TradingEventType.ModifyRisk;
    user: string;
    positionId: u32;
    stopLoss: i128;
    takeProfit: i128;
}

export interface TradingUpgradeWasmEvent extends BaseTradingEvent {
    eventType: TradingEventType.UpgradeWasm;
    admin: string;
    wasmHash: string;
}

export type TradingEvent =
    | TradingSetConfigEvent
    | TradingQueueSetConfigEvent
    | TradingCancelSetConfigEvent
    | TradingQueueSetMarketEvent
    | TradingCancelSetMarketEvent
    | TradingSetMarketEvent
    | TradingSetStatusEvent
    | TradingOpenPositionEvent
    | TradingClosePositionEvent
    | TradingFillPositionEvent
    | TradingLiquidationEvent
    | TradingCancelPositionEvent
    | TradingModifyRiskEvent
    | TradingUpgradeWasmEvent;

// Vault Events
export interface BaseVaultEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Vault;
    eventType: VaultEventType;
}

export interface VaultStrategyWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.StrategyWithdraw;
    strategy: string;
    amount: i128;
    newNetImpact: i128;
}

export interface VaultStrategyDepositEvent extends BaseVaultEvent {
    eventType: VaultEventType.StrategyDeposit;
    strategy: string;
    amount: i128;
    newNetImpact: i128;
}

export type VaultEvent =
    | VaultStrategyWithdrawEvent
    | VaultStrategyDepositEvent;

// Union of all events
export type ZenexEvent = TradingEvent | VaultEvent;
