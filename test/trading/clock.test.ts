import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultOrderKind } from '../../src/contracts/market/types.js';
import { Price } from '../../src/trading/price.js';
import { OrderIntent, marketContext, previewOrder } from '../../src/trading/order.js';
import { estimatePosition } from '../../src/trading/position_est.js';
import { VaultOrderIntent } from '../../src/trading/vault_order.js';
import {
    USER,
    fixtureMarket,
    flatPosition,
    loneBook,
    lonePosition,
    px,
    unit,
} from './market_fixture.js';

// The chain's ledger clock never predates the market's stored accrual, and a
// keeper fills with a report at least as fresh as the position's last mark.
// A client clock that lags network time must not turn either into a gate.

const ACCRUED = 10_000n;

function setWallClock(seconds: bigint): void {
    vi.spyOn(Date, 'now').mockReturnValue(Number(seconds) * 1000);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a lagging clock never gates a preview', () => {
    const market = fixtureMarket({
        data: { ...loneBook(), accruedAt: ACCRUED },
        vaultAssets: unit(100_000),
    });

    it('previews an open one second behind the stored accrual as at the accrual', () => {
        const order = new OrderIntent(market, USER, true).openMarket({
            notional: unit(100),
            margin: unit(20),
        });
        const behind = previewOrder(market, flatPosition(), order, px(10), ACCRUED - 1n);
        expect(behind.outcome).toBe('fills');
        expect(behind).toEqual(
            previewOrder(market, flatPosition(), order, px(10), ACCRUED),
        );
    });

    it('clamps the wall clock the same way when no time is passed', () => {
        setWallClock(ACCRUED - 30n);
        const order = new OrderIntent(market, USER, true).openMarket({
            notional: unit(100),
            margin: unit(20),
        });
        expect(previewOrder(market, flatPosition(), order, px(10)).outcome).toBe(
            'fills',
        );
    });

    it('stamps a bare price no earlier than the position mark (#740)', () => {
        // The last fill priced with a report two seconds ahead of the ledger
        // clock; the device clock lags three seconds behind.
        setWallClock(ACCRUED - 3n);
        const position = lonePosition({ pricedAt: ACCRUED + 2n });
        const order = new OrderIntent(market, USER, true).addMargin(unit(1));

        expect(previewOrder(market, position, order, px(10)).outcome).toBe('fills');
        expect(previewOrder(market, position, order, px(10), ACCRUED + 3n).outcome).toBe(
            'fills',
        );
        // An explicit report older than the mark still gates, as on chain.
        const stale = previewOrder(
            market,
            position,
            order,
            new Price(px(10), px(10), ACCRUED + 1n),
        );
        expect(stale.outcome).toBe('gate');
        expect(stale.gate?.code).toBe(740);
    });

    it('builds the engine context at the clamped time and stamp', () => {
        const position = lonePosition({ pricedAt: ACCRUED + 2n });
        const context = marketContext(market, position, px(10), ACCRUED - 9n);
        expect(context.ledgerTime).toBe(ACCRUED);
        expect(context.price.publishTime).toBe(ACCRUED + 2n);

        const later = marketContext(market, position, px(10), ACCRUED + 50n);
        expect(later.ledgerTime).toBe(ACCRUED + 50n);
        expect(later.price.publishTime).toBe(ACCRUED + 50n);

        // A full Price keeps its own observation time.
        const report = marketContext(
            market,
            position,
            new Price(px(10), px(10), 7n),
            ACCRUED,
        );
        expect(report.price.publishTime).toBe(7n);
    });

    it('keeps the withdrawable margin when the clock lags the accrual', () => {
        const roomy = lonePosition({ margin: unit(40) });
        const behind = estimatePosition(market, roomy, px(10), ACCRUED - 1n);
        expect(behind.maxWithdrawableMargin).toBeGreaterThan(0);
        expect(behind).toEqual(estimatePosition(market, roomy, px(10), ACCRUED));
    });

    it('advises a vault deposit created behind the accrual as fillable', () => {
        const intent = new VaultOrderIntent(
            market.id,
            USER,
            VaultOrderKind.Deposit,
            unit(100),
            0n,
        );
        expect(intent.fills(market, px(10), ACCRUED - 5n)).toEqual({ fills: true });
    });
});
