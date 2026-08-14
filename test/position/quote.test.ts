import { describe, expect, it } from 'vitest';
import { I128_MAX, SCALAR_18 } from '../../src/math/fixed.js';
import { quotePositionAction } from '../../src/trading/position/quote.js';
import type { PositionActionInput } from '../../src/trading/position/quote.js';
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
    work?: Record<string, unknown>;
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
            min_position_notional: 1n,
            max_position_notional: 1_000_000_000_000n,
            max_open_interest: 10_000_000_000_000n,
            max_util_open: 800_000_000_000_000_000n,
            now: 1n,
        },
        expected: {
            position_notional: 600_000_000n,
            position_tokens: 600_000_000_000_000_000n,
            position_collateral: 246_640_000n,
            market_notional: 600_000_000n,
            market_tokens: 600_000_000_000_000_000n,
            market_collateral: 246_640_000n,
            base_fee: 3_000_000n,
            impact_fee: 360_000n,
        },
    },
    'position.partial_decrease.flat': {
        operation: 'partial_decrease',
        inputs: {
            is_long: true,
            force: false,
            position_notional: 1_000_000_000n,
            position_tokens: 1_000_000_000_000_000_000n,
            position_collateral: 100_000_000n,
            notional_delta: 500_000_000n,
            collateral_delta: 0n,
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
            closed_notional: 500_000_000n,
            closed_tokens: 500_000_000_000_000_000n,
            returned: 0n,
            position_notional: 500_000_000n,
            position_tokens: 500_000_000_000_000_000n,
            position_collateral: 98_250_000n,
            market_notional: 500_000_000n,
            market_tokens: 500_000_000_000_000_000n,
            market_collateral: 98_250_000n,
            base_fee: 1_500_000n,
            impact_fee: 250_000n,
        },
    },
    'position.full_close.flat': {
        operation: 'full_close',
        inputs: {
            is_long: true,
            force: false,
            position_notional: 1_000_000_000n,
            position_tokens: 1_000_000_000_000_000_000n,
            position_collateral: 100_000_000n,
            notional_delta: 170_141_183_460_469_231_731_687_303_715_884_105_727n,
            collateral_delta: 0n,
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
            closed_notional: 1_000_000_000n,
            closed_tokens: 1_000_000_000_000_000_000n,
            gross_collateral: 100_000_000n,
            returned: 96_000_000n,
            bad_debt: 0n,
            position_notional: 0n,
            position_tokens: 0n,
            position_collateral: 0n,
            market_notional: 0n,
            market_tokens: 0n,
            market_collateral: 0n,
            base_fee: 3_000_000n,
            impact_fee: 1_000_000n,
        },
    },
    'position.full_close.underwater_voluntary_reject': {
        operation: 'full_close_reject',
        inputs: {
            is_long: true,
            force: false,
            position_notional: 100n,
            position_tokens: 100_000_000_000n,
            position_collateral: 10n,
            notional_delta: 170_141_183_460_469_231_731_687_303_715_884_105_727n,
            collateral_delta: 0n,
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
            error_code: 723n,
        },
    },
};

const marginCases: Record<string, ContractCase> = {
    'margin.fixed_add.zero_notional': {
        operation: 'fixed_add',
        inputs: {
            is_long: true,
            notional: 40n,
            margin: 10n,
            tokens: 40_000_000_000n,
            collateral_delta: 2n,
            position_funding_idx: 25_000_000_000_000_001n,
            position_borrowing_idx: 0n,
            market_funding_idx: 0n,
            market_borrowing_idx: 1n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 1n,
            init_margin: 250_000_000_000_000_000n,
            maintenance_margin: 100_000_000_000_000_000n,
            exec_fee: 2n,
            relay_fee_external_wallet_leg: 3n,
        },
        work: {
            funding_numerator: -1_000_000_000_000_000_040n,
            funding: -1n,
            borrowing_numerator: 40n,
            borrowing: 1n,
            debit: 1n,
            collateral_change: 1n,
        },
        expected: {
            position_notional: 40n,
            position_tokens: 40_000_000_000n,
            position_collateral: 11n,
            post_position_funding_idx: 0n,
            post_position_borrowing_idx: 1n,
            funding_pool_delta: 0n,
            funding_owed_delta: 1n,
            claimable_funding_delta: 1n,
        },
    },
    'margin.fixed_withdraw.below_accrued_debit': {
        operation: 'fixed_withdraw',
        inputs: {
            is_long: true,
            notional: 40n,
            margin: 20n,
            tokens: 40_000_000_000n,
            collateral_delta: 2n,
            position_funding_idx: 0n,
            position_borrowing_idx: 0n,
            market_funding_idx: 25_000_000_000_000_001n,
            market_borrowing_idx: 25_000_000_000_000_000n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 1n,
            init_margin: 250_000_000_000_000_000n,
            maintenance_margin: 100_000_000_000_000_000n,
            exec_fee: 2n,
            relay_fee_external_wallet_leg: 3n,
        },
        work: {
            funding: 2n,
            borrowing: 1n,
            debit: 3n,
            covered: 2n,
            uncovered: 1n,
            collateral_change: -3n,
        },
        expected: {
            position_notional: 40n,
            position_tokens: 40_000_000_000n,
            position_collateral: 17n,
            post_position_funding_idx: 25_000_000_000_000_001n,
            post_position_borrowing_idx: 25_000_000_000_000_000n,
            funding_pool_delta: 2n,
            funding_owed_delta: 0n,
            claimable_funding_delta: 0n,
            gross_collateral: 2n,
            trader_return: 0n,
        },
    },
    'margin.fixed_withdraw.equal_accrued_debit': {
        operation: 'fixed_withdraw',
        inputs: {
            is_long: true,
            notional: 40n,
            margin: 20n,
            tokens: 40_000_000_000n,
            collateral_delta: 3n,
            position_funding_idx: 0n,
            position_borrowing_idx: 0n,
            market_funding_idx: 25_000_000_000_000_001n,
            market_borrowing_idx: 25_000_000_000_000_000n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 1n,
            init_margin: 250_000_000_000_000_000n,
            maintenance_margin: 100_000_000_000_000_000n,
            exec_fee: 2n,
            relay_fee_external_wallet_leg: 3n,
        },
        work: {
            funding: 2n,
            borrowing: 1n,
            debit: 3n,
            covered: 3n,
            uncovered: 0n,
            collateral_change: -3n,
        },
        expected: {
            position_notional: 40n,
            position_tokens: 40_000_000_000n,
            position_collateral: 17n,
            post_position_funding_idx: 25_000_000_000_000_001n,
            post_position_borrowing_idx: 25_000_000_000_000_000n,
            funding_pool_delta: 2n,
            funding_owed_delta: 0n,
            claimable_funding_delta: 0n,
            gross_collateral: 3n,
            trader_return: 0n,
        },
    },
    'margin.fixed_withdraw.above_accrued_debit': {
        operation: 'fixed_withdraw',
        inputs: {
            is_long: true,
            notional: 40n,
            margin: 20n,
            tokens: 40_000_000_000n,
            collateral_delta: 4n,
            position_funding_idx: 0n,
            position_borrowing_idx: 0n,
            market_funding_idx: 25_000_000_000_000_001n,
            market_borrowing_idx: 25_000_000_000_000_000n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 1n,
            init_margin: 250_000_000_000_000_000n,
            maintenance_margin: 100_000_000_000_000_000n,
            exec_fee: 2n,
            relay_fee_external_wallet_leg: 3n,
        },
        work: {
            funding: 2n,
            borrowing: 1n,
            debit: 3n,
            covered: 3n,
            uncovered: 0n,
            collateral_change: -4n,
        },
        expected: {
            position_notional: 40n,
            position_tokens: 40_000_000_000n,
            position_collateral: 16n,
            post_position_funding_idx: 25_000_000_000_000_001n,
            post_position_borrowing_idx: 25_000_000_000_000_000n,
            funding_pool_delta: 2n,
            funding_owed_delta: 0n,
            claimable_funding_delta: 0n,
            gross_collateral: 4n,
            trader_return: 1n,
        },
    },
};

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function position(overrides: Partial<Position> = {}): Position {
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

function market(overrides: Partial<MarketData> = {}): MarketData {
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
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18,
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

function feedId(id = 1n): Buffer {
    const bytes = Buffer.alloc(32);
    bytes.writeBigUInt64BE(id, 24);
    return bytes;
}

function verifiedPrice(inputs: Record<string, unknown>): PriceData {
    return {
        feedId: feedId((inputs.feed_id ?? 1n) as bigint),
        bid: (inputs.bid ?? SCALAR_18) as bigint,
        ask: (inputs.ask ?? SCALAR_18) as bigint,
        publishTime: (inputs.publish_time ?? 1n) as bigint,
    };
}

function input(
    overrides: Partial<PositionActionInput> = {},
): PositionActionInput {
    return {
        ledger: 42,
        now: 1n,
        isLong: true,
        position: position(),
        market: market({ accruedAt: 1n }),
        config: config(),
        price: verifiedPrice({ publish_time: 1n }),
        vaultAssets: 100_000_000_000n,
        treasuryRate: 0n,
        action: { kind: 'increase', notional: 100n, margin: 20n },
        executionFee: 0n,
        relayFee: 0n,
        ...overrides,
    };
}

function vector(
    cases: Record<string, ContractCase>,
    id: string,
): ContractCase {
    const found = cases[id];
    if (!found) throw new Error(`Missing vector ${id}`);
    return found;
}

function positionVectorInput(id: string): PositionActionInput {
    const golden = vector(positionCases, id);
    const inputs = golden.inputs;
    const isLong = inputs.is_long as boolean;
    const open = position({
        notional: (inputs.position_notional ?? 0n) as bigint,
        tokens: (inputs.position_tokens ?? 0n) as bigint,
        margin: (inputs.position_collateral ?? 0n) as bigint,
    });
    const data = market({
        notional: isLong ? pair(open.notional, 0n) : pair(0n, open.notional),
        tokens: isLong ? pair(open.tokens, 0n) : pair(0n, open.tokens),
        margin: isLong
            ? pair(open.margin, 0n)
            : pair(0n, open.margin),
        accruedAt: inputs.now as bigint,
    });
    const operation = golden.operation;
    const action =
        operation === 'increase'
            ? {
                  kind: 'increase' as const,
                  notional: inputs.notional_delta as bigint,
                  margin: inputs.collateral_delta as bigint,
              }
            : operation === 'partial_decrease'
              ? {
                    kind: 'decrease' as const,
                    notional: inputs.notional_delta as bigint,
                    margin: inputs.collateral_delta as bigint,
                }
              : { kind: 'close' as const };

    return input({
        now: inputs.now as bigint,
        isLong,
        position: open,
        market: data,
        config: config({
            minPositionNotional: (inputs.min_position_notional ?? 1n) as bigint,
            maxPositionNotional: (inputs.max_position_notional ??
                1_000_000_000_000n) as bigint,
            maxOpenInterest: (inputs.max_open_interest ??
                10_000_000_000_000n) as bigint,
            feeDom: inputs.fee_dom as bigint,
            feeNonDom: inputs.fee_non_dom as bigint,
            impactScalar: inputs.impact_scalar as bigint,
            initMargin: inputs.init_margin as bigint,
            maintenanceMargin: inputs.maintenance_margin as bigint,
            maxUtilOpen: (inputs.max_util_open ?? SCALAR_18) as bigint,
        }),
        price: verifiedPrice(inputs),
        vaultAssets: inputs.vault_balance as bigint,
        action,
    });
}

function marginVectorInput(id: string): PositionActionInput {
    const golden = vector(marginCases, id);
    const inputs = golden.inputs;
    const isLong = inputs.is_long as boolean;
    const open = position({
        notional: inputs.notional as bigint,
        tokens: inputs.tokens as bigint,
        margin: inputs.margin as bigint,
        fundingIdx: inputs.position_funding_idx as bigint,
        borrowingIdx: inputs.position_borrowing_idx as bigint,
    });
    const now = (inputs.fill_timestamp ?? inputs.publish_time) as bigint;
    const data = market({
        notional: isLong ? pair(open.notional, 0n) : pair(0n, open.notional),
        tokens: isLong ? pair(open.tokens, 0n) : pair(0n, open.tokens),
        margin: isLong
            ? pair(open.margin, 0n)
            : pair(0n, open.margin),
        fundingIdx: isLong
            ? pair(inputs.market_funding_idx as bigint, 0n)
            : pair(0n, inputs.market_funding_idx as bigint),
        borrowingIdx: isLong
            ? pair(inputs.market_borrowing_idx as bigint, 0n)
            : pair(0n, inputs.market_borrowing_idx as bigint),
        accruedAt: now,
    });
    const operation = golden.operation;
    const action =
        operation === 'fixed_add'
            ? {
                  kind: 'adjustMargin' as const,
                  direction: 'add' as const,
                  amount: inputs.collateral_delta as bigint,
              }
            : {
                  kind: 'adjustMargin' as const,
                  direction: 'withdraw' as const,
                  amount: inputs.collateral_delta as bigint,
              };

    return input({
        now,
        isLong,
        position: open,
        market: data,
        config: config({
            initMargin: inputs.init_margin as bigint,
            maintenanceMargin: inputs.maintenance_margin as bigint,
        }),
        price: verifiedPrice(inputs),
        action,
        executionFee: inputs.exec_fee as bigint,
        relayFee: inputs.relay_fee_external_wallet_leg as bigint,
    });
}

describe('exact position action transitions', () => {
    it('matches the contract-derived empty-book increase and preserves inputs', () => {
        const id = 'position.increase.empty_book';
        const expected = vector(positionCases, id).expected;
        const quoteInput = positionVectorInput(id);
        const beforePosition = structuredClone(quoteInput.position);
        const beforeMarket = structuredClone(quoteInput.market);
        const result = quotePositionAction(quoteInput);

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.executionPrice).toBe(1_000_000_000n);
        expect(result.value.postPosition).toMatchObject({
            notional: expected.position_notional,
            tokens: expected.position_tokens,
            margin: expected.position_collateral,
        });
        expect(result.value.postMarket.notional.long).toBe(
            expected.market_notional,
        );
        expect(result.value.postMarket.tokens.long).toBe(
            expected.market_tokens,
        );
        expect(result.value.postMarket.margin.long).toBe(
            expected.market_collateral,
        );
        expect(result.value.fees).toMatchObject({
            base: expected.base_fee,
            impact: expected.impact_fee,
            marginDebit: 3_360_000n,
        });
        // Maintenance headroom is settled: the full-size close fees
        // (1_800_000n base + 360_000n impact) come out of the equity leg.
        expect(result.value.margin).toEqual({
            initialRequired: 60_000_000n,
            maintenanceRequired: 30_000_000n,
            initialHeadroom: 186_640_000n,
            maintenanceHeadroom: 214_480_000n,
        });
        expect(result.value.realizedPnl).toBe(0n);
        expect(result.value.walletPayout).toBe(0n);
        expect(result.value.action).not.toBe(quoteInput.action);
        expect(quoteInput.position).toEqual(beforePosition);
        expect(quoteInput.market).toEqual(beforeMarket);
    });

    it('matches the contract-derived partial decrease', () => {
        const id = 'position.partial_decrease.flat';
        const expected = vector(positionCases, id).expected;
        const result = quotePositionAction(positionVectorInput(id));

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.postPosition).toMatchObject({
            notional: expected.position_notional,
            tokens: expected.position_tokens,
            margin: expected.position_collateral,
        });
        expect(result.value.postMarket.notional.long).toBe(
            expected.market_notional,
        );
        expect(result.value.postMarket.tokens.long).toBe(
            expected.market_tokens,
        );
        expect(result.value.postMarket.margin.long).toBe(
            expected.market_collateral,
        );
        expect(result.value.fees.base).toBe(expected.base_fee);
        expect(result.value.fees.impact).toBe(expected.impact_fee);
        expect(result.value.walletPayout).toBe(expected.returned);
        expect(result.value.realizedPnl).toBe(0n);
    });

    it('matches the contract-derived full close and canonical zero state', () => {
        const id = 'position.full_close.flat';
        const expected = vector(positionCases, id).expected;
        const quoteInput = positionVectorInput(id);
        quoteInput.position.decreaseOrders = [2, 8];
        const result = quotePositionAction(quoteInput);

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.postPosition).toEqual(position());
        expect(result.value.postMarket.notional.long).toBe(
            expected.market_notional,
        );
        expect(result.value.postMarket.tokens.long).toBe(
            expected.market_tokens,
        );
        expect(result.value.postMarket.margin.long).toBe(
            expected.market_collateral,
        );
        expect(result.value.walletPayout).toBe(expected.returned);
        expect(result.value.fees.base).toBe(expected.base_fee);
        expect(result.value.fees.impact).toBe(expected.impact_fee);
    });

    it('rejects the contract-derived voluntary underwater full close with code 723', () => {
        const id = 'position.full_close.underwater_voluntary_reject';
        const expected = vector(positionCases, id).expected;
        const result = quotePositionAction(positionVectorInput(id));

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: `contract error #${expected.error_code}: position liquidatable`,
        });
    });

    it('rejects any decrease of a liquidatable position with code 723', () => {
        // Same underwater book as the full-close vector, but a partial
        // request: the settled-equity gate fires before the partial runs.
        const id = 'position.full_close.underwater_voluntary_reject';
        const quoteInput = positionVectorInput(id);
        quoteInput.action = { kind: 'decrease', notional: 10n, margin: 0n };
        const partial = quotePositionAction(quoteInput);
        const withdraw = quotePositionAction({
            ...positionVectorInput(id),
            action: {
                kind: 'adjustMargin',
                direction: 'withdraw',
                amount: 1n,
            },
        });

        expect(partial).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('723'),
        });
        expect(withdraw).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('723'),
        });
    });

    it('clamps a dust-band decrease to a full close with the settled payout', () => {
        // The contract-derived flat book: a decrease leaving 400_000_000n
        // behind under a 500_000_000n position minimum fills as a full close.
        const id = 'position.full_close.flat';
        const expected = vector(positionCases, id).expected;
        const quoteInput = positionVectorInput(id);
        quoteInput.config.minPositionNotional = 500_000_000n;
        quoteInput.action = {
            kind: 'decrease',
            notional: 600_000_000n,
            margin: 0n,
        };
        const result = quotePositionAction(quoteInput);

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.postPosition).toEqual(position());
        expect(result.value.walletPayout).toBe(expected.returned);
        expect(result.value.fees.base).toBe(expected.base_fee);
        expect(result.value.fees.impact).toBe(expected.impact_fee);
    });

    it('rejects a dust-band decrease with locked notional with code 721', () => {
        const id = 'position.full_close.flat';
        const quoteInput = positionVectorInput(id);
        quoteInput.config.minPositionNotional = 500_000_000n;
        quoteInput.position.lockedNotional = 100_000_000n;
        quoteInput.position.unlocksAt = 10n;
        quoteInput.action = {
            kind: 'decrease',
            notional: 600_000_000n,
            margin: 0n,
        };
        const result = quotePositionAction(quoteInput);

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('721'),
        });
    });

    it('anchors pricedAt at the fill price publish time and gates stale fills', () => {
        const increase = quotePositionAction(
            input({
                price: verifiedPrice({ publish_time: 7n }),
                action: { kind: 'increase', notional: 100n, margin: 20n },
            }),
        );
        const open = position({
            notional: 1_000n,
            tokens: 1_000n,
            margin: 200n,
            pricedAt: 5n,
        });
        const partialInput = input({
            now: 5n,
            position: open,
            market: market({
                notional: pair(1_000n, 0n),
                tokens: pair(1_000n, 0n),
                margin: pair(200n, 0n),
                accruedAt: 5n,
            }),
            price: verifiedPrice({ publish_time: 6n }),
            action: { kind: 'decrease', notional: 100n, margin: 0n },
        });
        const partial = quotePositionAction(partialInput);
        const stale = quotePositionAction({
            ...partialInput,
            price: verifiedPrice({ publish_time: 4n }),
        });

        expect(increase.kind).toBe('exact');
        if (increase.kind !== 'exact') return;
        expect(increase.value.postPosition.pricedAt).toBe(7n);
        expect(partial.kind).toBe('exact');
        if (partial.kind !== 'exact') return;
        expect(partial.value.postPosition.pricedAt).toBe(6n);
        expect(stale).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: 'contract error #740: stale price',
        });
    });
});

describe('funding, borrowing, and margin-only actions', () => {
    it('routes earned funding to claimable balance during a top-up', () => {
        const id = 'margin.fixed_add.zero_notional';
        const expected = vector(marginCases, id).expected;
        const result = quotePositionAction(marginVectorInput(id));

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.postPosition).toMatchObject({
            notional: expected.position_notional,
            tokens: expected.position_tokens,
            margin: expected.position_collateral,
            fundingIdx: expected.post_position_funding_idx,
            borrowingIdx: expected.post_position_borrowing_idx,
        });
        expect(result.value.postMarket.fundingOwed).toBe(
            expected.funding_owed_delta,
        );
        expect(result.value.postMarket.margin.long).toBe(11n);
        expect(result.value.claimableFundingDelta).toBe(
            expected.claimable_funding_delta,
        );
        expect(result.value.fees).toMatchObject({
            funding: -1n,
            borrowing: 1n,
            execution: 2n,
            relay: 3n,
            marginDebit: 1n,
        });
        expect(result.value.walletPayout).toBe(0n);
    });

    it.each([
        'margin.fixed_withdraw.below_accrued_debit',
        'margin.fixed_withdraw.equal_accrued_debit',
        'margin.fixed_withdraw.above_accrued_debit',
    ])(
        '$id settles paid accrual before returning withdrawal proceeds',
        (id) => {
            const golden = vector(marginCases, id);
            const work = golden.work ?? {};
            const expected = golden.expected;
            const result = quotePositionAction(marginVectorInput(id));

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.value.postPosition.margin).toBe(
                expected.position_collateral,
            );
            expect(result.value.postPosition.fundingIdx).toBe(
                expected.post_position_funding_idx,
            );
            expect(result.value.postPosition.borrowingIdx).toBe(
                expected.post_position_borrowing_idx,
            );
            expect(result.value.postMarket.fundingPool).toBe(
                expected.funding_pool_delta,
            );
            expect(result.value.claimableFundingDelta).toBe(
                expected.claimable_funding_delta,
            );
            expect(result.value.fees.marginDebit).toBe(work.debit);
            expect(result.value.walletPayout).toBe(expected.trader_return);
        },
    );
});

describe('haircuts and protocol gates', () => {
    it('haircuts a profitable close against the pre-action side overhang', () => {
        const open = position({
            notional: 1_000_000_000n,
            tokens: 10_000_000_000_000_000_000n,
            margin: 100_000_000n,
        });
        const result = quotePositionAction(
            input({
                position: open,
                market: market({
                    notional: pair(open.notional, 0n),
                    tokens: pair(open.tokens, 0n),
                    margin: pair(open.margin, 0n),
                    accruedAt: 1n,
                }),
                config: config({
                    feeDom: 5_000_000_000_000_000n,
                    feeNonDom: 3_000_000_000_000_000n,
                    maxPnlTrader: 900_000_000_000_000_000n,
                }),
                price: {
                    feedId: feedId(),
                    bid: 105_000_000n,
                    ask: 105_000_000n,
                    publishTime: 1n,
                },
                vaultAssets: 50_000_000n,
                action: { kind: 'close' },
            }),
        );

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.realizedPnl).toBe(22_500_000n);
        expect(result.value.walletPayout).toBe(118_500_000n);
    });

    it('enforces live notional locks', () => {
        const open = position({
            notional: 100n,
            tokens: 100n,
            margin: 100n,
            lockedNotional: 50n,
            unlocksAt: 100n,
        });
        const result = quotePositionAction(
            input({
                now: 99n,
                position: open,
                market: market({
                    notional: pair(100n, 0n),
                    tokens: pair(100n, 0n),
                    margin: pair(100n, 0n),
                    accruedAt: 99n,
                }),
                price: verifiedPrice({ publish_time: 99n }),
                action: { kind: 'decrease', notional: 51n, margin: 0n },
            }),
        );

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('721'),
        });
    });

    it('enforces open interest after the position margin gate', () => {
        const result = quotePositionAction(
            input({
                market: market({
                    notional: pair(90n, 0n),
                    tokens: pair(90n, 0n),
                    margin: pair(20n, 0n),
                    accruedAt: 1n,
                }),
                config: config({ maxOpenInterest: 100n }),
                action: { kind: 'increase', notional: 11n, margin: 10n },
            }),
        );

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('715'),
        });
    });

    it('enforces post-settlement reserve capacity on a size increase', () => {
        const result = quotePositionAction(
            input({
                config: config({ maxUtilOpen: 800_000_000_000_000_000n }),
                vaultAssets: 200n,
                action: { kind: 'increase', notional: 100n, margin: 100n },
            }),
        );

        expect(result).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('714'),
        });
    });

    it('uses fee settlement for reserve backing while keeping execution and relay external', () => {
        const quoteInput = input({
            config: config({
                feeDom: 100_000_000_000_000_000n,
                maxUtilOpen: SCALAR_18,
                impactScalar: I128_MAX,
            }),
            vaultAssets: 193n,
            action: { kind: 'increase', notional: 100n, margin: 100n },
            executionFee: 1_000n,
            relayFee: 2_000n,
        });
        const withoutTreasury = quotePositionAction(quoteInput);
        const withTreasury = quotePositionAction({
            ...quoteInput,
            treasuryRate: SCALAR_18 / 2n,
        });

        expect(withoutTreasury.kind).toBe('exact');
        expect(withTreasury).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('714'),
        });
        if (withoutTreasury.kind !== 'exact') return;
        expect(withoutTreasury.value.fees).toMatchObject({
            base: 10n,
            impact: 1n,
            execution: 1_000n,
            relay: 2_000n,
            marginDebit: 11n,
        });
    });

    it('enforces initial and settled maintenance margin on surviving positions', () => {
        const initial = quotePositionAction(
            input({
                action: { kind: 'increase', notional: 100n, margin: 9n },
            }),
        );
        // Healthy before the decrease (settled equity 10n over a 5n line),
        // but the withdrawal leaves 5n margin whose settled equity 4n sits
        // below the survivor's 5n maintenance requirement: the fee-inclusive
        // `require_valid` leg gates where a fee-free equity mark would pass.
        const open = position({
            notional: 100n,
            tokens: 100n,
            margin: 11n,
        });
        const maintenance = quotePositionAction(
            input({
                position: open,
                market: market({
                    notional: pair(100n, 0n),
                    tokens: pair(100n, 0n),
                    margin: pair(11n, 0n),
                    accruedAt: 1n,
                }),
                config: config({ initMargin: 50_000_000_000_000_000n }),
                action: { kind: 'decrease', notional: 10n, margin: 6n },
            }),
        );

        expect(initial).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('713'),
        });
        expect(maintenance).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('713'),
        });
    });
});

describe('typed public quote failures', () => {
    it('maps checked i128 overflow and invalid chronology separately', () => {
        const overflowing = quotePositionAction(
            input({
                position: position({
                    notional: I128_MAX,
                    margin: I128_MAX,
                }),
                market: market({
                    notional: pair(I128_MAX, 0n),
                    margin: pair(I128_MAX, 0n),
                    accruedAt: 1n,
                }),
                config: config({
                    maxPositionNotional: I128_MAX,
                    maxOpenInterest: I128_MAX,
                }),
                action: { kind: 'increase', notional: 1n, margin: 1n },
            }),
        );
        const chronology = quotePositionAction(
            input({
                now: 1n,
                market: market({ accruedAt: 2n }),
            }),
        );

        expect(overflowing).toMatchObject({
            kind: 'unavailable',
            code: 'CONTRACT_OVERFLOW',
        });
        expect(chronology).toMatchObject({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
        });
    });
});
