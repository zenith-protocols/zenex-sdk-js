import type { MarketData, Position, SidePair, MarketConfig } from '../../contracts/market/types.js';
import { SCALAR_18, addI128, checkedI128, mulDivCeil, mulDivFloor, subI128 } from '../../math/fixed.js';
import { advanceMarketAccruals, entryPrice, exactPositionPnl, exitPrice, marketSidePnl, quoteTradeFees, sideCapacity, sideReserved } from './math.js';
import type { PriceData } from './math.js';
import { quotePositionFees } from './position.js';
import type { PositionFeeBreakdown } from './position.js';
/** Inclusive upper bound for a u32 ledger sequence. */
const U32_MAX = 4_294_967_295;

/**
 * Why a `QuoteResult` came back `unavailable` instead of a value.
 * `MISSING_STATE` is a state argument the quote needed but the caller did not
 * supply. `INVALID_INPUT` is an argument the SDK rejected before contract
 * math ran. `CONTRACT_OVERFLOW` is a value outside the i128 range.
 * `CONTRACT_GATE` mirrors a contract error; the `reason` string on the
 * result names which one, and `contractCode` carries its number.
 */
export type QuoteUnavailableCode =
    | 'MISSING_STATE'
    | 'INVALID_INPUT'
    | 'CONTRACT_OVERFLOW'
    | 'CONTRACT_GATE';

/**
 * The outcome of a quote call across the quoting API. Check `kind` before you
 * read `value`; a business-logic failure never throws, it comes back
 * `unavailable` instead.
 *
 * `exact` prices the call against on-chain state as of `ledger`, a ledger
 * sequence. `estimate` is a caller-side preview; `assumptions` lists the
 * facts it took as true, and any of them can change before a fill.
 * `unavailable` carries a `code` to branch on and a `reason` string for logs,
 * not for parsing. When `code` is `CONTRACT_GATE`, `contractCode` carries
 * the mirrored contract error number.
 */
export type QuoteResult<T> =
    | { kind: 'exact'; value: T; ledger: number }
    | { kind: 'estimate'; value: T; assumptions: string[] }
    | {
          kind: 'unavailable';
          code: QuoteUnavailableCode;
          reason: string;
          contractCode?: number;
      };

/**
 * Check that `value` is a valid ledger sequence and return it as a `number`.
 *
 * @param value - candidate ledger sequence; must be a nonnegative u32 safe integer.
 * @throws {TypeError} if `value` is not a number.
 * @throws {RangeError} if `value` is negative, unsafe, or above the u32 range.
 */
export function decodeLedgerSequence(value: unknown): number {
    if (typeof value !== 'number') {
        throw new TypeError('ledger sequence must be a number');
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
        throw new RangeError('ledger sequence must be a nonnegative u32 safe integer');
    }
    return value;
}

/**
 * Wrap `value` as an exact quote, priced against on-chain state as of `ledger`.
 *
 * @param ledger - ledger sequence the value was computed against.
 * @throws {RangeError} if `ledger` is negative, unsafe, or above the u32 range.
 */
export function exact<T>(value: T, ledger: number): QuoteResult<T> {
    return {
        kind: 'exact',
        value,
        ledger: decodeLedgerSequence(ledger),
    };
}

/** Wrap `value` as an estimate; `assumptions` lists what could make it wrong before a fill. */
export function estimate<T>(value: T, assumptions: string[]): QuoteResult<T> {
    return { kind: 'estimate', value, assumptions: [...assumptions] };
}

/** Wrap `code` and `reason` as an unavailable quote. Never throws. */
export function unavailable<T>(
    code: QuoteUnavailableCode,
    reason: string,
    contractCode?: number,
): QuoteResult<T> {
    return contractCode === undefined
        ? { kind: 'unavailable', code, reason }
        : { kind: 'unavailable', code, reason, contractCode };
}

const U64_MAX = 2n ** 64n - 1n;
const OVERFLOW_MESSAGE = 'value is outside the i128 range';

const GATE_REASONS: Readonly<Record<number, string>> = {
    705: 'increase halted',
    710: 'negative value not allowed',
    711: 'notional below minimum',
    712: 'notional above maximum',
    713: 'insufficient margin',
    714: 'utilization exceeded',
    715: 'open interest exceeded',
    720: 'position not found',
    721: 'notional locked',
    722: 'not liquidatable',
    723: 'position liquidatable',
    732: 'invalid order',
    740: 'stale price',
};

class ProtocolGateError extends Error {
    constructor(readonly code: number) {
        super(
            `contract error #${code}: ${GATE_REASONS[code] ?? 'protocol gate failed'}`,
        );
    }
}

/**
 * The position change to quote, mirroring the fill kinds `execute_order`
 * settles. `notional`, `margin`, and `amount` are token-dec.
 */
export type PositionAction =
    | {
          kind: 'increase';
          /** Size to add. Zero is valid only with a nonzero `margin`, a margin-only top-up. */
          notional: bigint;
          /** Margin to post alongside the added size. */
          margin: bigint;
      }
    | {
          kind: 'decrease';
          /**
           * Requested close size. Clamps to a full close if it reaches or
           * exceeds the open notional, or would leave a survivor under
           * `config.minPositionNotional`.
           */
          notional: bigint;
          /** Requested withdrawal from the surviving margin. Ignored once the request clamps to a full close. */
          margin: bigint;
      }
    | { kind: 'close' }
    | {
          kind: 'adjustMargin';
          /** `'add'` posts margin with no change to size. `'withdraw'` returns margin, under the same rules as a decrease. */
          direction: 'add' | 'withdraw';
          /** Margin delta. Must be positive. A zero amount is rejected as a no-op (#732). */
          amount: bigint;
      };

/**
 * Ports the contract's `Fees`: the itemized costs one action settles, all
 * token-dec. `funding` is signed. Positive means the position paid into the
 * funding pool; negative means it earned funding, matching
 * `claimableFundingDelta`. `execution` and `relay` are the input fees
 * echoed unchanged; they are not part of `marginDebit` and settle outside
 * this simulation.
 */
export type FeeBreakdown = PositionFeeBreakdown;

/**
 * The two margin gates `Position::require_valid` and
 * `Position::is_liquidatable` check, all token-dec. Every field reads zero
 * when `position.notional` is zero.
 */
export interface MarginState {
    /** `ceil(config.initMargin * notional / SCALAR_18)`, the pre-PnL floor `margin` must clear (#713). */
    initialRequired: bigint;
    /** `ceil(config.maintenanceMargin * notional / SCALAR_18)`, the settled-equity floor the liquidation gate checks. */
    maintenanceRequired: bigint;
    /** `margin - initialRequired`. Negative means the position fails the initial-margin gate. */
    initialHeadroom: bigint;
    /** Settled equity minus `maintenanceRequired`. Negative means the position is liquidatable. */
    maintenanceHeadroom: bigint;
}

/**
 * The settled result of quoting a `PositionAction`, mirroring what
 * `execute_order` would commit on chain. Every amount is exact as of
 * `PositionQuoteContext.ledger`. Nothing here reflects a fill that lands
 * after this quote is taken.
 */
export interface PositionActionOutcome {
    /** The action that was quoted, cloned from the input. */
    action: PositionAction;
    /**
     * price_scalar (18-dec). The entry-side price, ask for a long and bid
     * for a short, on an increase or a margin `add`. The exit-side price,
     * bid for a long and ask for a short, on a decrease, close, or margin
     * `withdraw`. Still set on a margin-only action, even though no size
     * fills at it.
     */
    executionPrice: bigint;
    /** The position after the action settles. All-zero, the canonical closed row, once notional reaches zero. */
    postPosition: Position;
    /**
     * The market aggregates after this action's own fee, PnL, and accrual
     * legs settle. Reflects only this action. A fill on another position
     * landing first is not accounted for.
     */
    postMarket: MarketData;
    /** The itemized costs this action settled. See `FeeBreakdown`. */
    fees: FeeBreakdown;
    /**
     * Realized PnL, token-dec, after the profit haircut. Zero on an
     * increase or a margin `add`/`withdraw`. On a decrease, the realized
     * PnL of only the closed fraction. On a close, the realized PnL of the
     * whole position. Excludes the unrealized PnL of any size the action
     * leaves open.
     */
    realizedPnl: bigint;
    /**
     * Token-dec. What the trader is owed back to their wallet, net of the
     * settled fees. Zero on an increase. On a partial decrease, the paid
     * withdrawal plus the profit the fees did not consume: fees pay from
     * profit first, and the withdrawal caps at the margin that survives the
     * loss and the uncovered fees. Excludes `executionFee` and `relayFee`,
     * which settle outside this simulation.
     */
    walletPayout: bigint;
    /**
     * Token-dec, never negative. The shortfall the vault absorbs when a
     * close settles at negative equity, or a partial decrease's loss and
     * uncovered fees exceed its margin. The withdrawal itself can no longer
     * mint bad debt: it caps at the margin that survives. Mirrors the
     * `bad_debt` leg of the fill receipts. On the voluntary path this quote
     * models, the liquidatable gate (#723) and the margin gates (#713)
     * close before equity turns negative, so this reads zero except under a
     * degenerate config with zeroed margin requirements.
     */
    badDebt: bigint;
    /** Token-dec. The amount this action added to the trader's claimable funding balance, not the running total. */
    claimableFundingDelta: bigint;
    /** The margin gates evaluated against `postPosition` and `postMarket`, at the input price and vault assets. */
    margin: MarginState;
}

/**
 * The chain state a position quote settles against, all supplied by the
 * caller. Mirrors what `Position::increase` and `Position::decrease` read
 * from storage. The SDK does not fetch or check any of it, so a stale
 * snapshot quotes silently wrong rather than failing.
 */
export interface PositionQuoteContext {
    /** Ledger sequence this quote is exact as of. Stamped onto the returned `QuoteResult`. */
    ledger: number;
    /** Unix seconds. Advances the funding and borrowing accrual indices, and gates the decrease lock (`unlocksAt`). */
    now: bigint;
    /** Which side of the `(user, isLong)` position key this quotes. */
    isLong: boolean;
    /** The trader's current stored position for this side. */
    position: Position;
    /** The market's current stored aggregates. */
    market: MarketData;
    /** The market's current owner-set parameters. */
    config: MarketConfig;
    /** The oracle price to fill against, price_scalar (18-dec). */
    price: PriceData;
    /**
     * The vault's tracked balance, token-dec. Mirrors `Market::vault_balance`.
     * Drives the PnL haircut allowance and the post-fill utilization gate
     * (#714).
     */
    vaultAssets: bigint;
    /**
     * The treasury's fee cut rate (SCALAR_18), fetched from the treasury
     * contract at call time. Only feeds this quote's internal utilization
     * estimate; it is not part of the returned `fees`.
     */
    treasuryRate: bigint;
}

/**
 * The full input to `quotePositionAction`: a `PositionQuoteContext` plus
 * the action to quote and its two flat fees.
 */
export interface PositionActionInput extends PositionQuoteContext {
    /** The position change to quote. */
    action: PositionAction;
    /**
     * The keeper's flat per-order fee, token-dec. Echoed into
     * `fees.execution` unchanged. The real order escrows it separately at
     * creation (`Order::exec_fee`), so this quote never deducts it.
     */
    executionFee: bigint;
    /**
     * An off-chain relay cost, token-dec, with no on-chain contract
     * counterpart. Echoed into `fees.relay` for display only.
     */
    relayFee: bigint;
}

interface SettledFees {
    fees: FeeBreakdown;
    claimableFundingDelta: bigint;
}

interface TransitionResult {
    position: Position;
    market: MarketData;
    fees: FeeBreakdown;
    executionPrice: bigint;
    realizedPnl: bigint;
    walletPayout: bigint;
    badDebt: bigint;
    claimableFundingDelta: bigint;
    settlementVaultLeg: bigint;
}

function addTimestamp(left: bigint, right: bigint): bigint {
    const sum = left + right;
    if (sum > U64_MAX) throw new RangeError(OVERFLOW_MESSAGE);
    return sum;
}

function pairValue(pair: SidePair, isLong: boolean): bigint {
    return isLong ? pair.long : pair.short;
}

function addPair(pair: SidePair, isLong: boolean, delta: bigint): void {
    if (isLong) pair.long = addI128(pair.long, delta);
    else pair.short = addI128(pair.short, delta);
}

function clonePosition(position: Position): Position {
    return {
        ...position,
        decreaseOrders: [...position.decreaseOrders],
    };
}

function zeroPosition(): Position {
    return {
        margin: 0n,
        notional: 0n,
        tokens: 0n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        pricedAt: 0n,
        decreaseOrders: [],
    };
}

function validateAction(action: PositionAction): void {
    if (action.kind === 'close') return;
    if (action.kind === 'adjustMargin') {
        const amount = checkedI128(action.amount);
        if (amount < 0n) throw new ProtocolGateError(710);
        if (amount === 0n) throw new ProtocolGateError(732);
        return;
    }

    const notional = checkedI128(action.notional);
    const margin = checkedI128(action.margin);
    if (notional < 0n || margin < 0n) throw new ProtocolGateError(710);
    if (notional === 0n && margin === 0n) throw new ProtocolGateError(732);
}

function cloneAction(action: PositionAction): PositionAction {
    if (action.kind === 'close') return { kind: 'close' };
    if (action.kind === 'adjustMargin') return { ...action };
    return { ...action };
}

function settleFees(
    position: Position,
    market: MarketData,
    config: MarketConfig,
    isLong: boolean,
    signedNotional: bigint,
    signedTokens: bigint,
    executionFee: bigint,
    relayFee: bigint,
): SettledFees {
    const quoted = quotePositionFees({
        position,
        market,
        config,
        isLong,
        signedNotional,
        signedTokens,
        executionFee,
        relayFee,
    });
    const { funding } = quoted.fees;
    const earnedFunding = quoted.claimableFundingDelta;

    if (funding > 0n) market.creditPool = addI128(market.creditPool, funding);
    if (earnedFunding > 0n)
        market.creditOwed = addI128(market.creditOwed, earnedFunding);
    position.fundingIdx = pairValue(market.fundingIdx, isLong);
    position.borrowingIdx = pairValue(market.borrowingIdx, isLong);

    return {
        fees: quoted.fees,
        claimableFundingDelta: earnedFunding,
    };
}

function feeVaultLeg(
    fees: FeeBreakdown,
    config: MarketConfig,
    treasuryRate: bigint,
): bigint {
    const tradeFee = addI128(fees.base, fees.impact);
    const keeper = mulDivFloor(tradeFee, config.keeperRate, SCALAR_18);
    const treasuryCut = addI128(
        mulDivFloor(tradeFee, treasuryRate, SCALAR_18),
        mulDivFloor(fees.borrowing, treasuryRate, SCALAR_18),
    );
    return subI128(
        addI128(subI128(tradeFee, keeper), fees.borrowing),
        treasuryCut,
    );
}

function haircutPnl(
    market: MarketData,
    config: MarketConfig,
    price: PriceData,
    vaultAssets: bigint,
    isLong: boolean,
    pnl: bigint,
): bigint {
    if (pnl <= 0n) return pnl;
    const sidePnl = marketSidePnl(market, price, isLong, true);
    const allowance = sideCapacity(vaultAssets, config.maxPnlTrader);
    return sidePnl > allowance ? mulDivFloor(pnl, allowance, sidePnl) : pnl;
}

/**
 * Settled equity of a position whose accrual indices are already synced to
 * the market (the repeat settle banks nothing): margin less the full-size
 * close-grade trade fees, plus the haircut PnL. Ports the equity leg of
 * `Position::settle`.
 */
function settledEquity(
    position: Position,
    market: MarketData,
    config: MarketConfig,
    price: PriceData,
    vaultAssets: bigint,
    isLong: boolean,
): bigint {
    const trade = quoteTradeFees(
        market,
        config,
        isLong,
        subI128(0n, position.notional),
        subI128(0n, position.tokens),
    );
    const pnl = haircutPnl(
        market,
        config,
        price,
        vaultAssets,
        isLong,
        exactPositionPnl(position, price, isLong),
    );
    return addI128(
        subI128(position.margin, addI128(trade.base, trade.impact)),
        pnl,
    );
}

function marginState(
    position: Position,
    market: MarketData,
    config: MarketConfig,
    price: PriceData,
    vaultAssets: bigint,
    isLong: boolean,
): MarginState {
    if (position.notional === 0n) {
        return {
            initialRequired: 0n,
            maintenanceRequired: 0n,
            initialHeadroom: 0n,
            maintenanceHeadroom: 0n,
        };
    }
    const initialRequired = mulDivCeil(
        position.notional,
        config.initMargin,
        SCALAR_18,
    );
    const maintenanceRequired = mulDivCeil(
        position.notional,
        config.maintenanceMargin,
        SCALAR_18,
    );
    // The maintenance line is the settled (fee-inclusive) predicate the
    // contract's `is_liquidatable` applies, not a fee-free equity mark.
    const equity = settledEquity(
        position,
        market,
        config,
        price,
        vaultAssets,
        isLong,
    );
    return {
        initialRequired,
        maintenanceRequired,
        initialHeadroom: subI128(position.margin, initialRequired),
        maintenanceHeadroom: subI128(equity, maintenanceRequired),
    };
}

function requireValidPosition(
    position: Position,
    market: MarketData,
    config: MarketConfig,
    price: PriceData,
    vaultAssets: bigint,
    isLong: boolean,
): void {
    if (position.notional < config.minPositionNotional)
        throw new ProtocolGateError(711);
    if (position.notional > config.maxPositionNotional)
        throw new ProtocolGateError(712);
    const margin = marginState(
        position,
        market,
        config,
        price,
        vaultAssets,
        isLong,
    );
    if (position.margin < margin.initialRequired)
        throw new ProtocolGateError(713);
    // Ports `require_valid`'s second settle: no action may leave a
    // liquidatable (settled equity below maintenance) position behind.
    if (margin.maintenanceHeadroom < 0n) throw new ProtocolGateError(713);
}

function increaseTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
    notional: bigint,
    margin: bigint,
): TransitionResult {
    const executionPrice = entryPrice(input.price, input.isLong);
    const tokensAdded = mulDivFloor(notional, SCALAR_18, executionPrice);
    const settled = settleFees(
        position,
        market,
        input.config,
        input.isLong,
        notional,
        tokensAdded,
        input.executionFee,
        input.relayFee,
    );

    position.tokens = addI128(position.tokens, tokensAdded);
    addPair(market.tokens, input.isLong, tokensAdded);
    position.notional = addI128(position.notional, notional);
    addPair(market.notional, input.isLong, notional);

    const marginAdded = subI128(margin, settled.fees.marginDebit);
    position.margin = addI128(position.margin, marginAdded);
    addPair(market.margin, input.isLong, marginAdded);

    if (notional > 0n) {
        const liveLock =
            input.now < position.unlocksAt ? position.lockedNotional : 0n;
        position.lockedNotional = addI128(liveLock, notional);
        position.unlocksAt = addTimestamp(input.now, input.config.notionalLock);
    }
    // Anchor the position's price floor at this fill's price.
    position.pricedAt = input.price.publishTime;

    requireValidPosition(
        position,
        market,
        input.config,
        input.price,
        input.vaultAssets,
        input.isLong,
    );
    if (
        notional > 0n &&
        pairValue(market.notional, input.isLong) > input.config.maxOpenInterest
    ) {
        throw new ProtocolGateError(715);
    }

    return {
        position,
        market,
        fees: settled.fees,
        executionPrice,
        realizedPnl: 0n,
        walletPayout: 0n,
        badDebt: 0n,
        claimableFundingDelta: settled.claimableFundingDelta,
        settlementVaultLeg: feeVaultLeg(
            settled.fees,
            input.config,
            input.treasuryRate,
        ),
    };
}

interface SettledClose {
    fees: FeeBreakdown;
    claimableFundingDelta: bigint;
    pnl: bigint;
    equity: bigint;
}

/**
 * Ports `Position::settle`: bank the accruals, price the trade fees at the
 * full size, haircut the full PnL, and derive the settled equity. Banks the
 * accrual legs into `market` and syncs `position`'s indices exactly once.
 */
function settleToClose(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
): SettledClose {
    const settled = settleFees(
        position,
        market,
        input.config,
        input.isLong,
        subI128(0n, position.notional),
        subI128(0n, position.tokens),
        input.executionFee,
        input.relayFee,
    );
    const pnl = haircutPnl(
        market,
        input.config,
        input.price,
        input.vaultAssets,
        input.isLong,
        exactPositionPnl(position, input.price, input.isLong),
    );
    return {
        fees: settled.fees,
        claimableFundingDelta: settled.claimableFundingDelta,
        pnl,
        equity: addI128(
            subI128(position.margin, settled.fees.marginDebit),
            pnl,
        ),
    };
}

/**
 * Ports `Position::close_settled`: close the whole position against its
 * settled numbers; the payout is the settled equity floored at zero, any
 * shortfall becoming bad debt.
 */
function closeSettledTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
    settled: SettledClose,
): TransitionResult {
    const returned = settled.equity > 0n ? settled.equity : 0n;
    const badDebt = settled.equity < 0n ? subI128(0n, settled.equity) : 0n;

    addPair(market.notional, input.isLong, subI128(0n, position.notional));
    addPair(market.tokens, input.isLong, subI128(0n, position.tokens));
    addPair(market.margin, input.isLong, subI128(0n, position.margin));

    const feeLeg = feeVaultLeg(settled.fees, input.config, input.treasuryRate);
    return {
        position: zeroPosition(),
        market,
        fees: settled.fees,
        executionPrice: exitPrice(input.price, input.isLong),
        realizedPnl: settled.pnl,
        walletPayout: returned,
        badDebt,
        claimableFundingDelta: settled.claimableFundingDelta,
        settlementVaultLeg: subI128(feeLeg, addI128(settled.pnl, badDebt)),
    };
}

function partialDecreaseTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
    settled: SettledClose,
    notional: bigint,
    margin: bigint,
): TransitionResult {
    const tokens = mulDivFloor(position.tokens, notional, position.notional);
    // The fill's own trade fees; impact is quadratic in fill size, so the
    // full-size fees priced for the settled-equity gate do not apply here.
    // The accruals were banked by the settle and ride along unchanged.
    const trade = quoteTradeFees(
        market,
        input.config,
        input.isLong,
        subI128(0n, notional),
        subI128(0n, tokens),
    );
    const paidFunding =
        settled.fees.funding > 0n ? settled.fees.funding : 0n;
    const marginDebit = addI128(
        addI128(trade.base, trade.impact),
        addI128(settled.fees.borrowing, paidFunding),
    );
    const fees: FeeBreakdown = {
        base: trade.base,
        impact: trade.impact,
        funding: settled.fees.funding,
        borrowing: settled.fees.borrowing,
        execution: input.executionFee,
        relay: input.relayFee,
        marginDebit,
    };
    const rawPnl = exactPositionPnl(
        { ...position, notional, tokens },
        input.price,
        input.isLong,
    );
    const pnl = haircutPnl(
        market,
        input.config,
        input.price,
        input.vaultAssets,
        input.isLong,
        rawPnl,
    );
    const profit = pnl > 0n ? pnl : 0n;
    const loss = pnl < 0n ? pnl : 0n;
    // The fees pay from the realized profit first. The margin pays the
    // uncovered rest, so a fee never reduces the withdrawal.
    const covered = marginDebit < profit ? marginDebit : profit;
    const uncovered = subI128(marginDebit, covered);
    // The withdrawal claims last: it caps at the margin that survives the
    // loss and the uncovered fees, so it never mints bad debt.
    const room = addI128(position.margin, subI128(loss, uncovered));
    const cap = room > 0n ? room : 0n;
    const withdrawal = margin < cap ? margin : cap;
    const marginChange = subI128(subI128(loss, uncovered), withdrawal);

    // Margin floors at zero; the excess is bad debt drawn from the vault.
    const nextMargin = addI128(position.margin, marginChange);
    const badDebt = nextMargin < 0n ? subI128(0n, nextMargin) : 0n;
    position.margin = nextMargin > 0n ? nextMargin : 0n;
    addPair(market.margin, input.isLong, addI128(marginChange, badDebt));

    // Anchor the position's price floor at this fill's price.
    position.pricedAt = input.price.publishTime;

    position.notional = subI128(position.notional, notional);
    addPair(market.notional, input.isLong, subI128(0n, notional));
    position.tokens = subI128(position.tokens, tokens);
    addPair(market.tokens, input.isLong, subI128(0n, tokens));

    requireValidPosition(
        position,
        market,
        input.config,
        input.price,
        input.vaultAssets,
        input.isLong,
    );

    const feeLeg = feeVaultLeg(fees, input.config, input.treasuryRate);
    return {
        position,
        market,
        fees,
        executionPrice: exitPrice(input.price, input.isLong),
        realizedPnl: pnl,
        walletPayout: addI128(withdrawal, subI128(profit, covered)),
        badDebt,
        claimableFundingDelta: settled.claimableFundingDelta,
        settlementVaultLeg: subI128(feeLeg, addI128(pnl, badDebt)),
    };
}

function decreaseTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
    requestedNotional: bigint,
    margin: bigint,
): TransitionResult {
    if (position.notional === 0n) throw new ProtocolGateError(720);

    // Settle once (`Position::decrease`): the liquidatable gate, the clamped
    // full close, and the partial's accruals all consume the same numbers.
    const settled = settleToClose(input, position, market);
    const maintenance = mulDivCeil(
        position.notional,
        input.config.maintenanceMargin,
        SCALAR_18,
    );
    // Liquidation is the only legal transition for an underwater position.
    if (settled.equity < maintenance) throw new ProtocolGateError(723);

    const locked =
        input.now < position.unlocksAt ? position.lockedNotional : 0n;
    // A request for the whole position (or more) is a full close; so is one
    // whose survivor would sit below the position minimum. That partial
    // could never validate (#711), so the fill clamps to a full close.
    if (
        requestedNotional >= position.notional ||
        subI128(position.notional, requestedNotional) <
            input.config.minPositionNotional
    ) {
        if (locked > 0n) throw new ProtocolGateError(721);
        return closeSettledTransition(input, position, market, settled);
    }
    // A partial close is only allowed on the unlocked fraction.
    if (requestedNotional > subI128(position.notional, locked)) {
        throw new ProtocolGateError(721);
    }
    return partialDecreaseTransition(
        input,
        position,
        market,
        settled,
        requestedNotional,
        margin,
    );
}

function runTransition(input: PositionActionInput): TransitionResult {
    validateAction(input.action);

    // No fill may price behind the position's own last mark: `priced_at`
    // stays monotone (`Position::require_price_not_stale`, #740).
    if (input.price.publishTime < input.position.pricedAt) {
        throw new ProtocolGateError(740);
    }

    const market = advanceMarketAccruals(
        input.market,
        input.config,
        input.price,
        input.vaultAssets,
        input.now,
    ).market;
    const position = clonePosition(input.position);

    let transition: TransitionResult;
    if (input.action.kind === 'increase') {
        transition = increaseTransition(
            input,
            position,
            market,
            input.action.notional,
            input.action.margin,
        );
    } else if (input.action.kind === 'decrease') {
        transition = decreaseTransition(
            input,
            position,
            market,
            input.action.notional,
            input.action.margin,
        );
    } else if (input.action.kind === 'close') {
        transition = decreaseTransition(
            input,
            position,
            market,
            position.notional,
            0n,
        );
    } else if (input.action.direction === 'add') {
        transition = increaseTransition(
            input,
            position,
            market,
            0n,
            input.action.amount,
        );
    } else {
        transition = decreaseTransition(
            input,
            position,
            market,
            0n,
            input.action.amount,
        );
    }

    const postVaultAssets = addI128(
        input.vaultAssets,
        transition.settlementVaultLeg,
    );
    if (input.action.kind === 'increase' && input.action.notional > 0n) {
        const capacity = sideCapacity(
            postVaultAssets,
            input.config.maxUtilOpen,
        );
        if (
            sideReserved(transition.market, input.price, true) > capacity ||
            sideReserved(transition.market, input.price, false) > capacity
        ) {
            throw new ProtocolGateError(714);
        }
    }

    return transition;
}

function caughtUnavailable<T>(error: unknown): QuoteResult<T> {
    if (error instanceof ProtocolGateError) {
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
        error instanceof Error ? error.message : 'invalid position quote input',
    );
}

/**
 * Quote the exact settlement of `input.action`, without touching the chain
 * or changing `input`.
 *
 * Ports the math behind `execute_order`. An `increase` or a margin `add`
 * runs `Position::increase`. A `decrease`, `close`, or margin `withdraw`
 * runs `Position::decrease`, which exits through `Position::close_settled`
 * on a full close. Accruals settle first, mirroring `Market::load`'s
 * elapsed-window advance.
 *
 * The caller must supply `position`, `market`, `vaultAssets`, and
 * `treasuryRate` exactly as read from the chain. The SDK does not fetch or
 * check any of them, so a stale snapshot returns a wrong quote, not a
 * failure.
 *
 * This mirrors only the voluntary action path. It does not model the
 * keeper-only ADL remainder, which skips the initial-margin floor.
 *
 * # Returns
 * - `exact`, with the outcome and the ledger it is exact as of.
 * - `unavailable`, on every condition below. This function never throws.
 *
 * # Errors
 * Every error below comes back as `unavailable` with code `CONTRACT_GATE`
 * and the mirrored contract error named in the reason string.
 * - NegativeValueNotAllowed (710) if a notional, margin, or `adjustMargin`
 *   amount is negative.
 * - NotionalBelowMinimum (711) if the resulting position's notional falls
 *   under `config.minPositionNotional`. Never fires on a close, since that
 *   path skips this check.
 * - NotionalAboveMaximum (712) if the resulting position's notional
 *   exceeds `config.maxPositionNotional`. Same exemption as #711.
 * - InsufficientMargin (713) if margin falls under the initial requirement,
 *   or settled equity under the maintenance requirement. Same exemption as
 *   #711.
 * - UtilizationExceeded (714) on an increase that adds notional, if either
 *   side's reserved value exceeds the post-fill utilization cap.
 * - OpenInterestExceeded (715) on an increase that adds notional, if the
 *   side's open interest exceeds `config.maxOpenInterest`.
 * - PositionNotFound (720) if a decrease, close, or margin `withdraw`
 *   targets a position at zero notional.
 * - NotionalLocked (721) if a partial decrease exceeds the unlocked
 *   notional, or a full close, explicit or clamped from a decrease, finds
 *   any notional still locked.
 * - PositionLiquidatable (723) on a voluntary decrease, close, or margin
 *   `withdraw`, if settled equity is under the maintenance margin.
 *   Liquidation is then the only legal transition.
 * - InvalidOrder (732) if the action is a no-op: zero notional and margin,
 *   or a zero `adjustMargin` amount.
 * - StalePrice (740) if `price.publishTime` is before the position's
 *   `pricedAt`.
 *
 * Two more `unavailable` codes cover the SDK's own checks, not a contract
 * error:
 * - `CONTRACT_OVERFLOW` if a settlement step leaves the `i128` or `u64` range.
 * - `INVALID_INPUT` for any other error the inputs raise.
 */
export function quotePositionAction(
    input: PositionActionInput,
): QuoteResult<PositionActionOutcome> {
    try {
        const transition = runTransition(input);
        return exact(
            {
                action: cloneAction(input.action),
                executionPrice: transition.executionPrice,
                postPosition: transition.position,
                postMarket: transition.market,
                fees: transition.fees,
                realizedPnl: transition.realizedPnl,
                walletPayout: transition.walletPayout,
                badDebt: transition.badDebt,
                claimableFundingDelta: transition.claimableFundingDelta,
                margin: marginState(
                    transition.position,
                    transition.market,
                    input.config,
                    input.price,
                    input.vaultAssets,
                    input.isLong,
                ),
            },
            input.ledger,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}
