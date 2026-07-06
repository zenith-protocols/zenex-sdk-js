import { describe, it, expect } from 'vitest';
import { scValToNative } from '@stellar/stellar-sdk';
import {
    OrderKind, VaultOrderKind, Status, FULL_CLOSE,
    orderKindToScVal, vaultOrderKindToScVal, tradingConfigToScVal,
    parsePosition, parseMarketData,
    TradingConfig,
} from '../../src/trading/trading_types.js';

// Every field 1n except the three lock fields (u64 seconds), which are 60n.
function makeConfig(): TradingConfig {
    return {
        keeperRate: 1n,
        minPositionNotional: 1n,
        maxPositionNotional: 1n,
        maxOpenInterest: 1n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        feeDom: 1n,
        feeNonDom: 1n,
        impactDivisor: 1n,
        maxUtilOpen: 1n,
        maxUtilWithdraw: 1n,
        initMargin: 1n,
        maintenanceMargin: 1n,
        liqFee: 1n,
        notionalLock: 60n,
        targetUtil: 1n,
        borrowRate: 1n,
        increasedBorrowRate: 1n,
        fundingIncrease: 1n,
        fundingDecrease: 1n,
        thresholdStableFunding: 1n,
        thresholdDecreaseFunding: 1n,
        fundingMin: 1n,
        fundingMax: 1n,
        adlMaxPnl: 1n,
        adlClearTarget: 1n,
        maxPnlTrader: 1n,
        redeemLock: 60n,
        depositLock: 60n,
        instantDepositPnl: 1n,
        vaultFee: 1n,
        minDeposit: 1n,
        maxPnlDeposit: 1n,
        maxPnlWithdraw: 1n,
        maxVaultBalance: 1n,
    };
}

describe('trading_types', () => {
    it('encodes OrderKind as a unit-variant vec', () => {
        const sc = orderKindToScVal(OrderKind.Increase);
        expect(sc.switch().name).toBe('scvVec');
        expect(scValToNative(sc)).toEqual(['Increase']);
    });

    it('encodes VaultOrderKind.Redeem', () => {
        expect(scValToNative(vaultOrderKindToScVal(VaultOrderKind.Redeem))).toEqual(['Redeem']);
    });

    it('FULL_CLOSE is i128::MAX', () => {
        expect(FULL_CLOSE).toBe(2n ** 127n - 1n);
    });

    it('Status discriminants match the contract', () => {
        expect(Status.Active).toBe(0);
        expect(Status.Retired).toBe(4);
    });

    it('tradingConfigToScVal produces an alphabetically ordered map', () => {
        const config = makeConfig();
        const sc = tradingConfigToScVal(config);
        const keys = sc.map()!.map((e) => e.key().sym().toString());
        expect(keys).toEqual([...keys].sort());
        expect(keys).toContain('keeper_rate');
        expect(keys).toHaveLength(35);
    });

    it('parsePosition camelCases a native decode', () => {
        const pos = parsePosition({
            collateral: 100n, notional: 1000n, tokens: 5n,
            funding_idx: 0n, borrowing_idx: 0n,
            locked_notional: 0n, unlocks_at: 0n, updated_at: 12n,
        });
        expect(pos.lockedNotional).toBe(0n);
        expect(pos.updatedAt).toBe(12n);
    });

    it('parseMarketData maps SidePairs', () => {
        const md = parseMarketData({
            notional: { long: 1n, short: 2n }, collateral: { long: 0n, short: 0n },
            tokens: { long: 0n, short: 0n }, funding_idx: { long: 0n, short: 0n },
            borrowing_idx: { long: 0n, short: 0n }, funding_rate: 3n,
            funding_update: 4n, borrowing_update: 5n, funding_pool: 6n, funding_owed: 7n,
        });
        expect(md.notional.short).toBe(2n);
        expect(md.fundingOwed).toBe(7n);
    });
});
