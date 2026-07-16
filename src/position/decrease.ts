import { Address, StrKey } from '@stellar/stellar-sdk';
import { MAX_SIGNED_PRICE_UPDATE_BYTES } from '../data/price.js';
import { addI128, checkedI128, mulDivFloor, subI128 } from '../math/fixed.js';
import { normalizeExactRatio, type ExactRatio } from '../math/ratio.js';
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
import { positionDecreaseSnapshotBinding } from './decrease_identity.js';
import {
    quotePositionAction,
    type PositionAction,
    type PositionActionOutcome,
} from './quote.js';

export const POSITION_DECREASE_MAX_VALIDITY_LEDGERS = 60;

export type PositionDecreaseSizeIntent =
    | { readonly kind: 'full' }
    | { readonly kind: 'notional'; readonly notional: bigint }
    | { readonly kind: 'fraction'; readonly ratio: ExactRatio };

export type PositionDecreasePartialSizeIntent = Exclude<
    PositionDecreaseSizeIntent,
    { kind: 'full' }
>;

export type PositionDecreaseCollateralReturnIntent =
    | { readonly kind: 'explicit'; readonly amount: bigint }
    | { readonly kind: 'proRata' };

export type PositionDecreaseExecutionIntent =
    | {
          readonly transport: 'direct';
          readonly executionFee: bigint;
      }
    | {
          readonly transport: 'relay';
          readonly executionFee: bigint;
          readonly feeToken: ExactRelayFeeToken;
      };

interface PositionDecreaseIntentBase {
    readonly snapshot: SubjectBoundTradingSnapshot;
    readonly isLong: boolean;
    readonly execution: PositionDecreaseExecutionIntent;
    readonly maximumSlippage: ExactRatio;
    readonly validForLedgers: number;
}

export type QuotePositionDecreaseIntentInput =
    | (PositionDecreaseIntentBase & {
          readonly size: { readonly kind: 'full' };
          readonly collateralReturn?: never;
      })
    | (PositionDecreaseIntentBase & {
          readonly size: PositionDecreasePartialSizeIntent;
          readonly collateralReturn: PositionDecreaseCollateralReturnIntent;
      });

export interface QuoteMaximumPositionDecreaseIntentInput
    extends PositionDecreaseIntentBase {
    readonly collateralReturn: PositionDecreaseCollateralReturnIntent;
    readonly quantum: bigint;
}

export type CanonicalPositionDecreaseAction = Extract<
    PositionAction,
    { kind: 'decrease' | 'close' }
>;

export interface NormalizedPositionDecreaseIntent {
    readonly size: PositionDecreaseSizeIntent;
    readonly collateralReturn: PositionDecreaseCollateralReturnIntent | null;
    readonly execution: PositionDecreaseExecutionIntent;
    readonly maximumSlippage: ExactRatio;
    readonly validForLedgers: number;
}

export interface PositionDecreaseIntentIdentity {
    readonly trading: string;
    readonly router: string;
    readonly isLong: boolean;
    /** Opaque exact binding to every field of the coherent input snapshot. */
    readonly snapshotBinding: string;
}

export interface PositionDecreaseIntentOutcome {
    readonly kind: 'positionDecrease';
    readonly identity: PositionDecreaseIntentIdentity;
    readonly intent: NormalizedPositionDecreaseIntent;
    readonly action: CanonicalPositionDecreaseAction;
    readonly resolvedNotional: bigint;
    readonly resolvedCollateralReturn: bigint | null;
    readonly priceBound: bigint;
    readonly expiration: number;
    readonly outcome: PositionActionOutcome;
}

export interface ExactPositionDecreaseIntentQuote {
    readonly kind: 'exact';
    readonly value: PositionDecreaseIntentOutcome;
    readonly ledger: number;
    readonly priceTime: bigint;
}

interface ResolvedPositionDecreaseIntent {
    readonly intent: NormalizedPositionDecreaseIntent;
    readonly action: CanonicalPositionDecreaseAction;
    readonly resolvedNotional: bigint;
    readonly resolvedCollateralReturn: bigint | null;
    readonly executionFee: bigint;
    readonly relayFee: bigint;
}

const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;

function validateSnapshotBoundary(snapshot: SubjectBoundTradingSnapshot): void {
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

function validateSnapshotSubject(
    snapshot: SubjectBoundTradingSnapshot,
    isLong: boolean,
): void {
    const subject = snapshot.subject;
    if (!subject || typeof subject !== 'object') {
        throw new TypeError('snapshot subject provenance is required');
    }
    let user: string;
    try {
        user = Address.fromString(subject.user).toString();
    } catch {
        throw new TypeError(
            'snapshot subject user must be a valid Stellar address',
        );
    }
    if (user !== subject.user) {
        throw new TypeError('snapshot subject user must be canonical');
    }
    if (typeof subject.isLong !== 'boolean') {
        throw new TypeError('snapshot subject side must be boolean');
    }
    if (subject.isLong !== isLong) {
        throw new RangeError('position side must match snapshot subject');
    }
}

function nonnegativeAtomic(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
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
    execution: PositionDecreaseExecutionIntent,
    snapshot: SubjectBoundTradingSnapshot,
): PositionDecreaseExecutionIntent {
    if (!execution || typeof execution !== 'object') {
        throw new TypeError('position decrease execution intent is required');
    }
    const executionFee = nonnegativeAtomic(
        execution.executionFee,
        'execution fee',
    );
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
        return { transport: 'direct', executionFee };
    }
    if (execution.transport !== 'relay') {
        throw new TypeError('position decrease transport is unknown');
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
    return {
        transport: 'relay',
        executionFee,
        feeToken: cloneExactRelayFeeToken(execution.feeToken),
    };
}

function positionDecreaseExpiration(
    ledger: number,
    validForLedgers: number,
): number {
    const current = decodeLedgerSequence(ledger);
    if (
        !Number.isSafeInteger(validForLedgers) ||
        validForLedgers <= 0 ||
        validForLedgers > POSITION_DECREASE_MAX_VALIDITY_LEDGERS
    ) {
        throw new RangeError(
            `position decrease validity must be an integer from 1 through ${POSITION_DECREASE_MAX_VALIDITY_LEDGERS} ledgers`,
        );
    }
    if (current > U32_MAX - validForLedgers) {
        throw new RangeError(
            'position decrease expiration exceeds the u32 ceiling',
        );
    }
    return current + validForLedgers;
}

function resolveNotional(
    size: PositionDecreaseSizeIntent,
    positionNotional: bigint,
): { size: PositionDecreaseSizeIntent; notional: bigint } {
    if (!size || typeof size !== 'object') {
        throw new TypeError('position decrease size intent is required');
    }
    if (size.kind === 'full') {
        return { size: { kind: 'full' }, notional: positionNotional };
    }
    if (size.kind === 'notional') {
        const notional = checkedI128(size.notional);
        if (notional <= 0n) {
            throw new RangeError('position decrease notional must be positive');
        }
        if (notional > positionNotional) {
            throw new RangeError(
                'position decrease notional exceeds position notional',
            );
        }
        return {
            size: { kind: 'notional', notional },
            notional,
        };
    }
    if (size.kind !== 'fraction') {
        throw new TypeError('position decrease size kind is unknown');
    }
    const ratio = normalizeExactRatio(size.ratio, {
        label: 'position size fraction',
        minimum: 1n,
        allowOne: true,
    });
    const notional = mulDivFloor(
        positionNotional,
        ratio.numerator,
        ratio.denominator,
    );
    if (notional === 0n) {
        throw new RangeError(
            'position size fraction resolves to zero atomic notional',
        );
    }
    return { size: { kind: 'fraction', ratio }, notional };
}

function resolvePositionDecreaseIntent(
    input: QuotePositionDecreaseIntentInput,
): ResolvedPositionDecreaseIntent {
    if (!input || typeof input !== 'object') {
        throw new TypeError('position decrease intent input is required');
    }
    if (!input.snapshot || typeof input.snapshot !== 'object') {
        throw new TypeError('trading snapshot is required');
    }
    if (typeof input.isLong !== 'boolean') {
        throw new TypeError('position side must be boolean');
    }
    validateSnapshotSubject(input.snapshot, input.isLong);
    validateSnapshotBoundary(input.snapshot);

    const positionNotional = nonnegativeAtomic(
        input.snapshot.position.notional,
        'position notional',
    );
    const positionCollateral = nonnegativeAtomic(
        input.snapshot.position.collateral,
        'position collateral',
    );
    const resolvedSize = resolveNotional(input.size, positionNotional);
    const full = resolvedSize.notional === positionNotional;
    if (input.size.kind !== 'full' && full) {
        throw new RangeError(
            "whole-position decrease must use size kind 'full'",
        );
    }

    let collateralReturn: PositionDecreaseCollateralReturnIntent | null;
    let resolvedCollateralReturn: bigint | null;
    let action: CanonicalPositionDecreaseAction;
    if (input.size.kind === 'full') {
        if (Object.prototype.hasOwnProperty.call(input, 'collateralReturn')) {
            throw new TypeError(
                'full position decrease does not accept collateralReturn',
            );
        }
        collateralReturn = null;
        resolvedCollateralReturn = null;
        action = { kind: 'close' };
    } else {
        const requested = input.collateralReturn;
        if (!requested || typeof requested !== 'object') {
            throw new TypeError(
                'partial position decrease requires collateralReturn',
            );
        }
        if (requested.kind === 'explicit') {
            const amount = nonnegativeAtomic(
                requested.amount,
                'collateral return',
            );
            if (amount > positionCollateral) {
                throw new RangeError(
                    'collateral return exceeds position collateral',
                );
            }
            collateralReturn = { kind: 'explicit', amount };
            resolvedCollateralReturn = amount;
        } else if (requested.kind === 'proRata') {
            collateralReturn = { kind: 'proRata' };
            resolvedCollateralReturn = mulDivFloor(
                positionCollateral,
                resolvedSize.notional,
                positionNotional,
            );
        } else {
            throw new TypeError('collateral return kind is unknown');
        }
        action = full
            ? { kind: 'close' }
            : {
                  kind: 'decrease',
                  notional: resolvedSize.notional,
                  collateral: resolvedCollateralReturn,
              };
    }

    const execution = normalizeExecution(input.execution, input.snapshot);
    const configuredExecutionFee = nonnegativeAtomic(
        input.snapshot.config.execFee,
        'snapshot config execution fee',
    );
    if (execution.executionFee !== configuredExecutionFee) {
        throw new RangeError(
            'execution fee must equal snapshot config execFee',
        );
    }
    const maximumSlippage = normalizeExactRatio(input.maximumSlippage, {
        label: 'maximum slippage',
        minimum: 0n,
        allowOne: false,
    });
    const expiration = positionDecreaseExpiration(
        input.snapshot.ledger,
        input.validForLedgers,
    );
    return {
        intent: {
            size: resolvedSize.size,
            collateralReturn,
            execution,
            maximumSlippage,
            validForLedgers: expiration - input.snapshot.ledger,
        },
        action,
        resolvedNotional: resolvedSize.notional,
        resolvedCollateralReturn: full ? null : resolvedCollateralReturn,
        executionFee: execution.executionFee,
        relayFee:
            execution.transport === 'relay'
                ? execution.feeToken.maxSignedFeeAtomic
                : 0n,
    };
}

/**
 * Quote one exact close or partial decrease from one coherent trading snapshot.
 */
export function quotePositionDecreaseIntent(
    input: QuotePositionDecreaseIntentInput,
): QuoteResult<PositionDecreaseIntentOutcome> {
    try {
        const resolved = resolvePositionDecreaseIntent(input);
        if (
            input.snapshot.status === Status.Frozen ||
            input.snapshot.status === Status.Retired
        ) {
            return unavailable(
                'CONTRACT_GATE',
                'contract error #704: market status blocks order creation',
            );
        }
        const positionQuote = quotePositionAction({
            ledger: input.snapshot.ledger,
            now: input.snapshot.ledgerTime,
            isLong: input.isLong,
            position: input.snapshot.position,
            market: input.snapshot.market,
            config: input.snapshot.config,
            price: input.snapshot.price,
            vaultAssets: input.snapshot.vault.totalAssets,
            treasuryRate: input.snapshot.treasuryRate,
            action: resolved.action,
            executionFee: resolved.executionFee,
            relayFee: resolved.relayFee,
        });
        if (positionQuote.kind === 'unavailable') return positionQuote;
        if (positionQuote.kind === 'estimate') {
            return unavailable(
                'INVALID_INPUT',
                'position decrease requires exact action provenance',
            );
        }
        const adversePrice = mulDivFloor(
            positionQuote.value.executionPrice,
            resolved.intent.maximumSlippage.numerator,
            resolved.intent.maximumSlippage.denominator,
        );
        const priceBound = input.isLong
            ? subI128(positionQuote.value.executionPrice, adversePrice)
            : addI128(positionQuote.value.executionPrice, adversePrice);

        return exact(
            {
                kind: 'positionDecrease',
                identity: {
                    trading: input.snapshot.deployment.trading,
                    router: input.snapshot.deployment.router,
                    isLong: input.isLong,
                    snapshotBinding: positionDecreaseSnapshotBinding(
                        input.snapshot,
                    ),
                },
                intent: resolved.intent,
                action: resolved.action,
                resolvedNotional: resolved.resolvedNotional,
                resolvedCollateralReturn: resolved.resolvedCollateralReturn,
                priceBound,
                expiration:
                    input.snapshot.ledger + resolved.intent.validForLedgers,
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
                : 'invalid position decrease intent',
        );
    }
}

/**
 * Return the greatest exact partial-decrease quote aligned to `quantum` while
 * preserving the snapshot's live decrease lock and minimum position notional.
 */
export function quoteMaximumPositionDecreaseIntent(
    input: QuoteMaximumPositionDecreaseIntentInput,
): QuoteResult<PositionDecreaseIntentOutcome> {
    try {
        if (!input || typeof input !== 'object') {
            throw new TypeError('maximum position decrease input is required');
        }
        const quantum = checkedI128(input.quantum);
        if (quantum <= 0n) {
            throw new RangeError('position decrease quantum must be positive');
        }
        validateSnapshotSubject(input.snapshot, input.isLong);
        validateSnapshotBoundary(input.snapshot);
        const positionNotional = nonnegativeAtomic(
            input.snapshot.position.notional,
            'position notional',
        );
        const configuredMinimum = nonnegativeAtomic(
            input.snapshot.config.minPositionNotional,
            'minimum position notional',
        );
        const lockedNotional = nonnegativeAtomic(
            input.snapshot.position.lockedNotional,
            'locked position notional',
        );
        const unlocksAt = input.snapshot.position.unlocksAt;
        if (
            typeof unlocksAt !== 'bigint' ||
            unlocksAt < 0n ||
            unlocksAt > U64_MAX
        ) {
            throw new RangeError('position unlock timestamp must be a u64 bigint');
        }
        const liveLocked =
            input.snapshot.ledgerTime < unlocksAt ? lockedNotional : 0n;
        const requiredRemainder =
            liveLocked > configuredMinimum ? liveLocked : configuredMinimum;
        if (positionNotional <= requiredRemainder) {
            return unavailable(
                'CONTRACT_GATE',
                'no partial position decrease fits the requested quantum',
            );
        }
        const hardHeadroom = subI128(positionNotional, requiredRemainder);
        let high = hardHeadroom / quantum;
        const minimumOrder = nonnegativeAtomic(
            input.snapshot.config.minOrderNotional,
            'minimum order notional',
        );
        let low = minimumOrder / quantum;
        if (minimumOrder % quantum !== 0n) low += 1n;
        if (low < 1n) low = 1n;
        if (low > high) {
            return unavailable(
                'CONTRACT_GATE',
                'no partial position decrease fits the requested quantum',
            );
        }

        let best:
            | Extract<
                  QuoteResult<PositionDecreaseIntentOutcome>,
                  { kind: 'exact' }
              >
            | undefined;
        while (low <= high) {
            const middle = low + (high - low) / 2n;
            const notional = checkedI128(middle * quantum);
            const result = quotePositionDecreaseIntent({
                snapshot: input.snapshot,
                isLong: input.isLong,
                size: { kind: 'notional', notional },
                collateralReturn: input.collateralReturn,
                execution: input.execution,
                maximumSlippage: input.maximumSlippage,
                validForLedgers: input.validForLedgers,
            });
            if (result.kind === 'exact') {
                best = result;
                low = middle + 1n;
            } else {
                high = middle - 1n;
            }
        }
        return (
            best ??
            unavailable(
                'CONTRACT_GATE',
                'no exact partial position decrease fits the requested quantum',
            )
        );
    } catch (error) {
        return unavailable(
            'INVALID_INPUT',
            error instanceof Error
                ? error.message
                : 'invalid maximum position decrease input',
        );
    }
}
