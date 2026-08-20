import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { SCALAR_18 } from '../../src/math/fixed.js';
import { makeConfig } from '../helpers/market_state.js';
import type {
    MarketData,
    SidePair,
    MarketConfig,
} from '../../src/contracts/market/types.js';
import { OrderKind, Status } from '../../src/contracts/market/types.js';
import { Market } from '../../src/trading/market.js';
import { MarketPosition } from '../../src/trading/position.js';
import { Price } from '../../src/trading/price.js';
import { estimateMarket } from '../../src/trading/market_est.js';
import { estimatePosition } from '../../src/trading/position_est.js';
import {
    OrderIntent,
    maxMarginForBalance,
    previewOrder,
} from '../../src/trading/order.js';
import { VaultOrderIntent } from '../../src/trading/vault_order.js';
import {
    SECONDS_PER_YEAR,
    formatAnnualPercent,
    formatHourlyPercent,
    formatPercent,
    formatPrice,
    formatRatio,
    formatToken,
} from '../../src/float.js';

const pair = (long = 0n, short = 0n): SidePair => ({ long, short });
const TOKEN_DECIMALS = 7;
/** A token-dec amount: notional, margin, fees -- and base size (see below). */
const unit = (whole: number) => BigInt(whole) * 10n ** BigInt(TOKEN_DECIMALS);
/** An 18-dec price. Prices never use the token's decimals. */
const px = (whole: number) => BigInt(whole) * SCALAR_18;

const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
const NETWORK = { rpc: 'http://localhost', passphrase: 'test' };

function marketData(overrides: Partial<MarketData> = {}): MarketData {
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

/** A loaded Market, built the way a cache or a test builds one: by constructor. */
function loadedMarket(
    data: Partial<MarketData> = {},
    config: Partial<MarketConfig> = {},
    vaultAssets: bigint = unit(1000),
): Market {
    return new Market(
        NETWORK,
        MARKET,
        100,
        VAULT,
        TOKEN,
        ORACLE,
        TREASURY,
        undefined,
        Buffer.alloc(32, 1),
        Status.Active,
        { ...makeConfig(), ...config },
        marketData(data),
        { long: false, short: false },
        undefined,
        vaultAssets,
        vaultAssets,
        0,
        TOKEN_DECIMALS,
    );
}

/** A market whose aggregates carry the standard long position. */
function marketWithBook(): Market {
    return loadedMarket(
        {
            notional: pair(unit(1000), 0n),
            margin: pair(unit(100), 0n),
            tokens: pair(unit(10), 0n),
        },
        {},
        unit(100_000),
    );
}

function openPosition(
    overrides: Partial<MarketPosition> = {},
): MarketPosition {
    const position = new MarketPosition(
        true,
        unit(100),
        unit(1000),
        // `to_tokens` = notional * SCALAR_18 / price, so with a token-dec
        // notional and an 18-dec price the base size is at TOKEN decimals.
        unit(10),
        0n,
        0n,
        0n,
        0n,
        0n,
        [],
    );
    return Object.assign(position, overrides);
}

describe('float format helpers', () => {
    it('separates the three scales the SDK returns', () => {
        expect(formatToken(unit(250), TOKEN_DECIMALS)).toBe(250);
        expect(formatToken(12_345_678n, 6)).toBe(12.345678);
        expect(formatRatio(SCALAR_18 / 4n)).toBe(0.25);
        expect(formatPercent(SCALAR_18 / 10n)).toBe(10);
        expect(formatPrice(25n * SCALAR_18)).toBe(25);
    });

    it('rejects a nonsensical decimals rather than silently mis-scaling', () => {
        expect(() => formatToken(1n, -1)).toThrow(RangeError);
        expect(() => formatToken(1n, 1.5)).toThrow(RangeError);
        expect(() => formatToken(1n, 39)).toThrow(RangeError);
    });

    it('annualizes a per-second rate and keeps its sign', () => {
        const perSecond = SCALAR_18 / BigInt(SECONDS_PER_YEAR);
        expect(formatAnnualPercent(perSecond)).toBeCloseTo(100, 4);
        expect(formatAnnualPercent(-perSecond)).toBeCloseTo(-100, 4);
    });
});

describe('Price', () => {
    it('expands a single value to a zero-spread bid/ask', () => {
        const price = Price.from(px(100), 1_000n);
        expect(price.bid).toBe(px(100));
        expect(price.ask).toBe(px(100));
        expect(price.publishTime).toBe(1_000n);
    });

    it('picks the adverse side per direction', () => {
        const price = new Price(px(99), px(101), 1_000n);
        expect(price.entry(true)).toBe(px(101));
        expect(price.entry(false)).toBe(px(99));
        expect(price.exit(true)).toBe(px(99));
        expect(price.exit(false)).toBe(px(101));
    });
});

describe('estimateMarket', () => {
    it('reports per-side utilization and the rate the side would pay', () => {
        const est = estimateMarket(
            loadedMarket({ tokens: pair(unit(6), unit(2)) }),
            px(10),
        );

        expect(est.long.utilizationPercent).toBeGreaterThan(0);
        expect(est.long.borrowRatePercent1h).toBeGreaterThan(0);
        // Longs dominate on tokens, so longs are the side actually charged.
        expect(est.long.charged).toBe(true);
        expect(est.short.charged).toBe(false);
    });

    it('charges both sides on a token tie, matching the accrual', () => {
        const est = estimateMarket(
            loadedMarket({ tokens: pair(unit(4), unit(4)) }),
            px(10),
        );
        expect(est.long.charged).toBe(true);
        expect(est.short.charged).toBe(true);
    });

    it('signs funding by who pays', () => {
        const at = (rate: bigint) =>
            estimateMarket(loadedMarket({ fundingRate: rate }), px(10));
        expect(at(500n).fundingRatePercent1h).toBeGreaterThan(0);
        expect(at(-500n).fundingRatePercent1h).toBeLessThan(0);
        expect(at(0n).fundingRatePercent1h).toBe(0);
    });

    it('floors the charged funding rate but not the stored one', () => {
        const tiny = estimateMarket(
            loadedMarket({ fundingRate: 1n }, { fundingMin: 100n }),
            px(10),
        );
        expect(tiny.fundingChargeRatePercent1h).toBe(formatHourlyPercent(100n));
        expect(tiny.fundingRatePercent1h).toBe(formatHourlyPercent(1n));
        const zero = estimateMarket(
            loadedMarket({ fundingRate: 0n }, { fundingMin: 100n }),
            px(10),
        );
        expect(zero.fundingChargeRatePercent1h).toBe(0);
    });

    it('derives max leverage from the initial margin', () => {
        expect(
            estimateMarket(loadedMarket({}, { initMargin: SCALAR_18 / 10n }), px(10))
                .maxLeverage,
        ).toBe(10);
        expect(
            estimateMarket(loadedMarket({}, { initMargin: 0n }), px(10))
                .maxLeverage,
        ).toBe(Infinity);
    });

    it('splits the net hourly rate: payer pays the floored rate, receiver earns the re-spread', () => {
        // Longs pay (positive rate); the receiver credit re-spreads the payer
        // charge over the receiver's notional (here 2x -> half the rate).
        // Tokens tie, so borrowing charges both sides identically and the
        // long-short gap is purely the funding legs.
        const est = estimateMarket(
            loadedMarket({
                fundingRate: 1_000_000n,
                notional: pair(unit(100), unit(200)),
                tokens: pair(unit(1), unit(1)),
            }),
            px(10),
        );
        const fundingPct1h = (1_000_000 / 1e18) * 3600 * 100;
        const fundingLeg = (side: typeof est.long): number =>
            side.fundingRatePercent1h;
        expect(est.long.netRatePercent1h).toBeGreaterThan(0);
        expect(fundingLeg(est.long)).toBeCloseTo(fundingPct1h, 12);
        expect(fundingLeg(est.short)).toBeCloseTo(-fundingPct1h / 2, 12);
    });

    it('carries the snapshot facts: raws, vault totals, and the price echo', () => {
        // Distinct bid/ask and a fixed publish time, so each echoed field is
        // asserted against its own exact source and a swap cannot cancel out.
        const price = new Price(px(10), px(11), 1_234n);
        const est = estimateMarket(
            loadedMarket({
                notional: pair(unit(100), unit(50)),
                margin: pair(unit(10), unit(5)),
                tokens: pair(unit(10), unit(5)),
            }),
            price,
        );
        expect(est.long.notional).toBeCloseTo(100, 6);
        expect(est.short.notional).toBeCloseTo(50, 6);
        expect(est.long.margin).toBeCloseTo(10, 6);
        expect(est.short.margin).toBeCloseTo(5, 6);
        expect(est.vaultAssets).toBeGreaterThan(0);
        expect(est.vaultSupply).toBeGreaterThan(0);
        expect(est.bid).toBe(10);
        expect(est.ask).toBe(11);
        expect(est.publishTime).toBe(1234);
    });

    it('reports open interest and capacity per side', () => {
        const est = estimateMarket(
            loadedMarket({
                notional: pair(unit(100), unit(50)),
                tokens: pair(unit(10), unit(5)),
            }),
            px(10),
        );
        expect(est.long.openInterestTokens).toBeGreaterThan(0);
        expect(est.long.openInterestValue).toBeGreaterThan(0);
        expect(est.long.openCapacity).toBeGreaterThan(0);
    });

    it('prices shares against uPnL and reports the max redeem', () => {
        const flat = estimateMarket(loadedMarket({}, {}, unit(1000)), px(10));
        expect(flat.netPnl).toBe(0);
        expect(flat.maxRedeemableShares).toBeGreaterThanOrEqual(0);
        expect(flat.sharePrice).toBeGreaterThan(0);
    });
});

describe('estimatePosition', () => {
    it('formats each field at its own scale', () => {
        // 10 tokens entered at 100.0, marked at 110.
        const view = estimatePosition(
            marketWithBook(),
            openPosition(),
            px(110),
            0n,
        );

        expect(view.notional).toBe(1000);
        expect(view.margin).toBe(100);
        expect(view.entryPrice).toBe(100);
        expect(view.tokens).toBe(10);
        expect(view.positionValue).toBe(1100);
        // 10 * 110 = 1100, so +100 profit.
        expect(view.pnl).toBe(100);
        expect(view.equity).toBe(200);
        expect(view.leverage).toBeCloseTo(5, 9);
        expect(view.healthFactor).toBeGreaterThan(1);
        expect(view.liquidationDistancePercent).toBeGreaterThan(0);
        // The headline number nets the close cost out of the raw PnL.
        expect(view.closeFee).toBeGreaterThan(0);
        expect(view.netPnl).toBeCloseTo(
            view.pnl - view.closeFee - view.pendingFunding - view.pendingBorrowing,
            9,
        );
        expect(view.netPnlPercent).toBeCloseTo((view.netPnl / view.margin) * 100, 9);
        // Margin sits exactly at the 10% init requirement, so nothing is
        // withdrawable: the #713 gate measures posted margin, not equity.
        expect(view.maxWithdrawableMargin).toBe(0);
    });

    it('reports the withdrawable margin above the init requirement', () => {
        const view = estimatePosition(
            marketWithBook(),
            openPosition({ margin: unit(300) }),
            px(110),
            0n,
        );
        // 300 posted against a 100 init requirement: about 200 is free, less
        // the dust floor and fee headroom the exact probe enforces.
        expect(view.maxWithdrawableMargin).toBeGreaterThan(150);
        expect(view.maxWithdrawableMargin).toBeLessThanOrEqual(200);
    });

    it('reads a crossed liquidation price as negative distance', () => {
        const view = estimatePosition(
            marketWithBook(),
            openPosition({ margin: 1n }),
            px(50),
            0n,
        );
        expect(view.liquidationDistancePercent).toBeLessThan(0);
        expect(view.healthFactor).toBeLessThan(1);
    });

    it('floors leverage at zero once equity is gone', () => {
        const view = estimatePosition(
            marketWithBook(),
            openPosition({ margin: 0n }),
            px(1),
            0n,
        );
        expect(view.equity).toBeLessThanOrEqual(0);
        expect(view.leverage).toBe(0);
    });

    it('excludes locked notional only while the lock stands', () => {
        const locked = openPosition({
            lockedNotional: unit(400),
            unlocksAt: 2_000n,
        });
        const build = (now: bigint) =>
            estimatePosition(marketWithBook(), locked, px(100), now);
        expect(build(1_999n).unlockedNotional).toBe(600);
        // At the boundary the lock has expired.
        expect(build(2_000n).unlockedNotional).toBe(1000);
    });
});

describe('previewOrder', () => {
    const market = loadedMarket({}, {}, unit(100_000));

    it('previews a market open end to end and embeds the resulting position', () => {
        const intent = new OrderIntent(market, USER, true);
        const order = intent.openMarket({ notional: unit(100), margin: unit(50) });
        expect(order.expiration).toBe(market.ledger + 60);
        expect(order.priceBound).toBe(0n);

        const flat = new MarketPosition(true, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, []);
        const preview = previewOrder(market, flat, order, px(100), 1n);
        expect(preview.outcome).toBe('fills');
        expect(preview.executionPrice).toBe(100);
        expect(preview.totalFees).toBeCloseTo(
            preview.baseFee + preview.impactFee + preview.execFee,
            9,
        );
        expect(preview.escrowed).toBeCloseTo(50 + preview.execFee, 9);
        expect(preview.position).toBeDefined();
        expect(preview.position!.notional).toBe(100);
        expect(preview.position!.entryPrice).toBe(100);
    });

    it('reports a trigger order as resting', () => {
        const intent = new OrderIntent(marketWithBook(), USER, true);
        const order = intent.stopLoss({ triggerPrice: px(90) });
        const preview = previewOrder(marketWithBook(), openPosition(), order, px(100), 1n);
        expect(preview.outcome).toBe('rests');
        expect(preview.position).toBeUndefined();
    });

    it('gates a withdrawal that would break the margin gate (#713)', () => {
        const intent = new OrderIntent(marketWithBook(), USER, true);
        const order = intent.withdrawMargin(unit(99));
        const preview = previewOrder(
            marketWithBook(),
            openPosition({ margin: unit(100) }),
            order,
            px(100),
            1n,
        );
        expect(preview.outcome).toBe('gate');
        expect(preview.gate?.code).toBeGreaterThan(0);
    });

    it('is reachable as position.preview with identical output', () => {
        const intent = new OrderIntent(market, USER, true);
        const order = intent.closePosition();
        const book = marketWithBook();
        const position = openPosition();
        const direct = previewOrder(book, position, order, px(110), 5n);
        const method = position.preview(book, order, px(110), 5n);
        expect(method).toEqual(direct);
        expect(direct.outcome).toBe('fills');
        expect(direct.payout).toBeGreaterThan(0);
        // A full close leaves a flat position.
        expect(direct.position!.notional).toBe(0);
    });

    it('derives the slippage bound when the intent carries one', () => {
        const intent = new OrderIntent(market, USER, true, 60, 100n);
        const order = intent.openMarket({
            notional: unit(100),
            margin: unit(50),
            price: px(100),
        });
        // 1% above the ask for a long open.
        expect(order.priceBound).toBe(px(101));
        expect(() => intent.openMarket({ notional: unit(1), margin: unit(1) })).toThrow(
            /price is required/,
        );
    });
});

describe('maxMarginForBalance', () => {
    it('inverts the fee model inside the balance', () => {
        const market = loadedMarket({}, {}, unit(100_000));
        const max = maxMarginForBalance(market, true, unit(100), 5, px(100));
        expect(max).toBeGreaterThan(0);
        expect(max).toBeLessThan(100);
        // Spending the reported max plus fees must fit inside the balance.
        const intent = new OrderIntent(market, USER, true);
        const notional = BigInt(Math.round(max * 5 * 10 ** TOKEN_DECIMALS));
        const margin = BigInt(Math.round(max * 10 ** TOKEN_DECIMALS));
        const preview = previewOrder(
            market,
            new MarketPosition(true, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, []),
            intent.openMarket({ notional, margin }),
            px(100),
            1n,
        );
        expect(preview.outcome).toBe('fills');
        expect(
            margin +
                BigInt(Math.round(preview.baseFee * 10 ** TOKEN_DECIMALS)) +
                BigInt(Math.round(preview.impactFee * 10 ** TOKEN_DECIMALS)) +
                market.config.execFee,
        ).toBeLessThanOrEqual(unit(100));
    });

    it('returns zero when the balance cannot cover the execution fee', () => {
        const market = loadedMarket();
        expect(maxMarginForBalance(market, true, 0n, 5, px(100))).toBe(0);
    });
});

describe('VaultOrderIntent', () => {
    const market = loadedMarket({}, {}, unit(1000));

    it('derives minOut from slippage against the expected output', () => {
        const intent = VaultOrderIntent.create(
            market,
            USER,
            OrderKind.MarketIncrease === 0 ? 0 : 0, // VaultOrderKind.Deposit
            unit(100),
            100n,
            px(10),
        );
        const expected = intent.expectedOut(market, px(10));
        expect(intent.minOut).toBe((expected * 9_900n) / 10_000n);
        expect(intent.minOut).toBeGreaterThan(0n);
    });

    it('leaves minOut unset without slippage', () => {
        const intent = VaultOrderIntent.create(market, USER, 0, unit(100));
        expect(intent.minOut).toBe(0n);
    });

    it('builds the create operation from its own fields', () => {
        const intent = VaultOrderIntent.create(market, USER, 0, unit(100));
        expect(intent.toOperation()).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('advises on fillability without gating creation', () => {
        const intent = VaultOrderIntent.create(market, USER, 0, unit(100));
        const verdict = intent.fills(market, px(10), 1_000n);
        expect('fills' in verdict).toBe(true);
    });
});
