import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../index.js';

// =============================================================================
// Type mirrors and ScVal converters for the v2 Trading contract's core types.
//
// Mirrors `zenex-contracts/trading/src/trading/{order,vault_order,position,
// config,market_data,adl,status}.rs`. Field order in the ScVal maps below
// matches `#[contracttype]`'s alphabetical snake_case serialization; unit
// enums without discriminants encode as `scvVec([scvSymbol('<Variant>')])`.
// =============================================================================

/**
 * Contract operational status (instance storage singleton), stored as its
 * `u32` discriminant and crossing the ABI as a plain `u32`.
 */
export enum Status {
    /** Normal trading. */
    Active = 0,
    /** Opens are blocked; everything else keeps running. */
    OnIce = 1,
    /** Every price-bearing and fund-moving path is halted. */
    Frozen = 2,
    /** Wind-down: opens are blocked, revertible within the grace window, force-liquidatable past the deadline. */
    Delisted = 3,
    /** Defunct: only funding claims, direct vault redeems, and cancels remain live. */
    Retired = 4,
}

/**
 * Whether an order grows or shrinks the position; sets the direction of an
 * order's `notional`/`collateral` magnitudes. Encodes as a unit-variant vec.
 */
export enum OrderKind {
    /** Size up; collateral added. */
    Increase = 'Increase',
    /** Size down and/or collateral withdrawn. */
    Decrease = 'Decrease',
}

/**
 * Vault liquidity action requested by the user. Encodes as a unit-variant vec.
 */
export enum VaultOrderKind {
    /** Escrow `amount` assets at creation; mint shares at fill. */
    Deposit = 'Deposit',
    /** Escrow `amount` shares at creation; burn and pay assets at fill. */
    Redeem = 'Redeem',
}

/** i128::MAX; the conventional full-close sentinel for a Decrease order's notional. */
export const FULL_CLOSE: i128 = 2n ** 127n - 1n;

/** A keeper-executed order (temporary storage, keyed `(user, id)`). */
export interface Order {
    /** Side this order targets. */
    isLong: boolean;
    /** Increase or Decrease; sets the delta directions. */
    kind: OrderKind;
    /** Size change magnitude (>= 0), token-dec. */
    notional: i128;
    /** Margin change magnitude (>= 0), token-dec. */
    collateral: i128;
    /** Eligibility on crossing; 0 = none/market (price_scalar). */
    triggerPrice: i128;
    /** Eligible when price >= triggerPrice (true) or <= (false); ignored when triggerPrice == 0. */
    triggerAbove: boolean;
    /** Fill slippage limit (price_scalar); 0 = unbounded. */
    priceBound: i128;
    /** Submission timestamp; per-fill anti-replay anchor. */
    createdAt: u64;
    /** Ledger sequence; eligible while e.ledger().sequence() <= expiration. */
    expiration: u32;
}

/** A pending vault deposit or redeem (persistent storage, keyed `(user, id)`). */
export interface VaultOrder {
    /** Deposit or redeem. */
    kind: VaultOrderKind;
    /** Escrowed assets (deposit) or shares (redeem), token-dec. */
    amount: i128;
    /** Fill bound: max tolerated adverse share mispricing, net pending PnL / vault (SCALAR_18); 0 = unbounded. */
    maxAdversePnl: i128;
    /** Creation timestamp; per-fill anti-replay anchor. */
    createdAt: u64;
    /** Cooldown deadline stamped at creation from the kind's lock. */
    unlocksAt: u64;
}

/** A netted trader position, one per `(user, is_long)` (the storage key). */
export interface Position {
    /** Posted margin, token-dec. */
    collateral: i128;
    /** Size in quote, token-dec. */
    notional: i128;
    /** Size in base, base-dec; entry implied = notional/tokens. */
    tokens: i128;
    /** Funding index snapshot at last change (SCALAR_18). */
    fundingIdx: i128;
    /** Borrowing index snapshot at last change (SCALAR_18). */
    borrowingIdx: i128;
    /** Notional under the decrease lock, token-dec. */
    lockedNotional: i128;
    /** Lock deadline ts; lockedNotional counts while now < unlocksAt. */
    unlocksAt: u64;
    /** Last fill timestamp; force-close price anti-replay anchor. */
    updatedAt: u64;
}

/** A long/short pair of `i128` values, used for per-side open interest, posted collateral, and base size. */
export interface SidePair {
    long: i128;
    short: i128;
}

/** Market state, stored in its own persistent entry. Pool surplus is `fundingPool - fundingOwed`. */
export interface MarketData {
    /** Open interest per side, token-dec. */
    notional: SidePair;
    /** Posted collateral per side, token-dec. */
    collateral: SidePair;
    /** Base size per side = sum(notional/entry), base-dec. */
    tokens: SidePair;
    /** Cumulative funding index per side (SCALAR_18). */
    fundingIdx: SidePair;
    /** Cumulative borrowing index per side (SCALAR_18). */
    borrowingIdx: SidePair;
    /** Signed funding rate, + = longs pay (SCALAR_18, per second). */
    fundingRate: i128;
    /** Last funding accrual timestamp. */
    fundingUpdate: u64;
    /** Last borrowing accrual timestamp (independent of funding). */
    borrowingUpdate: u64;
    /** Internal funding pool, token-dec. */
    fundingPool: i128;
    /** Total funding owed to traders, token-dec. */
    fundingOwed: i128;
}

/** ADL state (instance storage singleton): the per-side enable flags driving the open-stop. */
export interface AdlState {
    /** Long-side ADL enabled: long increases blocked. */
    long: boolean;
    /** Short-side ADL enabled: short increases blocked. */
    short: boolean;
}

/**
 * Global trading parameters (instance storage singleton), mutable via the
 * owner-only `set_config`. Rates are per-second (GMX parity).
 */
export interface TradingConfig {
    /** Keeper share of trade and vault fill fees (SCALAR_18). */
    keeperRate: i128;
    /** Minimum position notional, token-dec. */
    minPositionNotional: i128;
    /** Maximum position notional, token-dec. */
    maxPositionNotional: i128;
    /** Per-side open-interest ceiling, token-dec; >= maxPositionNotional. */
    maxOpenInterest: i128;
    /** Minimum |notional| per order, token-dec (dust floor); <= minPositionNotional. */
    minOrderNotional: i128;
    /** Minimum |collateral| per order, token-dec (dust floor). */
    minOrderCollateral: i128;
    /** Dominant-side trade fee (SCALAR_18). */
    feeDom: i128;
    /** Non-dominant trade fee (SCALAR_18). */
    feeNonDom: i128;
    /** Impact fee = notional / impactDivisor (SCALAR_18); worsening leg only. */
    impactDivisor: i128;
    /** Opens blocked above this; also the borrow-reserve denominator (SCALAR_18; util = open interest / vault). */
    maxUtilOpen: i128;
    /** Withdrawals blocked above this; retains min vault liquidity, >= maxUtilOpen (SCALAR_18). */
    maxUtilWithdraw: i128;
    /** Initial margin; max leverage = 1/initMargin (SCALAR_18). */
    initMargin: i128;
    /** Hard liquidation floor, < initMargin (SCALAR_18). */
    maintenanceMargin: i128;
    /** Liquidation fee (SCALAR_18). */
    liqFee: i128;
    /** Decrease lock on newly added notional, seconds. */
    notionalLock: u64;
    /** Kink utilization on the normalized [0,1] reserve curve (SCALAR_18); < 1. */
    targetUtil: i128;
    /** Borrowing-rate slope: rate = borrowRate * utilization below the kink (SCALAR_18, per second). */
    borrowRate: i128;
    /** Borrowing rate at full utilization (SCALAR_18, per second); in [borrowRate, MAX_BORROW_RATE]. */
    increasedBorrowRate: i128;
    /** Velocity acceleration as skew widens (SCALAR_18, per second^2). */
    fundingIncrease: i128;
    /** Velocity decay inside the decay band (SCALAR_18, per second^2). */
    fundingDecrease: i128;
    /** Skew band within which the rate holds (SCALAR_18). */
    thresholdStableFunding: i128;
    /** Skew band within which the rate decays (SCALAR_18), <= thresholdStableFunding. */
    thresholdDecreaseFunding: i128;
    /** Charged-rate floor (SCALAR_18, per second). */
    fundingMin: i128;
    /** Saved-rate hard cap (SCALAR_18, per second). */
    fundingMax: i128;
    /** ADL trigger: side pending PnL / (vault / 2) that arms the side; in [MIN_ADL_TRIGGER, maxPnlTrader], < 1 (SCALAR_18). */
    adlMaxPnl: i128;
    /** ADL clear target on the same measure; in [MIN_ADL_CLEAR, adlMaxPnl] (SCALAR_18). */
    adlClearTarget: i128;
    /** Realized-profit haircut threshold: while side pending PnL exceeds this fraction of half the vault, close payouts scale by allowance / side PnL, < 1 (SCALAR_18). */
    maxPnlTrader: i128;
    /** Redeem cooldown from a vault order's createdAt, seconds. */
    redeemLock: u64;
    /** Deposit cooldown from a vault order's createdAt, seconds; waived while pending losses sit at or under instantDepositPnl. */
    depositLock: u64;
    /** Share underpricing (net pending trader loss / vault) at or under which a deposit fills without the cooldown; <= maxPnlDeposit (SCALAR_18). */
    instantDepositPnl: i128;
    /** Vault fill fee rate on moved assets (SCALAR_18). */
    vaultFee: i128;
    /** Minimum assets per vault order fill, token-dec. */
    minDeposit: i128;
    /** Deposit fills blocked while share underpricing (net pending trader loss / vault) exceeds this, < 1 (SCALAR_18). */
    maxPnlDeposit: i128;
    /** Redeem fills blocked while share overpricing (net pending trader profit / post-redeem vault) exceeds this, < 1 (SCALAR_18). */
    maxPnlWithdraw: i128;
    /** Vault balance ceiling enforced on deposit fills, token-dec. */
    maxVaultBalance: i128;
}

// =============================================================================
// Converters: TS -> ScVal
// =============================================================================

/** Encode a unit-variant `OrderKind` as `scvVec([scvSymbol(kind)])`. */
export function orderKindToScVal(kind: OrderKind): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(kind)]);
}

/** Encode a unit-variant `VaultOrderKind` as `scvVec([scvSymbol(kind)])`. */
export function vaultOrderKindToScVal(kind: VaultOrderKind): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(kind)]);
}

/** Encode a `TradingConfig` as an alphabetically key-ordered `ScMap`. */
export function tradingConfigToScVal(config: TradingConfig): xdr.ScVal {
    const entry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    const i128Val = (v: i128) => nativeToScVal(v, { type: 'i128' });
    const u64Val = (v: u64) => nativeToScVal(v, { type: 'u64' });
    return xdr.ScVal.scvMap([
        entry('adl_clear_target', i128Val(config.adlClearTarget)),
        entry('adl_max_pnl', i128Val(config.adlMaxPnl)),
        entry('borrow_rate', i128Val(config.borrowRate)),
        entry('deposit_lock', u64Val(config.depositLock)),
        entry('fee_dom', i128Val(config.feeDom)),
        entry('fee_non_dom', i128Val(config.feeNonDom)),
        entry('funding_decrease', i128Val(config.fundingDecrease)),
        entry('funding_increase', i128Val(config.fundingIncrease)),
        entry('funding_max', i128Val(config.fundingMax)),
        entry('funding_min', i128Val(config.fundingMin)),
        entry('impact_divisor', i128Val(config.impactDivisor)),
        entry('increased_borrow_rate', i128Val(config.increasedBorrowRate)),
        entry('init_margin', i128Val(config.initMargin)),
        entry('instant_deposit_pnl', i128Val(config.instantDepositPnl)),
        entry('keeper_rate', i128Val(config.keeperRate)),
        entry('liq_fee', i128Val(config.liqFee)),
        entry('maintenance_margin', i128Val(config.maintenanceMargin)),
        entry('max_open_interest', i128Val(config.maxOpenInterest)),
        entry('max_pnl_deposit', i128Val(config.maxPnlDeposit)),
        entry('max_pnl_trader', i128Val(config.maxPnlTrader)),
        entry('max_pnl_withdraw', i128Val(config.maxPnlWithdraw)),
        entry('max_position_notional', i128Val(config.maxPositionNotional)),
        entry('max_util_open', i128Val(config.maxUtilOpen)),
        entry('max_util_withdraw', i128Val(config.maxUtilWithdraw)),
        entry('max_vault_balance', i128Val(config.maxVaultBalance)),
        entry('min_deposit', i128Val(config.minDeposit)),
        entry('min_order_collateral', i128Val(config.minOrderCollateral)),
        entry('min_order_notional', i128Val(config.minOrderNotional)),
        entry('min_position_notional', i128Val(config.minPositionNotional)),
        entry('notional_lock', u64Val(config.notionalLock)),
        entry('redeem_lock', u64Val(config.redeemLock)),
        entry('target_util', i128Val(config.targetUtil)),
        entry('threshold_decrease_funding', i128Val(config.thresholdDecreaseFunding)),
        entry('threshold_stable_funding', i128Val(config.thresholdStableFunding)),
        entry('vault_fee', i128Val(config.vaultFee)),
    ]);
}

// =============================================================================
// Parsers: scValToNative output (snake_case) -> camelCase interface
// =============================================================================

/** Coerce a decoded numeric (already `bigint`, or occasionally `number`) to `bigint`. */
function big(v: unknown): bigint {
    return typeof v === 'bigint' ? v : BigInt(v as number);
}

/** Map a decoded `SidePair` (field names are already `long`/`short`, no case change). */
function toSidePair(v: Record<string, unknown>): SidePair {
    return { long: big(v.long), short: big(v.short) };
}

/** Parse a `scValToNative`-decoded `Order` into its camelCase interface. */
export function parseOrder(raw: Record<string, unknown>): Order {
    return {
        isLong: raw.is_long as boolean,
        kind: raw.kind as OrderKind,
        notional: big(raw.notional),
        collateral: big(raw.collateral),
        triggerPrice: big(raw.trigger_price),
        triggerAbove: raw.trigger_above as boolean,
        priceBound: big(raw.price_bound),
        createdAt: big(raw.created_at),
        expiration: Number(raw.expiration),
    };
}

/** Parse a `scValToNative`-decoded `VaultOrder` into its camelCase interface. */
export function parseVaultOrder(raw: Record<string, unknown>): VaultOrder {
    return {
        kind: raw.kind as VaultOrderKind,
        amount: big(raw.amount),
        maxAdversePnl: big(raw.max_adverse_pnl),
        createdAt: big(raw.created_at),
        unlocksAt: big(raw.unlocks_at),
    };
}

/** Parse a `scValToNative`-decoded `Position` into its camelCase interface. */
export function parsePosition(raw: Record<string, unknown>): Position {
    return {
        collateral: big(raw.collateral),
        notional: big(raw.notional),
        tokens: big(raw.tokens),
        fundingIdx: big(raw.funding_idx),
        borrowingIdx: big(raw.borrowing_idx),
        lockedNotional: big(raw.locked_notional),
        unlocksAt: big(raw.unlocks_at),
        updatedAt: big(raw.updated_at),
    };
}

/** Parse a `scValToNative`-decoded `MarketData` into its camelCase interface. */
export function parseMarketData(raw: Record<string, unknown>): MarketData {
    return {
        notional: toSidePair(raw.notional as Record<string, unknown>),
        collateral: toSidePair(raw.collateral as Record<string, unknown>),
        tokens: toSidePair(raw.tokens as Record<string, unknown>),
        fundingIdx: toSidePair(raw.funding_idx as Record<string, unknown>),
        borrowingIdx: toSidePair(raw.borrowing_idx as Record<string, unknown>),
        fundingRate: big(raw.funding_rate),
        fundingUpdate: big(raw.funding_update),
        borrowingUpdate: big(raw.borrowing_update),
        fundingPool: big(raw.funding_pool),
        fundingOwed: big(raw.funding_owed),
    };
}

/** Parse a `scValToNative`-decoded `AdlState` into its camelCase interface. */
export function parseAdlState(raw: Record<string, unknown>): AdlState {
    return {
        long: raw.long as boolean,
        short: raw.short as boolean,
    };
}

/** Parse a `scValToNative`-decoded `Config` into its camelCase `TradingConfig`. */
export function parseTradingConfig(raw: Record<string, unknown>): TradingConfig {
    return {
        keeperRate: big(raw.keeper_rate),
        minPositionNotional: big(raw.min_position_notional),
        maxPositionNotional: big(raw.max_position_notional),
        maxOpenInterest: big(raw.max_open_interest),
        minOrderNotional: big(raw.min_order_notional),
        minOrderCollateral: big(raw.min_order_collateral),
        feeDom: big(raw.fee_dom),
        feeNonDom: big(raw.fee_non_dom),
        impactDivisor: big(raw.impact_divisor),
        maxUtilOpen: big(raw.max_util_open),
        maxUtilWithdraw: big(raw.max_util_withdraw),
        initMargin: big(raw.init_margin),
        maintenanceMargin: big(raw.maintenance_margin),
        liqFee: big(raw.liq_fee),
        notionalLock: big(raw.notional_lock),
        targetUtil: big(raw.target_util),
        borrowRate: big(raw.borrow_rate),
        increasedBorrowRate: big(raw.increased_borrow_rate),
        fundingIncrease: big(raw.funding_increase),
        fundingDecrease: big(raw.funding_decrease),
        thresholdStableFunding: big(raw.threshold_stable_funding),
        thresholdDecreaseFunding: big(raw.threshold_decrease_funding),
        fundingMin: big(raw.funding_min),
        fundingMax: big(raw.funding_max),
        adlMaxPnl: big(raw.adl_max_pnl),
        adlClearTarget: big(raw.adl_clear_target),
        maxPnlTrader: big(raw.max_pnl_trader),
        redeemLock: big(raw.redeem_lock),
        depositLock: big(raw.deposit_lock),
        instantDepositPnl: big(raw.instant_deposit_pnl),
        vaultFee: big(raw.vault_fee),
        minDeposit: big(raw.min_deposit),
        maxPnlDeposit: big(raw.max_pnl_deposit),
        maxPnlWithdraw: big(raw.max_pnl_withdraw),
        maxVaultBalance: big(raw.max_vault_balance),
    };
}
