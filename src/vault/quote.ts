import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivFloor,
    subI128,
} from '../math/fixed.js';
import { marketSidePnl, sideCapacity } from '../market/capacity.js';
import { advanceMarketAccruals } from '../market/rates.js';
import type { VerifiedPrice } from '../market/types.js';
import {
    decodeLedgerSequence,
    estimate,
    exact,
    unavailable,
} from '../quote/result.js';
import type { QuoteResult } from '../quote/result.js';
import {
    Status,
    type MarketData,
    type TradingConfig,
} from '../trading/trading_types.js';
import { VaultProtocolGateError, evaluateVaultWithdrawGates } from './gates.js';

const U64_MAX = 2n ** 64n - 1n;
const MAX_DECIMALS_OFFSET = 38;
const MAX_FEE_RATE = SCALAR_18 / 100n;
const MAX_SPLIT_RATE = SCALAR_18 / 2n;
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

export interface VaultAtomicState {
    totalAssets: bigint;
    totalSupply: bigint;
    decimalsOffset: number;
}

export interface VaultEstimatedOutputReference {
    readonly kind: 'estimate';
    readonly output: bigint;
}

export interface VaultRationalSlippageBound {
    readonly numerator: bigint;
    readonly denominator: bigint;
}

export interface VaultMinimumOutput {
    readonly reference: VaultEstimatedOutputReference;
    readonly maximumSlippage: VaultRationalSlippageBound;
    readonly rounding: 'floor';
    readonly minOut: bigint;
}

export interface DeriveVaultMinimumOutputInput {
    readonly reference: VaultEstimatedOutputReference;
    readonly maximumSlippage: VaultRationalSlippageBound;
}

export interface VaultOrderCreationQuoteInput {
    ledger: number;
    now: bigint;
    status: Status;
    config: TradingConfig;
    action: 'deposit' | 'redeem';
    amount: bigint;
    minOut: bigint;
    /** Required only for a Retired market redeem, which executes directly. */
    vault?: VaultAtomicState;
}

export interface VaultRestingOrderCreation {
    kind: 'resting';
    policy: 'restOnly';
    action: 'deposit' | 'redeem';
    amount: bigint;
    minOut: bigint;
    executionFee: bigint;
    createdAt: bigint;
    /** Earliest valid later price timestamp, or null at the u64 ceiling. */
    fillAfter: bigint | null;
    /** Contract cooldown boundary for a redeem, otherwise null. */
    redeemUnlockAt: bigint | null;
    /** Settlement token escrow, including executionFee. */
    escrowedAssets: bigint;
    escrowedShares: bigint;
}

export interface VaultRetiredImmediateRedeem {
    kind: 'retiredImmediateRedeem';
    policy: 'direct';
    action: 'redeem';
    shares: bigint;
    assets: bigint;
    minOutApplied: false;
    executionFee: 0n;
}

export type VaultOrderCreationOutcome =
    | VaultRestingOrderCreation
    | VaultRetiredImmediateRedeem;

export interface ExactVaultOrderCreationQuote {
    kind: 'exact';
    value: VaultOrderCreationOutcome;
    ledger: number;
    priceTime: bigint;
}

export interface ExactVaultRestingOrderCreationQuote
    extends ExactVaultOrderCreationQuote {
    value: VaultRestingOrderCreation;
}

export interface VaultQuoteOutcome {
    kind: 'deposit' | 'redeem';
    input: bigint;
    output: bigint;
    grossAssets: bigint;
    vaultFee: bigint;
    executionFee: bigint;
    netPnl: bigint;
    postVaultAssets: bigint;
    valuation: 'transactionQuoteMarkedNav';
}

export interface VaultQuoteContext {
    ledger: number;
    now: bigint;
    market: MarketData;
    config: TradingConfig;
    price: VerifiedPrice;
    vault: VaultAtomicState;
    treasuryRate: bigint;
    executionFee: bigint;
    minOut: bigint;
}

export interface VaultDepositQuoteInput extends VaultQuoteContext {
    assets: bigint;
}

export interface VaultRedeemQuoteInput extends VaultQuoteContext {
    shares: bigint;
    createdAt: bigint;
}

export interface VaultGateInput extends VaultQuoteContext {
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

function timestamp(value: bigint, label: string): bigint {
    if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
        throw new RangeError(`${label} must be a u64 bigint`);
    }
    return value;
}

function nonnegative(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
}

function checkedRate(value: bigint, maximum: bigint, label: string): bigint {
    const rate = nonnegative(value, label);
    if (rate > maximum)
        throw new RangeError(`${label} exceeds its contract bound`);
    return rate;
}

function checkedVaultState(vault: VaultAtomicState): VaultAtomicState {
    if (
        !Number.isSafeInteger(vault.decimalsOffset) ||
        vault.decimalsOffset < 0 ||
        vault.decimalsOffset > MAX_DECIMALS_OFFSET
    ) {
        throw new RangeError(
            `vault decimals offset must be an integer from 0 to ${MAX_DECIMALS_OFFSET}`,
        );
    }
    return {
        totalAssets: nonnegative(vault.totalAssets, 'vault total assets'),
        totalSupply: nonnegative(vault.totalSupply, 'vault total supply'),
        decimalsOffset: vault.decimalsOffset,
    };
}

function exchangeBasis(
    vault: VaultAtomicState,
    netPnl: bigint,
): { supply: bigint; assets: bigint } {
    const checkedVault = checkedVaultState(vault);
    const pnl = checkedI128(netPnl);
    const effectiveAssets = subI128(checkedVault.totalAssets, pnl);
    if (effectiveAssets < 0n) throw new VaultQuoteGateError(801);
    const virtualShares = checkedI128(
        10n ** BigInt(checkedVault.decimalsOffset),
    );
    return {
        supply: addI128(checkedVault.totalSupply, virtualShares),
        assets: addI128(effectiveAssets, 1n),
    };
}

/** @internal Mirrors strategy-vault preview_deposit exactly. */
export function convertVaultAssetsToShares(
    vault: VaultAtomicState,
    assets: bigint,
    netPnl: bigint,
): bigint {
    const amount = checkedI128(assets);
    if (amount < 0n) throw new VaultQuoteGateError(800);
    const basis = exchangeBasis(vault, netPnl);
    return mulDivFloor(amount, basis.supply, basis.assets);
}

/** @internal Mirrors strategy-vault preview_redeem exactly. */
export function convertVaultSharesToAssets(
    vault: VaultAtomicState,
    shares: bigint,
    netPnl: bigint,
): bigint {
    const amount = checkedI128(shares);
    if (amount < 0n) throw new VaultQuoteGateError(800);
    const basis = exchangeBasis(vault, netPnl);
    return mulDivFloor(amount, basis.assets, basis.supply);
}

function feeSplit(
    fee: bigint,
    keeperRate: bigint,
    treasuryRate: bigint,
): VaultFeeSplit {
    const amount = nonnegative(fee, 'vault fee');
    const keeper = mulDivFloor(
        amount,
        checkedRate(keeperRate, MAX_SPLIT_RATE, 'keeper rate'),
        SCALAR_18,
    );
    const treasury = mulDivFloor(
        amount,
        checkedRate(treasuryRate, MAX_SPLIT_RATE, 'treasury rate'),
        SCALAR_18,
    );
    return {
        keeper,
        treasury,
        vault: subI128(subI128(amount, keeper), treasury),
    };
}

function cappedNetPnl(
    market: MarketData,
    config: TradingConfig,
    price: VerifiedPrice,
    vaultAssets: bigint,
    maximize: boolean,
): bigint {
    const cap = sideCapacity(vaultAssets, config.maxPnlTrader);
    const long = marketSidePnl(market, price, true, maximize);
    const short = marketSidePnl(market, price, false, maximize);
    return addI128(long < cap ? long : cap, short < cap ? short : cap);
}

function prepareContext(input: VaultQuoteContext): PreparedVaultContext {
    decodeLedgerSequence(input.ledger);
    const now = timestamp(input.now, 'quote timestamp');
    const vault = checkedVaultState(input.vault);
    const executionFee = nonnegative(input.executionFee, 'execution fee');
    const minOut = checkedI128(input.minOut);
    if (minOut < 0n) throw new VaultQuoteGateError(710);
    const treasuryRate = checkedRate(
        input.treasuryRate,
        MAX_SPLIT_RATE,
        'treasury rate',
    );
    if (input.price.publishTime > now) {
        throw new RangeError(
            'verified price publish time exceeds quote timestamp',
        );
    }
    const accrued = advanceMarketAccruals(
        input.market,
        input.config,
        input.price,
        vault.totalAssets,
        now,
    ).market;
    return { market: accrued, vault, executionFee, minOut, treasuryRate };
}

function requireBookPriceFresh(price: VerifiedPrice, market: MarketData): void {
    if (
        price.publishTime < timestamp(market.lastPriceTime, 'last price time')
    ) {
        throw new VaultQuoteGateError(740);
    }
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

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
    let divisor = left;
    let remainder = right;
    while (remainder !== 0n) {
        const next = divisor % remainder;
        divisor = remainder;
        remainder = next;
    }
    return divisor;
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
        if (!input || typeof input !== 'object') {
            throw new TypeError('vault minimum output input is required');
        }
        const reference = input.reference;
        if (
            !reference ||
            typeof reference !== 'object' ||
            reference.kind !== 'estimate'
        ) {
            throw new TypeError(
                'vault output reference must be an explicit estimate',
            );
        }
        const output = checkedI128(reference.output);
        if (output < 0n) {
            throw new RangeError(
                'vault estimated output must be nonnegative',
            );
        }

        const bound = input.maximumSlippage;
        if (!bound || typeof bound !== 'object') {
            throw new TypeError('maximum slippage bound is required');
        }
        const numerator = checkedI128(bound.numerator);
        const denominator = checkedI128(bound.denominator);
        if (denominator <= 0n) {
            throw new RangeError(
                'maximum slippage denominator must be positive',
            );
        }
        if (numerator < 0n || numerator > denominator) {
            throw new RangeError(
                'maximum slippage must be between zero and one',
            );
        }

        const divisor = greatestCommonDivisor(numerator, denominator);
        const maximumSlippage = {
            numerator: numerator / divisor,
            denominator: denominator / divisor,
        } as const;
        const minOut = mulDivFloor(
            output,
            denominator - numerator,
            denominator,
        );

        return estimate(
            {
                reference: { kind: 'estimate', output },
                maximumSlippage,
                rounding: 'floor',
                minOut,
            },
            [
                'minimum output is derived from a caller-supplied estimated fill output',
                'vault order fill output can change before keeper execution',
            ],
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

function checkedStatus(value: Status): Status {
    if (
        value !== Status.Active &&
        value !== Status.OnIce &&
        value !== Status.Frozen &&
        value !== Status.Delisted &&
        value !== Status.Retired
    ) {
        throw new RangeError('market status is unknown');
    }
    return value;
}

/** Quote only the price-free creation leg of a vault order. */
export function quoteVaultOrderCreation(
    input: VaultOrderCreationQuoteInput,
): QuoteResult<VaultOrderCreationOutcome> {
    try {
        const ledger = decodeLedgerSequence(input.ledger);
        const createdAt = timestamp(
            input.now,
            'vault order creation timestamp',
        );
        const minOut = checkedI128(input.minOut);
        if (minOut < 0n) throw new VaultQuoteGateError(710);
        if (input.action !== 'deposit' && input.action !== 'redeem') {
            throw new RangeError('vault order action is unknown');
        }

        const status = checkedStatus(input.status);
        if (status === Status.Frozen) throw new VaultQuoteGateError(704);
        if (status === Status.Retired) {
            if (input.action === 'deposit') {
                throw new VaultQuoteGateError(702);
            }
            if (input.vault === undefined) {
                return unavailable(
                    'MISSING_STATE',
                    'exact vault state is required for a retired direct redeem',
                );
            }
            const vault = checkedVaultState(input.vault);
            const shares = checkedI128(input.amount);
            if (shares <= 0n) throw new VaultQuoteGateError(800);
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
                createdAt,
            );
        }

        const amount = checkedI128(input.amount);
        const executionFee = nonnegative(input.config.execFee, 'execution fee');
        if (input.action === 'deposit') {
            const minimum = nonnegative(
                input.config.minDeposit,
                'minimum deposit',
            );
            if (amount <= 0n || amount < minimum) {
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
            createdAt,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

export function quoteVaultDepositFill(
    input: VaultDepositQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    try {
        const prepared = prepareContext(input);
        requireBookPriceFresh(input.price, prepared.market);
        const assets = checkedI128(input.assets);
        if (assets <= 0n) throw new VaultQuoteGateError(800);

        const vaultFee = mulDivFloor(
            assets,
            checkedRate(input.config.depositFee, MAX_FEE_RATE, 'deposit fee'),
            SCALAR_18,
        );
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
        const maximum = nonnegative(
            input.config.maxVaultBalance,
            'maximum vault balance',
        );
        if (postVaultAssets > maximum) throw new VaultQuoteGateError(753);

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
            input.price.publishTime,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}

function saturatingTimestampAdd(left: bigint, right: bigint): bigint {
    const start = timestamp(left, 'vault order creation timestamp');
    const delta = timestamp(right, 'vault redeem lock');
    return start > U64_MAX - delta ? U64_MAX : start + delta;
}

export function quoteVaultRedeemFill(
    input: VaultRedeemQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    try {
        const prepared = prepareContext(input);
        const createdAt = timestamp(
            input.createdAt,
            'vault order creation timestamp',
        );
        if (input.price.publishTime <= createdAt) {
            throw new VaultQuoteGateError(740);
        }
        requireBookPriceFresh(input.price, prepared.market);
        if (
            input.now <
            saturatingTimestampAdd(createdAt, input.config.redeemLock)
        ) {
            throw new VaultQuoteGateError(751);
        }
        const shares = checkedI128(input.shares);
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
        const vaultFee = mulDivFloor(
            grossAssets,
            checkedRate(input.config.redeemFee, MAX_FEE_RATE, 'redeem fee'),
            SCALAR_18,
        );
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
            input.price.publishTime,
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
