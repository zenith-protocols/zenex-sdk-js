import { describe, expect, it } from 'vitest';
import { I128_MAX, SCALAR_18 } from '../../src/math/fixed.js';
import type {
    MarketConfig,
    MarketData,
    Position,
} from '../../src/contracts/market/types.js';
import { VaultOrderKind } from '../../src/contracts/market/types.js';
import {
    advanceMarketAccruals,
    marketPendingBorrowing,
} from '../../src/trading/internal/math.js';
import type { PriceData } from '../../src/trading/internal/math.js';
import { quotePositionAction } from '../../src/trading/internal/quote.js';
import type {
    PositionAction,
    PositionActionOutcome,
} from '../../src/trading/internal/quote.js';
import {
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    lpNetPnl,
    quoteVaultDepositFill,
    quoteVaultRedeemFill,
} from '../../src/trading/internal/vault.js';
import type {
    VaultAtomicState,
    VaultQuoteContext,
} from '../../src/trading/internal/vault.js';
import { VaultOrderIntent } from '../../src/trading/vault_order.js';
import {
    USER,
    contractTestConfig,
    fixtureMarket,
    marketData,
    pair,
} from './market_fixture.js';

// Ports of the zenex-contracts #223 tests (branch head 201a2f0): pending
// borrowing, the LP NAV adjustment, the borrowing checkpoint weight, the
// deposit PnL gate, and the vault's supply and payout bounds. Inputs and
// expected values are the contract's, to the unit.

/** `MAX_OPEN_INTEREST`: 10^11 tokens per side, token-dec. */
const MAX_OPEN_INTEREST = 100_000_000_000n * 10n ** 7n;
/** The vault's fixed `DECIMALS_OFFSET` and the share scale it sets. */
const DECIMALS_OFFSET = 6;
const SHARE_SCALE = 1_000_000n;
/** The supply of a 1,000.0 vault at the bootstrap rate, share-dec. */
const SHARES_1000 = 1000_0000000n * SHARE_SCALE;

/**
 * The long book both the pending-borrowing and the NAV tests mark: 1,000.0
 * checkpointed at index 0.001 and 333.3333333 at 0.001500000000000333.
 */
const TWO_LONGS_WEIGHT =
    1000_0000000n * 1_000_000_000_000_000n +
    333_3333333n * 1_500_000_000_000_333n;

const flat = (value: bigint, publishTime = 0n): PriceData => ({
    bid: value,
    ask: value,
    publishTime,
});

describe('marketPendingBorrowing mirrors MarketData::pending_borrowing', () => {
    // The long side owes 2.1243757712... and the short side exactly
    // 0.10000005. The 2.2243758212... total floors to 2.2243758 and ceils to
    // 2.2243759. Flooring each side apart would read 2.2243757.
    it('rounds the two sides once', () => {
        expect(TWO_LONGS_WEIGHT).toBe(14_999_999_999_501_109_999_999_889n);
        const data = marketData({
            notional: pair(1333_3333333n, 5_0000000n),
            borrowingIdx: pair(2_718_281_828_459_045n, 30_000_010_000_000_000n),
            borrowingWeight: pair(
                TWO_LONGS_WEIGHT,
                5_0000000n * (SCALAR_18 / 100n),
            ),
        });

        expect(marketPendingBorrowing(data, true)).toBe(2_2243758n);
        expect(marketPendingBorrowing(data, false)).toBe(2_2243759n);
    });

    // 100.0 checkpointed at index 0.01 and marked at 0.05 owes exactly 4.0.
    // A side checkpointed at its current index, and an empty book, owe
    // nothing.
    it('is exact on a whole-unit total', () => {
        const data = marketData({
            notional: pair(100_0000000n, 0n),
            borrowingIdx: pair((5n * SCALAR_18) / 100n, 0n),
            borrowingWeight: pair(100_0000000n * (SCALAR_18 / 100n), 0n),
        });
        expect(marketPendingBorrowing(data, true)).toBe(4_0000000n);
        expect(marketPendingBorrowing(data, false)).toBe(4_0000000n);

        data.borrowingWeight.long = data.notional.long * data.borrowingIdx.long;
        expect(marketPendingBorrowing(data, true)).toBe(0n);
        expect(marketPendingBorrowing(data, false)).toBe(0n);

        expect(marketPendingBorrowing(marketData(), false)).toBe(0n);
    });

    // At MAX_OPEN_INTEREST on both sides the exact sum fits i128 up to a
    // summed index of 170. A summed index of 171 does not fit.
    it('fits at the open interest bound and fails closed past it', () => {
        const data = marketData({
            notional: pair(MAX_OPEN_INTEREST, MAX_OPEN_INTEREST),
            borrowingIdx: pair(85n * SCALAR_18, 85n * SCALAR_18),
        });
        expect(marketPendingBorrowing(data, true)).toBe(170n * MAX_OPEN_INTEREST);
        expect(marketPendingBorrowing(data, false)).toBe(170n * MAX_OPEN_INTEREST);

        expect(MAX_OPEN_INTEREST * 171n * SCALAR_18).toBeGreaterThan(I128_MAX);
        const past = marketData({
            notional: pair(MAX_OPEN_INTEREST, 0n),
            borrowingIdx: pair(171n * SCALAR_18, 0n),
        });
        expect(() => marketPendingBorrowing(past, true)).toThrow(
            /outside the i128 range/,
        );
    });

    // A side whose weight runs ahead of its mark counts as zero, not as a
    // credit against the other side.
    it('floors a side at zero before summing', () => {
        const data = marketData({
            notional: pair(100_0000000n, 100_0000000n),
            borrowingIdx: pair(SCALAR_18 / 100n, SCALAR_18 / 100n),
            borrowingWeight: pair(100_0000000n * SCALAR_18, 0n),
        });
        expect(marketPendingBorrowing(data, true)).toBe(1_0000000n);
        expect(marketPendingBorrowing(data, false)).toBe(1_0000000n);
    });
});

describe('lpNetPnl mirrors Market::lp_net_pnl', () => {
    const config = contractTestConfig();

    // The long side marks zero PnL at a flat $1 and owes 2.1243757712... of
    // borrowing. The NAV adjustment is minus the vault's share after the
    // treasury cut. The redeem mark floors the total and the share. The
    // deposit mark ceils both.
    it.each([
        [0n, 2_1243757n, 2_1243758n],
        [SCALAR_18 / 10n, 1_9119381n, 1_9119383n],
        [SCALAR_18 / 2n, 1_0621878n, 1_0621879n],
    ])(
        'subtracts the vault share of pending borrowing at treasury rate %s',
        (treasuryRate, redeem, deposit) => {
            const data = marketData({
                notional: pair(1333_3333333n, 0n),
                tokens: pair(1333_3333333n, 0n),
                borrowingIdx: pair(2_718_281_828_459_045n, 0n),
                borrowingWeight: pair(TWO_LONGS_WEIGHT, 0n),
            });
            const price = flat(SCALAR_18);

            expect(
                lpNetPnl(data, config, price, 1000_0000000n, treasuryRate, true),
            ).toBe(-redeem);
            expect(
                lpNetPnl(data, config, price, 1000_0000000n, treasuryRate, false),
            ).toBe(-deposit);
        },
    );

    // A 100.0 vault caps each side at 45.0. At $10 the long (entered 50.0
    // for 10 base tokens) and the short (entered 150.0 for 10 base tokens)
    // each mark 50.0 of profit and count as 45.0. The long's 10.0 of
    // borrowing subtracts in full: 45.0 + 45.0 - 10.0.
    it('caps each side profit but not the borrowing', () => {
        const data = marketData({
            notional: pair(50_0000000n, 150_0000000n),
            margin: pair(10_0000000n, 10_0000000n),
            tokens: pair(10_0000000n, 10_0000000n),
            borrowingIdx: pair(SCALAR_18 / 5n, 0n),
        });
        const price = flat(10n * SCALAR_18);

        expect(lpNetPnl(data, config, price, 100_0000000n, 0n, true)).toBe(
            80_0000000n,
        );
        expect(lpNetPnl(data, config, price, 100_0000000n, 0n, false)).toBe(
            80_0000000n,
        );
    });

    // The long side entered 150.0 for 10 base tokens on 20.0 margin, so at
    // $10 its 50.0 loss counts as 20.0. It also owes 10.0 of borrowing:
    // 100.0 checkpointed at index 0.05 and 50.0 at 0, marked at 0.1.
    it('clips a loss at margin but counts all the borrowing', () => {
        const data = marketData({
            notional: pair(150_0000000n, 0n),
            margin: pair(20_0000000n, 0n),
            tokens: pair(10_0000000n, 0n),
            borrowingIdx: pair(SCALAR_18 / 10n, 0n),
            borrowingWeight: pair(100_0000000n * (SCALAR_18 / 20n), 0n),
        });
        const price = flat(10n * SCALAR_18);

        expect(lpNetPnl(data, config, price, 100_0000000n, 0n, true)).toBe(
            -30_0000000n,
        );
        expect(lpNetPnl(data, config, price, 100_0000000n, 0n, false)).toBe(
            -30_0000000n,
        );
    });
});

describe('the borrowing weight follows the position checkpoints', () => {
    const zeroed = (): Position => ({
        margin: 0n,
        notional: 0n,
        tokens: 0n,
        fundingIdx: 0n,
        borrowingIdx: 0n,
        lockedNotional: 0n,
        unlocksAt: 0n,
        pricedAt: 0n,
        decreaseOrders: [],
    });
    const TREASURY_RATE = SCALAR_18 / 10n;
    const VAULT = 100000_0000000n;
    const config = contractTestConfig();
    const price = flat(SCALAR_18);

    function settle(
        market: MarketData,
        position: Position,
        isLong: boolean,
        now: bigint,
        action: PositionAction,
    ): PositionActionOutcome {
        const result = quotePositionAction({
            ledger: 42,
            now,
            isLong,
            position,
            market,
            config,
            price: { ...price, publishTime: now },
            vaultAssets: VAULT,
            treasuryRate: TREASURY_RATE,
            action,
            executionFee: 0n,
            relayFee: 0n,
        });
        if (result.kind !== 'exact') {
            throw new Error(`expected an exact quote, got ${result.kind}`);
        }
        return result.value;
    }

    const nav = (market: MarketData, maximize: boolean) =>
        lpNetPnl(market, config, price, VAULT, TREASURY_RATE, maximize);

    // The contract's `borrowing_weight_follows_two_longs_through_their_lifetimes`:
    // an empty book at a flat $1, a 100,000.0 vault, a 10% treasury rate.
    it('through two longs opening, shrinking and closing', () => {
        let market = marketData({
            borrowingIdx: pair(1_000_000_000_000_000n, 0n),
        });

        const openA = settle(market, zeroed(), true, 0n, {
            kind: 'increase',
            notional: 1000_0000000n,
            margin: 200_0000000n,
        });
        market = openA.postMarket;
        let a = openA.postPosition;
        expect(market.borrowingWeight.long).toBe(
            1000_0000000n * 1_000_000_000_000_000n,
        );
        expect(marketPendingBorrowing(market, false)).toBe(0n);

        market.borrowingIdx.long = 1_500_000_000_000_333n;
        const openB = settle(market, zeroed(), true, 0n, {
            kind: 'increase',
            notional: 333_3333333n,
            margin: 100_0000000n,
        });
        market = openB.postMarket;
        let b = openB.postPosition;
        expect(market.notional.long).toBe(1333_3333333n);
        expect(market.borrowingWeight.long).toBe(TWO_LONGS_WEIGHT);
        expect(marketPendingBorrowing(market, true)).toBe(5_000_000n);
        expect(marketPendingBorrowing(market, false)).toBe(5_000_001n);

        market.borrowingIdx.long = 2_718_281_828_459_045n;
        expect(marketPendingBorrowing(market, true)).toBe(2_1243757n);
        expect(marketPendingBorrowing(market, false)).toBe(2_1243758n);
        expect(nav(market, true)).toBe(-1_9119381n);
        expect(nav(market, false)).toBe(-1_9119383n);

        // Past the 30 s decrease lock.
        market.accruedAt = 100n;
        const reduce = settle(market, a, true, 100n, {
            kind: 'decrease',
            notional: 400_0000000n,
            margin: 0n,
        });
        market = reduce.postMarket;
        a = reduce.postPosition;
        expect(reduce.fees.borrowing).toBe(1_7182819n);
        expect(market.notional.long).toBe(933_3333333n);
        expect(market.borrowingWeight.long).toBe(
            21_309_690_970_255_379_999_999_889n,
        );
        expect(marketPendingBorrowing(market, true)).toBe(4060939n);
        expect(marketPendingBorrowing(market, false)).toBe(4060940n);

        market.borrowingIdx.long = 3_141_592_653_589_793n;
        expect(nav(market, true)).toBe(-7210656n);
        expect(nav(market, false)).toBe(-7210657n);
        const closeA = settle(market, a, true, 100n, { kind: 'close' });
        market = closeA.postMarket;
        const closeB = settle(market, b, true, 100n, { kind: 'close' });
        market = closeB.postMarket;
        b = closeB.postPosition;
        expect(closeA.fees.borrowing).toBe(2539865n);
        expect(closeB.fees.borrowing).toBe(5471976n);
        expect(b.notional).toBe(0n);
        expect(market.notional.long).toBe(0n);
        expect(market.borrowingWeight.long).toBe(0n);
        expect(market.borrowingWeight.short).toBe(0n);
    });

    // A margin top-up settles the accrued borrowing and re-checkpoints the
    // position at its unchanged size, so the side's weight stays the sum of
    // its rows' `notional * borrowingIdx`. The contract's
    // `borrowing_weight_matches_the_rows_through_every_checkpoint_writer`
    // opens these three shorts and tops up the second the same way.
    it('through a margin top-up at an unchanged size', () => {
        let market = marketData({
            borrowingIdx: pair(0n, 7_000_000_000_000_001n),
        });
        const rowsWeight = (...rows: Position[]) =>
            rows.reduce((sum, row) => sum + row.notional * row.borrowingIdx, 0n);

        const open1 = settle(market, zeroed(), false, 0n, {
            kind: 'increase',
            notional: 250_0000000n,
            margin: 100_0000000n,
        });
        market = open1.postMarket;
        const s1 = open1.postPosition;
        market.borrowingIdx.short = 19_999_999_999_999_999n;
        const open2 = settle(market, zeroed(), false, 0n, {
            kind: 'increase',
            notional: 123_4567891n,
            margin: 50_0000000n,
        });
        market = open2.postMarket;
        let s2 = open2.postPosition;
        market.borrowingIdx.short = 31_415_926_535_897_932n;
        const open3 = settle(market, zeroed(), false, 0n, {
            kind: 'increase',
            notional: 77_7777777n,
            margin: 30_0000000n,
        });
        market = open3.postMarket;
        const s3 = open3.postPosition;
        expect(market.borrowingWeight.short).toBe(rowsWeight(s1, s2, s3));

        market.accruedAt = 100n;
        market.borrowingIdx.short = 47_123_456_789_012_345n;
        const topUp = settle(market, s2, false, 100n, {
            kind: 'increase',
            notional: 0n,
            margin: 1_0000000n,
        });
        market = topUp.postMarket;
        s2 = topUp.postPosition;
        expect(s2.borrowingIdx).toBe(market.borrowingIdx.short);
        expect(s2.notional).toBe(123_4567891n);
        expect(market.borrowingWeight.short).toBe(rowsWeight(s1, s2, s3));
        expect(market.borrowingWeight.long).toBe(0n);
    });
});

describe('vault share math at the fixed offset of 6', () => {
    const vault = (totalAssets: bigint, totalSupply: bigint): VaultAtomicState => ({
        totalAssets,
        totalSupply,
        decimalsOffset: DECIMALS_OFFSET,
    });
    /** The largest share supply the vault admits. */
    const SUPPLY_BOUND = I128_MAX - SHARE_SCALE;

    // The bootstrap quote is assets * (0 supply + 1e6 virtual) / (0 backing + 1).
    it('prices the empty vault at 10^6 shares per unit', () => {
        expect(convertVaultAssetsToShares(vault(0n, 0n), 10_0000000n, 0n)).toBe(
            10_0000000n * SHARE_SCALE,
        );
    });

    // A profit mark equal to the asset balance still prices, on the +1
    // floor: shares = floor(1e8 * (1e16 + 1e6) / (0 + 1)).
    it('prices a profit matching the assets on the floor', () => {
        const assets = 1000_0000000n;
        expect(
            convertVaultAssetsToShares(
                vault(assets, assets * SHARE_SCALE),
                10_0000000n,
                assets,
            ),
        ).toBe(100_000_000n * (10_000_000_000_000_000n + SHARE_SCALE));
    });

    // One unit of pending loss lifts the full exit of the 1e16 supply to
    // exactly the balance: floor(1e16 * (1e10 + 1 + 1) / (1e16 + 1e6)) =
    // 1e10. Two units price it one unit past.
    it('quotes a full exit at and one unit past the balance', () => {
        const state = vault(1000_0000000n, 1000_0000000n * SHARE_SCALE);
        expect(convertVaultSharesToAssets(state, state.totalSupply, -1n)).toBe(
            1000_0000000n,
        );
        expect(convertVaultSharesToAssets(state, state.totalSupply, -2n)).toBe(
            1000_0000001n,
        );
    });

    // A pending loss of 10^6 - 1 units on the empty vault prices one share
    // per unit, so a deposit of the supply bound mints exactly the bound.
    it('mints the supply bound at one share per unit', () => {
        expect(
            convertVaultAssetsToShares(vault(0n, 0n), SUPPLY_BOUND, -(SHARE_SCALE - 1n)),
        ).toBe(SUPPLY_BOUND);
    });
});

describe('vault fills price pending borrowing against the LP', () => {
    function context(overrides: Partial<VaultQuoteContext> = {}): VaultQuoteContext {
        return {
            ledger: 42,
            now: 100n,
            market: marketData({ accruedAt: 100n }),
            config: contractTestConfig(),
            price: flat(10n * SCALAR_18, 100n),
            vault: {
                totalAssets: 1000_0000000n,
                totalSupply: SHARES_1000,
                decimalsOffset: DECIMALS_OFFSET,
            },
            treasuryRate: 0n,
            executionFee: 0n,
            minOut: 0n,
            ...overrides,
        };
    }

    // The contract's `vault_fills_price_pending_borrowing_against_the_lp`:
    // the long side marks zero PnL at the flat $10 and owes 5.0 and a
    // fraction of a unit, 100.0 checkpointed at index 0 and marked at
    // 0.050000000000000001. The deposit prices at -5.0000001, rounded up,
    // and the redeem at -5.0, rounded down.
    const book = (): MarketData =>
        marketData({
            notional: pair(100_0000000n, 0n),
            margin: pair(10_0000000n, 0n),
            tokens: pair(10_0000000n, 0n),
            borrowingIdx: pair(SCALAR_18 / 20n + 1n, 0n),
            accruedAt: 100n,
        });

    it('rounds the deposit NAV up and the redeem NAV down', () => {
        const deposit = quoteVaultDepositFill({
            ...context({ market: book() }),
            assets: 5_0000000n,
            createdAt: 40n,
        });
        expect(deposit.kind).toBe('exact');
        if (deposit.kind !== 'exact') return;
        expect(deposit.value.kind).toBe('deposit');
        expect(deposit.value.netPnl).toBe(-5_0000001n);
        // 4.995 after the 0.1% fee, against 1,005.0000001 of backing plus one.
        expect(deposit.value.kind === 'deposit' && deposit.value.output).toBe(
            (4_9950000n * (SHARES_1000 + SHARE_SCALE)) / (1005_0000001n + 1n),
        );

        const redeem = quoteVaultRedeemFill({
            ...context({ market: book() }),
            shares: 5_0000000n * SHARE_SCALE,
            createdAt: 40n,
        });
        expect(redeem.kind).toBe('exact');
        if (redeem.kind !== 'exact') return;
        expect(redeem.value.kind).toBe('redeem');
        expect(redeem.value.netPnl).toBe(-5_0000000n);
        expect(redeem.value.kind === 'redeem' && redeem.value.grossAssets).toBe(
            (5_0000000n * SHARE_SCALE * (1005_0000000n + 1n)) /
                (SHARES_1000 + SHARE_SCALE),
        );
    });

    it('reports the same NAV adjustment on a rejected order', () => {
        const deposit = quoteVaultDepositFill({
            ...context({ market: book(), minOut: I128_MAX }),
            assets: 5_0000000n,
            createdAt: 40n,
        });
        expect(deposit).toEqual({
            kind: 'exact',
            ledger: 42,
            value: expect.objectContaining({
                kind: 'rejected',
                action: 'deposit',
                netPnl: -5_0000001n,
            }),
        });

        const redeem = quoteVaultRedeemFill({
            ...context({ market: book(), minOut: I128_MAX }),
            shares: 5_0000000n * SHARE_SCALE,
            createdAt: 40n,
        });
        expect(redeem).toEqual({
            kind: 'exact',
            ledger: 42,
            value: expect.objectContaining({
                kind: 'rejected',
                action: 'redeem',
                netPnl: -5_0000000n,
            }),
        });
    });

    // The fill accrues the market to its own time first, so the borrowing
    // the stored index has not caught up with still prices against the LP.
    //
    // By hand from `accrue_borrowing`: the 10 base tokens reserve 100.0 at
    // $10 against a capacity of 0.8 * 1,000.0 / 2 = 400.0, a utilization of
    // 0.25, under the 0.5 kink. The rate is 0.001 * 0.25 = 0.00025 a second,
    // so the 3,600 s since the stored accrual lift the index by 0.9. The
    // 100.0 of notional checkpointed at index 0 then owes exactly 90.0 at
    // either rounding, all of it the vault's at a zero treasury rate.
    it('counts the borrowing accrued since the stored accrual', () => {
        const config: MarketConfig = contractTestConfig({
            borrowRate: SCALAR_18 / 1000n,
            increasedBorrowRate: SCALAR_18 / 100n,
        });
        const stored = marketData({
            notional: pair(100_0000000n, 0n),
            margin: pair(10_0000000n, 0n),
            tokens: pair(10_0000000n, 0n),
            accruedAt: 100n,
        });
        const price = flat(10n * SCALAR_18, 3700n);
        const vault = context().vault;
        const accrued = advanceMarketAccruals(
            stored,
            config,
            price,
            vault.totalAssets,
            3700n,
        ).market;
        expect(accrued.borrowingIdx).toEqual(pair(900_000_000_000_000_000n, 0n));
        expect(marketPendingBorrowing(stored, false)).toBe(0n);
        expect(marketPendingBorrowing(accrued, false)).toBe(90_0000000n);
        expect(
            lpNetPnl(accrued, config, price, vault.totalAssets, 0n, false),
        ).toBe(-90_0000000n);

        const deposit = quoteVaultDepositFill({
            ...context({ market: stored, config, price, now: 3700n }),
            assets: 5_0000000n,
            createdAt: 40n,
        });
        expect(deposit.kind).toBe('exact');
        if (deposit.kind !== 'exact') return;
        expect(deposit.value.kind).toBe('deposit');
        if (deposit.value.kind !== 'deposit') return;
        expect(deposit.value.netPnl).toBe(-90_0000000n);
        // 4.995 after the 0.1% fee, against 1,090.0 of backing plus one:
        // floor(49_950_000 * 10_000_000_001_000_000 / 10_900_000_001).
        expect(deposit.value.output).toBe(45_825_688_073_772n);

        const redeem = quoteVaultRedeemFill({
            ...context({ market: stored, config, price, now: 3700n }),
            shares: 5_0000000n * SHARE_SCALE,
            createdAt: 40n,
        });
        expect(redeem.kind).toBe('exact');
        if (redeem.kind !== 'exact') return;
        expect(redeem.value.kind).toBe('redeem');
        if (redeem.value.kind !== 'redeem') return;
        expect(redeem.value.netPnl).toBe(-90_0000000n);
        // 5.0 shares: floor(5e13 * 10_900_000_001 / 10_000_000_001_000_000).
        expect(redeem.value.grossAssets).toBe(5_4499999n);
    });

    describe('the deposit pending-PnL gate', () => {
        // $10.000000005 values 10 base tokens at 100.00000005, half a unit
        // off the grid, so a side's maximized mark reads one unit above its
        // minimized mark.
        const GATE_PRICE = 10n * SCALAR_18 + 5_000_000_000n;

        // 10 base tokens and 10.0 margin per side at the given entry
        // notionals, accrued to the fill's timestamp.
        const gateBook = (longNotional: bigint, shortNotional: bigint) =>
            marketData({
                notional: pair(longNotional, shortNotional),
                margin: pair(10_0000000n, 10_0000000n),
                tokens: pair(10_0000000n, 10_0000000n),
                accruedAt: 100n,
            });

        // A 5.0 deposit into a 100.0 vault, priced flat at GATE_PRICE.
        const fill = (market: MarketData, minOut = 0n) =>
            quoteVaultDepositFill({
                ...context({
                    market,
                    price: flat(GATE_PRICE, 100n),
                    vault: {
                        totalAssets: 100_0000000n,
                        totalSupply: 100_0000000n * SHARE_SCALE,
                        decimalsOffset: DECIMALS_OFFSET,
                    },
                    minOut,
                }),
                assets: 5_0000000n,
                createdAt: 40n,
            });
        const gated = {
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: expect.stringContaining('#754'),
            contractCode: 754,
        };

        // The 100.0 vault allows floor(90% * 50.0) = 45.0 per side.
        // Maximized, the long (on 55.0000001) and the short (on 145.0) each
        // mark exactly 45.0. Minimized, each marks 44.9999999.
        it('fills with pending profit exactly at the allowance on both sides', () => {
            const result = fill(gateBook(55_0000001n, 145_0000000n));

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.value.kind).toBe('deposit');
            if (result.value.kind !== 'deposit') return;
            expect(result.value.input).toBe(5_0000000n);
            expect(result.value.vaultFee).toBe(50_000n);
            expect(result.value.netPnl).toBe(89_9999998n);
        });

        // The long on 55.0 marks 45.0000001 maximized, one unit over the
        // allowance. Minimized it marks 45.0, so only the maximized mark
        // gates.
        it('gates one unit of long profit above the allowance', () => {
            expect(fill(gateBook(55_0000000n, 145_0000000n))).toEqual(gated);
        });

        // The short on 145.0000001 marks 45.0000001 maximized.
        it('gates one unit of short profit above the allowance', () => {
            expect(fill(gateBook(55_0000001n, 145_0000001n))).toEqual(gated);
        });

        // The gate reads the pre-deposit vault: the 4.995 net deposit would
        // lift the allowance to 47.24775 and clear the long's 45.0000001.
        it('reads the balance before the deposit lands', () => {
            const book = gateBook(55_0000000n, 145_0000000n);
            expect(fill(book)).toEqual(gated);

            const after = quoteVaultDepositFill({
                ...context({
                    market: book,
                    price: flat(GATE_PRICE, 100n),
                    vault: {
                        totalAssets: 104_9950000n,
                        totalSupply: 100_0000000n * SHARE_SCALE,
                        decimalsOffset: DECIMALS_OFFSET,
                    },
                }),
                assets: 5_0000000n,
                createdAt: 40n,
            });
            expect(after.kind === 'exact' && after.value.kind).toBe('deposit');
        });

        // The gate runs ahead of the slippage bound, so an order over it
        // stays resting instead of being rejected.
        it('gates ahead of a missed minOut', () => {
            expect(fill(gateBook(55_0000000n, 145_0000000n), I128_MAX)).toEqual(gated);
            const rejected = fill(gateBook(55_0000001n, 145_0000000n), I128_MAX);
            expect(rejected.kind === 'exact' && rejected.value.kind).toBe('rejected');
        });

        // The fill-time check still runs behind the order's timing rule.
        it('gates behind the stale-price check', () => {
            const stale = quoteVaultDepositFill({
                ...context({
                    market: gateBook(55_0000000n, 145_0000000n),
                    price: flat(GATE_PRICE, 39n),
                    vault: {
                        totalAssets: 100_0000000n,
                        totalSupply: 100_0000000n * SHARE_SCALE,
                        decimalsOffset: DECIMALS_OFFSET,
                    },
                }),
                assets: 5_0000000n,
                createdAt: 40n,
            });
            expect(stale).toEqual({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
                reason: expect.stringContaining('#740'),
                contractCode: 740,
            });
        });

        it('blocks VaultOrderIntent.fills with code 754', () => {
            const intent = new VaultOrderIntent(
                'C',
                USER,
                VaultOrderKind.Deposit,
                5_0000000n,
                0n,
            );
            const over = fixtureMarket({
                data: gateBook(55_0000000n, 145_0000000n),
                vaultAssets: 100_0000000n,
            });
            const at = fixtureMarket({
                data: gateBook(55_0000001n, 145_0000000n),
                vaultAssets: 100_0000000n,
            });

            expect(intent.fills(over, GATE_PRICE, 100n)).toEqual({
                fills: false,
                block: expect.objectContaining({ code: 754 }),
            });
            expect(intent.fills(at, GATE_PRICE, 100n)).toEqual({ fills: true });
        });
    });

    describe('the payout bound on a redeem', () => {
        // `units` of pending borrowing and no PnL at a flat $1: `units` of
        // notional and base size marked at index 1.0 from a zero checkpoint.
        const owing = (units: bigint) =>
            marketData({
                notional: pair(units, 0n),
                tokens: pair(units, 0n),
                borrowingIdx: pair(SCALAR_18, 0n),
                accruedAt: 100n,
            });
        const fullExit = (units: bigint, minOut = 0n) =>
            quoteVaultRedeemFill({
                ...context({
                    market: owing(units),
                    price: flat(SCALAR_18, 100n),
                    minOut,
                }),
                shares: SHARES_1000,
                createdAt: 40n,
            });

        // One unit of counted borrowing lifts the full exit to exactly the
        // 1,000.0 balance.
        it('fills a full exit paying exactly the balance', () => {
            const result = fullExit(1n);

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.value.kind).toBe('redeem');
            if (result.value.kind !== 'redeem') return;
            expect(result.value.netPnl).toBe(-1n);
            expect(result.value.grossAssets).toBe(1000_0000000n);
        });

        // Two units price the same exit one unit past the balance, which
        // the vault refuses with PayoutExceedsAssets.
        it('gates a full exit paying one unit past the balance (#803)', () => {
            expect(fullExit(2n)).toEqual({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
                reason: expect.stringContaining('#803'),
                contractCode: 803,
            });
        });

        // The slippage bound reads the quote before the burn, so a missed
        // minOut rejects the order and the payout bound is never reached.
        it('rejects a missed minOut ahead of the payout bound', () => {
            expect(fullExit(2n, I128_MAX)).toEqual({
                kind: 'exact',
                ledger: 42,
                value: expect.objectContaining({
                    kind: 'rejected',
                    action: 'redeem',
                    netPnl: -2n,
                    // 1,000.0000001 less the 0.1% redeem fee, rounded down.
                    quoted: 1000_0000001n - 1_0000000n,
                }),
            });
        });

        it('blocks VaultOrderIntent.fills with code 803', () => {
            const intent = new VaultOrderIntent(
                'C',
                USER,
                VaultOrderKind.Redeem,
                SHARES_1000,
                0n,
            );
            // The fixture market holds 1,000.0 at the bootstrap rate, so its
            // whole supply exits for
            // floor(1e16 * (1e10 + 2 + 1) / (1e16 + 1e6)) = 1,000.0000001.
            const market = fixtureMarket({ data: owing(2n) });

            expect(intent.fills(market, SCALAR_18, 100n)).toEqual({
                fills: false,
                block: expect.objectContaining({ code: 803 }),
            });
        });
    });

    describe('the supply bound on a deposit', () => {
        const SUPPLY_BOUND = I128_MAX - SHARE_SCALE;
        // 10^6 - 1 units of counted borrowing on the empty vault price one
        // share per unit. No deposit fee, so the whole deposit mints.
        const deposit = (assets: bigint) =>
            quoteVaultDepositFill({
                ...context({
                    market: marketData({
                        notional: pair(SHARE_SCALE - 1n, 0n),
                        tokens: pair(SHARE_SCALE - 1n, 0n),
                        borrowingIdx: pair(SCALAR_18, 0n),
                        accruedAt: 100n,
                    }),
                    config: contractTestConfig({
                        depositFee: 0n,
                        maxVaultBalance: I128_MAX,
                    }),
                    price: flat(SCALAR_18, 100n),
                    vault: {
                        totalAssets: 0n,
                        totalSupply: 0n,
                        decimalsOffset: DECIMALS_OFFSET,
                    },
                }),
                assets,
                createdAt: 40n,
            });

        it('mints a deposit that lands the supply exactly on the bound', () => {
            const result = deposit(SUPPLY_BOUND);

            expect(result.kind).toBe('exact');
            if (result.kind !== 'exact') return;
            expect(result.value.kind).toBe('deposit');
            if (result.value.kind !== 'deposit') return;
            expect(result.value.netPnl).toBe(-(SHARE_SCALE - 1n));
            expect(result.value.output).toBe(SUPPLY_BOUND);
        });

        it('gates one share past the bound (#802)', () => {
            expect(deposit(SUPPLY_BOUND + 1n)).toEqual({
                kind: 'unavailable',
                code: 'CONTRACT_GATE',
                reason: expect.stringContaining('#802'),
                contractCode: 802,
            });
        });
    });
});

describe('Market share pricing counts pending borrowing', () => {
    // The lifetime book: 2.1243757712... of pending borrowing, a 10% treasury
    // rate, no PnL at a flat $1.
    const market = () =>
        fixtureMarket({
            data: {
                notional: pair(1333_3333333n, 0n),
                tokens: pair(1333_3333333n, 0n),
                borrowingIdx: pair(2_718_281_828_459_045n, 0n),
                borrowingWeight: pair(TWO_LONGS_WEIGHT, 0n),
            },
            vaultAssets: 1000_0000000n,
            treasuryRate: SCALAR_18 / 10n,
        });

    it('reports pending borrowing rounded down and the redeem NAV adjustment', () => {
        expect(market().pendingBorrowing()).toBe(2_1243757n);
        expect(market().netPnl(SCALAR_18)).toBe(-1_9119381n);
    });

    it('prices a deposit on the rounded-up NAV and a redeem on the rounded-down NAV', () => {
        const loaded = market();
        // 1,000.0 at the bootstrap rate: 1e16 shares plus the 1e6 virtual
        // shares, over the backing plus one. The deposit backing counts
        // ceil(2.1243758 * 0.9) = 1.9119383, the redeem backing
        // floor(2.1243757 * 0.9) = 1.9119381.
        const supply = SHARES_1000 + SHARE_SCALE;

        // floor(1e8 * 10_000_000_001_000_000 / 10_019_119_384)
        expect(loaded.assetsToShares(10_0000000n, SCALAR_18)).toBe(
            99_809_171_023_248n,
        );
        expect(
            (10_0000000n * supply) / (1000_0000000n + 1_9119383n + 1n),
        ).toBe(99_809_171_023_248n);
        // 10.0 shares: floor(1e14 * 10_019_119_382 / 10_000_000_001_000_000)
        expect(
            loaded.sharesToAssets(10_0000000n * SHARE_SCALE, SCALAR_18),
        ).toBe(10_0191193n);
        expect(
            (10_0000000n * SHARE_SCALE * (1000_0000000n + 1_9119381n + 1n)) /
                supply,
        ).toBe(10_0191193n);
    });

    it('prices nothing extra once every position sits at the current index', () => {
        const settled = fixtureMarket({
            data: {
                notional: pair(1333_3333333n, 0n),
                tokens: pair(1333_3333333n, 0n),
                borrowingIdx: pair(2_718_281_828_459_045n, 0n),
                borrowingWeight: pair(1333_3333333n * 2_718_281_828_459_045n, 0n),
            },
            vaultAssets: 1000_0000000n,
            treasuryRate: SCALAR_18 / 10n,
        });

        expect(settled.pendingBorrowing()).toBe(0n);
        expect(settled.netPnl(SCALAR_18)).toBe(0n);
    });

    // The snapshot methods read the stored indices. `accrue` advances them,
    // and the accrued snapshot counts the borrowing since.
    //
    // By hand from `accrue_borrowing`, as in the fill test above: 100.0
    // reserved of a 400.0 capacity is a utilization of 0.25, the rate is
    // 0.001 * 0.25 a second, and 3,600 s lift the index by 0.9. The 100.0 of
    // notional owes exactly 90.0, all of it the vault's.
    it('counts the borrowing accrued since the snapshot once accrued', () => {
        const stored = fixtureMarket({
            data: {
                notional: pair(100_0000000n, 0n),
                margin: pair(10_0000000n, 0n),
                tokens: pair(10_0000000n, 0n),
                accruedAt: 100n,
            },
            config: {
                borrowRate: SCALAR_18 / 1000n,
                increasedBorrowRate: SCALAR_18 / 100n,
            },
            vaultAssets: 1000_0000000n,
        });
        const price = 10n * SCALAR_18;
        expect(stored.pendingBorrowing()).toBe(0n);
        expect(stored.netPnl(price)).toBe(0n);

        // 10.0 shares and 10.0 of assets trade one for one at the stored
        // indices: floor(1e14 * (1e10 + 1) / (1e16 + 1e6)) and its inverse.
        const shares = 10_0000000n * SHARE_SCALE;
        expect(stored.sharesToAssets(shares, price)).toBe(10_0000000n);
        expect(stored.assetsToShares(10_0000000n, price)).toBe(shares);

        const accrued = stored.accrue(price, 3700n);
        expect(accrued.data.borrowingWeight).toEqual(pair());
        expect(accrued.data.borrowingIdx).toEqual(
            pair(900_000_000_000_000_000n, 0n),
        );
        expect(accrued.pendingBorrowing()).toBe(90_0000000n);
        expect(accrued.netPnl(price)).toBe(-90_0000000n);
        // The backing reads 1,090.0:
        // floor(1e14 * 10_900_000_001 / 10_000_000_001_000_000) = 10.8999999
        // and floor(1e8 * 10_000_000_001_000_000 / 10_900_000_001).
        expect(accrued.sharesToAssets(shares, price)).toBe(10_8999999n);
        expect(accrued.assetsToShares(10_0000000n, price)).toBe(
            91_743_119_266_812n,
        );
    });
});

describe('VaultOrderIntent quotes on the market accrued to the quote time', () => {
    // A 200.0 long (20 base tokens at $10) on the 1,000.0 vault at the
    // bootstrap rate, last accrued at 100, with a 10% treasury rate. By hand
    // from `accrue_borrowing`: 200.0 reserved of the 0.8 * 1,000.0 / 2 = 400.0
    // capacity is a utilization of 0.5, at the kink, so the rate is
    // ceil(15_854_895_992 * 0.5) = 7_927_447_996 a second.
    //
    // A quote at 86_500, a quiet day later, reads the index at
    // 7_927_447_996 * 86_400 = 684_931_506_854_400. The 200.0 owes
    // 0.13698630137..., 1_369_864 rounded up for a deposit and 1_369_863
    // rounded down for a redeem, and the vault keeps 90% of it:
    // ceil(1_232_877.6) = 1_232_878 and floor(1_232_876.7) = 1_232_876.
    //
    // The fill of an order created then lands at 86_501: the index reads
    // 684_939_434_302_396, the side owes 1_369_879 rounded up, and the
    // vault's share is ceil(1_232_891.1) = 1_232_892.
    const ACCRUED_AT = 100n;
    const QUOTE_AT = 86_500n;
    const PRICE = 10n * SCALAR_18;
    const AMOUNT = 100_0000000n;
    const market = () =>
        fixtureMarket({
            data: {
                notional: pair(200_0000000n, 0n),
                margin: pair(20_0000000n, 0n),
                tokens: pair(20_0000000n, 0n),
                accruedAt: ACCRUED_AT,
            },
            config: {
                borrowRate: 15_854_895_992n,
                increasedBorrowRate: 15_854_895_992n,
            },
            vaultAssets: 1000_0000000n,
            treasuryRate: SCALAR_18 / 10n,
        });
    const deposit = (minOut: bigint) =>
        new VaultOrderIntent(
            market().id,
            USER,
            VaultOrderKind.Deposit,
            AMOUNT,
            minOut,
        );

    // The 100.0 deposit mints on 99.9 after the 0.1% fee.
    // At the stored accrual: 999_000_000 * (1e16 + 1e6) / (1e10 + 1).
    const STORED_QUOTE = 999_000_000_000_000n;
    // At 86_500: floor(999_000_000 * 10_000_000_001_000_000 / 10_001_232_879).
    const ACCRUED_QUOTE = 998_876_850_670_622n;
    // At 86_501: floor(999_000_000 * 10_000_000_001_000_000 / 10_001_232_893).
    const FILL_QUOTE = 998_876_849_272_367n;

    it('cuts a deposit bound from the accrued quote, which the fill a second later meets', () => {
        const intent = VaultOrderIntent.create(
            market(),
            USER,
            VaultOrderKind.Deposit,
            AMOUNT,
            1n,
            PRICE,
            QUOTE_AT,
        );

        // floor(998_876_850_670_622 * 9_999 / 10_000): one basis point under
        // the accrued quote, and under the fill's quote.
        expect(intent.minOut).toBe(998_776_962_985_554n);
        expect(intent.fills(market(), PRICE, QUOTE_AT)).toEqual({ fills: true });

        // The fill prices a second of borrowing past the quote.
        expect(deposit(FILL_QUOTE).fills(market(), PRICE, QUOTE_AT)).toEqual({
            fills: true,
        });
        expect(deposit(FILL_QUOTE + 1n).fills(market(), PRICE, QUOTE_AT)).toEqual({
            fills: false,
            rejected: { quoted: FILL_QUOTE },
        });
    });

    // The same basis point cut from the quote at the stored accrual sits
    // above the fill's quote: the day of borrowing moved the share price by
    // more than the slippage.
    it('rejects a bound cut from the quote at the stored accrual', () => {
        const stale = VaultOrderIntent.create(
            market(),
            USER,
            VaultOrderKind.Deposit,
            AMOUNT,
            1n,
            PRICE,
            ACCRUED_AT,
        );

        // floor(999_000_000_000_000 * 9_999 / 10_000)
        expect(stale.minOut).toBe(998_900_100_000_000n);
        expect(stale.fills(market(), PRICE, QUOTE_AT)).toEqual({
            fills: false,
            rejected: { quoted: FILL_QUOTE },
        });
    });

    it('quotes what the snapshot accrued to the quote time quotes', () => {
        const loaded = market();
        const accrued = loaded.accrue(PRICE, QUOTE_AT);
        expect(accrued.data.borrowingIdx).toEqual(
            pair(684_931_506_854_400n, 0n),
        );

        const mint = deposit(0n);
        expect(mint.expectedOut(loaded, PRICE, QUOTE_AT)).toBe(ACCRUED_QUOTE);
        expect(mint.expectedOut(loaded, PRICE, QUOTE_AT)).toBe(
            mint.expectedOut(accrued, PRICE, QUOTE_AT),
        );

        // 100.0 shares redeem floor(1e14 * 10_001_232_877 /
        // 10_000_000_001_000_000) = 100.0123287 gross, less the 0.1% fee of
        // 0.1000123.
        const burn = new VaultOrderIntent(
            loaded.id,
            USER,
            VaultOrderKind.Redeem,
            AMOUNT * SHARE_SCALE,
            0n,
        );
        expect(burn.expectedOut(loaded, PRICE, QUOTE_AT)).toBe(99_9123164n);
        expect(burn.expectedOut(loaded, PRICE, QUOTE_AT)).toBe(
            burn.expectedOut(accrued, PRICE, QUOTE_AT),
        );
    });

    it('quotes the stored snapshot at the stored accrual, and never before it', () => {
        const mint = deposit(0n);
        expect(mint.expectedOut(market(), PRICE, ACCRUED_AT)).toBe(STORED_QUOTE);
        expect(mint.expectedOut(market(), PRICE, 0n)).toBe(STORED_QUOTE);
    });
});
