import { Address, StrKey } from '@stellar/stellar-sdk';
import { MAX_SIGNED_PRICE_UPDATE_BYTES } from '../data/price.js';
import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivFloor,
    subI128,
} from '../math/fixed.js';
import { normalizeExactRatio, type ExactRatio } from '../math/ratio.js';
import { entryPrice } from '../market/capacity.js';
import { advanceMarketAccruals } from '../market/rates.js';
import {
    cloneExactRelayFeeToken,
    exactRelayFeeTokenIssue,
    type ExactRelayFeeToken,
} from '../order/fee_token.js';
import {
    decodeLedgerSequence,
    exact,
    unavailable,
    type QuoteResult,
} from '../quote/result.js';
import type { SubjectBoundTradingSnapshot } from '../trading/trading_snapshot.js';
import { Status } from '../trading/trading_types.js';
import { canonicalIdentity } from './decrease_identity.js';
import { quotePositionFees } from './fees.js';
import { quotePositionAction, type PositionActionOutcome } from './quote.js';

export const POSITION_INCREASE_MAX_VALIDITY_LEDGERS = 60;

export type PositionIncreaseExecutionIntent =
    | {
          readonly transport: 'direct';
          readonly executionFee: bigint;
      }
    | {
          readonly transport: 'relay';
          readonly executionFee: bigint;
          readonly feeToken: ExactRelayFeeToken;
      };

export interface QuotePositionIncreaseIntentInput {
    readonly snapshot: SubjectBoundTradingSnapshot;
    readonly notional: bigint;
    /** Exact margin added after base, impact, borrowing, and paid funding. */
    readonly desiredPostFeeMarginDelta: bigint;
    readonly execution: PositionIncreaseExecutionIntent;
    readonly maximumSlippage: ExactRatio;
    readonly validForLedgers: number;
}

/**
 * Exact inputs for selecting a fillable position increase on a caller-chosen
 * atomic quantum (for example `100_000n` for a 0.01 token display step at 7
 * decimals). The wallet ceiling includes collateral, execution fee, and the
 * relay maximum exactly as reported by the returned quote.
 */
export interface QuoteMaximumPositionIncreaseIntentInput
    extends Omit<QuotePositionIncreaseIntentInput, 'notional'> {
    readonly maximumWalletDebit: bigint;
    readonly quantum: bigint;
}

export interface NormalizedPositionIncreaseIntent {
    readonly notional: bigint;
    readonly desiredPostFeeMarginDelta: bigint;
    readonly execution: PositionIncreaseExecutionIntent;
    readonly maximumSlippage: ExactRatio;
    readonly validForLedgers: number;
}

export interface PositionIncreaseIntentIdentity {
    readonly trading: string;
    readonly router: string;
    readonly collateralToken: string;
    readonly user: string;
    readonly isLong: boolean;
    /** Opaque exact binding to every field of the coherent input snapshot. */
    readonly snapshotBinding: string;
}

export interface PositionIncreaseIntentOutcome {
    readonly kind: 'positionIncrease';
    readonly identity: PositionIncreaseIntentIdentity;
    readonly intent: NormalizedPositionIncreaseIntent;
    /** Collateral escrowed by `create_order`, before the fill's margin debit. */
    readonly grossOrderCollateral: bigint;
    /** Conservative wallet debit: collateral + exec fee + relay maximum. */
    readonly walletMaximumDebit: bigint;
    readonly priceBound: bigint;
    readonly expiration: number;
    readonly outcome: PositionActionOutcome;
}

export interface ExactPositionIncreaseIntentQuote {
    readonly kind: 'exact';
    readonly value: PositionIncreaseIntentOutcome;
    readonly ledger: number;
    readonly priceTime: bigint;
}

interface ResolvedExecution {
    readonly intent: PositionIncreaseExecutionIntent;
    readonly executionFee: bigint;
    readonly relayFee: bigint;
}

const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;

function nonnegativeAtomic(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
}

function canonicalUser(value: string): string {
    let canonical: string;
    try {
        canonical = Address.fromString(value).toString();
    } catch {
        throw new TypeError(
            'snapshot subject user must be a valid Stellar address',
        );
    }
    if (canonical !== value) {
        throw new TypeError('snapshot subject user must be canonical');
    }
    return canonical;
}

function validateSnapshot(snapshot: SubjectBoundTradingSnapshot): void {
    if (!snapshot || typeof snapshot !== 'object') {
        throw new TypeError('trading snapshot is required');
    }
    decodeLedgerSequence(snapshot.ledger);
    if (
        typeof snapshot.ledgerTime !== 'bigint' ||
        snapshot.ledgerTime < 0n ||
        snapshot.ledgerTime > U64_MAX
    ) {
        throw new RangeError('snapshot ledger time must be a u64 bigint');
    }
    if (
        !snapshot.deployment ||
        typeof snapshot.deployment !== 'object' ||
        !StrKey.isValidContract(snapshot.deployment.trading) ||
        !StrKey.isValidContract(snapshot.deployment.router)
    ) {
        throw new TypeError(
            'snapshot trading and Router identities must be valid contract IDs',
        );
    }
    if (
        !snapshot.subject ||
        typeof snapshot.subject !== 'object' ||
        typeof snapshot.subject.isLong !== 'boolean'
    ) {
        throw new TypeError('snapshot subject provenance is required');
    }
    canonicalUser(snapshot.subject.user);
    if (
        !snapshot.adl ||
        typeof snapshot.adl !== 'object' ||
        typeof snapshot.adl.long !== 'boolean' ||
        typeof snapshot.adl.short !== 'boolean'
    ) {
        throw new TypeError('snapshot ADL provenance is required');
    }
    if (!StrKey.isValidContract(snapshot.collateralToken)) {
        throw new TypeError(
            'snapshot collateral token must be a valid contract ID',
        );
    }
    if (
        snapshot.status !== Status.Active &&
        snapshot.status !== Status.OnIce &&
        snapshot.status !== Status.Frozen &&
        snapshot.status !== Status.Delisted &&
        snapshot.status !== Status.Retired
    ) {
        throw new RangeError('snapshot market status is unknown');
    }

    const price = snapshot.price;
    if (!price || typeof price !== 'object') {
        throw new TypeError('snapshot verified price is required');
    }
    const bid = checkedI128(price.bid);
    const ask = checkedI128(price.ask);
    if (
        price.feedId !== snapshot.deployment.feedId ||
        price.exponent !== snapshot.deployment.exponent
    ) {
        throw new RangeError(
            'snapshot verified price identity does not match deployment',
        );
    }
    if (bid <= 0n || ask < bid) {
        throw new RangeError('snapshot verified price is malformed');
    }
    if (
        typeof price.publishTime !== 'bigint' ||
        price.publishTime < 0n ||
        price.publishTime > snapshot.ledgerTime ||
        price.publishTime > U64_MAX
    ) {
        throw new RangeError(
            'snapshot verified price time is outside its ledger boundary',
        );
    }
    if (price.source !== 'pyth' && price.source !== 'terminal') {
        throw new RangeError('snapshot verified price source is unknown');
    }
    if (
        !(snapshot.priceUpdate instanceof Uint8Array) ||
        snapshot.priceUpdate.byteLength === 0 ||
        snapshot.priceUpdate.byteLength > MAX_SIGNED_PRICE_UPDATE_BYTES
    ) {
        throw new TypeError(
            'snapshot price update must contain no more than 32 KiB of bytes',
        );
    }
}

function snapshotAssetDecimals(snapshot: SubjectBoundTradingSnapshot): number {
    const { vaultDecimalsOffset, vaultShareDecimals } = snapshot.deployment;
    if (
        !Number.isSafeInteger(vaultDecimalsOffset) ||
        !Number.isSafeInteger(vaultShareDecimals) ||
        vaultDecimalsOffset < 0 ||
        vaultShareDecimals < vaultDecimalsOffset ||
        vaultShareDecimals > 38
    ) {
        throw new RangeError('snapshot vault decimal provenance is invalid');
    }
    return vaultShareDecimals - vaultDecimalsOffset;
}

function normalizeExecution(
    execution: PositionIncreaseExecutionIntent,
    snapshot: SubjectBoundTradingSnapshot,
): ResolvedExecution {
    if (!execution || typeof execution !== 'object') {
        throw new TypeError('position increase execution intent is required');
    }
    const executionFee = nonnegativeAtomic(
        execution.executionFee,
        'execution fee',
    );
    if (
        executionFee !== nonnegativeAtomic(snapshot.config.execFee, 'execFee')
    ) {
        throw new RangeError(
            'execution fee must equal snapshot config execFee',
        );
    }
    if (execution.transport === 'direct') {
        if (
            Object.prototype.hasOwnProperty.call(execution, 'feeToken') ||
            Object.prototype.hasOwnProperty.call(execution, 'relayFee') ||
            Object.prototype.hasOwnProperty.call(execution, 'maxFeeAmount')
        ) {
            throw new TypeError(
                'direct execution does not accept relay fee configuration',
            );
        }
        return {
            intent: { transport: 'direct', executionFee },
            executionFee,
            relayFee: 0n,
        };
    }
    if (execution.transport !== 'relay') {
        throw new TypeError('position increase transport is unknown');
    }
    if (
        Object.prototype.hasOwnProperty.call(execution, 'relayFee') ||
        Object.prototype.hasOwnProperty.call(execution, 'maxFeeAmount')
    ) {
        throw new TypeError(
            'relay maximum is derived from the exact fee-token configuration',
        );
    }
    const issue = exactRelayFeeTokenIssue(execution.feeToken);
    if (issue !== undefined) throw new TypeError(issue);
    if (execution.feeToken.contractId !== snapshot.collateralToken) {
        throw new RangeError(
            'relay fee token must equal the snapshot collateral token',
        );
    }
    if (execution.feeToken.decimals !== snapshotAssetDecimals(snapshot)) {
        throw new RangeError(
            'relay fee token decimals do not match snapshot collateral decimals',
        );
    }
    const feeToken = cloneExactRelayFeeToken(execution.feeToken);
    return {
        intent: { transport: 'relay', executionFee, feeToken },
        executionFee,
        relayFee: feeToken.maxSignedFeeAtomic,
    };
}

function expiration(ledger: number, validForLedgers: number): number {
    const current = decodeLedgerSequence(ledger);
    if (
        !Number.isSafeInteger(validForLedgers) ||
        validForLedgers <= 0 ||
        validForLedgers > POSITION_INCREASE_MAX_VALIDITY_LEDGERS
    ) {
        throw new RangeError(
            `position increase validity must be an integer from 1 through ${POSITION_INCREASE_MAX_VALIDITY_LEDGERS} ledgers`,
        );
    }
    if (current > U32_MAX - validForLedgers) {
        throw new RangeError(
            'position increase expiration exceeds the u32 ceiling',
        );
    }
    return current + validForLedgers;
}

/** Quote one exact atomic market open or size-growing increase. */
export function quotePositionIncreaseIntent(
    input: QuotePositionIncreaseIntentInput,
): QuoteResult<PositionIncreaseIntentOutcome> {
    try {
        if (!input || typeof input !== 'object') {
            throw new TypeError('position increase intent input is required');
        }
        if (
            Object.prototype.hasOwnProperty.call(input, 'user') ||
            Object.prototype.hasOwnProperty.call(input, 'isLong')
        ) {
            throw new TypeError(
                'position increase user and side come from snapshot subject provenance',
            );
        }
        validateSnapshot(input.snapshot);
        const snapshot = input.snapshot;
        const { user, isLong } = snapshot.subject;
        const notional = checkedI128(input.notional);
        if (notional <= 0n) {
            throw new RangeError('position increase notional must be positive');
        }
        const minimumOrder = nonnegativeAtomic(
            snapshot.config.minOrderNotional,
            'minimum order notional',
        );
        if (minimumOrder <= 0n || notional < minimumOrder) {
            throw new RangeError(
                'position increase notional is below the order dust floor',
            );
        }
        const desiredPostFeeMarginDelta = nonnegativeAtomic(
            input.desiredPostFeeMarginDelta,
            'desired post-fee margin delta',
        );
        const resolvedExecution = normalizeExecution(input.execution, snapshot);
        const maximumSlippage = normalizeExactRatio(input.maximumSlippage, {
            label: 'maximum slippage',
            minimum: 0n,
            allowOne: false,
        });
        const quotedExpiration = expiration(
            snapshot.ledger,
            input.validForLedgers,
        );

        if (
            snapshot.status === Status.Frozen ||
            snapshot.status === Status.Retired
        ) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #704: market status blocks order creation',
            );
        }
        if (
            snapshot.status !== Status.Active ||
            (isLong ? snapshot.adl.long : snapshot.adl.short)
        ) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #705: market status or ADL blocks position increases',
            );
        }

        const advancedMarket = advanceMarketAccruals(
            snapshot.market,
            snapshot.config,
            snapshot.price,
            snapshot.vault.totalAssets,
            snapshot.ledgerTime,
        ).market;
        const executionPrice = entryPrice(snapshot.price, isLong);
        const tokens = mulDivFloor(notional, SCALAR_18, executionPrice);
        const preliminaryFees = quotePositionFees({
            position: snapshot.position,
            market: advancedMarket,
            config: snapshot.config,
            isLong,
            signedNotional: notional,
            signedTokens: tokens,
            executionFee: resolvedExecution.executionFee,
            relayFee: resolvedExecution.relayFee,
        }).fees;
        const grossOrderCollateral = addI128(
            desiredPostFeeMarginDelta,
            preliminaryFees.marginDebit,
        );
        const minimumCollateral = nonnegativeAtomic(
            snapshot.config.minOrderCollateral,
            'minimum order collateral',
        );
        if (
            minimumCollateral <= 0n ||
            (grossOrderCollateral > 0n &&
                grossOrderCollateral < minimumCollateral)
        ) {
            throw new RangeError(
                'position increase collateral is below the order dust floor',
            );
        }

        const positionQuote = quotePositionAction({
            ledger: snapshot.ledger,
            now: snapshot.ledgerTime,
            isLong,
            position: snapshot.position,
            market: snapshot.market,
            config: snapshot.config,
            price: snapshot.price,
            vaultAssets: snapshot.vault.totalAssets,
            treasuryRate: snapshot.treasuryRate,
            action: {
                kind: 'increase',
                notional,
                collateral: grossOrderCollateral,
            },
            executionFee: resolvedExecution.executionFee,
            relayFee: resolvedExecution.relayFee,
        });
        if (positionQuote.kind === 'unavailable') return positionQuote;
        if (positionQuote.kind === 'estimate') {
            return unavailable(
                'INVALID_INPUT',
                'position increase requires exact action provenance',
            );
        }
        if (
            positionQuote.value.fees.marginDebit !== preliminaryFees.marginDebit
        ) {
            throw new RangeError(
                'position increase fee quote changed across one coherent snapshot',
            );
        }
        const actualMarginDelta = subI128(
            positionQuote.value.postPosition.collateral,
            snapshot.position.collateral,
        );
        if (actualMarginDelta !== desiredPostFeeMarginDelta) {
            throw new RangeError(
                'position increase post-fee margin delta invariant failed',
            );
        }

        const adversePrice = mulDivFloor(
            positionQuote.value.executionPrice,
            maximumSlippage.numerator,
            maximumSlippage.denominator,
        );
        const priceBound = isLong
            ? addI128(positionQuote.value.executionPrice, adversePrice)
            : subI128(positionQuote.value.executionPrice, adversePrice);
        const walletMaximumDebit = addI128(
            addI128(grossOrderCollateral, resolvedExecution.executionFee),
            resolvedExecution.relayFee,
        );

        return exact(
            {
                kind: 'positionIncrease',
                identity: {
                    trading: snapshot.deployment.trading,
                    router: snapshot.deployment.router,
                    collateralToken: snapshot.collateralToken,
                    user,
                    isLong,
                    snapshotBinding: canonicalIdentity(snapshot),
                },
                intent: {
                    notional,
                    desiredPostFeeMarginDelta,
                    execution: resolvedExecution.intent,
                    maximumSlippage,
                    validForLedgers: quotedExpiration - snapshot.ledger,
                },
                grossOrderCollateral,
                walletMaximumDebit,
                priceBound,
                expiration: quotedExpiration,
                outcome: positionQuote.value,
            },
            positionQuote.ledger,
            positionQuote.priceTime,
        );
    } catch (error) {
        return unavailable(
            'INVALID_INPUT',
            error instanceof Error
                ? error.message
                : 'invalid position increase intent',
        );
    }
}

/**
 * Return the greatest exact position-increase quote aligned to `quantum` that
 * fits the snapshot's hard position/open-interest ceilings and wallet debit.
 */
export function quoteMaximumPositionIncreaseIntent(
    input: QuoteMaximumPositionIncreaseIntentInput,
): QuoteResult<PositionIncreaseIntentOutcome> {
    try {
        if (!input || typeof input !== 'object') {
            throw new TypeError('maximum position increase input is required');
        }
        if (
            Object.prototype.hasOwnProperty.call(input, 'user') ||
            Object.prototype.hasOwnProperty.call(input, 'isLong')
        ) {
            throw new TypeError(
                'position increase user and side come from snapshot subject provenance',
            );
        }
        const quantum = checkedI128(input.quantum);
        if (quantum <= 0n) {
            throw new RangeError('position increase quantum must be positive');
        }
        const maximumWalletDebit = nonnegativeAtomic(
            input.maximumWalletDebit,
            'maximum wallet debit',
        );
        validateSnapshot(input.snapshot);
        const snapshot = input.snapshot;
        const sideNotional = snapshot.subject.isLong
            ? snapshot.market.notional.long
            : snapshot.market.notional.short;
        const maximumPositionNotional = nonnegativeAtomic(
            snapshot.config.maxPositionNotional,
            'maximum position notional',
        );
        const positionNotional = nonnegativeAtomic(
            snapshot.position.notional,
            'position notional',
        );
        const maximumOpenInterest = nonnegativeAtomic(
            snapshot.config.maxOpenInterest,
            'maximum open interest',
        );
        const marketSideNotional = nonnegativeAtomic(
            sideNotional,
            'market side notional',
        );
        if (
            positionNotional >= maximumPositionNotional ||
            marketSideNotional >= maximumOpenInterest
        ) {
            return unavailable(
                'CONTRACT_GATE',
                'no position increase fits the requested quantum',
            );
        }
        const positionHeadroom = subI128(
            maximumPositionNotional,
            positionNotional,
        );
        const marketHeadroom = subI128(
            maximumOpenInterest,
            marketSideNotional,
        );
        const hardHeadroom =
            positionHeadroom < marketHeadroom
                ? positionHeadroom
                : marketHeadroom;
        let high = hardHeadroom / quantum;
        if (high <= 0n) {
            return unavailable(
                'CONTRACT_GATE',
                'no position increase fits the requested quantum',
            );
        }

        const minimumOrderNotional = nonnegativeAtomic(
            snapshot.config.minOrderNotional,
            'minimum order notional',
        );
        const minimumPositionIncrease =
            positionNotional === 0n
                ? nonnegativeAtomic(
                      snapshot.config.minPositionNotional,
                      'minimum position notional',
                  )
                : 0n;
        const minimumNotional =
            minimumOrderNotional > minimumPositionIncrease
                ? minimumOrderNotional
                : minimumPositionIncrease;
        let low = minimumNotional / quantum;
        if (minimumNotional % quantum !== 0n) low += 1n;
        if (low < 1n) low = 1n;
        if (low > high) {
            return unavailable(
                'CONTRACT_GATE',
                'no position increase fits the requested quantum',
            );
        }

        // With one frozen snapshot, margin, reserve, OI, and wallet-debit gates
        // form an upper boundary as notional grows. The only lower boundary is
        // the configured order/position dust floor (plus collateral dust), so
        // a bigint binary search can select the greatest admissible quantum
        // without converting transaction inputs through JavaScript numbers.
        let best:
            | Extract<
                  QuoteResult<PositionIncreaseIntentOutcome>,
                  { kind: 'exact' }
              >
            | undefined;
        let lastUnavailable:
            | Extract<
                  QuoteResult<PositionIncreaseIntentOutcome>,
                  { kind: 'unavailable' }
              >
            | undefined;
        while (low <= high) {
            const middle = low + (high - low) / 2n;
            const notional = checkedI128(middle * quantum);
            const result = quotePositionIncreaseIntent({
                snapshot,
                notional,
                desiredPostFeeMarginDelta: input.desiredPostFeeMarginDelta,
                execution: input.execution,
                maximumSlippage: input.maximumSlippage,
                validForLedgers: input.validForLedgers,
            });
            if (
                result.kind === 'exact' &&
                result.value.walletMaximumDebit <= maximumWalletDebit
            ) {
                best = result;
                low = middle + 1n;
                continue;
            }
            if (result.kind === 'unavailable') {
                lastUnavailable = result;
            }
            if (
                result.kind === 'unavailable' &&
                result.code === 'INVALID_INPUT' &&
                (result.reason.includes('notional is below') ||
                    result.reason.includes('collateral is below'))
            ) {
                low = middle + 1n;
                continue;
            }
            if (
                result.kind === 'unavailable' &&
                result.code === 'INVALID_INPUT' &&
                !result.reason.includes('outside the i128 range')
            ) {
                return result;
            }
            high = middle - 1n;
        }
        return (
            best ??
            lastUnavailable ??
            unavailable(
                'CONTRACT_GATE',
                'no exact position increase fits the requested quantum and wallet debit',
            )
        );
    } catch (error) {
        return unavailable(
            'INVALID_INPUT',
            error instanceof Error
                ? error.message
                : 'invalid maximum position increase input',
        );
    }
}
