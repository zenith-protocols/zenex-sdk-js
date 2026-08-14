import {
    BPS_DENOMINATOR,
    SCALAR_18,
    addI128,
    checkedBps,
    checkedI128,
    mulDivFloor,
    subI128,
} from '../../math/fixed.js';
import { marketSidePnl, sideCapacity } from '../market/capacity.js';
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

export interface VaultAtomicState {
    totalAssets: bigint;
    totalSupply: bigint;
    decimalsOffset: number;
}

export interface VaultEstimatedOutputReference {
    readonly kind: 'estimate';
    readonly output: bigint;
}

export interface VaultMinimumOutput {
    readonly reference: VaultEstimatedOutputReference;
    /** Maximum slippage in basis points (10_000 = 100%). */
    readonly maximumSlippageBps: bigint;
    readonly rounding: 'floor';
    readonly minOut: bigint;
}

export interface DeriveVaultMinimumOutputInput {
    readonly reference: VaultEstimatedOutputReference;
    /** Maximum slippage in basis points (10_000 = 100%). */
    readonly maximumSlippageBps: bigint;
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
    VaultRestingOrderCreation | VaultRetiredImmediateRedeem;

export interface ExactVaultOrderCreationQuote {
    kind: 'exact';
    value: VaultOrderCreationOutcome;
    ledger: number;
}

export interface ExactVaultRestingOrderCreationQuote extends ExactVaultOrderCreationQuote {
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
    price: PriceData;
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

/** @internal Mirrors strategy-vault preview_deposit exactly. */
export function convertVaultAssetsToShares(
    vault: VaultAtomicState,
    assets: bigint,
    netPnl: bigint,
): bigint {
    if (assets < 0n) throw new VaultQuoteGateError(800);
    const basis = exchangeBasis(vault, netPnl);
    return mulDivFloor(assets, basis.supply, basis.assets);
}

/** @internal Mirrors strategy-vault preview_redeem exactly. */
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

/** Quote only the price-free creation leg of a vault order. */
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
            if (input.vault === undefined) {
                return unavailable(
                    'MISSING_STATE',
                    'exact vault state is required for a retired direct redeem',
                );
            }
            const vault = input.vault;
            const shares = input.amount;
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

export function quoteVaultDepositFill(
    input: VaultDepositQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    try {
        const prepared = prepareContext(input);
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

export function quoteVaultRedeemFill(
    input: VaultRedeemQuoteInput,
): QuoteResult<VaultQuoteOutcome> {
    try {
        const prepared = prepareContext(input);
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
