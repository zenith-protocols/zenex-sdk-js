import { describe, expect, it } from 'vitest';
import { mulDivFloor, SCALAR_18 } from '../../src/math/fixed.js';
import {
    impliedEntryPrice,
    liquidationState,
    positionLeverage,
} from '../../src/trading/position/lifecycle.js';
import type { PriceData } from '../../src/trading/market/types.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../src/contracts/trading/trading_types.js';

interface ContractCase {
    operation: string;
    inputs: Record<string, unknown>;
    expected: Record<string, unknown>;
}

// Contract-derived scenarios preserved from the retired trading-v2 golden
// vectors (contracts commit 4c631eb17af53ec5e6875f42bf71a43af295e521).
const positionCases: Record<string, ContractCase> = {
    'position.increase.empty_book': {
        operation: 'increase',
        inputs: {
            is_long: true,
            notional_delta: 600_000_000n,
            collateral_delta: 250_000_000n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 1n,
            vault_balance: 100_000_000_000n,
            fee_dom: 5_000_000_000_000_000n,
            fee_non_dom: 3_000_000_000_000_000n,
            impact_scalar: 1_000_000_000_000n,
            init_margin: 100_000_000_000_000_000n,
            maintenance_margin: 50_000_000_000_000_000n,
            now: 1n,
        },
        expected: {
            position_notional: 600_000_000n,
            position_tokens: 600_000_000_000_000_000n,
            position_collateral: 246_640_000n,
        },
    },
    'position.full_close.flat': {
        operation: 'full_close',
        inputs: {
            is_long: true,
            position_notional: 1_000_000_000n,
            position_tokens: 1_000_000_000_000_000_000n,
            position_collateral: 100_000_000n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 1n,
            vault_balance: 100_000_000_000n,
            fee_dom: 5_000_000_000_000_000n,
            fee_non_dom: 3_000_000_000_000_000n,
            impact_scalar: 1_000_000_000_000n,
            init_margin: 100_000_000_000_000_000n,
            maintenance_margin: 50_000_000_000_000_000n,
            now: 1n,
        },
        expected: {
            returned: 96_000_000n,
        },
    },
    'position.full_close.underwater_voluntary_reject': {
        operation: 'full_close_reject',
        inputs: {
            is_long: true,
            position_notional: 100n,
            position_tokens: 100_000_000_000n,
            position_collateral: 10n,
            feed_id: 1n,
            bid: 800_000_000n,
            ask: 800_000_000n,
            publish_time: 1n,
            vault_balance: 100_000_000_000n,
            fee_dom: 0n,
            fee_non_dom: 0n,
            impact_scalar: 1_000_000_000_000_000_000n,
            init_margin: 100_000_000_000_000_000n,
            maintenance_margin: 50_000_000_000_000_000n,
            now: 1n,
        },
        expected: {
            error_code: 713n,
        },
    },
};

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function emptyPosition(overrides: Partial<Position> = {}): Position {
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
        ...overrides,
    };
}

function emptyMarket(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        margin: pair(),
        tokens: pair(),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        accruedAt: 0n,
        fundingPool: 0n,
        fundingOwed: 0n,
        ...overrides,
    };
}

function config(overrides: Partial<TradingConfig> = {}): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
        execFee: 0n,
        feeDom: 5_000_000_000_000_000n,
        feeNonDom: 3_000_000_000_000_000n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: 800_000_000_000_000_000n,
        maxUtilWithdraw: 900_000_000_000_000_000n,
        initMargin: 100_000_000_000_000_000n,
        maintenanceMargin: 50_000_000_000_000_000n,
        liqFee: 0n,
        notionalLock: 15n,
        targetUtil: 800_000_000_000_000_000n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: 500_000_000_000_000_000n,
        adlClearTarget: 400_000_000_000_000_000n,
        maxPnlTrader: 900_000_000_000_000_000n,
        maxPnlWithdraw: 150_000_000_000_000_000n,
        redeemLock: 0n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 1n,
        maxVaultBalance: 10_000_000_000_000n,
        ...overrides,
    };
}

function price(inputs: Record<string, unknown>): PriceData {
    const feedId = Buffer.alloc(32);
    feedId.writeBigUInt64BE(inputs.feed_id as bigint, 24);
    return {
        feedId,
        bid: inputs.bid as bigint,
        ask: inputs.ask as bigint,
        publishTime: (inputs.publish_time ?? 1n) as bigint,
    };
}

function vector(id: string): ContractCase {
    const found = positionCases[id];
    if (!found) throw new Error(`Missing position vector ${id}`);
    return found;
}

function liquidationContext(id: string) {
    const inputs = vector(id).inputs;
    const open = emptyPosition({
        notional: inputs.position_notional as bigint,
        tokens: inputs.position_tokens as bigint,
        margin: inputs.position_collateral as bigint,
    });
    return {
        ledger: 77,
        now: inputs.now as bigint,
        isLong: inputs.is_long as boolean,
        position: open,
        market: emptyMarket({
            notional: pair(open.notional, 0n),
            tokens: pair(open.tokens, 0n),
            margin: pair(open.margin, 0n),
            accruedAt: inputs.now as bigint,
        }),
        config: config({
            feeDom: inputs.fee_dom as bigint,
            feeNonDom: inputs.fee_non_dom as bigint,
            impactScalar: inputs.impact_scalar as bigint,
            initMargin: inputs.init_margin as bigint,
            maintenanceMargin: inputs.maintenance_margin as bigint,
        }),
        price: price(inputs),
        vaultAssets: inputs.vault_balance as bigint,
        treasuryRate: 0n,
    };
}

describe('position lifecycle state', () => {
    it('derives the exact implied entry and leaves an empty position undefined', () => {
        const golden = vector('position.increase.empty_book');
        const inputs = golden.inputs;
        const expected = golden.expected;

        expect(impliedEntryPrice(emptyPosition())).toBeUndefined();
        expect(
            impliedEntryPrice(
                emptyPosition({
                    notional: expected.position_notional as bigint,
                    tokens: expected.position_tokens as bigint,
                }),
            ),
        ).toBe(inputs.ask);
    });

    it('quotes marked-equity leverage without converting financial values to number', () => {
        const golden = vector('position.increase.empty_book');
        const inputs = golden.inputs;
        const expected = golden.expected;
        const open = emptyPosition({
            notional: expected.position_notional as bigint,
            tokens: expected.position_tokens as bigint,
            margin: expected.position_collateral as bigint,
        });
        const result = positionLeverage(open, price(inputs), true);

        expect(result).toEqual({
            kind: 'estimate',
            value: mulDivFloor(open.notional, SCALAR_18, open.margin),
            assumptions: ['excludes unsettled funding and borrowing accruals'],
        });
        expect(
            positionLeverage(emptyPosition(), price(inputs), true),
        ).toMatchObject({
            kind: 'estimate',
            value: 0n,
        });
    });

    it('matches the healthy full-close settled equity and maintenance line', () => {
        const golden = vector('position.full_close.flat');
        const expected = golden.expected;
        const result = liquidationState(
            liquidationContext('position.full_close.flat').position,
            liquidationContext('position.full_close.flat'),
        );

        expect(result).toEqual({
            kind: 'exact',
            ledger: 77,
            value: {
                equity: expected.returned,
                maintenanceRequired: 50_000_000n,
                liquidatable: false,
            },
        });
    });

    it('identifies the contract-derived underwater full close as liquidatable', () => {
        const result = liquidationState(
            liquidationContext(
                'position.full_close.underwater_voluntary_reject',
            ).position,
            liquidationContext(
                'position.full_close.underwater_voluntary_reject',
            ),
        );

        expect(result).toEqual({
            kind: 'exact',
            ledger: 77,
            value: {
                equity: 0n,
                maintenanceRequired: 5n,
                liquidatable: true,
            },
        });
    });

    it('returns a typed unavailable result for inconsistent chronology', () => {
        const chronology = liquidationContext('position.full_close.flat');
        chronology.market.accruedAt = 2n;

        expect(liquidationState(chronology.position, chronology)).toMatchObject(
            {
                kind: 'unavailable',
                code: 'INVALID_INPUT',
            },
        );
    });
});
