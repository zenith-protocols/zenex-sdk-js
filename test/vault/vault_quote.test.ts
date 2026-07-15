import { describe, expect, it } from 'vitest';
import { I128_MAX, SCALAR_18 } from '../../src/math/fixed.js';
import type { VerifiedPrice } from '../../src/market/types.js';
import type {
    MarketData,
    SidePair,
    TradingConfig,
} from '../../src/trading/trading_types.js';
import {
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    quoteVaultDeposit,
    quoteVaultRedeem,
} from '../../src/vault/quote.js';
import type {
    VaultAtomicState,
    VaultDepositQuoteInput,
    VaultQuoteContext,
    VaultRedeemQuoteInput,
} from '../../src/vault/quote.js';
import { checkVaultWithdrawGates } from '../../src/vault/gates.js';
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

function market(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        collateral: pair(),
        tokens: pair(),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        fundingUpdate: 2n,
        borrowingUpdate: 2n,
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

function price(overrides: Partial<VerifiedPrice> = {}): VerifiedPrice {
    return {
        feedId: 1,
        exponent: -8,
        bid: 1_000_000_000n,
        ask: 1_000_000_000n,
        publishTime: 2n,
        source: 'pyth',
        ...overrides,
    };
}

function context(
    overrides: Partial<VaultQuoteContext> = {},
): VaultQuoteContext {
    return {
        ledger: 42,
        now: 2n,
        market: market(),
        config: config(),
        price: price(),
        vault: {
            totalAssets: 1_000_000_000n,
            totalSupply: 1_000_000_000n,
            decimalsOffset: 0,
        },
        treasuryRate: 0n,
        executionFee: 0n,
        minOut: 0n,
        ...overrides,
    };
}

const shareCases = loadGoldenCases('strategyVault', 'shares');
const tradingCases = loadGoldenCases('trading', 'vault');

function strategyState(inputs: Record<string, unknown>): VaultAtomicState {
    return {
        totalAssets: inputs.total_assets as bigint,
        totalSupply: inputs.total_supply as bigint,
        decimalsOffset: Number(inputs.decimals_offset),
    };
}

function tradingVector(id: string) {
    const found = tradingCases.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Missing vector ${id}`);
    return found;
}

function tradingContext(id: string): {
    input: VaultDepositQuoteInput | VaultRedeemQuoteInput;
    work: Record<string, unknown>;
    expected: Record<string, unknown>;
} {
    const golden = tradingVector(id);
    const inputs = record(golden.inputs);
    const work = record(golden.work);
    const expected = record(golden.expected);
    const now = inputs.now as bigint;
    const netPnl = work.net_pnl as bigint;
    const totalAssets = inputs.vault_balance_before as bigint;
    const common = context({
        now,
        market: market({
            notional: pair(
                inputs.long_notional as bigint,
                inputs.short_notional as bigint,
            ),
            collateral: pair(
                inputs.long_collateral as bigint,
                inputs.short_collateral as bigint,
            ),
            tokens: pair(
                inputs.long_tokens as bigint,
                inputs.short_tokens as bigint,
            ),
            fundingUpdate: now,
            borrowingUpdate: now,
            lastPriceTime: inputs.created_at as bigint,
        }),
        config: config({
            keeperRate: inputs.keeper_rate as bigint,
            maxUtilWithdraw:
                (inputs.max_util_withdraw as bigint | undefined) ?? SCALAR_18,
            maxPnlTrader: inputs.max_pnl_trader as bigint,
            maxPnlWithdraw:
                (inputs.max_pnl_withdraw as bigint | undefined) ??
                150_000_000_000_000_000n,
            depositFee: (inputs.deposit_fee as bigint | undefined) ?? 0n,
            redeemFee: (inputs.redeem_fee as bigint | undefined) ?? 0n,
            redeemLock: 0n,
            minDeposit: 1n,
            maxVaultBalance:
                (inputs.max_vault_balance as bigint | undefined) ??
                10_000_000_000_000n,
        }),
        price: price({
            feedId: Number(inputs.feed_id),
            exponent: Number(inputs.exponent),
            bid: inputs.bid as bigint,
            ask: inputs.ask as bigint,
            publishTime: inputs.publish_time as bigint,
        }),
        // The trading artifact intentionally uses a 1:1 mock strategy. Match
        // its exchange rate while the production conversion is tested against
        // the strategy-vault artifact below.
        vault: {
            totalAssets,
            totalSupply: totalAssets - netPnl,
            decimalsOffset: 0,
        },
        treasuryRate: inputs.treasury_rate as bigint,
        executionFee: inputs.exec_fee as bigint,
        minOut: inputs.min_out as bigint,
    });

    const input =
        golden.operation === 'deposit_gate'
            ? {
                  ...common,
                  assets: inputs.assets_deposited as bigint,
              }
            : {
                  ...common,
                  shares: inputs.shares_requested as bigint,
                  createdAt: inputs.created_at as bigint,
              };
    return { input, work, expected };
}

describe('strategy-vault share conversion', () => {
    it.each(
        shareCases.filter(
            (entry) => record(entry.expected).outcome === 'value',
        ),
    )('matches $id exactly', (golden) => {
        const inputs = record(golden.inputs);
        const expected = record(golden.expected);
        const output =
            golden.operation === 'preview_deposit'
                ? convertVaultAssetsToShares(
                      strategyState(inputs),
                      inputs.assets as bigint,
                      inputs.net_pnl as bigint,
                  )
                : convertVaultSharesToAssets(
                      strategyState(inputs),
                      inputs.shares as bigint,
                      inputs.net_pnl as bigint,
                  );

        expect(output).toBe(expected.output);
    });

    it.each(
        shareCases.filter(
            (entry) => record(entry.expected).outcome === 'contract_error',
        ),
    )('returns the strategy contract code for $id', (golden) => {
        const inputs = record(golden.inputs);
        const expected = record(golden.expected);
        const call = () =>
            golden.operation === 'preview_deposit'
                ? convertVaultAssetsToShares(
                      strategyState(inputs),
                      inputs.assets as bigint,
                      inputs.net_pnl as bigint,
                  )
                : convertVaultSharesToAssets(
                      strategyState(inputs),
                      inputs.shares as bigint,
                      inputs.net_pnl as bigint,
                  );

        expect(call).toThrow(new RegExp(`#${String(expected.error_code)}`));
    });

    it('uses widened multiplication but rejects an i128 result overflow', () => {
        const golden = shareCases.find(
            (entry) =>
                entry.id === 'strategy_vault.deposit.i128.result_overflow',
        );
        if (!golden) throw new Error('Missing widened overflow vector');
        const inputs = record(golden.inputs);

        expect(() =>
            convertVaultAssetsToShares(
                strategyState(inputs),
                inputs.assets as bigint,
                inputs.net_pnl as bigint,
            ),
        ).toThrow(/outside the i128 range/);
    });

    it('rejects an impossible decimals offset before exponentiation', () => {
        expect(() =>
            convertVaultAssetsToShares(
                { totalAssets: 0n, totalSupply: 0n, decimalsOffset: 39 },
                1n,
                0n,
            ),
        ).toThrow(/decimals offset/);
    });
});

describe('trading vault fill sequence', () => {
    it.each(tradingCases.filter((entry) => record(entry.expected).accepted))(
        'quotes accepted vector $id atomically',
        (golden) => {
            const { input, work, expected } = tradingContext(golden.id);
            const result =
                golden.operation === 'deposit_gate'
                    ? quoteVaultDeposit(input as VaultDepositQuoteInput)
                    : quoteVaultRedeem(input as VaultRedeemQuoteInput);

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.ledger).toBe(42);
            expect(result.priceTime).toBe(
                record(golden.inputs).publish_time as bigint,
            );
            expect(result.value).toMatchObject({
                kind:
                    golden.operation === 'deposit_gate' ? 'deposit' : 'redeem',
                output:
                    golden.operation === 'deposit_gate'
                        ? expected.mock_shares_received
                        : expected.user_token_balance_after,
                vaultFee: work.vault_fee,
                executionFee: record(golden.inputs).exec_fee,
                netPnl: work.net_pnl,
                postVaultAssets: expected.vault_balance_after,
                valuation: 'transactionQuoteMarkedNav',
            });
            expect(result.value).not.toHaveProperty('navNumerator');
            expect(result.value).not.toHaveProperty('navDenominator');
        },
    );

    it.each(tradingCases.filter((entry) => !record(entry.expected).accepted))(
        'returns the exact failed gate for $id',
        (golden) => {
            const { input, expected } = tradingContext(golden.id);
            const result =
                golden.operation === 'deposit_gate'
                    ? quoteVaultDeposit(input as VaultDepositQuoteInput)
                    : quoteVaultRedeem(input as VaultRedeemQuoteInput);

            expect(result).toEqual({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
                reason: expect.stringContaining(
                    `#${String(expected.error_code)}`,
                ),
            });
        },
    );

    it('reports gross assets and keeps execution fee outside vault backing', () => {
        const { input } = tradingContext(
            'vault.deposit.pnl_fee_settlement_success',
        );
        const result = quoteVaultDeposit(input as VaultDepositQuoteInput);

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.input).toBe(1001n);
        expect(result.value.grossAssets).toBe(1001n);
        expect(result.value.executionFee).toBe(2n);
        expect(result.value.postVaultAssets).toBe(10_996n);
    });

    it('applies the price postdate gate before redeem cooldown', () => {
        const { input } = tradingContext(
            'vault.redeem.pnl_fee_settlement_success',
        );
        const base = input as VaultRedeemQuoteInput;
        const stale = quoteVaultRedeem({ ...base, createdAt: 2n });
        expect(stale).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#740'),
        });

        const locked = quoteVaultRedeem({
            ...base,
            config: config({
                ...base.config,
                redeemLock: 2n,
            }),
        });
        expect(locked).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#751'),
        });
    });

    it('rejects a nonpositive strategy deposit without rereading minDeposit', () => {
        const result = quoteVaultDeposit({
            ...context({ config: config({ minDeposit: 10n }) }),
            assets: 0n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#800'),
        });
    });

    it('does not apply the live minDeposit again to an existing order', () => {
        const result = quoteVaultDeposit({
            ...context({ config: config({ minDeposit: 10n }) }),
            assets: 9n,
        });

        expect(result.kind).toBe('exact');
    });

    it('caps each side PnL before pricing shares', () => {
        const result = quoteVaultDeposit({
            ...context({
                market: market({
                    notional: pair(100n, 0n),
                    collateral: pair(0n, 0n),
                    tokens: pair(1_000n * SCALAR_18, 0n),
                }),
                config: config({
                    maxPnlTrader: SCALAR_18 / 2n,
                    maxVaultBalance: 2_000n,
                }),
                vault: {
                    totalAssets: 1_000n,
                    totalSupply: 750n,
                    decimalsOffset: 0,
                },
            }),
            assets: 100n,
        });

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.netPnl).toBe(250n);
        expect(result.value.output).toBe(100n);
    });

    it('applies redeem minOut to net assets', () => {
        const { input } = tradingContext(
            'vault.redeem.pnl_fee_settlement_success',
        );
        const result = quoteVaultRedeem({
            ...(input as VaultRedeemQuoteInput),
            minOut: 992n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#752'),
        });
    });

    it('fails closed when requested shares exceed total supply', () => {
        const result = quoteVaultRedeem({
            ...context({
                market: market({
                    notional: pair(100n, 0n),
                    collateral: pair(0n, 0n),
                    tokens: pair(101n * SCALAR_18, 0n),
                }),
                vault: {
                    totalAssets: 100n,
                    totalSupply: 100n,
                    decimalsOffset: 0,
                },
            }),
            shares: 101n,
            createdAt: 1n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'redeem shares exceed total supply',
        });
    });

    it('maps a strategy result overflow to CONTRACT_OVERFLOW', () => {
        const result = quoteVaultDeposit({
            ...context({
                vault: {
                    totalAssets: 0n,
                    totalSupply: 1n,
                    decimalsOffset: 0,
                },
                config: config({ maxVaultBalance: I128_MAX }),
            }),
            assets: I128_MAX,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_OVERFLOW',
            reason: expect.stringContaining('outside the i128 range'),
        });
    });
});

describe('withdrawal gates', () => {
    it('returns zero utilization headroom at the exact boundary', () => {
        const { input, work } = tradingContext(
            'vault.utilization.exact_boundary_pass',
        );
        const result = checkVaultWithdrawGates({
            ...(input as VaultRedeemQuoteInput),
            postVaultAssets: work.vault_balance_after_settlement as bigint,
        });

        expect(result).toEqual({
            kind: 'exact',
            ledger: 42,
            priceTime: 2n,
            value: {
                utilizationHeadroom: 0n,
                pnlHeadroom: 150_000_000n,
            },
        });
    });

    it('returns zero PnL headroom at the exact boundary', () => {
        const { input, work } = tradingContext(
            'vault.pending_pnl.exact_boundary_pass',
        );
        const result = checkVaultWithdrawGates({
            ...(input as VaultRedeemQuoteInput),
            postVaultAssets: work.vault_balance_after_settlement as bigint,
        });

        expect(result).toEqual({
            kind: 'exact',
            ledger: 42,
            priceTime: 2n,
            value: {
                utilizationHeadroom: 100_000_000n,
                pnlHeadroom: 0n,
            },
        });
    });

    it('fails closed when the quote chronology is inconsistent', () => {
        const result = checkVaultWithdrawGates({
            ...context({
                now: 1n,
                price: price({ publishTime: 1n }),
                market: market({
                    fundingUpdate: 2n,
                    borrowingUpdate: 2n,
                }),
            }),
            postVaultAssets: 1_000_000_000n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('predates stored accrual'),
        });
    });

    it('does not constrain diagnostic headroom to i128', () => {
        const result = checkVaultWithdrawGates({
            ...context({
                market: market({
                    notional: pair(I128_MAX, 0n),
                    collateral: pair(I128_MAX, I128_MAX),
                    tokens: pair(0n, I128_MAX),
                }),
                config: config({
                    maxPnlWithdraw: SCALAR_18 / 2n,
                }),
                price: price({
                    bid: SCALAR_18,
                    ask: SCALAR_18,
                }),
                vault: {
                    totalAssets: I128_MAX,
                    totalSupply: 0n,
                    decimalsOffset: 0,
                },
            }),
            postVaultAssets: I128_MAX,
        });

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.pnlHeadroom).toBeGreaterThan(I128_MAX);
    });
});
