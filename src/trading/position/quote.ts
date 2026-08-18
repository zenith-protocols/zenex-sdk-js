import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../../math/fixed.js';
import {
    entryPrice,
    exactPositionPnl,
    exitPrice,
    marketSidePnl,
    quoteTradeFees,
    sideCapacity,
    sideReserved,
} from '../market/capacity.js';
import { advanceMarketAccruals } from '../market/rates.js';
import type { PriceData } from '../market/types.js';
import { decodeLedgerSequence, exact, unavailable } from '../quote/result.js';
import type { QuoteResult } from '../quote/result.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../contracts/trading/trading_types.js';
import { quotePositionFees, type PositionFeeBreakdown } from './fees.js';

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

export type PositionAction =
    | { kind: 'increase'; notional: bigint; margin: bigint }
    | { kind: 'decrease'; notional: bigint; margin: bigint }
    | { kind: 'close' }
    | {
          kind: 'adjustMargin';
          direction: 'add' | 'withdraw';
          amount: bigint;
      };

export type FeeBreakdown = PositionFeeBreakdown;

export interface MarginState {
    initialRequired: bigint;
    maintenanceRequired: bigint;
    initialHeadroom: bigint;
    maintenanceHeadroom: bigint;
}

export interface PositionActionOutcome {
    action: PositionAction;
    executionPrice: bigint;
    postPosition: Position;
    postMarket: MarketData;
    fees: FeeBreakdown;
    realizedPnl: bigint;
    walletPayout: bigint;
    claimableFundingDelta: bigint;
    margin: MarginState;
}

export interface PositionQuoteContext {
    ledger: number;
    now: bigint;
    isLong: boolean;
    position: Position;
    market: MarketData;
    config: TradingConfig;
    price: PriceData;
    vaultAssets: bigint;
    treasuryRate: bigint;
}

export interface PositionActionInput extends PositionQuoteContext {
    action: PositionAction;
    executionFee: bigint;
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
    config: TradingConfig,
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

    if (funding > 0n) market.fundingPool = addI128(market.fundingPool, funding);
    if (earnedFunding > 0n)
        market.fundingOwed = addI128(market.fundingOwed, earnedFunding);
    position.fundingIdx = pairValue(market.fundingIdx, isLong);
    position.borrowingIdx = pairValue(market.borrowingIdx, isLong);

    return {
        fees: quoted.fees,
        claimableFundingDelta: earnedFunding,
    };
}

function feeVaultLeg(
    fees: FeeBreakdown,
    config: TradingConfig,
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
    config: TradingConfig,
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
    config: TradingConfig,
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
    config: TradingConfig,
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
    config: TradingConfig,
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
    const proceeds = addI128(margin, profit);
    const covered = marginDebit < proceeds ? marginDebit : proceeds;
    const uncovered = subI128(marginDebit, covered);
    const marginChange = subI128(subI128(loss, margin), uncovered);

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
        walletPayout: subI128(proceeds, covered),
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
    // whose survivor would sit below the position minimum — that partial
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
        error instanceof Error ? error.message : 'invalid position quote input',
    );
}

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
