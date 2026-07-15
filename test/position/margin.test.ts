import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import { quoteMarginAdjustment } from '../../src/position/margin.js';
import type { MarginAdjustmentInput } from '../../src/position/margin.js';
import type { VerifiedPrice } from '../../src/market/types.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../src/trading/trading_types.js';
import { loadGoldenCases } from '../helpers/golden.js';

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected a golden vector record');
    }
    return value as Record<string, unknown>;
}

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function position(overrides: Partial<Position> = {}): Position {
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
        ...overrides,
    };
}

function market(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        collateral: pair(),
        tokens: pair(),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        fundingUpdate: 0n,
        borrowingUpdate: 0n,
        fundingPool: 0n,
        fundingOwed: 0n,
        lastPriceTime: 0n,
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
        minOrderCollateral: 1n,
        execFee: 0n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18,
        initMargin: 250_000_000_000_000_000n,
        maintenanceMargin: 100_000_000_000_000_000n,
        liqFee: 0n,
        notionalLock: 15n,
        targetUtil: 500_000_000_000_000_000n,
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

const marginCases = loadGoldenCases('trading', 'margin');

function vector(id: string) {
    const found = marginCases.find((entry) => entry.id === id);
    if (!found) throw new Error(`Missing margin vector ${id}`);
    return found;
}

function vectorInput(id: string): MarginAdjustmentInput {
    const golden = vector(id);
    const inputs = record(golden.inputs);
    const isLong = inputs.is_long as boolean;
    const open = position({
        notional: inputs.notional as bigint,
        collateral: inputs.collateral as bigint,
        tokens: inputs.tokens as bigint,
        fundingIdx: inputs.position_funding_idx as bigint,
        borrowingIdx: inputs.position_borrowing_idx as bigint,
    });
    const now = (inputs.fill_timestamp ?? inputs.publish_time) as bigint;
    const marketFundingIdx = inputs.market_funding_idx as bigint;
    const marketBorrowingIdx = inputs.market_borrowing_idx as bigint;
    const longNotional = (inputs.long_notional ??
        (isLong ? open.notional : 0n)) as bigint;
    const shortNotional = (inputs.short_notional ??
        (isLong ? 0n : open.notional)) as bigint;
    const longTokens = (inputs.long_tokens ??
        (isLong ? open.tokens : 0n)) as bigint;
    const shortTokens = (inputs.short_tokens ??
        (isLong ? 0n : open.tokens)) as bigint;
    const collateral = isLong
        ? pair(open.collateral, 0n)
        : pair(0n, open.collateral);
    const useTerminal = inputs.use_terminal_price === true;
    const verifiedPrice: VerifiedPrice = {
        feedId: Number(inputs.feed_id),
        exponent: Number(inputs.exponent),
        bid: inputs.bid as bigint,
        ask: inputs.ask as bigint,
        publishTime: inputs.publish_time as bigint,
        source: useTerminal ? 'terminal' : 'pyth',
    };

    return {
        ledger: 9,
        now,
        isLong,
        position: open,
        market: market({
            notional: pair(longNotional, shortNotional),
            collateral,
            tokens: pair(longTokens, shortTokens),
            fundingIdx: isLong
                ? pair(marketFundingIdx, 0n)
                : pair(0n, marketFundingIdx),
            borrowingIdx: isLong
                ? pair(marketBorrowingIdx, 0n)
                : pair(0n, marketBorrowingIdx),
            fundingRate: (inputs.funding_rate ?? 0n) as bigint,
            fundingUpdate: (inputs.funding_update ?? now) as bigint,
            borrowingUpdate: (inputs.borrowing_update ?? now) as bigint,
        }),
        config: config({
            minOrderCollateral: (inputs.min_order_collateral ?? 1n) as bigint,
            maxUtilOpen: (inputs.max_util_open ?? SCALAR_18) as bigint,
            initMargin: inputs.init_margin as bigint,
            maintenanceMargin: inputs.maintenance_margin as bigint,
            targetUtil: (inputs.target_util ??
                500_000_000_000_000_000n) as bigint,
            borrowRate: (inputs.borrow_rate ?? 0n) as bigint,
            increasedBorrowRate: (inputs.increased_borrow_rate ?? 0n) as bigint,
            fundingIncrease: (inputs.funding_increase ?? 0n) as bigint,
            fundingDecrease: (inputs.funding_decrease ?? 0n) as bigint,
            thresholdStableFunding: (inputs.threshold_stable_funding ??
                0n) as bigint,
            thresholdDecreaseFunding: (inputs.threshold_decrease_funding ??
                0n) as bigint,
            fundingMin: (inputs.funding_min ?? 0n) as bigint,
            fundingMax: (inputs.funding_max ?? 0n) as bigint,
        }),
        price: verifiedPrice,
        vaultAssets: (inputs.vault_balance ?? 1_000n) as bigint,
        treasuryRate: 0n,
        direction: golden.operation === 'fixed_add' ? 'add' : 'withdraw',
        amount:
            golden.operation === 'max_withdraw'
                ? { kind: 'max' }
                : (inputs.collateral_delta as bigint),
        executionFee: inputs.exec_fee as bigint,
        relayFee: inputs.relay_fee_external_wallet_leg as bigint,
    };
}

const fixedVectors = marginCases.filter((entry) =>
    entry.operation.startsWith('fixed_'),
);
const maxVectors = marginCases.filter(
    (entry) => entry.operation === 'max_withdraw',
);

describe('requested collateral adjustment', () => {
    it.each(fixedVectors)(
        '$id preserves the gross contract argument',
        (golden) => {
            const inputs = record(golden.inputs);
            const work = record(golden.work);
            const expected = record(golden.expected);
            const quoteInput = vectorInput(golden.id);
            const result = quoteMarginAdjustment(quoteInput);

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.value.requestedAtomicDelta).toBe(
                inputs.collateral_delta,
            );
            expect(result.value.maximumAtomicDelta).toBeGreaterThanOrEqual(
                inputs.collateral_delta as bigint,
            );
            expect(result.value.postPosition).toMatchObject({
                notional: expected.position_notional,
                tokens: expected.position_tokens,
                collateral: expected.position_collateral,
                fundingIdx: expected.post_position_funding_idx,
                borrowingIdx: expected.post_position_borrowing_idx,
            });
            expect(result.value.costs.marginDebit).toBe(work.debit);
            expect(result.value.netWalletAmount).toBe(
                expected.wallet_delta_external_keeper,
            );
        },
    );

    it('rejects a requested amount below the contract order dust floor', () => {
        const quoteInput = vectorInput('margin.max.dust_unorderable');
        quoteInput.amount = 1n;

        expect(quoteMarginAdjustment(quoteInput)).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: 'contract error #732: collateral adjustment is below the order dust floor',
        });
    });
});

describe('exact Max collateral withdrawal', () => {
    it.each(
        maxVectors.filter(
            (entry) => record(entry.expected).success_expected === true,
        ),
    )(
        '$id matches the golden maximum and round-trips through the requested path',
        (golden) => {
            const work = record(golden.work);
            const expected = record(golden.expected);
            const quoteInput = vectorInput(golden.id);
            const result = quoteMarginAdjustment(quoteInput);

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.value.requestedAtomicDelta).toBe(
                expected.max_withdraw,
            );
            expect(result.value.maximumAtomicDelta).toBe(expected.max_withdraw);
            expect(result.value.postPosition).toMatchObject({
                collateral: expected.post_collateral,
                fundingIdx: expected.post_position_funding_idx,
                borrowingIdx: expected.post_position_borrowing_idx,
            });
            expect(result.value.costs.marginDebit).toBe(work.debit);
            expect(result.value.netWalletAmount).toBe(
                expected.wallet_delta_external_keeper,
            );
            expect(result.value.bindingConstraint).toBe(expected.binding);
            expect(result.value.margin.initialRequired).toBe(
                work.initial_requirement,
            );
            expect(result.value.margin.maintenanceRequired).toBe(
                work.maintenance_requirement,
            );
            expect(
                result.value.margin.maintenanceHeadroom +
                    result.value.margin.maintenanceRequired,
            ).toBe(expected.post_equity);

            const requested = quoteMarginAdjustment({
                ...quoteInput,
                amount: result.value.requestedAtomicDelta,
            });
            expect(requested).toMatchObject({ kind: 'exact' });
            if (requested.kind !== 'exact') return;
            expect(requested.value.requestedAtomicDelta).toBe(
                expected.max_withdraw,
            );
            expect(requested.value.postPosition).toEqual(
                result.value.postPosition,
            );
            expect(requested.value.costs).toEqual(result.value.costs);
            expect(requested.value.netWalletAmount).toBe(
                result.value.netWalletAmount,
            );

            const failedProbe = quoteMarginAdjustment({
                ...quoteInput,
                amount: expected.probe_withdraw as bigint,
            });
            expect(failedProbe).toMatchObject({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
                reason: expect.stringContaining(
                    String(expected.probe_error_code),
                ),
            });
        },
    );

    it.each(
        maxVectors.filter(
            (entry) => record(entry.expected).success_expected === false,
        ),
    )(
        '$id returns no submit-ready collateral instead of a fabricated quote',
        (golden) => {
            const expected = record(golden.expected);
            const quoteInput = vectorInput(golden.id);

            expect(quoteMarginAdjustment(quoteInput)).toEqual({
                kind: 'unavailable',
                code: 'NO_WITHDRAWABLE_COLLATERAL',
                reason: 'no submit-ready collateral withdrawal is available',
            });

            expect(
                quoteMarginAdjustment({
                    ...quoteInput,
                    amount: expected.probe_withdraw as bigint,
                }),
            ).toMatchObject({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
                reason: expect.stringContaining(
                    String(expected.probe_error_code),
                ),
            });
        },
    );

    it('rejects Max for collateral additions because wallet capacity is unknown', () => {
        const quoteInput = vectorInput('margin.fixed_add.zero_notional');
        quoteInput.amount = { kind: 'max' };

        expect(quoteMarginAdjustment(quoteInput)).toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'Max collateral adjustment is only defined for withdrawals',
        });
    });
});

describe('fail-closed margin quote boundaries', () => {
    it('propagates a missing position instead of reporting a zero maximum', () => {
        const quoteInput = vectorInput('margin.max.initial_bound');
        quoteInput.position = position();
        quoteInput.market = market({
            fundingUpdate: quoteInput.now,
            borrowingUpdate: quoteInput.now,
        });

        expect(quoteMarginAdjustment(quoteInput)).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('720'),
        });
    });

    it('propagates chronology failure instead of treating it as a margin bound', () => {
        const quoteInput = vectorInput('margin.max.initial_bound');
        quoteInput.market.fundingUpdate = quoteInput.now + 1n;

        expect(quoteMarginAdjustment(quoteInput)).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('predates'),
        });
    });

    it('accepts the terminal-price Max vector with exact provenance', () => {
        const quoteInput = vectorInput('margin.max.accrued_fee');
        const result = quoteMarginAdjustment(quoteInput);

        expect(quoteInput.price.source).toBe('terminal');
        expect(result).toMatchObject({
            kind: 'exact',
            ledger: quoteInput.ledger,
            priceTime: quoteInput.price.publishTime,
        });
    });

    it('does not apply the forced-close price floor to a normal margin order', () => {
        const quoteInput = vectorInput('margin.max.initial_bound');
        quoteInput.position.pricedAt = quoteInput.price.publishTime + 1n;

        expect(quoteMarginAdjustment(quoteInput)).toMatchObject({
            kind: 'exact',
        });
    });
});
