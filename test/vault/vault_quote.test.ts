import { describe, expect, it } from 'vitest';
import { I128_MAX, SCALAR_18 } from '../../src/math/fixed.js';
import type { PriceData } from '../../src/trading/internal/math.js';
import type {
    MarketData,
    SidePair,
    TradingConfig,
} from '../../src/contracts/market/types.js';
import {
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    quoteVaultDeposit,
    quoteVaultRedeem,
} from '../../src/trading/internal/vault.js';
import type {
    VaultAtomicState,
    VaultDepositQuoteInput,
    VaultQuoteContext,
    VaultRedeemQuoteInput,
} from '../../src/trading/internal/vault.js';
import { checkVaultWithdrawGates } from '../../src/trading/internal/vault.js';

interface ContractCase {
    operation: string;
    inputs: Record<string, unknown>;
    work: Record<string, unknown>;
    expected: Record<string, unknown>;
}

// Contract-derived scenarios preserved from the retired trading-v2 and
// strategy-vault-v2 golden vectors
// (contracts commit 4c631eb17af53ec5e6875f42bf71a43af295e521).
const tradingVaultCases: Record<string, ContractCase> = {
    'vault.deposit.pnl_fee_settlement_success': {
        operation: 'deposit_gate',
        inputs: {
            vault_balance_before: 10_000n,
            assets_deposited: 1_001n,
            long_notional: 100n,
            short_notional: 0n,
            long_collateral: 50n,
            short_collateral: 0n,
            long_tokens: 100_000_000_000n,
            short_tokens: 0n,
            feed_id: 1n,
            bid: 800_000_000n,
            ask: 800_000_000n,
            publish_time: 2n,
            max_vault_balance: 10_996n,
            max_pnl_trader: 900_000_000_000_000_000n,
            deposit_fee: 10_000_000_000_000_000n,
            keeper_rate: 200_000_000_000_000_000n,
            treasury_rate: 333_333_333_333_333_333n,
            exec_fee: 2n,
            min_out: 991n,
            created_at: 1n,
            now: 2n,
        },
        work: {
            long_minimized_pnl: -20n,
            short_minimized_pnl: 0n,
            net_pnl: -20n,
            vault_fee: 10n,
            deposit_assets: 991n,
            keeper_fee_cut: 2n,
            treasury_fee_cut: 3n,
            vault_fee_cut: 5n,
            hypothetical_vault_balance_after: 10_996n,
        },
        expected: {
            accepted: true,
            mock_shares_received: 991n,
            vault_balance_after: 10_996n,
        },
    },
    'vault.redeem.pnl_fee_settlement_success': {
        operation: 'redeem_gate',
        inputs: {
            vault_balance_before: 10_000n,
            shares_requested: 1_001n,
            mock_redeemed_assets: 1_001n,
            long_notional: 100n,
            short_notional: 0n,
            long_collateral: 50n,
            short_collateral: 0n,
            long_tokens: 100_000_000_000n,
            short_tokens: 0n,
            feed_id: 1n,
            bid: 1_200_000_000n,
            ask: 1_200_000_000n,
            publish_time: 2n,
            max_pnl_trader: 900_000_000_000_000_000n,
            max_util_withdraw: 900_000_000_000_000_000n,
            max_pnl_withdraw: 150_000_000_000_000_000n,
            redeem_fee: 10_000_000_000_000_000n,
            keeper_rate: 200_000_000_000_000_000n,
            treasury_rate: 333_333_333_333_333_333n,
            exec_fee: 2n,
            min_out: 991n,
            created_at: 1n,
            now: 2n,
        },
        work: {
            redeemed_assets: 1_001n,
            pnl_cap: 4_500n,
            net_pnl: 20n,
            vault_fee: 10n,
            assets_to_user: 991n,
            keeper_fee_cut: 2n,
            treasury_fee_cut: 3n,
            vault_fee_cut: 5n,
            vault_balance_after_redeem: 8_999n,
            vault_balance_after_settlement: 9_004n,
        },
        expected: {
            accepted: true,
            user_token_balance_after: 991n,
            vault_balance_after: 9_004n,
        },
    },
    'vault.utilization.exact_boundary_pass': {
        operation: 'redeem_gate',
        inputs: {
            vault_balance_before: 2_100_000_000n,
            shares_requested: 100_000_000n,
            mock_redeemed_assets: 100_000_000n,
            long_notional: 900_000_000n,
            short_notional: 0n,
            long_collateral: 900_000_000n,
            short_collateral: 0n,
            long_tokens: 900_000_000_000_000_000n,
            short_tokens: 0n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 2n,
            max_pnl_trader: 900_000_000_000_000_000n,
            max_util_withdraw: 900_000_000_000_000_000n,
            max_pnl_withdraw: 150_000_000_000_000_000n,
            redeem_fee: 0n,
            keeper_rate: 0n,
            treasury_rate: 0n,
            exec_fee: 0n,
            min_out: 0n,
            created_at: 1n,
            now: 2n,
        },
        work: {
            redeemed_assets: 100_000_000n,
            net_pnl: 0n,
            vault_fee: 0n,
            assets_to_user: 100_000_000n,
            vault_balance_after_redeem: 2_000_000_000n,
            vault_balance_after_settlement: 2_000_000_000n,
            utilization_capacity: 900_000_000n,
            long_reserved: 900_000_000n,
            short_reserved: 0n,
            pnl_allowance: 150_000_000n,
        },
        expected: {
            accepted: true,
            vault_balance_after: 2_000_000_000n,
        },
    },
    'vault.pending_pnl.exact_boundary_pass': {
        operation: 'redeem_gate',
        inputs: {
            vault_balance_before: 2_100_000_000n,
            shares_requested: 100_000_000n,
            mock_redeemed_assets: 100_000_000n,
            long_notional: 650_000_000n,
            short_notional: 0n,
            long_collateral: 650_000_000n,
            short_collateral: 0n,
            long_tokens: 800_000_000_000_000_000n,
            short_tokens: 0n,
            feed_id: 1n,
            bid: 1_000_000_000n,
            ask: 1_000_000_000n,
            publish_time: 2n,
            max_pnl_trader: 900_000_000_000_000_000n,
            max_util_withdraw: 900_000_000_000_000_000n,
            max_pnl_withdraw: 150_000_000_000_000_000n,
            redeem_fee: 0n,
            keeper_rate: 0n,
            treasury_rate: 0n,
            exec_fee: 0n,
            min_out: 0n,
            created_at: 1n,
            now: 2n,
        },
        work: {
            redeemed_assets: 100_000_000n,
            net_pnl: 150_000_000n,
            vault_fee: 0n,
            assets_to_user: 100_000_000n,
            vault_balance_after_redeem: 2_000_000_000n,
            vault_balance_after_settlement: 2_000_000_000n,
            utilization_capacity: 900_000_000n,
            long_reserved: 800_000_000n,
            short_reserved: 0n,
            long_pending_pnl: 150_000_000n,
            pnl_allowance: 150_000_000n,
        },
        expected: {
            accepted: true,
            vault_balance_after: 2_000_000_000n,
        },
    },
};

// strategy_vault.deposit.i128.result_overflow inputs from the retired
// strategy-vault-v2 golden vectors.
const strategyOverflowInputs: Record<string, unknown> = {
    decimals_offset: 0n,
    total_assets: 0n,
    total_supply: 1n,
    assets: 170_141_183_460_469_231_731_687_303_715_884_105_727n,
    net_pnl: 0n,
};

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function market(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        margin: pair(),
        tokens: pair(),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        accruedAt: 2n,
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

function feedId(id: bigint): Buffer {
    const bytes = Buffer.alloc(32);
    bytes.writeBigUInt64BE(id, 24);
    return bytes;
}

function price(overrides: Partial<PriceData> = {}): PriceData {
    return {
        feedId: feedId(1n),
        bid: 1_000_000_000n,
        ask: 1_000_000_000n,
        publishTime: 2n,
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

function strategyState(inputs: Record<string, unknown>): VaultAtomicState {
    return {
        totalAssets: inputs.total_assets as bigint,
        totalSupply: inputs.total_supply as bigint,
        decimalsOffset: Number(inputs.decimals_offset),
    };
}

function tradingVector(id: string): ContractCase {
    const found = tradingVaultCases[id];
    if (!found) throw new Error(`Missing vector ${id}`);
    return found;
}

function tradingContext(id: string): {
    input: VaultDepositQuoteInput | VaultRedeemQuoteInput;
    work: Record<string, unknown>;
    expected: Record<string, unknown>;
} {
    const golden = tradingVector(id);
    const inputs = golden.inputs;
    const work = golden.work;
    const expected = golden.expected;
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
            margin: pair(
                inputs.long_collateral as bigint,
                inputs.short_collateral as bigint,
            ),
            tokens: pair(
                inputs.long_tokens as bigint,
                inputs.short_tokens as bigint,
            ),
            accruedAt: now,
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
            feedId: feedId(inputs.feed_id as bigint),
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
                  createdAt: inputs.created_at as bigint,
              }
            : {
                  ...common,
                  shares: inputs.shares_requested as bigint,
                  createdAt: inputs.created_at as bigint,
              };
    return { input, work, expected };
}

describe('strategy-vault share conversion', () => {
    it('uses widened multiplication but rejects an i128 result overflow', () => {
        const inputs = strategyOverflowInputs;

        expect(() =>
            convertVaultAssetsToShares(
                strategyState(inputs),
                inputs.assets as bigint,
                inputs.net_pnl as bigint,
            ),
        ).toThrow(/outside the i128 range/);
    });
});

describe('trading vault fill sequence', () => {
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

    it('applies the redeem cooldown gate', () => {
        const { input } = tradingContext(
            'vault.redeem.pnl_fee_settlement_success',
        );
        const base = input as VaultRedeemQuoteInput;
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

    it('rejects a deposit fill priced at a payload predating the order', () => {
        const result = quoteVaultDeposit({
            ...context({ now: 3n, price: price({ publishTime: 1n }) }),
            assets: 100n,
            createdAt: 2n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#740'),
        });
    });

    it('rejects a deposit fill in the commitment ledger even with a fresh price', () => {
        const result = quoteVaultDeposit({
            ...context({ now: 2n, price: price({ publishTime: 2n }) }),
            assets: 100n,
            createdAt: 2n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#740'),
        });
    });

    it('accepts a fill whose price publishTime equals createdAt in a later ledger', () => {
        const result = quoteVaultDeposit({
            ...context({ now: 3n, price: price({ publishTime: 2n }) }),
            assets: 100n,
            createdAt: 2n,
        });

        expect(result.kind).toBe('exact');
    });

    it('gates a same-second redeem fill on the ledger check before the cooldown', () => {
        const result = quoteVaultRedeem({
            ...context({ now: 2n, price: price({ publishTime: 2n }) }),
            shares: 100n,
            createdAt: 2n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#740'),
        });
    });

    it('rejects a redeem fill priced at a payload predating the order', () => {
        const result = quoteVaultRedeem({
            ...context({ now: 3n, price: price({ publishTime: 1n }) }),
            shares: 100n,
            createdAt: 2n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#740'),
        });
    });

    it('rejects a nonpositive strategy deposit without rereading minDeposit', () => {
        const result = quoteVaultDeposit({
            ...context({ config: config({ minDeposit: 10n }) }),
            assets: 0n,
            createdAt: 1n,
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
            createdAt: 1n,
        });

        expect(result.kind).toBe('exact');
    });

    it('caps each side PnL before pricing shares', () => {
        const result = quoteVaultDeposit({
            ...context({
                market: market({
                    notional: pair(100n, 0n),
                    margin: pair(0n, 0n),
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
            createdAt: 1n,
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
                    margin: pair(0n, 0n),
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
            createdAt: 1n,
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
                price: price(),
                market: market({
                    accruedAt: 2n,
                }),
            }),
            postVaultAssets: 1_000_000_000n,
        });

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('predates stored'),
        });
    });

    it('does not constrain diagnostic headroom to i128', () => {
        const result = checkVaultWithdrawGates({
            ...context({
                market: market({
                    notional: pair(I128_MAX, 0n),
                    margin: pair(I128_MAX, I128_MAX),
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
