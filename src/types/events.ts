import { i128, u32, u64 } from './primitives.js';
import { Asset } from './asset.js';
import { MarketConfigWithAsset } from './trading.js';

// Contract type enum
export enum ZenexContractType {
    Vault = 'vault',
    Trading = 'trading',
}

// Trading event types (matches Rust events)
export enum TradingEventType {
    SetConfig = 'SetConfig',
    QueueSetConfig = 'QueueSetConfig',
    CancelSetConfig = 'CancelSetConfig',
    QueueSetMarket = 'QueueSetMarket',
    CancelSetMarket = 'CancelSetMarket',
    SetMarket = 'SetMarket',
    SetStatus = 'SetStatus',
    OpenPosition = 'OpenPosition',
    ClosePosition = 'ClosePosition',
    FillPosition = 'FillPosition',
    Liquidation = 'Liquidation',
    TakeProfit = 'TakeProfit',
    StopLoss = 'StopLoss',
    CancelPosition = 'CancelPosition',
    WithdrawCollateral = 'WithdrawCollateral',
    DepositCollateral = 'DepositCollateral',
    SetTakeProfit = 'SetTakeProfit',
    SetStopLoss = 'SetStopLoss',
}

// Vault event types
export enum VaultEventType {
    StrategyWithdraw = 'StrategyWithdraw',
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
    oracle: string;
    callerTakeRate: i128;
    maxPositions: u32;
}

export interface TradingQueueSetConfigEvent extends BaseTradingEvent {
    eventType: TradingEventType.QueueSetConfig;
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
    asset: Asset;
    config: MarketConfigWithAsset;
}

export interface TradingCancelSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelSetMarket;
    asset: Asset;
}

export interface TradingSetMarketEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetMarket;
    assetIndex: u32;
}

export interface TradingSetStatusEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetStatus;
    status: u32;
}

export interface TradingOpenPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.OpenPosition;
    assetIndex: u32;
    user: string;
    positionId: u32;
}

export interface TradingClosePositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.ClosePosition;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    fee: i128;
}

export interface TradingFillPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.FillPosition;
    assetIndex: u32;
    user: string;
    positionId: u32;
}

export interface TradingLiquidationEvent extends BaseTradingEvent {
    eventType: TradingEventType.Liquidation;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    fee: i128;
}

export interface TradingCancelPositionEvent extends BaseTradingEvent {
    eventType: TradingEventType.CancelPosition;
    assetIndex: u32;
    user: string;
    positionId: u32;
}

export interface TradingTakeProfitEvent extends BaseTradingEvent {
    eventType: TradingEventType.TakeProfit;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    fee: i128;
}

export interface TradingStopLossEvent extends BaseTradingEvent {
    eventType: TradingEventType.StopLoss;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
    fee: i128;
}

export interface TradingWithdrawCollateralEvent extends BaseTradingEvent {
    eventType: TradingEventType.WithdrawCollateral;
    assetIndex: u32;
    user: string;
    positionId: u32;
    amount: i128;
}

export interface TradingDepositCollateralEvent extends BaseTradingEvent {
    eventType: TradingEventType.DepositCollateral;
    assetIndex: u32;
    user: string;
    positionId: u32;
    amount: i128;
}

export interface TradingSetTakeProfitEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetTakeProfit;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
}

export interface TradingSetStopLossEvent extends BaseTradingEvent {
    eventType: TradingEventType.SetStopLoss;
    assetIndex: u32;
    user: string;
    positionId: u32;
    price: i128;
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
    | TradingTakeProfitEvent
    | TradingStopLossEvent
    | TradingCancelPositionEvent
    | TradingWithdrawCollateralEvent
    | TradingDepositCollateralEvent
    | TradingSetTakeProfitEvent
    | TradingSetStopLossEvent;

// Vault Events
export interface BaseVaultEvent extends BaseZenexEvent {
    contractType: ZenexContractType.Vault;
    eventType: VaultEventType;
}

export interface VaultStrategyWithdrawEvent extends BaseVaultEvent {
    eventType: VaultEventType.StrategyWithdraw;
    strategy: string;
    amount: i128;
}

export type VaultEvent = VaultStrategyWithdrawEvent;

// Union of all events
export type ZenexEvent = TradingEvent | VaultEvent;
