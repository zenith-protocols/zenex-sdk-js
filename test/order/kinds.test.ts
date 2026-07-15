import { describe, expect, it } from 'vitest';

import {
    isDecreaseOrderKind,
    isIncreaseOrderKind,
    isMarketOrderKind,
    isRestingOrderKind,
    isTriggerOrderKind,
    orderKindCrossing,
    orderKindFiresAbove,
} from '../../src/order/kinds.js';
import { OrderKind } from '../../src/trading/trading_types.js';

type ExpectedSemantics = {
    kind: OrderKind;
    increase: boolean;
    market: boolean;
    longCrossing: 'above' | 'below' | null;
    shortCrossing: 'above' | 'below' | null;
};

const CASES: readonly ExpectedSemantics[] = [
    {
        kind: OrderKind.MarketIncrease,
        increase: true,
        market: true,
        longCrossing: null,
        shortCrossing: null,
    },
    {
        kind: OrderKind.LimitIncrease,
        increase: true,
        market: false,
        longCrossing: 'below',
        shortCrossing: 'above',
    },
    {
        kind: OrderKind.StopIncrease,
        increase: true,
        market: false,
        longCrossing: 'above',
        shortCrossing: 'below',
    },
    {
        kind: OrderKind.MarketDecrease,
        increase: false,
        market: true,
        longCrossing: null,
        shortCrossing: null,
    },
    {
        kind: OrderKind.LimitDecrease,
        increase: false,
        market: false,
        longCrossing: 'above',
        shortCrossing: 'below',
    },
    {
        kind: OrderKind.StopDecrease,
        increase: false,
        market: false,
        longCrossing: 'below',
        shortCrossing: 'above',
    },
];

describe('OrderKind semantics', () => {
    it.each(CASES)('classifies discriminant $kind exhaustively', (entry) => {
        expect(isIncreaseOrderKind(entry.kind)).toBe(entry.increase);
        expect(isDecreaseOrderKind(entry.kind)).toBe(!entry.increase);
        expect(isMarketOrderKind(entry.kind)).toBe(entry.market);
        expect(isRestingOrderKind(entry.kind)).toBe(!entry.market);
        expect(isTriggerOrderKind(entry.kind)).toBe(!entry.market);
    });

    it.each(CASES)(
        'derives side-aware crossing for discriminant $kind',
        (entry) => {
            expect(orderKindCrossing(entry.kind, true)).toBe(
                entry.longCrossing,
            );
            expect(orderKindCrossing(entry.kind, false)).toBe(
                entry.shortCrossing,
            );
            expect(orderKindFiresAbove(entry.kind, true)).toBe(
                entry.longCrossing === null
                    ? null
                    : entry.longCrossing === 'above',
            );
            expect(orderKindFiresAbove(entry.kind, false)).toBe(
                entry.shortCrossing === null
                    ? null
                    : entry.shortCrossing === 'above',
            );
        },
    );

    it('fails closed for an unknown numeric discriminant', () => {
        const unknown = 6 as OrderKind;

        for (const classify of [
            isIncreaseOrderKind,
            isDecreaseOrderKind,
            isMarketOrderKind,
            isRestingOrderKind,
            isTriggerOrderKind,
        ]) {
            expect(() => classify(unknown)).toThrow(/unknown order kind/i);
        }
        expect(() => orderKindCrossing(unknown, true)).toThrow(
            /unknown order kind/i,
        );
        expect(() => orderKindFiresAbove(unknown, false)).toThrow(
            /unknown order kind/i,
        );
    });
});
