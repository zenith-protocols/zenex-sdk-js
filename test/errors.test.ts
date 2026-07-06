import { describe, it, expect } from 'vitest';
import { TradingError, ContractErrorType } from '../src/errors.js';

describe('TradingError (v2 trading/src/errors.rs)', () => {
    it('matches every v2 trading error code exactly', () => {
        expect(TradingError.InvalidConfig).toBe(700);
        expect(TradingError.InvalidPrice).toBe(701);
        expect(TradingError.InvalidStatus).toBe(702);
        expect(TradingError.BorrowingNotAccrued).toBe(703);
        expect(TradingError.MarketFrozen).toBe(704);
        expect(TradingError.IncreaseHalted).toBe(705);
        expect(TradingError.MarketNotCleared).toBe(706);
        expect(TradingError.NegativeValueNotAllowed).toBe(710);
        expect(TradingError.NotionalBelowMinimum).toBe(711);
        expect(TradingError.NotionalAboveMaximum).toBe(712);
        expect(TradingError.InsufficientMargin).toBe(713);
        expect(TradingError.UtilizationExceeded).toBe(714);
        expect(TradingError.OpenInterestExceeded).toBe(715);
        expect(TradingError.PositionNotFound).toBe(720);
        expect(TradingError.NotionalLocked).toBe(721);
        expect(TradingError.NotLiquidatable).toBe(722);
        expect(TradingError.OrderNotFound).toBe(730);
        expect(TradingError.OrderExpired).toBe(731);
        expect(TradingError.InvalidOrder).toBe(732);
        expect(TradingError.StalePrice).toBe(740);
        expect(TradingError.PriceBoundExceeded).toBe(741);
        expect(TradingError.TriggerNotMet).toBe(742);
        expect(TradingError.VaultOrderNotFound).toBe(750);
        expect(TradingError.VaultOrderLocked).toBe(751);
        expect(TradingError.PendingPnlExceeded).toBe(752);
        expect(TradingError.VaultBalanceExceeded).toBe(753);
        expect(TradingError.NothingToClaim).toBe(760);
        expect(TradingError.AdlNotTriggered).toBe(770);
        expect(TradingError.AdlOvershoot).toBe(771);
        expect(TradingError.AdlNotEligible).toBe(772);
    });

    it('has exactly 30 members (no stale v1 codes)', () => {
        const numericValues = Object.values(TradingError).filter((v) => typeof v === 'number');
        expect(numericValues).toHaveLength(30);
    });
});

describe('ContractErrorType v1 trading codes removed', () => {
    it('no longer carries the v1 trading names (MarketNotFound, PriceSlippage, etc. are gone)', () => {
        expect((ContractErrorType as unknown as Record<string, unknown>).MarketNotFound).toBeUndefined();
        expect((ContractErrorType as unknown as Record<string, unknown>).PriceSlippage).toBeUndefined();
        expect((ContractErrorType as unknown as Record<string, unknown>).LeverageAboveMaximum).toBeUndefined();
        expect((ContractErrorType as unknown as Record<string, unknown>).ContractFrozen).toBeUndefined();
    });

    it('governance codes are untouched (770-772 still map to governance meanings there)', () => {
        expect(ContractErrorType.GovNotQueued).toBe(770);
        expect(ContractErrorType.GovNotUnlocked).toBe(771);
        expect(ContractErrorType.GovInvalidDelay).toBe(772);
    });
});
