import { describe, expect, it } from 'vitest';
import { quotePositionAction } from '../../src/trading/internal/quote.js';
import { liquidationState } from '../../src/trading/internal/position.js';
import { applyOrder } from '../../src/trading/internal/apply.js';
import { OrderKind, Status } from '../../src/contracts/market/types.js';
import { OrderIntent, marketContext, previewOrder } from '../../src/trading/order.js';
import {
    USER,
    contractTestConfig,
    fixtureMarket,
    flatPosition,
    lonePosition,
    marketData,
    pair,
    px,
    unit,
} from './market_fixture.js';

describe('VaultInsolvent (755)', () => {
    // The trader's lone 10x long (10 base at $10) shares the side with a
    // loser (20 base at $40, 100.0 margin). At $25 the side nets -150, inside
    // the haircut cap, so the trader's 150.0 profit is not cut. The vault
    // draw, 150.0 less the 0.36 fee share, exceeds the 100.0 vault.
    const book = {
        notional: pair(unit(900), 0n),
        margin: pair(unit(110), 0n),
        tokens: pair(unit(30), 0n),
    };
    const input = (vaultAssets: bigint) => ({
        ledger: 1,
        now: 1n,
        isLong: true,
        position: lonePosition(),
        market: marketData({ ...book, accruedAt: 1n }),
        config: contractTestConfig(),
        price: { bid: px(25), ask: px(25), publishTime: 1n },
        vaultAssets,
        treasuryRate: 0n,
        action: { kind: 'close' as const },
        executionFee: 0n,
        relayFee: 0n,
    });

    it('gates a close whose vault draw exceeds the vault balance', () => {
        expect(quotePositionAction(input(unit(100)))).toEqual({
            kind: 'unavailable',
            code: 'CONTRACT_GATE',
            reason: 'contract error #755: vault insolvent',
            contractCode: 755,
        });
    });

    it('fills the same close once the vault covers the draw', () => {
        const result = quotePositionAction(input(unit(150)));
        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.realizedPnl).toBe(unit(150));
        expect(result.value.walletPayout).toBe(1_596_000_000n);
    });

    it('surfaces as a preview gate', () => {
        const market = fixtureMarket({ data: book, vaultAssets: unit(100) });
        const order = new OrderIntent(market, USER, true).closePosition();
        expect(previewOrder(market, lonePosition(), order, px(25), 1n).gate?.code).toBe(755);
    });
});

describe('contract codes on every CONTRACT_GATE', () => {
    it('carries 720 when liquidationState finds no position', () => {
        const state = liquidationState(flatPosition(), {
            ledger: 1,
            now: 0n,
            isLong: true,
            position: flatPosition(),
            market: marketData(),
            config: contractTestConfig(),
            price: { bid: px(1), ask: px(1), publishTime: 0n },
            vaultAssets: unit(1000),
            treasuryRate: 0n,
        });
        expect(state).toMatchObject({ code: 'CONTRACT_GATE', contractCode: 720 });
    });

    it('reports the creation code first when two gates fail together', () => {
        // A dust-sized open on a frozen market: creation returns 704.
        const market = fixtureMarket({ status: Status.Frozen });
        const result = applyOrder(
            marketContext(market, flatPosition(), px(1), 1n, USER),
            {
                market: market.id,
                user: USER,
                isLong: true,
                kind: OrderKind.MarketIncrease,
                notional: 1n,
                margin: unit(10),
                triggerPrice: 0n,
                priceBound: 0n,
                expiration: 1_000,
            },
        );
        expect(result).toMatchObject({ kind: 'gate', code: 704 });
    });
});
