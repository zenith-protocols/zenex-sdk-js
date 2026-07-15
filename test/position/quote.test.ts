import { describe, expect, it } from 'vitest';
import { I128_MAX, SCALAR_18 } from '../../src/math/fixed.js';
import { quotePositionAction } from '../../src/position/quote.js';
import type { PositionActionInput } from '../../src/position/quote.js';
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

function verifiedPrice(inputs: Record<string, unknown>): VerifiedPrice {
    return {
        feedId: Number(inputs.feed_id ?? 1n),
        exponent: Number(inputs.exponent ?? -18n),
        bid: (inputs.bid ?? SCALAR_18) as bigint,
        ask: (inputs.ask ?? SCALAR_18) as bigint,
        publishTime: (inputs.publish_time ?? inputs.now ?? 0n) as bigint,
        source: 'pyth',
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
        market: market({ fundingUpdate: 1n, borrowingUpdate: 1n }),
        config: config(),
        price: verifiedPrice({ publish_time: 1n }),
        vaultAssets: 100_000_000_000n,
        treasuryRate: 0n,
        action: { kind: 'increase', notional: 100n, collateral: 20n },
        executionFee: 0n,
        relayFee: 0n,
        ...overrides,
    };
}

const positionCases = loadGoldenCases('trading', 'position');
const marginCases = loadGoldenCases('trading', 'margin');

function vector(cases: typeof positionCases, id: string) {
    const found = cases.find((entry) => entry.id === id);
    if (!found) throw new Error(`Missing vector ${id}`);
    return found;
}

function positionVectorInput(id: string): PositionActionInput {
    const golden = vector(positionCases, id);
    const inputs = record(golden.inputs);
    const isLong = inputs.is_long as boolean;
    const open = position({
        notional: (inputs.position_notional ?? 0n) as bigint,
        tokens: (inputs.position_tokens ?? 0n) as bigint,
        collateral: (inputs.position_collateral ?? 0n) as bigint,
    });
    const data = market({
        notional: isLong ? pair(open.notional, 0n) : pair(0n, open.notional),
        tokens: isLong ? pair(open.tokens, 0n) : pair(0n, open.tokens),
        collateral: isLong
            ? pair(open.collateral, 0n)
            : pair(0n, open.collateral),
        fundingUpdate: inputs.now as bigint,
        borrowingUpdate: inputs.now as bigint,
    });
    const operation = golden.operation;
    const action =
        operation === 'increase'
            ? {
                  kind: 'increase' as const,
                  notional: inputs.notional_delta as bigint,
                  collateral: inputs.collateral_delta as bigint,
              }
            : operation === 'partial_decrease'
              ? {
                    kind: 'decrease' as const,
                    notional: inputs.notional_delta as bigint,
                    collateral: inputs.collateral_delta as bigint,
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
    const inputs = record(golden.inputs);
    const isLong = inputs.is_long as boolean;
    const open = position({
        notional: inputs.notional as bigint,
        tokens: inputs.tokens as bigint,
        collateral: inputs.collateral as bigint,
        fundingIdx: inputs.position_funding_idx as bigint,
        borrowingIdx: inputs.position_borrowing_idx as bigint,
    });
    const now = (inputs.fill_timestamp ?? inputs.publish_time) as bigint;
    const data = market({
        notional: isLong ? pair(open.notional, 0n) : pair(0n, open.notional),
        tokens: isLong ? pair(open.tokens, 0n) : pair(0n, open.tokens),
        collateral: isLong
            ? pair(open.collateral, 0n)
            : pair(0n, open.collateral),
        fundingIdx: isLong
            ? pair(inputs.market_funding_idx as bigint, 0n)
            : pair(0n, inputs.market_funding_idx as bigint),
        borrowingIdx: isLong
            ? pair(inputs.market_borrowing_idx as bigint, 0n)
            : pair(0n, inputs.market_borrowing_idx as bigint),
        fundingUpdate: now,
        borrowingUpdate: now,
    });
    const operation = golden.operation;
    const action =
        operation === 'fixed_add'
            ? {
                  kind: 'adjustCollateral' as const,
                  direction: 'add' as const,
                  amount: inputs.collateral_delta as bigint,
              }
            : {
                  kind: 'adjustCollateral' as const,
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
        const golden = vector(positionCases, 'position.increase.empty_book');
        const expected = record(golden.expected);
        const quoteInput = positionVectorInput(golden.id);
        const beforePosition = structuredClone(quoteInput.position);
        const beforeMarket = structuredClone(quoteInput.market);
        const result = quotePositionAction(quoteInput);

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.executionPrice).toBe(1_000_000_000n);
        expect(result.value.postPosition).toMatchObject({
            notional: expected.position_notional,
            tokens: expected.position_tokens,
            collateral: expected.position_collateral,
        });
        expect(result.value.postMarket.notional.long).toBe(
            expected.market_notional,
        );
        expect(result.value.postMarket.tokens.long).toBe(
            expected.market_tokens,
        );
        expect(result.value.postMarket.collateral.long).toBe(
            expected.market_collateral,
        );
        expect(result.value.fees).toMatchObject({
            base: expected.base_fee,
            impact: expected.impact_fee,
            marginDebit: 3_360_000n,
        });
        expect(result.value.margin).toEqual({
            initialRequired: 60_000_000n,
            maintenanceRequired: 30_000_000n,
            initialHeadroom: 186_640_000n,
            maintenanceHeadroom: 216_640_000n,
        });
        expect(result.value.realizedPnl).toBe(0n);
        expect(result.value.walletPayout).toBe(0n);
        expect(result.value.action).not.toBe(quoteInput.action);
        expect(quoteInput.position).toEqual(beforePosition);
        expect(quoteInput.market).toEqual(beforeMarket);
    });

    it('matches the contract-derived partial decrease', () => {
        const golden = vector(positionCases, 'position.partial_decrease.flat');
        const expected = record(golden.expected);
        const result = quotePositionAction(positionVectorInput(golden.id));

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.postPosition).toMatchObject({
            notional: expected.position_notional,
            tokens: expected.position_tokens,
            collateral: expected.position_collateral,
        });
        expect(result.value.postMarket.notional.long).toBe(
            expected.market_notional,
        );
        expect(result.value.postMarket.tokens.long).toBe(
            expected.market_tokens,
        );
        expect(result.value.postMarket.collateral.long).toBe(
            expected.market_collateral,
        );
        expect(result.value.fees.base).toBe(expected.base_fee);
        expect(result.value.fees.impact).toBe(expected.impact_fee);
        expect(result.value.walletPayout).toBe(expected.returned);
        expect(result.value.realizedPnl).toBe(0n);
    });

    it('matches the contract-derived full close and canonical zero state', () => {
        const golden = vector(positionCases, 'position.full_close.flat');
        const expected = record(golden.expected);
        const quoteInput = positionVectorInput(golden.id);
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
        expect(result.value.postMarket.collateral.long).toBe(
            expected.market_collateral,
        );
        expect(result.value.walletPayout).toBe(expected.returned);
        expect(result.value.fees.base).toBe(expected.base_fee);
        expect(result.value.fees.impact).toBe(expected.impact_fee);
    });

    it('rejects the contract-derived voluntary underwater full close with code 713', () => {
        const golden = vector(
            positionCases,
            'position.full_close.underwater_voluntary_reject',
        );
        const expected = record(golden.expected);
        const result = quotePositionAction(positionVectorInput(golden.id));

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: `contract error #${expected.error_code}: insufficient margin`,
        });
    });
});

describe('funding, borrowing, and collateral-only actions', () => {
    it('routes earned funding to claimable balance during a top-up', () => {
        const golden = vector(marginCases, 'margin.fixed_add.zero_notional');
        const expected = record(golden.expected);
        const result = quotePositionAction(marginVectorInput(golden.id));

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.postPosition).toMatchObject({
            notional: expected.position_notional,
            tokens: expected.position_tokens,
            collateral: expected.position_collateral,
            fundingIdx: expected.post_position_funding_idx,
            borrowingIdx: expected.post_position_borrowing_idx,
        });
        expect(result.value.postMarket.fundingOwed).toBe(
            expected.funding_owed_delta,
        );
        expect(result.value.postMarket.collateral.long).toBe(11n);
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
            const work = record(golden.work);
            const expected = record(golden.expected);
            const result = quotePositionAction(marginVectorInput(id));

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.value.postPosition.collateral).toBe(
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
            collateral: 100_000_000n,
        });
        const result = quotePositionAction(
            input({
                position: open,
                market: market({
                    notional: pair(open.notional, 0n),
                    tokens: pair(open.tokens, 0n),
                    collateral: pair(open.collateral, 0n),
                    fundingUpdate: 1n,
                    borrowingUpdate: 1n,
                }),
                config: config({
                    feeDom: 5_000_000_000_000_000n,
                    feeNonDom: 3_000_000_000_000_000n,
                    maxPnlTrader: 900_000_000_000_000_000n,
                }),
                price: {
                    feedId: 1,
                    exponent: -7,
                    bid: 105_000_000n,
                    ask: 105_000_000n,
                    publishTime: 1n,
                    source: 'pyth',
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
            collateral: 100n,
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
                    collateral: pair(100n, 0n),
                    fundingUpdate: 99n,
                    borrowingUpdate: 99n,
                }),
                price: verifiedPrice({ publish_time: 99n }),
                action: { kind: 'decrease', notional: 51n, collateral: 0n },
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
                    collateral: pair(20n, 0n),
                    fundingUpdate: 1n,
                    borrowingUpdate: 1n,
                }),
                config: config({ maxOpenInterest: 100n }),
                action: { kind: 'increase', notional: 11n, collateral: 10n },
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
                action: { kind: 'increase', notional: 100n, collateral: 100n },
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
            action: { kind: 'increase', notional: 100n, collateral: 100n },
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

    it('enforces initial and maintenance margin on surviving positions', () => {
        const initial = quotePositionAction(
            input({
                action: { kind: 'increase', notional: 100n, collateral: 9n },
            }),
        );
        const open = position({
            notional: 100n,
            tokens: 100n,
            collateral: 11n,
        });
        const maintenance = quotePositionAction(
            input({
                position: open,
                market: market({
                    notional: pair(100n, 0n),
                    tokens: pair(100n, 0n),
                    collateral: pair(11n, 0n),
                    fundingUpdate: 1n,
                    borrowingUpdate: 1n,
                }),
                price: {
                    feedId: 1,
                    exponent: -18,
                    bid: 940_000_000_000_000_000n,
                    ask: 940_000_000_000_000_000n,
                    publishTime: 1n,
                    source: 'pyth',
                },
                action: { kind: 'decrease', notional: 10n, collateral: 0n },
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
    it.each(['notional', 'tokens', 'collateral'] as const)(
        'rejects a position larger than the market %s aggregate',
        (field) => {
            const open = position({
                notional: 100n,
                tokens: 100n,
                collateral: 20n,
            });
            const aggregate = market({
                notional: pair(100n, 0n),
                tokens: pair(100n, 0n),
                collateral: pair(20n, 0n),
                fundingUpdate: 1n,
                borrowingUpdate: 1n,
            });
            aggregate[field].long -= 1n;

            expect(
                quotePositionAction(
                    input({
                        position: open,
                        market: aggregate,
                        action: { kind: 'close' },
                    }),
                ),
            ).toMatchObject({
                kind: 'unavailable',
                code: 'INVALID_INPUT',
            });
        },
    );

    it('maps checked i128 overflow and invalid chronology separately', () => {
        const overflowing = quotePositionAction(
            input({
                position: position({
                    notional: I128_MAX,
                    collateral: I128_MAX,
                }),
                market: market({
                    notional: pair(I128_MAX, 0n),
                    collateral: pair(I128_MAX, 0n),
                    fundingUpdate: 1n,
                    borrowingUpdate: 1n,
                }),
                config: config({
                    maxPositionNotional: I128_MAX,
                    maxOpenInterest: I128_MAX,
                }),
                action: { kind: 'increase', notional: 1n, collateral: 1n },
            }),
        );
        const chronology = quotePositionAction(
            input({
                now: 1n,
                market: market({ fundingUpdate: 2n, borrowingUpdate: 1n }),
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
