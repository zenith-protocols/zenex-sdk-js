import {
    SCALAR_18,
    addI128,
    checkedI128,
    mulDivCeil,
    mulDivFloor,
    subI128,
} from '../math/fixed.js';
import {
    entryPrice,
    exactPositionPnl,
    exitPrice,
    marketSidePnl,
    sideCapacity,
    sideReserved,
} from '../market/capacity.js';
import { advanceMarketAccruals } from '../market/rates.js';
import type { VerifiedPrice } from '../market/types.js';
import { decodeLedgerSequence, exact, unavailable } from '../quote/result.js';
import type { QuoteResult } from '../quote/result.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../trading/trading_types.js';
import { quotePositionFees, type PositionFeeBreakdown } from './fees.js';

const U64_MAX = 2n ** 64n - 1n;
const MAX_TREASURY_RATE = SCALAR_18 / 2n;
const OVERFLOW_MESSAGE = 'value is outside the i128 range';

const GATE_REASONS: Readonly<Record<number, string>> = {
    710: 'negative value not allowed',
    711: 'notional below minimum',
    712: 'notional above maximum',
    713: 'insufficient margin',
    714: 'utilization exceeded',
    715: 'open interest exceeded',
    720: 'position not found',
    721: 'notional locked',
    732: 'invalid order',
};

class ProtocolGateError extends Error {
    constructor(readonly code: number) {
        super(
            `contract error #${code}: ${GATE_REASONS[code] ?? 'protocol gate failed'}`,
        );
    }
}

export type PositionAction =
    | { kind: 'increase'; notional: bigint; collateral: bigint }
    | { kind: 'decrease'; notional: bigint; collateral: bigint }
    | { kind: 'close' }
    | {
          kind: 'adjustCollateral';
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
    price: VerifiedPrice;
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

function nonnegative(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
}

function timestamp(value: bigint, label: string): bigint {
    if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
        throw new RangeError(`${label} must be a u64 bigint`);
    }
    return value;
}

function addTimestamp(left: bigint, right: bigint): bigint {
    const sum =
        timestamp(left, 'timestamp') + timestamp(right, 'timestamp delta');
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
        collateral: checkedI128(position.collateral),
        notional: checkedI128(position.notional),
        tokens: checkedI128(position.tokens),
        fundingIdx: checkedI128(position.fundingIdx),
        borrowingIdx: checkedI128(position.borrowingIdx),
        lockedNotional: checkedI128(position.lockedNotional),
        unlocksAt: timestamp(position.unlocksAt, 'position unlock timestamp'),
        pricedAt: timestamp(position.pricedAt, 'position price timestamp'),
        decreaseOrders: [...position.decreaseOrders],
    };
}

function requirePositionWithinMarket(
    position: Position,
    market: MarketData,
    isLong: boolean,
): void {
    const aggregates = [
        ['notional', pairValue(market.notional, isLong), position.notional],
        ['tokens', pairValue(market.tokens, isLong), position.tokens],
        [
            'collateral',
            pairValue(market.collateral, isLong),
            position.collateral,
        ],
    ] as const;

    for (const [label, aggregate, positionValue] of aggregates) {
        if (nonnegative(aggregate, `market ${label}`) < positionValue) {
            throw new RangeError(
                `position exceeds its market-side ${label} aggregate`,
            );
        }
    }
}

function zeroPosition(): Position {
    return {
        collateral: 0n,
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
    if (action.kind === 'adjustCollateral') {
        const amount = checkedI128(action.amount);
        if (amount < 0n) throw new ProtocolGateError(710);
        if (amount === 0n) throw new ProtocolGateError(732);
        return;
    }

    const notional = checkedI128(action.notional);
    const collateral = checkedI128(action.collateral);
    if (notional < 0n || collateral < 0n) throw new ProtocolGateError(710);
    if (notional === 0n && collateral === 0n) throw new ProtocolGateError(732);
}

function cloneAction(action: PositionAction): PositionAction {
    if (action.kind === 'close') return { kind: 'close' };
    if (action.kind === 'adjustCollateral') return { ...action };
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
    const keeperRate = nonnegative(config.keeperRate, 'keeper rate');
    const treasury = nonnegative(treasuryRate, 'treasury rate');
    if (treasury > MAX_TREASURY_RATE) {
        throw new RangeError('treasury rate exceeds the contract maximum');
    }
    const tradeFee = addI128(fees.base, fees.impact);
    const keeper = mulDivFloor(tradeFee, keeperRate, SCALAR_18);
    const treasuryCut = addI128(
        mulDivFloor(tradeFee, treasury, SCALAR_18),
        mulDivFloor(fees.borrowing, treasury, SCALAR_18),
    );
    return subI128(
        addI128(subI128(tradeFee, keeper), fees.borrowing),
        treasuryCut,
    );
}

function haircutPnl(
    market: MarketData,
    config: TradingConfig,
    price: VerifiedPrice,
    vaultAssets: bigint,
    isLong: boolean,
    pnl: bigint,
): bigint {
    if (pnl <= 0n) return pnl;
    const sidePnl = marketSidePnl(market, price, isLong, true);
    const allowance = sideCapacity(vaultAssets, config.maxPnlTrader);
    return sidePnl > allowance ? mulDivFloor(pnl, allowance, sidePnl) : pnl;
}

function marginState(
    position: Position,
    config: TradingConfig,
    price: VerifiedPrice,
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
        nonnegative(config.initMargin, 'initial margin'),
        SCALAR_18,
    );
    const maintenanceRequired = mulDivCeil(
        position.notional,
        nonnegative(config.maintenanceMargin, 'maintenance margin'),
        SCALAR_18,
    );
    const equity = addI128(
        position.collateral,
        exactPositionPnl(position, price, isLong),
    );
    return {
        initialRequired,
        maintenanceRequired,
        initialHeadroom: subI128(position.collateral, initialRequired),
        maintenanceHeadroom: subI128(equity, maintenanceRequired),
    };
}

function requireValidPosition(
    position: Position,
    market: MarketData,
    config: TradingConfig,
    price: VerifiedPrice,
    isLong: boolean,
): void {
    if (position.notional < config.minPositionNotional)
        throw new ProtocolGateError(711);
    if (position.notional > config.maxPositionNotional)
        throw new ProtocolGateError(712);
    const margin = marginState(position, config, price, isLong);
    if (position.collateral < margin.initialRequired)
        throw new ProtocolGateError(713);
    if (margin.maintenanceHeadroom < 0n) throw new ProtocolGateError(713);

    const aggregateNotional = pairValue(market.notional, isLong);
    if (aggregateNotional < position.notional) {
        throw new RangeError(
            'position exceeds its market-side notional aggregate',
        );
    }
}

function increaseTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
    notional: bigint,
    collateral: bigint,
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

    const marginAdded = subI128(collateral, settled.fees.marginDebit);
    position.collateral = addI128(position.collateral, marginAdded);
    addPair(market.collateral, input.isLong, marginAdded);

    if (notional > 0n) {
        const liveLock =
            input.now < position.unlocksAt ? position.lockedNotional : 0n;
        position.lockedNotional = addI128(liveLock, notional);
        position.unlocksAt = addTimestamp(input.now, input.config.notionalLock);
    }
    position.pricedAt = input.price.publishTime;

    requireValidPosition(
        position,
        market,
        input.config,
        input.price,
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

function fullCloseTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
): TransitionResult {
    const notional = position.notional;
    const tokens = position.tokens;
    const grossCollateral = position.collateral;
    const settled = settleFees(
        position,
        market,
        input.config,
        input.isLong,
        subI128(0n, notional),
        subI128(0n, tokens),
        input.executionFee,
        input.relayFee,
    );
    const remainder = subI128(grossCollateral, settled.fees.marginDebit);
    const rawPnl = exactPositionPnl(position, input.price, input.isLong);
    const pnl = haircutPnl(
        market,
        input.config,
        input.price,
        input.vaultAssets,
        input.isLong,
        rawPnl,
    );
    const equity = addI128(remainder, pnl);
    const returned = equity > 0n ? equity : 0n;
    const badDebt = equity < 0n ? subI128(0n, equity) : 0n;

    addPair(market.notional, input.isLong, subI128(0n, notional));
    addPair(market.tokens, input.isLong, subI128(0n, tokens));
    addPair(market.collateral, input.isLong, subI128(0n, grossCollateral));

    const maintenance = mulDivCeil(
        notional,
        nonnegative(input.config.maintenanceMargin, 'maintenance margin'),
        SCALAR_18,
    );
    if (returned < maintenance) throw new ProtocolGateError(713);

    const feeLeg = feeVaultLeg(settled.fees, input.config, input.treasuryRate);
    const pnlAndDebt = addI128(pnl, badDebt);
    return {
        position: zeroPosition(),
        market,
        fees: settled.fees,
        executionPrice: exitPrice(input.price, input.isLong),
        realizedPnl: pnl,
        walletPayout: returned,
        badDebt,
        claimableFundingDelta: settled.claimableFundingDelta,
        settlementVaultLeg: subI128(feeLeg, pnlAndDebt),
    };
}

function partialDecreaseTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
    notional: bigint,
    collateral: bigint,
): TransitionResult {
    const tokens = mulDivFloor(position.tokens, notional, position.notional);
    const settled = settleFees(
        position,
        market,
        input.config,
        input.isLong,
        subI128(0n, notional),
        subI128(0n, tokens),
        input.executionFee,
        input.relayFee,
    );
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
    const proceeds = addI128(collateral, profit);
    const covered =
        settled.fees.marginDebit < proceeds
            ? settled.fees.marginDebit
            : proceeds;
    const uncovered = subI128(settled.fees.marginDebit, covered);
    const collateralChange = subI128(subI128(loss, collateral), uncovered);

    position.collateral = addI128(position.collateral, collateralChange);
    addPair(market.collateral, input.isLong, collateralChange);
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
        input.isLong,
    );

    const feeLeg = feeVaultLeg(settled.fees, input.config, input.treasuryRate);
    return {
        position,
        market,
        fees: settled.fees,
        executionPrice: exitPrice(input.price, input.isLong),
        realizedPnl: pnl,
        walletPayout: subI128(proceeds, covered),
        badDebt: 0n,
        claimableFundingDelta: settled.claimableFundingDelta,
        settlementVaultLeg: subI128(feeLeg, pnl),
    };
}

function decreaseTransition(
    input: PositionActionInput,
    position: Position,
    market: MarketData,
    requestedNotional: bigint,
    collateral: bigint,
): TransitionResult {
    if (position.notional === 0n) throw new ProtocolGateError(720);
    const locked =
        input.now < position.unlocksAt ? position.lockedNotional : 0n;
    if (requestedNotional >= position.notional) {
        if (locked > 0n) throw new ProtocolGateError(721);
        return fullCloseTransition(input, position, market);
    }
    if (requestedNotional > subI128(position.notional, locked)) {
        throw new ProtocolGateError(721);
    }
    return partialDecreaseTransition(
        input,
        position,
        market,
        requestedNotional,
        collateral,
    );
}

function runTransition(input: PositionActionInput): TransitionResult {
    decodeLedgerSequence(input.ledger);
    timestamp(input.now, 'quote timestamp');
    validateAction(input.action);
    nonnegative(input.vaultAssets, 'vault assets');
    nonnegative(input.executionFee, 'execution fee');
    nonnegative(input.relayFee, 'relay fee');
    nonnegative(input.treasuryRate, 'treasury rate');

    const market = advanceMarketAccruals(
        input.market,
        input.config,
        input.price,
        input.vaultAssets,
        input.now,
    ).market;
    const position = clonePosition(input.position);
    if (
        position.notional < 0n ||
        position.tokens < 0n ||
        position.collateral < 0n ||
        position.lockedNotional < 0n
    ) {
        throw new RangeError('position fields must be nonnegative');
    }
    requirePositionWithinMarket(position, market, input.isLong);

    let transition: TransitionResult;
    if (input.action.kind === 'increase') {
        transition = increaseTransition(
            input,
            position,
            market,
            input.action.notional,
            input.action.collateral,
        );
    } else if (input.action.kind === 'decrease') {
        transition = decreaseTransition(
            input,
            position,
            market,
            input.action.notional,
            input.action.collateral,
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

    if (input.price.publishTime > transition.market.lastPriceTime) {
        transition.market.lastPriceTime = input.price.publishTime;
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
                    input.config,
                    input.price,
                    input.isLong,
                ),
            },
            input.ledger,
            input.price.publishTime,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}
