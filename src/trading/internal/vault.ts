import { Status } from '../../contracts/market/types.js';
import type { MarketData, MarketConfig } from '../../contracts/market/types.js';
import { BPS_DENOMINATOR, I128_MAX, SCALAR_18, addI128, checkedBps, checkedI128, mulDivFloor, subI128 } from '../../math/fixed.js';
import { advanceMarketAccruals, marketSidePnl, sideCapacity, sideReserved } from './math.js';
import type { PriceData } from './math.js';
import { decodeLedgerSequence, estimate, exact, unavailable } from './quote.js';
import type { QuoteResult } from './quote.js';

const OVERFLOW_MESSAGE = 'value is outside the i128 range';

const WITHDRAW_GATE_REASONS: Readonly<Record<number, string>> = {
    714: 'utilization exceeded',
    740: 'stale price',
    754: 'pending PnL exceeded',
};

/**
 * Room left before a withdrawal trips a protocol gate, evaluated at the
 * `postVaultAssets` the caller checked. Both fields are token-dec and take
 * the smaller of the long and short side.
 */
export interface VaultWithdrawHeadroom {
    /** Reserved-notional room left before the utilization gate (contract error 714) trips. */
    utilizationHeadroom: bigint;
    /** Pending-profit room left before the withdraw PnL gate (contract error 754) trips. */
    pnlHeadroom: bigint;
}

/**
 * A withdraw-side protocol gate rejected the call. `code` mirrors the
 * contract error number; the message names which gate failed.
 * `checkVaultWithdrawGates` catches this and reports it as `CONTRACT_GATE`
 * instead of throwing it to the caller.
 */
export class VaultProtocolGateError extends Error {
    constructor(
        /** The mirrored contract error number. */
        readonly code: number,
    ) {
        super(
            `contract error #${code}: ${WITHDRAW_GATE_REASONS[code] ?? 'protocol gate failed'}`,
        );
    }
}

function minimum(left: bigint, right: bigint): bigint {
    return left < right ? left : right;
}

/**
 * @internal Mirror the exit gates `Market::require_utilization` and the
 * redeem PnL check `execute_vault_order` runs after a redeem settles:
 * reserve utilization, then pending trader PnL, both measured against
 * `postVaultAssets`. Assumes `market` is already accrued to the quote time.
 * Returns the headroom on each side if both gates pass.
 *
 * @param postVaultAssets - projected vault backing after the withdrawal, token-dec.
 * @throws {VaultProtocolGateError} code 714 (`MarketError::UtilizationExceeded`)
 *   if either side's reserved notional would exceed `config.maxUtilWithdraw`
 *   of half `postVaultAssets`. A smaller withdrawal or less open interest clears it.
 * @throws {VaultProtocolGateError} code 754 (`MarketError::PendingPnlExceeded`)
 *   if either side's pending profit would exceed `config.maxPnlWithdraw` of
 *   half `postVaultAssets`. A smaller withdrawal or an adverse price move clears it.
 */
export function evaluateVaultWithdrawGates(
    market: MarketData,
    config: MarketConfig,
    price: PriceData,
    postVaultAssets: bigint,
): VaultWithdrawHeadroom {
    const utilizationCapacity = sideCapacity(
        postVaultAssets,
        config.maxUtilWithdraw,
    );
    const longReserved = sideReserved(market, price, true);
    const shortReserved = sideReserved(market, price, false);
    if (
        longReserved > utilizationCapacity ||
        shortReserved > utilizationCapacity
    ) {
        throw new VaultProtocolGateError(714);
    }
    const utilizationHeadroom = minimum(
        utilizationCapacity - longReserved,
        utilizationCapacity - shortReserved,
    );

    const pnlAllowance = sideCapacity(postVaultAssets, config.maxPnlWithdraw);
    const longPnl = marketSidePnl(market, price, true, true);
    const shortPnl = marketSidePnl(market, price, false, true);
    if (longPnl > pnlAllowance || shortPnl > pnlAllowance) {
        throw new VaultProtocolGateError(754);
    }
    const pnlHeadroom = minimum(
        pnlAllowance - longPnl,
        pnlAllowance - shortPnl,
    );

    return { utilizationHeadroom, pnlHeadroom };
}

function caughtGateUnavailable<T>(error: unknown): QuoteResult<T> {
    if (error instanceof VaultProtocolGateError) {
        return unavailable('CONTRACT_GATE', error.message, error.code);
    }
    if (
        error instanceof RangeError &&
        error.message.includes(OVERFLOW_MESSAGE)
    ) {
        return unavailable('CONTRACT_OVERFLOW', error.message);
    }
    return unavailable(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'invalid vault gate input',
    );
}

/**
 * Check whether withdrawing down to `input.postVaultAssets` clears the
 * vault's exit gates, after advancing the market's accrual indices to
 * `input.now`. Mirrors the same checks `quoteVaultRedeemFill` runs inline,
 * so a caller can preview a withdrawal without quoting a full redeem.
 *
 * Returns `unavailable` with `CONTRACT_GATE`:
 * - 714 if either side's reserved notional would leave the vault
 *   under-reserved. A smaller withdrawal or less open interest clears it.
 * - 754 if either side's pending profit would overhang the withdraw PnL cap.
 *   A smaller withdrawal or an adverse price move clears it.
 */
export function checkVaultWithdrawGates(
    input: VaultGateInput,
): QuoteResult<VaultWithdrawHeadroom> {
    try {
        const accrued = advanceMarketAccruals(
            input.market,
            input.config,
            input.price,
            input.vault.totalAssets,
            input.now,
        ).market;
        return exact(
            evaluateVaultWithdrawGates(
                accrued,
                input.config,
                input.price,
                input.postVaultAssets,
            ),
            input.ledger,
        );
    } catch (error) {
        return caughtGateUnavailable(error);
    }
}

const U64_MAX = 2n ** 64n - 1n;


const ORDER_GATE_REASONS: Readonly<Record<number, string>> = {
    702: 'invalid market status',
    704: 'market is frozen',
    710: 'negative value not allowed',
    732: 'invalid order',
    740: 'stale price',
    751: 'vault order locked',
    753: 'vault balance exceeded',
    800: 'invalid strategy amount',
    801: 'pending PnL exceeds vault assets',
};

class VaultQuoteGateError extends VaultProtocolGateError {
    constructor(code: number) {
        super(code);
        this.message = `contract error #${code}: ${ORDER_GATE_REASONS[code] ?? 'protocol gate failed'}`;
    }
}

/** Vault state read atomically at one ledger, mirroring `StrategyVaultContract` state. */
export interface VaultAtomicState {
    /** Vault's asset balance before any uPnL mark, token-dec. Mirrors `Vault::total_assets`. */
    totalAssets: bigint;
    /** Outstanding share supply, share-dec. Mirrors `Base::total_supply`. */
    totalSupply: bigint;
    /** Extra decimals shares carry over the asset. Share-dec equals token-dec plus this value; fixed at construction (`decimals_offset`). */
    decimalsOffset: number;
}

/** A caller-supplied fill estimate that `deriveVaultMinimumOutput` derives a `minOut` bound from. */
export interface VaultEstimatedOutputReference {
    /** Marks the output as a caller estimate, not a chain quote. */
    readonly kind: 'estimate';
    /** Estimated fill output: shares for a deposit, assets for a redeem (share-dec or token-dec, matching the order side). */
    readonly output: bigint;
}

/** A `minOut` slippage bound derived from an estimated fill; ready for `VaultOrderCreationQuoteInput.minOut`. */
export interface VaultMinimumOutput {
    /** The estimate `minOut` was derived from. */
    readonly reference: VaultEstimatedOutputReference;
    /** Echoes the input `maximumSlippageBps` used to derive `minOut`. */
    readonly maximumSlippageBps: bigint;
    /** Rounding always floors, in the vault's favor. */
    readonly rounding: 'floor';
    /** The slippage bound: `reference.output` cut by `maximumSlippageBps`, same units as `reference.output`. */
    readonly minOut: bigint;
}

/** Input to `deriveVaultMinimumOutput`. */
export interface DeriveVaultMinimumOutputInput {
    /** The caller's estimated fill output to derive a `minOut` bound from. */
    readonly reference: VaultEstimatedOutputReference;
    /** Maximum slippage in basis points (10_000 = 100%). */
    readonly maximumSlippageBps: bigint;
}

/** Input to `quoteVaultOrderCreation`, mirroring `create_vault_order`'s arguments and the market state it reads. */
export interface VaultOrderCreationQuoteInput {
    /** Ledger sequence the quote is exact as of. */
    ledger: number;
    /** Creation time, unix seconds: the order's `createdAt`. */
    now: bigint;
    /** Market status at creation. */
    status: Status;
    /** Market config at creation. */
    config: MarketConfig;
    /** Deposit escrows `amount` assets; redeem escrows `amount` shares. */
    action: 'deposit' | 'redeem';
    /** Assets to deposit (token-dec) or shares to redeem (share-dec). */
    amount: bigint;
    /** Slippage bound applied at fill, net of the vault fee: shares for a deposit or assets for a redeem. `0` means unset. A fill quoted below it rejects the order. */
    minOut: bigint;
    /** Required only for a Retired market redeem, which executes directly. */
    vault?: VaultAtomicState;
}

/** A vault order accepted to rest, mirroring the `VaultOrder` row `create_vault_order` stores. */
export interface VaultRestingOrderCreation {
    /** The order rests for a keeper fill. */
    kind: 'resting';
    /** Creation never fills a non-retired order. */
    policy: 'restOnly';
    /** Deposit or redeem. */
    action: 'deposit' | 'redeem';
    /** Assets escrowed (deposit, token-dec) or shares escrowed (redeem, share-dec). */
    amount: bigint;
    /** Slippage bound carried into the fill. `0` means unset. A fill quoted below it rejects the order. */
    minOut: bigint;
    /** Flat keeper fee escrowed alongside the order, settlement token, token-dec. */
    executionFee: bigint;
    /** Order creation timestamp, unix seconds. */
    createdAt: bigint;
    /**
     * Earliest ledger timestamp at which a fill can land (the fill ledger must
     * strictly postdate creation; the price's publishTime may equal
     * createdAt), or null at the u64 ceiling.
     */
    fillAfter: bigint | null;
    /** Contract cooldown boundary for a redeem, otherwise null. */
    redeemUnlockAt: bigint | null;
    /** Settlement token escrow, including executionFee. */
    escrowedAssets: bigint;
    /** Shares escrowed for a redeem, share-dec. `0` for a deposit. */
    escrowedShares: bigint;
}

/**
 * The instant redeem `create_vault_order` runs on a Retired market: it burns
 * `shares` and pays `assets` directly, with no resting order, no `minOut`
 * check, and no keeper `executionFee`.
 */
export interface VaultRetiredImmediateRedeem {
    /** The redeem settles inside creation. */
    kind: 'retiredImmediateRedeem';
    /** Creation pays out directly. */
    policy: 'direct';
    /** Only a redeem can settle this way. */
    action: 'redeem';
    /** Shares burned, share-dec. */
    shares: bigint;
    /** Assets paid, token-dec. Priced at `net_pnl = 0`, exact because a retired market's book is flat. */
    assets: bigint;
    /** `minOut` is never checked. */
    minOutApplied: false;
    /** No keeper fee is escrowed or paid. */
    executionFee: 0n;
}

/** Outcome of `quoteVaultOrderCreation`: a resting order, or an instant retired-market redeem. */
export type VaultOrderCreationOutcome =
    VaultRestingOrderCreation | VaultRetiredImmediateRedeem;

/** An exact `quoteVaultOrderCreation` result, unwrapped from its `QuoteResult` envelope. */
export interface ExactVaultOrderCreationQuote {
    /** Always `exact`. */
    kind: 'exact';
    /** The creation outcome. */
    value: VaultOrderCreationOutcome;
    /** Ledger sequence the quote is exact as of. */
    ledger: number;
}

/** `ExactVaultOrderCreationQuote` narrowed to the resting-order outcome. */
export interface ExactVaultRestingOrderCreationQuote extends ExactVaultOrderCreationQuote {
    /** The resting order. */
    value: VaultRestingOrderCreation;
}

/**
 * A keeper fill that lands, mirroring the `DepositFill` and `RedeemFill`
 * receipts `execute_vault_order` emits.
 */
export interface VaultFillOutcome {
    /** Which fill landed. */
    kind: 'deposit' | 'redeem';
    /** Assets deposited or shares redeemed, before fees: token-dec for a deposit, share-dec for a redeem. */
    input: bigint;
    /** Shares minted (deposit, share-dec) or assets paid to the redeemer (redeem, token-dec), net of the vault fee. */
    output: bigint;
    /** Assets moved through the vault before the fee cut, token-dec. Equals `input` for a deposit. */
    grossAssets: bigint;
    /** `depositFee` or `redeemFee` cut of `grossAssets`, token-dec, rounded down. */
    vaultFee: bigint;
    /** Flat keeper fee escrowed at order creation, paid to the keeper on fill, token-dec. */
    executionFee: bigint;
    /** Pending trader PnL the fill priced against, capped and signed, token-dec. Does not change what the user receives. */
    netPnl: bigint;
    /**
     * Vault backing projected after this fill, token-dec, including the
     * vault's cut of `vaultFee`. The keeper and treasury cuts leave the vault,
     * so this is not `vaultFee` added in full, and it does not change `output`.
     */
    postVaultAssets: bigint;
    /** Shares price at the vault's uPnL-marked net asset value at fill. */
    valuation: 'transactionQuoteMarkedNav';
}

/**
 * A mature order whose quote falls below its `minOut`, mirroring the
 * `RejectVaultOrder` receipt. `execute_vault_order` succeeds and settles the
 * order without filling it: the order is removed, the principal returns to
 * the user, and the escrowed execution fee pays the keeper. Nothing moves
 * through the vault.
 */
export interface VaultRejectOutcome {
    /** The keeper's call rejects the order. */
    kind: 'rejected';
    /** Deposit or redeem. */
    action: 'deposit' | 'redeem';
    /** The fill's quote, below `minOut`: the shares a deposit would mint (share-dec), or a redeem's assets net of the vault fee (token-dec). */
    quoted: bigint;
    /** The order's slippage bound the quote missed, in the unit of `quoted`. */
    minOut: bigint;
    /** Principal returned to the user: the escrowed assets (deposit, token-dec) or shares (redeem, share-dec). A deposit refund the user cannot receive parks as claimable credit. */
    refund: bigint;
    /** Flat keeper fee escrowed at order creation, token-dec: the keeper's whole payout on a rejection. */
    executionFee: bigint;
    /** Pending trader PnL the quote priced against, capped and signed, token-dec. */
    netPnl: bigint;
    /** Vault backing after the rejection, token-dec: unchanged. */
    postVaultAssets: bigint;
    /** The quote priced at the vault's uPnL-marked net asset value. */
    valuation: 'transactionQuoteMarkedNav';
}

/**
 * Result of `quoteVaultDepositFill` or `quoteVaultRedeemFill`: the fill lands
 * (`kind` is `'deposit'` or `'redeem'`), or its quote misses `minOut` and the
 * keeper's call rejects the order (`kind` is `'rejected'`). Narrow on `kind`
 * before reading the fill fields.
 */
export type VaultQuoteOutcome = VaultFillOutcome | VaultRejectOutcome;

/** Shared inputs for `quoteVaultDepositFill` and `quoteVaultRedeemFill`: the market and vault state a fill prices against. */
export interface VaultQuoteContext {
    /** Ledger sequence the quote is exact as of. */
    ledger: number;
    /** Fill time, unix seconds; the market accrues to it first. */
    now: bigint;
    /** The market's stored aggregates. */
    market: MarketData;
    /** The market's config. */
    config: MarketConfig;
    /** The verified fill price. */
    price: PriceData;
    /** The vault's atomic state. */
    vault: VaultAtomicState;
    /** Treasury's cut of the fill fee (SCALAR_18), read live like `execute_vault_order` reads it at fill time. */
    treasuryRate: bigint;
    /** Flat keeper fee escrowed on the order, settlement token, token-dec. */
    executionFee: bigint;
    /** Slippage bound from the resting order. `0` means unset. A quote below it rejects the order. */
    minOut: bigint;
}

/** Input to `quoteVaultDepositFill`. */
export interface VaultDepositQuoteInput extends VaultQuoteContext {
    /** Assets escrowed by the resting order, token-dec. */
    assets: bigint;
    /** The order's creation timestamp; the fill price must postdate it. */
    createdAt: bigint;
}

/** Input to `quoteVaultRedeemFill`. */
export interface VaultRedeemQuoteInput extends VaultQuoteContext {
    /** Shares escrowed by the resting order, share-dec. */
    shares: bigint;
    /** The order's creation timestamp; the fill price must postdate it, and the redeem lock counts from it. */
    createdAt: bigint;
}

/** Input to `checkVaultWithdrawGates`. */
export interface VaultGateInput extends VaultQuoteContext {
    /** Vault backing to gate the withdrawal against, token-dec. */
    postVaultAssets: bigint;
}

interface PreparedVaultContext {
    market: MarketData;
    vault: VaultAtomicState;
    executionFee: bigint;
    minOut: bigint;
    treasuryRate: bigint;
}

interface VaultFeeSplit {
    keeper: bigint;
    treasury: bigint;
    vault: bigint;
}

function exchangeBasis(
    vault: VaultAtomicState,
    netPnl: bigint,
): { supply: bigint; assets: bigint } {
    const effectiveAssets = subI128(vault.totalAssets, netPnl);
    if (effectiveAssets < 0n) throw new VaultQuoteGateError(801);
    const virtualShares = checkedI128(10n ** BigInt(vault.decimalsOffset));
    return {
        supply: addI128(vault.totalSupply, virtualShares),
        assets: addI128(effectiveAssets, 1n),
    };
}

/**
 * @internal Mirrors `StrategyVault::assets_to_shares` exactly. Shares minted
 * for `assets` at the uPnL-marked exchange rate, rounded down in the vault's
 * favor.
 *
 * @param assets - assets to convert, token-dec. Must be nonnegative.
 * @param netPnl - signed pending trader PnL marked against the vault,
 *   token-dec. Positive is profit the vault still owes.
 * @returns shares, share-dec (token-dec plus `vault.decimalsOffset`).
 * @throws {VaultQuoteGateError} 800 if `assets` is negative.
 * @throws {VaultQuoteGateError} 801 if `netPnl` exceeds `vault.totalAssets`.
 */
export function convertVaultAssetsToShares(
    vault: VaultAtomicState,
    assets: bigint,
    netPnl: bigint,
): bigint {
    if (assets < 0n) throw new VaultQuoteGateError(800);
    const basis = exchangeBasis(vault, netPnl);
    return mulDivFloor(assets, basis.supply, basis.assets);
}

/**
 * @internal Mirrors `StrategyVault::shares_to_assets` exactly. Assets paid
 * for `shares` at the uPnL-marked exchange rate, rounded down in the vault's
 * favor.
 *
 * @param shares - shares to convert, share-dec. Must be nonnegative.
 * @param netPnl - signed pending trader PnL marked against the vault,
 *   token-dec. Positive is profit the vault still owes.
 * @returns assets, token-dec.
 * @throws {VaultQuoteGateError} 800 if `shares` is negative.
 * @throws {VaultQuoteGateError} 801 if `netPnl` exceeds `vault.totalAssets`.
 */
export function convertVaultSharesToAssets(
    vault: VaultAtomicState,
    shares: bigint,
    netPnl: bigint,
): bigint {
    if (shares < 0n) throw new VaultQuoteGateError(800);
    const basis = exchangeBasis(vault, netPnl);
    return mulDivFloor(shares, basis.assets, basis.supply);
}

function feeSplit(
    fee: bigint,
    keeperRate: bigint,
    treasuryRate: bigint,
): VaultFeeSplit {
    const keeper = mulDivFloor(fee, keeperRate, SCALAR_18);
    const treasury = mulDivFloor(fee, treasuryRate, SCALAR_18);
    return {
        keeper,
        treasury,
        vault: subI128(subI128(fee, keeper), treasury),
    };
}

/**
 * Net pending trader PnL for share pricing, token-dec: both sides marked at
 * `maximize`, each side's profit capped at `maxPnlTrader` of half
 * `vaultAssets`. A redeem prices at `maximize = true`, a deposit at `false`.
 */
export function cappedNetPnl(
    market: MarketData,
    config: MarketConfig,
    price: PriceData,
    vaultAssets: bigint,
    maximize: boolean,
): bigint {
    const cap = sideCapacity(vaultAssets, config.maxPnlTrader);
    const long = marketSidePnl(market, price, true, maximize);
    const short = marketSidePnl(market, price, false, maximize);
    return addI128(long < cap ? long : cap, short < cap ? short : cap);
}

/**
 * Mirror the execute_vault_order commit-then-execute timing gates: the fill
 * may not price at a payload predating the commitment (equality passes), and
 * it must land in a ledger strictly later than the commitment.
 */
function requireFillTiming(
    price: PriceData,
    createdAt: bigint,
    now: bigint,
): void {
    if (price.publishTime < createdAt) throw new VaultQuoteGateError(740);
    if (now <= createdAt) throw new VaultQuoteGateError(740);
}

function prepareContext(input: VaultQuoteContext): PreparedVaultContext {
    decodeLedgerSequence(input.ledger);
    if (input.minOut < 0n) throw new VaultQuoteGateError(710);
    const accrued = advanceMarketAccruals(
        input.market,
        input.config,
        input.price,
        input.vault.totalAssets,
        input.now,
    ).market;
    return {
        market: accrued,
        vault: input.vault,
        executionFee: input.executionFee,
        minOut: input.minOut,
        treasuryRate: input.treasuryRate,
    };
}

/**
 * Mirror `keeper.rs` `reject`: the principal goes back to the user, the
 * escrowed execution fee is the keeper's only leg, and the vault is untouched.
 */
function rejection(
    action: 'deposit' | 'redeem',
    quoted: bigint,
    refund: bigint,
    prepared: PreparedVaultContext,
    netPnl: bigint,
): VaultRejectOutcome {
    return {
        kind: 'rejected',
        action,
        quoted,
        minOut: prepared.minOut,
        refund,
        executionFee: prepared.executionFee,
        netPnl,
        postVaultAssets: prepared.vault.totalAssets,
        valuation: 'transactionQuoteMarkedNav',
    };
}

function caughtUnavailable<T>(error: unknown): QuoteResult<T> {
    if (error instanceof VaultProtocolGateError) {
        return unavailable('CONTRACT_GATE', error.message, error.code);
    }
    if (
        error instanceof RangeError &&
        error.message.includes(OVERFLOW_MESSAGE)
    ) {
        return unavailable('CONTRACT_OVERFLOW', error.message);
    }
    return unavailable(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'invalid vault quote input',
    );
}

/**
 * Derive an atomic vault-order minimum from a caller-supplied fill estimate.
 * The arithmetic is exact, but the result retains estimate provenance because
 * the keeper prices the eventual fill against later state.
 *
 * Pass the fee-net output `execute_vault_order` checks `minOut` against:
 * the shares the post-`depositFee` assets mint, or the redeemed assets after
 * the `redeemFee` cut (the `output` of `quoteVaultDepositFill` or
 * `quoteVaultRedeemFill`). A fill quoted below the minimum rejects the order
 * and pays its execution fee to the keeper.
 */
export function deriveVaultMinimumOutput(
    input: DeriveVaultMinimumOutputInput,
): QuoteResult<VaultMinimumOutput> {
    try {
        const reference = input.reference;
        const output = checkedI128(reference.output);
        const maximumSlippageBps = checkedBps(input.maximumSlippageBps);
        const minOut = mulDivFloor(
            output,
            BPS_DENOMINATOR - maximumSlippageBps,
            BPS_DENOMINATOR,
        );

        return estimate(
            {
                reference: { kind: 'estimate', output },
                maximumSlippageBps,
                rounding: 'floor',
                minOut,
            },
            [
                'minimum output is derived from a caller-supplied estimated fill output',
                'vault order fill output can change before keeper execution',
                'minimum output is rounded down in atomic units',
            ],
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

/**
 * Quote the price-free creation leg of a vault order: the escrow amounts and
 * timing bounds `create_vault_order` would produce, without touching price
 * state. On a Retired market a redeem instead resolves as an instant fill,
 * mirroring `create_vault_order`'s direct-redeem branch; `input.vault` is
 * required for that case.
 *
 * Returns `unavailable` with `CONTRACT_GATE`, checked in the contract's
 * order:
 * - 710 if `amount` or `minOut` is negative.
 * - 704 if the market is Frozen.
 * - 702 if a deposit is quoted on a Retired market.
 * - 732 if `amount` is zero, a deposit falls under `config.minDeposit`, or
 *   a deposit's `amount + execFee` escrow leaves the i128 range.
 *
 * Returns `unavailable` with `MISSING_STATE` if the market is Retired, the
 * action is redeem, and `input.vault` was not supplied.
 */
export function quoteVaultOrderCreation(
    input: VaultOrderCreationQuoteInput,
): QuoteResult<VaultOrderCreationOutcome> {
    try {
        const ledger = decodeLedgerSequence(input.ledger);
        const createdAt = input.now;
        const amount = input.amount;
        const minOut = input.minOut;
        if (amount < 0n || minOut < 0n) throw new VaultQuoteGateError(710);

        const status = input.status;
        if (status === Status.Frozen) throw new VaultQuoteGateError(704);
        if (status === Status.Retired && input.action === 'deposit') {
            throw new VaultQuoteGateError(702);
        }
        // A zero order can never fill; a redeem has no other floor.
        if (amount === 0n) throw new VaultQuoteGateError(732);
        const executionFee = input.config.execFee;
        if (input.action === 'deposit') {
            if (amount < input.config.minDeposit) {
                throw new VaultQuoteGateError(732);
            }
            if (amount > I128_MAX - executionFee) {
                throw new VaultQuoteGateError(732);
            }
        }

        if (status === Status.Retired) {
            const shares = amount;
            if (input.vault === undefined) {
                return unavailable(
                    'MISSING_STATE',
                    'exact vault state is required for a retired direct redeem',
                );
            }
            const vault = input.vault;
            if (shares > vault.totalSupply) {
                throw new RangeError('redeem shares exceed total supply');
            }
            const assets = convertVaultSharesToAssets(vault, shares, 0n);
            return exact(
                {
                    kind: 'retiredImmediateRedeem',
                    policy: 'direct',
                    action: 'redeem',
                    shares,
                    assets,
                    minOutApplied: false,
                    executionFee: 0n,
                },
                ledger,
            );
        }

        const fillAfter = createdAt === U64_MAX ? null : createdAt + 1n;
        const redeemUnlockAt =
            input.action === 'redeem'
                ? saturatingTimestampAdd(createdAt, input.config.redeemLock)
                : null;
        const escrowedAssets =
            input.action === 'deposit'
                ? addI128(amount, executionFee)
                : executionFee;

        return exact(
            {
                kind: 'resting',
                policy: 'restOnly',
                action: input.action,
                amount,
                minOut,
                executionFee,
                createdAt,
                fillAfter,
                redeemUnlockAt,
                escrowedAssets,
                escrowedShares: input.action === 'redeem' ? amount : 0n,
            },
            ledger,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

/**
 * Quote the keeper fill leg of a deposit order at `input.price`, mirroring
 * `execute_vault_order`'s deposit branch. Deducts the vault's `depositFee`,
 * mints shares against the uPnL-marked exchange rate, and projects the vault
 * balance after the fill. `input.assets` and every fee amount are token-dec;
 * the minted shares are share-dec.
 *
 * Rounding always favors the vault: the fee and the minted shares both floor.
 * The keeper, treasury, and vault split of `vaultFee` only changes
 * `postVaultAssets`; it does not change the shares minted.
 *
 * A set `minOut` is checked first, against the shares the post-fee assets
 * mint. A quote below it returns an exact `rejected` outcome instead of a
 * fill: the keeper's call removes the order, refunds `assets`, and pays
 * `executionFee` to the keeper. The vault balance cap is never reached.
 *
 * Returns `unavailable` with `CONTRACT_GATE`:
 * - 740 if `price.publishTime` predates `createdAt`, or the fill runs in the
 *   creation ledger.
 * - 800 if `assets`, or the post-fee deposit amount, is not positive.
 * - 801 if the capped pending trader PnL exceeds `vault.totalAssets`.
 * - 753 if the projected `postVaultAssets` would exceed `config.maxVaultBalance`.
 *   Wait for the vault to free up room, or deposit less.
 */
export function quoteVaultDepositFill(
    input: VaultDepositQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    try {
        const prepared = prepareContext(input);
        requireFillTiming(input.price, input.createdAt, input.now);
        const assets = input.assets;
        if (assets <= 0n) throw new VaultQuoteGateError(800);

        const vaultFee = mulDivFloor(assets, input.config.depositFee, SCALAR_18);
        const depositAssets = subI128(assets, vaultFee);
        const netPnl = cappedNetPnl(
            prepared.market,
            input.config,
            input.price,
            prepared.vault.totalAssets,
            false,
        );
        // The slippage bound reads the vault's own quote of the post-fee
        // assets before anything moves, so a miss rejects the order ahead of
        // every fill gate.
        if (prepared.minOut > 0n) {
            const quoted = convertVaultAssetsToShares(
                prepared.vault,
                depositAssets,
                netPnl,
            );
            if (quoted < prepared.minOut) {
                return exact(
                    rejection('deposit', quoted, assets, prepared, netPnl),
                    input.ledger,
                );
            }
        }
        if (depositAssets <= 0n) throw new VaultQuoteGateError(800);
        const split = feeSplit(
            vaultFee,
            input.config.keeperRate,
            prepared.treasuryRate,
        );
        const shares = convertVaultAssetsToShares(
            prepared.vault,
            depositAssets,
            netPnl,
        );
        const postVaultAssets = addI128(
            addI128(prepared.vault.totalAssets, depositAssets),
            split.vault,
        );
        if (postVaultAssets > input.config.maxVaultBalance) {
            throw new VaultQuoteGateError(753);
        }

        return exact(
            {
                kind: 'deposit',
                input: assets,
                output: shares,
                grossAssets: assets,
                vaultFee,
                executionFee: prepared.executionFee,
                netPnl,
                postVaultAssets,
                valuation: 'transactionQuoteMarkedNav',
            },
            input.ledger,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

function saturatingTimestampAdd(left: bigint, right: bigint): bigint {
    return left > U64_MAX - right ? U64_MAX : left + right;
}

/**
 * Quote the keeper fill leg of a redeem order at `input.price`, mirroring
 * `execute_vault_order`'s redeem branch. Burns shares against the uPnL-marked
 * exchange rate maximized against the redeemer, deducts the vault's
 * `redeemFee`, and runs the withdraw gates against the projected post-fill
 * balance. `input.shares` is share-dec; every other amount is token-dec.
 *
 * Rounding always favors the vault: the redeemed assets and the fee both
 * floor. The keeper, treasury, and vault split of the redeem fee only
 * changes `postVaultAssets`; it does not change the assets paid to the
 * redeemer.
 *
 * Once the redeem lock has passed, a set `minOut` is checked against the
 * assets paid net of the redeem fee. A quote below it returns an exact
 * `rejected` outcome instead of a fill: the keeper's call removes the order,
 * returns `shares`, and pays `executionFee` to the keeper. The withdraw
 * gates are never reached.
 *
 * Returns `unavailable` with `CONTRACT_GATE`:
 * - 740 if `price.publishTime` predates `createdAt`, or the fill runs in the
 *   creation ledger.
 * - 751 if the `config.redeemLock` cooldown from `createdAt` has not
 *   elapsed. Wait and requote.
 * - 732 if `shares` is not positive.
 * - 714 or 754 if the withdraw gates block the fill; see
 *   `evaluateVaultWithdrawGates` for the condition and what clears it.
 */
export function quoteVaultRedeemFill(
    input: VaultRedeemQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    try {
        const prepared = prepareContext(input);
        requireFillTiming(input.price, input.createdAt, input.now);
        if (
            input.now <
            saturatingTimestampAdd(input.createdAt, input.config.redeemLock)
        ) {
            throw new VaultQuoteGateError(751);
        }
        const shares = input.shares;
        if (shares <= 0n) throw new VaultQuoteGateError(732);
        if (shares > prepared.vault.totalSupply) {
            throw new RangeError('redeem shares exceed total supply');
        }

        const netPnl = cappedNetPnl(
            prepared.market,
            input.config,
            input.price,
            prepared.vault.totalAssets,
            true,
        );
        const grossAssets = convertVaultSharesToAssets(
            prepared.vault,
            shares,
            netPnl,
        );
        const vaultFee = mulDivFloor(grossAssets, input.config.redeemFee, SCALAR_18);
        const output = subI128(grossAssets, vaultFee);
        // The slippage bound reads the vault's own quote net of the redeem
        // fee before anything burns, so a miss rejects the order ahead of the
        // burn and the exit gates.
        if (prepared.minOut > 0n && output < prepared.minOut) {
            return exact(
                rejection('redeem', output, shares, prepared, netPnl),
                input.ledger,
            );
        }
        if (grossAssets > prepared.vault.totalAssets) {
            throw new RangeError('redeem exceeds raw vault assets');
        }
        const split = feeSplit(
            vaultFee,
            input.config.keeperRate,
            prepared.treasuryRate,
        );
        const postVaultAssets = addI128(
            subI128(prepared.vault.totalAssets, grossAssets),
            split.vault,
        );
        evaluateVaultWithdrawGates(
            prepared.market,
            input.config,
            input.price,
            postVaultAssets,
        );

        return exact(
            {
                kind: 'redeem',
                input: shares,
                output,
                grossAssets,
                vaultFee,
                executionFee: prepared.executionFee,
                netPnl,
                postVaultAssets,
                valuation: 'transactionQuoteMarkedNav',
            },
            input.ledger,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

/** @deprecated Use quoteVaultDepositFill for the keeper fill leg. */
export function quoteVaultDeposit(
    input: VaultDepositQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    return quoteVaultDepositFill(input);
}

/** @deprecated Use quoteVaultRedeemFill for the keeper fill leg. */
export function quoteVaultRedeem(
    input: VaultRedeemQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    return quoteVaultRedeemFill(input);
}
