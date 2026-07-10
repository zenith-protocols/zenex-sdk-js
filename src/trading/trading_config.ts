import { SCALAR_18 } from '../math.js';
import { TradingConfig } from './trading_types.js';

// =============================================================================
// Client-side validation of a v2 `TradingConfig`, ported verbatim from
// `zenex-contracts/trading/src/trading/config.rs::Config::check_valid`
// (branch v2/dev). Every bound, floor, range, and ladder check is replicated in
// the same order the Rust evaluates them. The contract short-circuits on the
// first violated rule; this validator instead collects every violation so a
// caller can surface all of them at once. An empty array means the config is
// valid (the contract's `Ok(())`).
//
// All ratio/rate/fee/margin fields are SCALAR_18-scaled; notional/order/vault
// fields and execFee are token-dec. The bound constants below mirror
// `trading/src/trading/constants.rs` exactly.
// =============================================================================

/** Max keeper share of trade fees: 50%. */
const MAX_KEEPER_RATE = SCALAR_18 / 2n;
/** Max per-side trade fee: 1% of notional. */
const MAX_FEE_RATE = SCALAR_18 / 100n;
/** Global utilization cap ceiling: 1000%. */
const MAX_UTIL = 10n * SCALAR_18;
/** Max initial margin: 50% = 2x min leverage. */
const MAX_MARGIN = SCALAR_18 / 2n;
/** Min initial margin: 0.1% = 1000x max leverage. */
const MIN_MARGIN = SCALAR_18 / 1000n;
/** Max liquidation fee: 25%. */
const MAX_LIQ_FEE = SCALAR_18 / 4n;
/** ADL trigger floor: 45% of half the vault balance. */
const MIN_ADL_TRIGGER = (45n * SCALAR_18) / 100n;
/** ADL clear-target floor: 40% of half the vault balance. */
const MIN_ADL_CLEAR = (40n * SCALAR_18) / 100n;
/** Seconds in a 365-day year, the APR basis for per-second rate bounds. */
const SECONDS_PER_YEAR = 31_536_000n;
/** Max borrowing rate at full utilization: 1000% APR, per second. */
const MAX_BORROW_RATE = (10n * SCALAR_18) / SECONDS_PER_YEAR;
/** Max funding-rate magnitude: 1000% APR, per second. */
const MAX_FUNDING_RATE = (10n * SCALAR_18) / SECONDS_PER_YEAR;
/** Min decrease lock on newly added notional: the price-verifier's staleness ceiling (seconds). */
const MIN_NOTIONAL_LOCK = 15n;
/** Max decrease lock on newly added notional: 1 day (seconds). */
const MAX_NOTIONAL_LOCK = 86_400n;
/** Max redeem cooldown on vault orders: 30 days (seconds). */
const MAX_REDEEM_LOCK = 2_592_000n;
/** The vault-order fill floor is bounded to this fraction of `maxVaultBalance`. */
const MIN_DEPOSIT_DIVISOR = 100n;

/**
 * Validate a `TradingConfig` against the contract's `Config::check_valid`
 * bounds, returning a human-readable violation string for every failed rule.
 *
 * An empty array means the config would pass the contract's validation (its
 * `Ok(())`). The checks run in the same order as the Rust source; unlike the
 * contract, which returns on the first violation, this collects all of them.
 *
 * Ported from `config.rs::Config::check_valid`.
 */
export function validateTradingConfig(config: TradingConfig): string[] {
    const v: string[] = [];

    // --- Non-negativity (NegativeValueNotAllowed): the exact field set the
    //     contract guards; u64 locks and the notional/order/vault-size fields
    //     are not in this block. ---
    const nonNegative: [keyof TradingConfig, string][] = [
        ['keeperRate', 'keeperRate'],
        ['feeDom', 'feeDom'],
        ['feeNonDom', 'feeNonDom'],
        ['initMargin', 'initMargin'],
        ['maintenanceMargin', 'maintenanceMargin'],
        ['liqFee', 'liqFee'],
        ['borrowRate', 'borrowRate'],
        ['increasedBorrowRate', 'increasedBorrowRate'],
        ['targetUtil', 'targetUtil'],
        ['fundingIncrease', 'fundingIncrease'],
        ['fundingDecrease', 'fundingDecrease'],
        ['thresholdStableFunding', 'thresholdStableFunding'],
        ['thresholdDecreaseFunding', 'thresholdDecreaseFunding'],
        ['fundingMin', 'fundingMin'],
        ['fundingMax', 'fundingMax'],
        ['adlMaxPnl', 'adlMaxPnl'],
        ['adlClearTarget', 'adlClearTarget'],
        ['depositFee', 'depositFee'],
        ['redeemFee', 'redeemFee'],
        ['minDeposit', 'minDeposit'],
        ['maxPnlTrader', 'maxPnlTrader'],
        ['maxPnlWithdraw', 'maxPnlWithdraw'],
        ['execFee', 'execFee'],
    ];
    for (const [key, name] of nonNegative) {
        if ((config[key] as bigint) < 0n) {
            v.push(`${name} must be non-negative`);
        }
    }

    // --- Upper bounds (InvalidConfig). ---
    if (config.keeperRate > MAX_KEEPER_RATE) v.push('keeperRate exceeds MAX_KEEPER_RATE (50%)');
    if (config.feeDom > MAX_FEE_RATE) v.push('feeDom exceeds MAX_FEE_RATE (1%)');
    if (config.feeNonDom > MAX_FEE_RATE) v.push('feeNonDom exceeds MAX_FEE_RATE (1%)');
    if (config.maxUtilOpen > MAX_UTIL) v.push('maxUtilOpen exceeds MAX_UTIL (1000%)');
    if (config.maxUtilWithdraw > MAX_UTIL) v.push('maxUtilWithdraw exceeds MAX_UTIL (1000%)');
    if (config.initMargin > MAX_MARGIN) v.push('initMargin exceeds MAX_MARGIN (50%)');
    if (config.liqFee > MAX_LIQ_FEE) v.push('liqFee exceeds MAX_LIQ_FEE (25%)');
    if (config.notionalLock > MAX_NOTIONAL_LOCK) v.push('notionalLock exceeds MAX_NOTIONAL_LOCK (1 day)');
    if (config.redeemLock > MAX_REDEEM_LOCK) v.push('redeemLock exceeds MAX_REDEEM_LOCK (30 days)');

    // --- Floors (InvalidConfig). ---
    if (config.initMargin < MIN_MARGIN) v.push('initMargin is below MIN_MARGIN (0.1%)');
    if (config.impactScalar <= 0n) v.push('impactScalar must be positive');

    // The decrease lock must outlast the price-verifier's staleness window.
    if (config.notionalLock < MIN_NOTIONAL_LOCK) v.push('notionalLock is below MIN_NOTIONAL_LOCK (15s)');

    // --- Notional band. ---
    if (config.minPositionNotional <= 0n) v.push('minPositionNotional must be positive');
    if (config.maxPositionNotional <= config.minPositionNotional) {
        v.push('maxPositionNotional must exceed minPositionNotional');
    }

    // The per-side open-interest ceiling must admit one maximum-size position.
    if (config.maxOpenInterest < config.maxPositionNotional) {
        v.push('maxOpenInterest must be at least maxPositionNotional');
    }

    // Per-order dust floors: both positive, and the notional floor cannot exceed
    // minPositionNotional or a valid position could not be closed in one order.
    if (config.minOrderNotional <= 0n) v.push('minOrderNotional must be positive');
    if (config.minOrderCollateral <= 0n) v.push('minOrderCollateral must be positive');
    if (config.minOrderNotional > config.minPositionNotional) {
        v.push('minOrderNotional must not exceed minPositionNotional');
    }

    // The vault-order fill floor keeps dust fills out.
    if (config.minDeposit <= 0n) v.push('minDeposit must be positive');

    // Vault fill fee rates are bounded.
    if (config.depositFee > MAX_FEE_RATE) v.push('depositFee exceeds MAX_FEE_RATE (1%)');
    if (config.redeemFee > MAX_FEE_RATE) v.push('redeemFee exceeds MAX_FEE_RATE (1%)');

    // Open cap positive; withdraw cap at least the open cap.
    if (config.maxUtilOpen <= 0n) v.push('maxUtilOpen must be positive');
    if (config.maxUtilWithdraw < config.maxUtilOpen) {
        v.push('maxUtilWithdraw must be at least maxUtilOpen');
    }

    // Dominant side pays at least as much as the non-dominant side.
    if (config.feeDom < config.feeNonDom) v.push('feeDom must be at least feeNonDom');

    // Borrowing curve: the kink sits below full utilization, and the
    // full-utilization rate is bounded and at least the base slope.
    if (config.targetUtil >= SCALAR_18) v.push('targetUtil must be below SCALAR_18 (100%)');
    if (config.increasedBorrowRate < config.borrowRate) {
        v.push('increasedBorrowRate must be at least borrowRate');
    }
    if (config.increasedBorrowRate > MAX_BORROW_RATE) {
        v.push('increasedBorrowRate exceeds MAX_BORROW_RATE (1000% APR)');
    }

    // Funding velocity: the decay band sits inside the stable band, the
    // charged floor cannot exceed the bounded rate cap, and the accelerations
    // share the rate bound.
    if (config.thresholdStableFunding > SCALAR_18) v.push('thresholdStableFunding exceeds SCALAR_18 (100%)');
    if (config.thresholdDecreaseFunding > config.thresholdStableFunding) {
        v.push('thresholdDecreaseFunding must not exceed thresholdStableFunding');
    }
    if (config.fundingMin > config.fundingMax) v.push('fundingMin must not exceed fundingMax');
    if (config.fundingMax > MAX_FUNDING_RATE) v.push('fundingMax exceeds MAX_FUNDING_RATE (1000% APR)');
    if (config.fundingIncrease > MAX_FUNDING_RATE) v.push('fundingIncrease exceeds MAX_FUNDING_RATE (1000% APR)');
    if (config.fundingDecrease > MAX_FUNDING_RATE) v.push('fundingDecrease exceeds MAX_FUNDING_RATE (1000% APR)');

    // Solvency ladder, every rung a side pending PnL factor of half the vault
    // balance: the ADL clear target sits below the trigger (hysteresis), the
    // trigger at or below the trader haircut threshold, with band floors. The
    // redeem gate is positive and at most the haircut threshold.
    if (config.adlMaxPnl >= SCALAR_18) v.push('adlMaxPnl must be below SCALAR_18 (100%)');
    if (config.adlMaxPnl < MIN_ADL_TRIGGER) v.push('adlMaxPnl is below MIN_ADL_TRIGGER (45%)');
    if (config.adlClearTarget > config.adlMaxPnl) v.push('adlClearTarget must not exceed adlMaxPnl');
    if (config.adlClearTarget < MIN_ADL_CLEAR) v.push('adlClearTarget is below MIN_ADL_CLEAR (40%)');
    if (config.maxPnlTrader >= SCALAR_18) v.push('maxPnlTrader must be below SCALAR_18 (100%)');
    if (config.adlMaxPnl > config.maxPnlTrader) v.push('adlMaxPnl must not exceed maxPnlTrader');
    if (config.maxPnlWithdraw <= 0n) v.push('maxPnlWithdraw must be positive');
    if (config.maxPnlWithdraw > config.maxPnlTrader) {
        v.push('maxPnlWithdraw must not exceed maxPnlTrader');
    }

    // The vault size cap is positive.
    if (config.maxVaultBalance <= 0n) v.push('maxVaultBalance must be positive');

    // The fill floor stays a small fraction of the vault cap. BigInt has no
    // overflow, so the Rust `checked_mul` overflow branch collapses into this
    // single comparison: an oversized product simply exceeds the cap.
    if (config.minDeposit * MIN_DEPOSIT_DIVISOR > config.maxVaultBalance) {
        v.push('minDeposit exceeds maxVaultBalance / 100');
    }

    // Margin ladder: 0 <= liqFee < maintenanceMargin < initMargin.
    if (config.maintenanceMargin <= config.liqFee) v.push('maintenanceMargin must exceed liqFee');
    if (config.initMargin <= config.maintenanceMargin) v.push('initMargin must exceed maintenanceMargin');

    return v;
}
