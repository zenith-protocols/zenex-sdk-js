import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import {
    DELIST_DEADLINE,
    Status,
    VaultOrderKind,
} from '../../src/contracts/market/types.js';
import { Price } from '../../src/trading/price.js';
import { OrderIntent, previewOrder } from '../../src/trading/order.js';
import { estimateMarket } from '../../src/trading/market_est.js';
import { estimatePosition } from '../../src/trading/position_est.js';
import { VaultOrderIntent } from '../../src/trading/vault_order.js';
import { liquidationState } from '../../src/trading/internal/position.js';
import {
    USER,
    contractTestConfig,
    fixtureMarket,
    loneBook,
    lonePosition,
    marketData,
    pair,
    px,
    unit,
} from './market_fixture.js';
import type { MarketFixture } from './market_fixture.js';

// A delisted market past its grace window may carry a terminal price. From
// then on the contract fills, liquidates, accrues and prices shares flat at
// it (bid = ask = terminal, published at the ledger time) and never reads a
// report. Past DELIST_DEADLINE, any keeper may liquidate any position.

/** The contract's lone 10x long (100.0 on 10.0 at $10) on a 1000.0 vault. */
function delisted(overrides: MarketFixture = {}) {
    return fixtureMarket({
        data: { ...loneBook(), accruedAt: 0n },
        vaultAssets: unit(1000),
        status: Status.Delisted,
        delistedAt: 0n,
        ...overrides,
    });
}

describe('contract vectors: wind-down liquidation', () => {
    // keeper.rs liquidate_wind_down_closes_healthy_position_at_flat_price:
    // past the deadline at the $9.50 flat price, settled equity is
    // 10.0 - 0.3 base - 0.1 impact - 5.0 pnl = 4.6.
    it('liquidates at the flat price past the deadline, whatever the caller quotes', () => {
        const market = delisted({
            data: { ...loneBook(), accruedAt: DELIST_DEADLINE },
            terminalPrice: px(9.5),
        });
        expect(lonePosition().isLiquidatable(market, px(10.5))).toBe(true);

        const state = liquidationState(lonePosition(), {
            ledger: 1,
            now: DELIST_DEADLINE,
            isLong: true,
            position: lonePosition(),
            market: market.data,
            config: market.config,
            price: { bid: px(9.5), ask: px(9.5), publishTime: DELIST_DEADLINE },
            vaultAssets: unit(1000),
            treasuryRate: 0n,
            status: Status.Delisted,
            delistedAt: 0n,
        });
        expect(state).toMatchObject({
            kind: 'exact',
            value: {
                equity: 46_000_000n,
                maintenanceRequired: 50_000_000n,
                forced: true,
                liquidatable: true,
            },
        });
    });

    // keeper.rs liquidate_healthy_position_rejected_before_deadline: at the
    // $9.80 flat price equity is 7.6 against the 5.0 maintenance line, and
    // the waiver is off before the deadline (#722).
    it('keeps a healthy position safe before the deadline, at the flat price', () => {
        const market = delisted({ terminalPrice: px(9.8) });
        // $9.00 alone would make it liquidatable; the flat price wins.
        expect(lonePosition().isLiquidatable(market, px(9))).toBe(false);
    });

    // position.rs liquidate_force_waives_eligibility_for_healthy_position:
    // bid $9.80, ask $10, equity 7.6 above the 5.0 line. The waiver
    // liquidates it anyway; without it the liquidation reverts (#722).
    it('waives eligibility for a healthy position under force', () => {
        const context = {
            ledger: 1,
            now: DELIST_DEADLINE,
            isLong: true,
            position: lonePosition(),
            market: marketData(loneBook()),
            config: contractTestConfig(),
            price: { bid: px(9.8), ask: px(10), publishTime: 0n },
            vaultAssets: unit(1000),
            treasuryRate: 0n,
        };
        const forced = liquidationState(lonePosition(), {
            ...context,
            status: Status.Delisted,
            delistedAt: 0n,
        });
        expect(forced).toMatchObject({
            kind: 'exact',
            value: {
                equity: 76_000_000n,
                maintenanceRequired: 50_000_000n,
                forced: true,
                liquidatable: true,
            },
        });
        expect(liquidationState(lonePosition(), context)).toMatchObject({
            value: { equity: 76_000_000n, forced: false, liquidatable: false },
        });
    });
});

describe('the forced-liquidation deadline', () => {
    const DELISTED_AT = 1_000n;
    const deadline = DELISTED_AT + DELIST_DEADLINE;
    const at = (accruedAt: bigint, status = Status.Delisted) =>
        delisted({
            data: { ...loneBook(), accruedAt },
            status,
            delistedAt: DELISTED_AT,
        });

    it('unlocks exactly at delistedAt + DELIST_DEADLINE', () => {
        expect(lonePosition().isLiquidatable(at(deadline - 1n), px(10))).toBe(false);
        expect(lonePosition().isLiquidatable(at(deadline), px(10))).toBe(true);
    });

    it('measures the deadline at the snapshot time, so accrue measures it now', () => {
        const stale = at(deadline - 100n);
        expect(lonePosition().isLiquidatable(stale, px(10))).toBe(false);
        expect(
            lonePosition().isLiquidatable(stale.accrue(px(10), deadline), px(10)),
        ).toBe(true);
    });

    it('forces only a Delisted market', () => {
        expect(
            lonePosition().isLiquidatable(at(deadline, Status.Frozen), px(10)),
        ).toBe(false);
    });

    it('never forces a flat side', () => {
        const flat = lonePosition({ margin: 0n, notional: 0n, tokens: 0n });
        expect(flat.isLiquidatable(at(deadline), px(10))).toBe(false);
    });
});

describe('a terminal price replaces the caller price', () => {
    const terminal = px(9.8);
    const wound = delisted({ terminalPrice: terminal });
    const plain = delisted();

    // The audit probe: a close quoted at the $10.50 oracle mark paid 14.6;
    // the chain settles at $9.80 and pays 10.0 - 0.4 - 2.0 = 7.6.
    it('previews a close at the flat price', () => {
        const order = new OrderIntent(wound, USER, true).closePosition();
        const preview = previewOrder(wound, lonePosition(), order, px(10.5), 10n);
        expect(preview.outcome).toBe('fills');
        expect(preview.executionPrice).toBe(9.8);
        expect(preview.payout).toBeCloseTo(7.6, 9);

        const live = previewOrder(plain, lonePosition(), order, px(10.5), 10n);
        expect(live.payout).toBeCloseTo(14.6, 9);
    });

    it('publishes the flat price at the ledger time, so a stale quote cannot gate', () => {
        const marked = lonePosition({ pricedAt: 500n });
        const order = new OrderIntent(wound, USER, true).closePosition();
        const stale = new Price(px(10.5), px(10.5), 100n);
        expect(previewOrder(wound, marked, order, stale, 1_000n).outcome).toBe('fills');
        const live = previewOrder(plain, marked, order, stale, 1_000n);
        expect(live.gate?.code).toBe(740);
    });

    it('derives an intent bound from the flat price, with or without a quote', () => {
        const intent = new OrderIntent(wound, USER, true, 60, 100n);
        const expected = (terminal * 9_900n) / 10_000n;
        expect(intent.closePosition().priceBound).toBe(expected);
        expect(intent.closePosition(px(20)).priceBound).toBe(expected);
    });

    it('accrues, prices shares and estimates at the flat price', () => {
        const book = {
            ...loneBook(),
            notional: pair(unit(100), unit(50)),
            tokens: pair(unit(10), unit(6)),
            margin: pair(unit(10), unit(10)),
        };
        const config = { borrowRate: SCALAR_18 / 1_000_000n, increasedBorrowRate: SCALAR_18 / 100_000n };
        const flat = delisted({ data: book, config, terminalPrice: terminal });
        const atTerminal = delisted({ data: book, config });
        // The caller's $20 quote alone would move every figure below.
        expect(atTerminal.accrue(px(20), 3_600n).data).not.toEqual(
            atTerminal.accrue(terminal, 3_600n).data,
        );
        expect(atTerminal.sharesToAssets(unit(10), px(20))).not.toBe(
            atTerminal.sharesToAssets(unit(10), terminal),
        );

        expect(flat.accrue(px(20), 3_600n).data).toEqual(
            atTerminal.accrue(terminal, 3_600n).data,
        );
        expect(flat.assetsToShares(unit(10), px(20))).toBe(
            atTerminal.assetsToShares(unit(10), terminal),
        );
        expect(flat.sharesToAssets(unit(10), px(20))).toBe(
            atTerminal.sharesToAssets(unit(10), terminal),
        );
        expect(flat.netPnl(px(20))).toBe(atTerminal.netPnl(terminal));
        expect(flat.utilization(true, px(20))).toBe(
            atTerminal.utilization(true, terminal),
        );

        const estimate = estimateMarket(flat, px(20));
        const reference = estimateMarket(atTerminal, terminal);
        expect(estimate.bid).toBe(9.8);
        expect(estimate.ask).toBe(9.8);
        expect(estimate.longPnl).toBe(reference.longPnl);
        expect(estimate.sharePrice).toBe(reference.sharePrice);
        expect(estimate.long).toEqual(reference.long);

        const position = estimatePosition(flat, lonePosition(), px(20), 10n);
        expect(position.pnl).toBe(
            estimatePosition(atTerminal, lonePosition(), terminal, 10n).pnl,
        );

        const deposit = new VaultOrderIntent(
            flat.id,
            USER,
            VaultOrderKind.Deposit,
            unit(10),
            0n,
        );
        expect(deposit.expectedOut(flat, px(20))).toBe(
            deposit.expectedOut(atTerminal, terminal),
        );
    });
});
