import {
    BPS_DENOMINATOR,
    SCALAR_18,
    addI128,
    checkedBps,
    checkedI128,
    mulDivFloor,
    subI128,
} from '../../math/fixed.js';
import { sideCapacity } from '../market/capacity.js';
import { marketSidePnl } from '../market/pnl.js';
import { advanceMarketAccruals } from '../market/rates.js';
import type { PriceData } from '../market/types.js';
import {
    decodeLedgerSequence,
    estimate,
    exact,
    unavailable,
} from './result.js';
import type { QuoteResult } from './result.js';
import {
    Status,
    type MarketData,
    type TradingConfig,
} from '../../contracts/trading/trading_types.js';
import { VaultProtocolGateError, evaluateVaultWithdrawGates } from './vault_gates.js';

const U64_MAX = 2n ** 64n - 1n;
const OVERFLOW_MESSAGE = 'value is outside the i128 range';

const GATE_REASONS: Readonly<Record<number, string>> = {
    702: 'invalid market status',
    704: 'market is frozen',
    710: 'negative value not allowed',
    732: 'invalid order',
    740: 'stale price',
    751: 'vault order locked',
    752: 'minimum output not met',
    753: 'vault balance exceeded',
    800: 'invalid strategy amount',
    801: 'pending PnL exceeds vault assets',
};

class VaultQuoteGateError extends VaultProtocolGateError {
    constructor(code: number) {
        super(code);
        this.message = `contract error #${code}: ${GATE_REASONS[code] ?? 'protocol gate failed'}`;
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
    ledger: number;
    now: bigint;
    status: Status;
    config: TradingConfig;
    /** Deposit escrows `amount` assets; redeem escrows `amount` shares. */
    action: 'deposit' | 'redeem';
    /** Assets to deposit (token-dec) or shares to redeem (share-dec). */
    amount: bigint;
    /** Slippage bound applied at fill: shares for a deposit or assets for a redeem. `0` means unset. */
    minOut: bigint;
    /** Required only for a Retired market redeem, which executes directly. */
    vault?: VaultAtomicState;
}

/** A vault order accepted to rest, mirroring the `VaultOrder` row `create_vault_order` stores. */
export interface VaultRestingOrderCreation {
    kind: 'resting';
    policy: 'restOnly';
    action: 'deposit' | 'redeem';
    /** Assets escrowed (deposit, token-dec) or shares escrowed (redeem, share-dec). */
    amount: bigint;
    /** Slippage bound carried into the fill. `0` means unset. */
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
    kind: 'retiredImmediateRedeem';
    policy: 'direct';
    action: 'redeem';
    /** Shares burned, share-dec. */
    shares: bigint;
    /** Assets paid, token-dec. Priced at `net_pnl = 0`, exact because a retired market's book is flat. */
    assets: bigint;
    minOutApplied: false;
    executionFee: 0n;
}

/** Outcome of `quoteVaultOrderCreation`: a resting order, or an instant retired-market redeem. */
export type VaultOrderCreationOutcome =
    VaultRestingOrderCreation | VaultRetiredImmediateRedeem;

/** An exact `quoteVaultOrderCreation` result, unwrapped from its `QuoteResult` envelope. */
export interface ExactVaultOrderCreationQuote {
    kind: 'exact';
    value: VaultOrderCreationOutcome;
    ledger: number;
}

/** `ExactVaultOrderCreationQuote` narrowed to the resting-order outcome. */
export interface ExactVaultRestingOrderCreationQuote extends ExactVaultOrderCreationQuote {
    value: VaultRestingOrderCreation;
}

/**
 * Result of `quoteVaultDepositFill` or `quoteVaultRedeemFill`, mirroring the
 * `DepositFill` and `RedeemFill` receipts `execute_vault_order` emits.
 */
export interface VaultQuoteOutcome {
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
    valuation: 'transactionQuoteMarkedNav';
}

/** Shared inputs for `quoteVaultDepositFill` and `quoteVaultRedeemFill`: the market and vault state a fill prices against. */
export interface VaultQuoteContext {
    ledger: number;
    now: bigint;
    market: MarketData;
    config: TradingConfig;
    price: PriceData;
    vault: VaultAtomicState;
    /** Treasury's cut of the fill fee (SCALAR_18), read live like `execute_vault_order` reads it at fill time. */
    treasuryRate: bigint;
    /** Flat keeper fee escrowed on the order, settlement token, token-dec. */
    executionFee: bigint;
    /** Slippage bound from the resting order. `0` means unset. */
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

function cappedNetPnl(
    market: MarketData,
    config: TradingConfig,
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

function caughtUnavailable<T>(error: unknown): QuoteResult<T> {
    if (error instanceof VaultProtocolGateError) {
        return unavailable('CONTRACT_GATE', error.message);
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
 * Returns `unavailable`:
 * - `MISSING_STATE` if the market is Retired, the action is redeem, and
 *   `input.vault` was not supplied.
 * - `CONTRACT_GATE` 710 if `minOut` is negative.
 * - `CONTRACT_GATE` 704 if the market is Frozen.
 * - `CONTRACT_GATE` 702 if a deposit is quoted on a Retired market.
 * - `CONTRACT_GATE` 732 if a deposit falls under `config.minDeposit`, or a
 *   redeem's share `amount` is not positive.
 */
export function quoteVaultOrderCreation(
    input: VaultOrderCreationQuoteInput,
): QuoteResult<VaultOrderCreationOutcome> {
    try {
        const ledger = decodeLedgerSequence(input.ledger);
        const createdAt = input.now;
        const minOut = input.minOut;
        if (minOut < 0n) throw new VaultQuoteGateError(710);

        const status = input.status;
        if (status === Status.Frozen) throw new VaultQuoteGateError(704);
        if (status === Status.Retired) {
            if (input.action === 'deposit') {
                throw new VaultQuoteGateError(702);
            }
            const shares = input.amount;
            // Same guard as the pending-redeem branch below: the contract
            // rejects a non-positive share amount before touching the vault.
            if (shares <= 0n) throw new VaultQuoteGateError(732);
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

        const amount = input.amount;
        const executionFee = input.config.execFee;
        if (input.action === 'deposit') {
            if (amount <= 0n || amount < input.config.minDeposit) {
                throw new VaultQuoteGateError(732);
            }
        } else if (amount <= 0n) {
            throw new VaultQuoteGateError(732);
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
 * Returns `unavailable` with `CONTRACT_GATE`:
 * - 740 if `price.publishTime` predates `createdAt`, or the fill runs in the
 *   creation ledger.
 * - 800 if `assets`, or the post-fee deposit amount, is not positive.
 * - 801 if the capped pending trader PnL exceeds `vault.totalAssets`.
 * - 752 if the minted shares fall under `minOut`. Retry with a lower `minOut`
 *   or wait for a better price.
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
        if (depositAssets <= 0n) throw new VaultQuoteGateError(800);
        const split = feeSplit(
            vaultFee,
            input.config.keeperRate,
            prepared.treasuryRate,
        );
        const netPnl = cappedNetPnl(
            prepared.market,
            input.config,
            input.price,
            prepared.vault.totalAssets,
            false,
        );
        const shares = convertVaultAssetsToShares(
            prepared.vault,
            depositAssets,
            netPnl,
        );
        if (prepared.minOut > 0n && shares < prepared.minOut) {
            throw new VaultQuoteGateError(752);
        }
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
 * Returns `unavailable` with `CONTRACT_GATE`:
 * - 740 if `price.publishTime` predates `createdAt`, or the fill runs in the
 *   creation ledger.
 * - 751 if the `config.redeemLock` cooldown from `createdAt` has not
 *   elapsed. Wait and requote.
 * - 732 if `shares` is not positive.
 * - 752 if the assets paid fall under `minOut`. Retry with a lower `minOut`
 *   or wait for a better price.
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
        if (grossAssets > prepared.vault.totalAssets) {
            throw new RangeError('redeem exceeds raw vault assets');
        }
        const vaultFee = mulDivFloor(grossAssets, input.config.redeemFee, SCALAR_18);
        const output = subI128(grossAssets, vaultFee);
        const split = feeSplit(
            vaultFee,
            input.config.keeperRate,
            prepared.treasuryRate,
        );
        if (prepared.minOut > 0n && output < prepared.minOut) {
            throw new VaultQuoteGateError(752);
        }
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
