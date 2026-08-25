import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../../index.js';

/** Contract operational status (instance storage singleton). */
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
 * The intent of a keeper order: increase or decrease, and how it becomes
 * eligible, immediately or on a price crossing.
 */
export enum OrderKind {
    /** Grow the position now; `triggerPrice` is unused. */
    MarketIncrease = 0,
    /** Grow the position when the price crosses `triggerPrice` favorably. */
    LimitIncrease = 1,
    /** Grow the position when the price crosses `triggerPrice` adversely. */
    StopIncrease = 2,
    /** Shrink the position now; `triggerPrice` is unused. */
    MarketDecrease = 3,
    /** Take profit: shrink the position when the price crosses `triggerPrice` favorably. */
    LimitDecrease = 4,
    /** Stop loss: shrink the position when the price crosses `triggerPrice` adversely. */
    StopDecrease = 5,
}

/** Vault liquidity action requested by the user. */
export enum VaultOrderKind {
    /** Escrow `amount` assets at creation; mint shares at fill. */
    Deposit = 0,
    /** Escrow `amount` shares at creation; burn and pay assets at fill. */
    Redeem = 1,
}

/** i128::MAX; the conventional full-close sentinel for a decrease order's notional. */
export const FULL_CLOSE: i128 = 2n ** 127n - 1n;

/** Maximum pending decrease orders per side; the 9th push traps `TooManyOrders` (733). */
export const MAX_ORDERS_PER_SIDE = 8;

/**
 * A keeper-executed order (persistent user-tier storage, keyed `(user, id)`).
 *
 * `kind` sets both the size direction and the eligibility rule;
 * `notional`/`margin` are non-negative magnitudes. The `margin` (for
 * an increase) and the `execFee` are escrowed in the contract at creation.
 */
export interface Order {
    /** Side this order targets. */
    isLong: boolean;
    /** This order's kind. See `OrderKind`. */
    kind: OrderKind;
    /** Size change magnitude (>= 0), token-dec. */
    notional: i128;
    /** Margin change magnitude (>= 0), token-dec. */
    margin: i128;
    /** Crossing level for a trigger kind (price_scalar); unread for a market kind. */
    triggerPrice: i128;
    /** Fill slippage limit (price_scalar); 0 = unbounded. */
    priceBound: i128;
    /** Keeper execution fee escrowed at creation, token-dec. */
    execFee: i128;
    /** Submission timestamp, unix seconds; per-fill anti-replay anchor. */
    createdAt: u64;
    /** Ledger sequence; eligible while the current sequence <= expiration. */
    expiration: u32;
}

/** A pending vault deposit or redeem (persistent storage, keyed `(user, id)`). */
export interface VaultOrder {
    /** This order's kind. See `VaultOrderKind`. */
    kind: VaultOrderKind;
    /** Escrowed assets (deposit, token-dec) or shares (redeem, vault share decimals = asset decimals + decimalsOffset). */
    amount: i128;
    /** Minimum received at fill, net of the vault fee: shares (deposit, share-dec) or assets (redeem, token-dec); 0 = unset. */
    minOut: i128;
    /** Keeper execution fee escrowed at creation, token-dec. */
    execFee: i128;
    /** Creation timestamp, unix seconds. A fill needs a publish_time at or after it and a later ledger; a redeem also needs the redeemLock cooldown to pass. */
    createdAt: u64;
}

/** A netted trader position, one per `(user, is_long)` (the storage key). */
export interface Position {
    /** Posted margin, token-dec. */
    margin: i128;
    /** Size in quote, token-dec. */
    notional: i128;
    /** Size in base, base-dec. Not SCALAR_18: `to_tokens` floors a token-dec notional divided by a price_scalar price. Entry price is `notional / tokens`. */
    tokens: i128;
    /** Funding index snapshot at last change (SCALAR_18). */
    fundingIdx: i128;
    /** Borrowing index snapshot at last change (SCALAR_18). */
    borrowingIdx: i128;
    /** Notional under the decrease lock, token-dec. */
    lockedNotional: i128;
    /** Lock deadline, unix seconds; lockedNotional counts while now < unlocksAt. */
    unlocksAt: u64;
    /** publish_time of the last fill's price, unix seconds; force-close anti-replay floor. */
    pricedAt: u64;
    /** Pending decrease order ids on the side, max `MAX_ORDERS_PER_SIDE`; cleared when the position closes. */
    decreaseOrders: u32[];
}

/** A long/short pair of `i128` values, used for per-side open interest, posted margin, and base size. */
export interface SidePair {
    /** Long-side value; unit and scale match the containing field (e.g. token-dec, SCALAR_18). */
    long: i128;
    /** Short-side value; unit and scale match the containing field (e.g. token-dec, SCALAR_18). */
    short: i128;
}

/** Market state, stored in its own persistent entry. Pool surplus is `creditPool - creditOwed`. */
export interface MarketData {
    /** Open interest per side, token-dec. */
    notional: SidePair;
    /** Posted margin per side, token-dec. */
    margin: SidePair;
    /** Base size per side = sum(notional/entry), base-dec. */
    tokens: SidePair;
    /** Cumulative funding index per side (SCALAR_18). */
    fundingIdx: SidePair;
    /** Cumulative borrowing index per side (SCALAR_18). */
    borrowingIdx: SidePair;
    /** Signed funding rate, + = longs pay (SCALAR_18, per second). */
    fundingRate: i128;
    /** Last accrual timestamp, unix seconds, shared by both indices. */
    accruedAt: u64;
    /** Internal claimable-credit pool, including parked failed payouts, token-dec. */
    creditPool: i128;
    /** Total funding and parked failed payouts owed to traders, token-dec. */
    creditOwed: i128;
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
 * owner-only `set_config`. Rates are per second.
 */
export interface MarketConfig {
    /** Keeper share of trade and vault fill fees, up to 50% (SCALAR_18). */
    keeperRate: i128;
    /** Minimum position notional, token-dec; > 0. */
    minPositionNotional: i128;
    /** Maximum position notional, token-dec; > minPositionNotional. */
    maxPositionNotional: i128;
    /** Per-side open-interest ceiling, token-dec; >= maxPositionNotional. */
    maxOpenInterest: i128;
    /** Minimum |notional| per order, token-dec (dust floor); > 0 and <= minPositionNotional. */
    minOrderNotional: i128;
    /** Minimum |margin| per order, token-dec (dust floor); > 0. */
    minOrderMargin: i128;
    /** Flat keeper execution fee charged per order at creation, token-dec; <= minOrderMargin. */
    execFee: i128;
    /** Dominant-side trade fee, up to 1% (SCALAR_18); >= feeNonDom. */
    feeDom: i128;
    /** Non-dominant trade fee, up to 1% (SCALAR_18); <= feeDom. */
    feeNonDom: i128;
    /** Impact-fee divisor, token-dec. Fee = `notional * min(notional / impactScalar, MAX_IMPACT_RATE)` on every fill; floored so a minPositionNotional chunk pays at most 0.1%. */
    impactScalar: i128;
    /** Opens blocked above this, in (0, 1000%]; also each side's borrow-reserve denominator (SCALAR_18; util = open interest / vault). */
    maxUtilOpen: i128;
    /** Withdrawals blocked above this; retains min vault liquidity, in [maxUtilOpen, 1000%] (SCALAR_18). */
    maxUtilWithdraw: i128;
    /** Initial margin; max leverage = 1/initMargin. In [0.1%, 50%] and > maintenanceMargin (SCALAR_18). */
    initMargin: i128;
    /** Hard liquidation floor; > liqFee and < initMargin (SCALAR_18). */
    maintenanceMargin: i128;
    /** Liquidation fee rate, charged on every liquidation as min(equity, ceil(liqFee * notional)); up to 25% and < maintenanceMargin (SCALAR_18). */
    liqFee: i128;
    /** Decrease lock on newly added notional, seconds; in [15, 86400] (1 day max). */
    notionalLock: u64;
    /** Kink utilization on the normalized [0,1] reserve curve (SCALAR_18); < 1. */
    targetUtil: i128;
    /** Borrowing-rate slope: rate = borrowRate * utilization below the kink (SCALAR_18, per second); <= increasedBorrowRate. */
    borrowRate: i128;
    /** Borrowing rate at full utilization (SCALAR_18, per second); in [borrowRate, 1000% APR]. */
    increasedBorrowRate: i128;
    /** Velocity acceleration as skew widens (SCALAR_18, per second^2); up to 1000% APR. */
    fundingIncrease: i128;
    /** Velocity decay inside the decay band (SCALAR_18, per second^2); up to 1000% APR. */
    fundingDecrease: i128;
    /** Skew band within which the rate holds (SCALAR_18); <= 100%. */
    thresholdStableFunding: i128;
    /** Skew band within which the rate decays (SCALAR_18), <= thresholdStableFunding. */
    thresholdDecreaseFunding: i128;
    /** Charged-rate floor (SCALAR_18, per second); <= fundingMax. */
    fundingMin: i128;
    /** Saved-rate hard cap (SCALAR_18, per second); up to 1000% APR. */
    fundingMax: i128;
    /** ADL trigger: side pending PnL / (vault / 2) that arms the side; in [MIN_ADL_TRIGGER, maxPnlTrader], < 1 (SCALAR_18). */
    adlMaxPnl: i128;
    /** ADL clear target on the same measure; in [MIN_ADL_CLEAR, adlMaxPnl] (SCALAR_18). */
    adlClearTarget: i128;
    /** Realized-profit haircut threshold: while side pending PnL exceeds this fraction of half the vault, close payouts scale by allowance / side PnL. >= adlMaxPnl and < 1 (SCALAR_18). */
    maxPnlTrader: i128;
    /** Redeem gate: redeems blocked while a side's pending PnL exceeds this fraction of half the post-redeem balance; in (0, adlMaxPnl] (SCALAR_18). */
    maxPnlWithdraw: i128;
    /** Redeem cooldown from a vault order's createdAt, seconds; up to 2,592,000 (30 days). 0 = fill as soon as a post-creation price exists. */
    redeemLock: u64;
    /** Deposit fill fee rate on moved assets (SCALAR_18); up to 1%. */
    depositFee: i128;
    /** Redeem fill fee rate on moved assets (SCALAR_18); up to 1%. */
    redeemFee: i128;
    /** Minimum assets per vault order fill, token-dec; > 0 and <= maxVaultBalance / 100. */
    minDeposit: i128;
    /** Vault balance ceiling enforced on deposit fills, token-dec; > 0. */
    maxVaultBalance: i128;
}

/** Encode a `MarketConfig` for the `deploy` constructor or `set_config` call. */
export function marketConfigToScVal(config: MarketConfig): xdr.ScVal {
    const entry = (key: string, val: xdr.ScVal) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    const i128Val = (v: i128) => nativeToScVal(v, { type: 'i128' });
    const u64Val = (v: u64) => nativeToScVal(v, { type: 'u64' });
    return xdr.ScVal.scvMap([
        entry('adl_clear_target', i128Val(config.adlClearTarget)),
        entry('adl_max_pnl', i128Val(config.adlMaxPnl)),
        entry('borrow_rate', i128Val(config.borrowRate)),
        entry('deposit_fee', i128Val(config.depositFee)),
        entry('exec_fee', i128Val(config.execFee)),
        entry('fee_dom', i128Val(config.feeDom)),
        entry('fee_non_dom', i128Val(config.feeNonDom)),
        entry('funding_decrease', i128Val(config.fundingDecrease)),
        entry('funding_increase', i128Val(config.fundingIncrease)),
        entry('funding_max', i128Val(config.fundingMax)),
        entry('funding_min', i128Val(config.fundingMin)),
        entry('impact_scalar', i128Val(config.impactScalar)),
        entry('increased_borrow_rate', i128Val(config.increasedBorrowRate)),
        entry('init_margin', i128Val(config.initMargin)),
        entry('keeper_rate', i128Val(config.keeperRate)),
        entry('liq_fee', i128Val(config.liqFee)),
        entry('maintenance_margin', i128Val(config.maintenanceMargin)),
        entry('max_open_interest', i128Val(config.maxOpenInterest)),
        entry('max_pnl_trader', i128Val(config.maxPnlTrader)),
        entry('max_pnl_withdraw', i128Val(config.maxPnlWithdraw)),
        entry('max_position_notional', i128Val(config.maxPositionNotional)),
        entry('max_util_open', i128Val(config.maxUtilOpen)),
        entry('max_util_withdraw', i128Val(config.maxUtilWithdraw)),
        entry('max_vault_balance', i128Val(config.maxVaultBalance)),
        entry('min_deposit', i128Val(config.minDeposit)),
        entry('min_order_margin', i128Val(config.minOrderMargin)),
        entry('min_order_notional', i128Val(config.minOrderNotional)),
        entry('min_position_notional', i128Val(config.minPositionNotional)),
        entry('notional_lock', u64Val(config.notionalLock)),
        entry('redeem_fee', i128Val(config.redeemFee)),
        entry('redeem_lock', u64Val(config.redeemLock)),
        entry('target_util', i128Val(config.targetUtil)),
        entry('threshold_decrease_funding', i128Val(config.thresholdDecreaseFunding)),
        entry('threshold_stable_funding', i128Val(config.thresholdStableFunding)),
    ]);
}

/** Coerce a decoded numeric (already `bigint`, or occasionally `number`) to `bigint`. */
function big(v: unknown): bigint {
    return typeof v === 'bigint' ? v : BigInt(v as number);
}

/** Parse a `scValToNative`-decoded `SidePair` (field names are already `long`/`short`, no case change). */
export function parseSidePair(raw: Record<string, unknown>): SidePair {
    return { long: big(raw.long), short: big(raw.short) };
}

/** Parse a `scValToNative`-decoded `Order` into its camelCase interface. */
export function parseOrder(raw: Record<string, unknown>): Order {
    return {
        isLong: raw.is_long as boolean,
        kind: Number(raw.kind) as OrderKind,
        notional: big(raw.notional),
        margin: big(raw.margin),
        triggerPrice: big(raw.trigger_price),
        priceBound: big(raw.price_bound),
        execFee: big(raw.exec_fee),
        createdAt: big(raw.created_at),
        expiration: Number(raw.expiration),
    };
}

/** Parse a `scValToNative`-decoded `VaultOrder` into its camelCase interface. */
export function parseVaultOrder(raw: Record<string, unknown>): VaultOrder {
    return {
        kind: Number(raw.kind) as VaultOrderKind,
        amount: big(raw.amount),
        minOut: big(raw.min_out),
        execFee: big(raw.exec_fee),
        createdAt: big(raw.created_at),
    };
}

/** Parse a `scValToNative`-decoded `Position` into its camelCase interface. */
export function parsePosition(raw: Record<string, unknown>): Position {
    return {
        margin: big(raw.margin),
        notional: big(raw.notional),
        tokens: big(raw.tokens),
        fundingIdx: big(raw.funding_idx),
        borrowingIdx: big(raw.borrowing_idx),
        lockedNotional: big(raw.locked_notional),
        unlocksAt: big(raw.unlocks_at),
        pricedAt: big(raw.priced_at),
        decreaseOrders: (raw.decrease_orders as unknown[]).map((id) => Number(id)),
    };
}

/** Parse a `scValToNative`-decoded `MarketData` into its camelCase interface. */
export function parseMarketData(raw: Record<string, unknown>): MarketData {
    return {
        notional: parseSidePair(raw.notional as Record<string, unknown>),
        margin: parseSidePair(raw.margin as Record<string, unknown>),
        tokens: parseSidePair(raw.tokens as Record<string, unknown>),
        fundingIdx: parseSidePair(raw.funding_idx as Record<string, unknown>),
        borrowingIdx: parseSidePair(raw.borrowing_idx as Record<string, unknown>),
        fundingRate: big(raw.funding_rate),
        accruedAt: big(raw.accrued_at),
        creditPool: big(raw.credit_pool),
        creditOwed: big(raw.credit_owed),
    };
}

/** Parse a `scValToNative`-decoded `AdlState` into its camelCase interface. */
export function parseAdlState(raw: Record<string, unknown>): AdlState {
    return {
        long: raw.long as boolean,
        short: raw.short as boolean,
    };
}

/** Parse a `scValToNative`-decoded `Config` into its camelCase `MarketConfig`. */
export function parseMarketConfig(raw: Record<string, unknown>): MarketConfig {
    return {
        keeperRate: big(raw.keeper_rate),
        minPositionNotional: big(raw.min_position_notional),
        maxPositionNotional: big(raw.max_position_notional),
        maxOpenInterest: big(raw.max_open_interest),
        minOrderNotional: big(raw.min_order_notional),
        minOrderMargin: big(raw.min_order_margin),
        execFee: big(raw.exec_fee),
        feeDom: big(raw.fee_dom),
        feeNonDom: big(raw.fee_non_dom),
        impactScalar: big(raw.impact_scalar),
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
        maxPnlWithdraw: big(raw.max_pnl_withdraw),
        redeemLock: big(raw.redeem_lock),
        depositFee: big(raw.deposit_fee),
        redeemFee: big(raw.redeem_fee),
        minDeposit: big(raw.min_deposit),
        maxVaultBalance: big(raw.max_vault_balance),
    };
}
