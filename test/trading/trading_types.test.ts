import { describe, it, expect } from 'vitest';
import { scValToNative } from '@stellar/stellar-sdk';
import {
    OrderKind, VaultOrderKind, Status, FULL_CLOSE,
    tradingConfigToScVal, parseSidePair,
    parseOrder, parseVaultOrder, parsePosition, parseMarketData, parseAdlState,
    parseTradingConfig, TradingConfig,
} from '../../src/trading/trading_types.js';

// Each field gets a unique value, numbered in the declaration order of
// zenex-contracts/trading/src/trading/config.rs (101 = keeper_rate, the
// first field, through 134 = max_vault_balance, the last). Unique values
// make any key/field misrouting in the converter or parser visible.
function makeDistinctConfig(): TradingConfig {
    return {
        keeperRate: 101n,
        minPositionNotional: 102n,
        maxPositionNotional: 103n,
        maxOpenInterest: 104n,
        minOrderNotional: 105n,
        minOrderCollateral: 106n,
        execFee: 107n,
        feeDom: 108n,
        feeNonDom: 109n,
        impactScalar: 110n,
        maxUtilOpen: 111n,
        maxUtilWithdraw: 112n,
        initMargin: 113n,
        maintenanceMargin: 114n,
        liqFee: 115n,
        notionalLock: 116n,
        targetUtil: 117n,
        borrowRate: 118n,
        increasedBorrowRate: 119n,
        fundingIncrease: 120n,
        fundingDecrease: 121n,
        thresholdStableFunding: 122n,
        thresholdDecreaseFunding: 123n,
        fundingMin: 124n,
        fundingMax: 125n,
        adlMaxPnl: 126n,
        adlClearTarget: 127n,
        maxPnlTrader: 128n,
        maxPnlWithdraw: 129n,
        redeemLock: 130n,
        depositFee: 131n,
        redeemFee: 132n,
        minDeposit: 133n,
        maxVaultBalance: 134n,
    };
}

// The 34 snake_case field names of trading/src/trading/config.rs, hand-sorted
// alphabetically (the `#[contracttype]` ScMap key order).
const EXPECTED_CONFIG_KEYS = [
    'adl_clear_target',
    'adl_max_pnl',
    'borrow_rate',
    'deposit_fee',
    'exec_fee',
    'fee_dom',
    'fee_non_dom',
    'funding_decrease',
    'funding_increase',
    'funding_max',
    'funding_min',
    'impact_scalar',
    'increased_borrow_rate',
    'init_margin',
    'keeper_rate',
    'liq_fee',
    'maintenance_margin',
    'max_open_interest',
    'max_pnl_trader',
    'max_pnl_withdraw',
    'max_position_notional',
    'max_util_open',
    'max_util_withdraw',
    'max_vault_balance',
    'min_deposit',
    'min_order_collateral',
    'min_order_notional',
    'min_position_notional',
    'notional_lock',
    'redeem_fee',
    'redeem_lock',
    'target_util',
    'threshold_decrease_funding',
    'threshold_stable_funding',
];

describe('trading_types', () => {
    it('OrderKind carries the six u32 discriminants of order.rs', () => {
        expect(OrderKind.MarketIncrease).toBe(0);
        expect(OrderKind.LimitIncrease).toBe(1);
        expect(OrderKind.StopIncrease).toBe(2);
        expect(OrderKind.MarketDecrease).toBe(3);
        expect(OrderKind.LimitDecrease).toBe(4);
        expect(OrderKind.StopDecrease).toBe(5);
        // Exactly six kinds: a numeric TS enum holds one forward and one
        // reverse mapping per member.
        expect(Object.keys(OrderKind)).toHaveLength(12);
    });

    it('VaultOrderKind carries the two u32 discriminants of vault_order.rs', () => {
        expect(VaultOrderKind.Deposit).toBe(0);
        expect(VaultOrderKind.Redeem).toBe(1);
        expect(Object.keys(VaultOrderKind)).toHaveLength(4);
    });

    it('Status discriminants match status.rs', () => {
        expect(Status.Active).toBe(0);
        expect(Status.OnIce).toBe(1);
        expect(Status.Frozen).toBe(2);
        expect(Status.Delisted).toBe(3);
        expect(Status.Retired).toBe(4);
    });

    it('FULL_CLOSE is i128::MAX', () => {
        // i128::MAX = 2^127 - 1 = 170141183460469231731687303715884105727.
        expect(FULL_CLOSE).toBe(170141183460469231731687303715884105727n);
    });

    describe('tradingConfigToScVal', () => {
        it('emits exactly the 34 config.rs keys in alphabetical order', () => {
            const configScVal = tradingConfigToScVal(makeDistinctConfig());
            const keys = configScVal.map()!.map((mapEntry) => mapEntry.key().sym().toString());
            expect(keys).toEqual(EXPECTED_CONFIG_KEYS);
        });

        it('drops the retired v1 keys', () => {
            const configScVal = tradingConfigToScVal(makeDistinctConfig());
            const keys = configScVal.map()!.map((mapEntry) => mapEntry.key().sym().toString());
            for (const retiredKey of [
                'deposit_lock', 'impact_divisor', 'instant_deposit_pnl', 'max_pnl_deposit', 'vault_fee',
            ]) {
                expect(keys).not.toContain(retiredKey);
            }
        });

        it('encodes the two lock fields as u64 and everything else as i128', () => {
            const configScVal = tradingConfigToScVal(makeDistinctConfig());
            for (const mapEntry of configScVal.map()!) {
                const key = mapEntry.key().sym().toString();
                const expectedType = key === 'notional_lock' || key === 'redeem_lock' ? 'scvU64' : 'scvI128';
                expect(mapEntry.val().switch().name, `value type of ${key}`).toBe(expectedType);
            }
        });

        it('routes every field to its snake_case key (distinct-value check)', () => {
            const native = scValToNative(tradingConfigToScVal(makeDistinctConfig()));
            // Spot values follow the declaration-order numbering above.
            expect(native.keeper_rate).toBe(101n);
            expect(native.exec_fee).toBe(107n);
            expect(native.impact_scalar).toBe(110n);
            expect(native.notional_lock).toBe(116n);
            expect(native.adl_clear_target).toBe(127n);
            expect(native.redeem_lock).toBe(130n);
            expect(native.deposit_fee).toBe(131n);
            expect(native.redeem_fee).toBe(132n);
            expect(native.max_vault_balance).toBe(134n);
        });

        it('round-trips through parseTradingConfig', () => {
            const config = makeDistinctConfig();
            const native = scValToNative(tradingConfigToScVal(config));
            expect(parseTradingConfig(native)).toEqual(config);
        });
    });

    it('parseSidePair maps long and short', () => {
        expect(parseSidePair({ long: 5n, short: 6n })).toEqual({ long: 5n, short: 6n });
    });

    it('parseOrder decodes the u32 kind and carries execFee', () => {
        const order = parseOrder({
            is_long: true, kind: 4, notional: 1000n, collateral: 100n,
            trigger_price: 250n, price_bound: 260n, exec_fee: 3n,
            created_at: 500n, expiration: 1234,
        });
        expect(order).toEqual({
            isLong: true,
            kind: OrderKind.LimitDecrease,
            notional: 1000n,
            collateral: 100n,
            triggerPrice: 250n,
            priceBound: 260n,
            execFee: 3n,
            createdAt: 500n,
            expiration: 1234,
        });
        expect('triggerAbove' in order).toBe(false);
    });

    it('parseVaultOrder decodes minOut and execFee', () => {
        const vaultOrder = parseVaultOrder({
            kind: 1, amount: 42n, min_out: 7n, exec_fee: 2n, created_at: 100n,
        });
        expect(vaultOrder).toEqual({
            kind: VaultOrderKind.Redeem,
            amount: 42n,
            minOut: 7n,
            execFee: 2n,
            createdAt: 100n,
        });
        expect('unlocksAt' in vaultOrder).toBe(false);
    });

    it('parsePosition decodes pricedAt and decreaseOrders', () => {
        const position = parsePosition({
            collateral: 100n, notional: 1000n, tokens: 5n,
            funding_idx: 11n, borrowing_idx: 12n,
            locked_notional: 13n, unlocks_at: 14n, priced_at: 15n,
            decrease_orders: [3, 9],
        });
        expect(position).toEqual({
            collateral: 100n,
            notional: 1000n,
            tokens: 5n,
            fundingIdx: 11n,
            borrowingIdx: 12n,
            lockedNotional: 13n,
            unlocksAt: 14n,
            pricedAt: 15n,
            decreaseOrders: [3, 9],
        });
        expect('updatedAt' in position).toBe(false);
    });

    it('parseMarketData decodes SidePairs and lastPriceTime', () => {
        const marketData = parseMarketData({
            notional: { long: 1n, short: 2n }, collateral: { long: 3n, short: 4n },
            tokens: { long: 5n, short: 6n }, funding_idx: { long: 7n, short: 8n },
            borrowing_idx: { long: 9n, short: 10n }, funding_rate: 11n,
            funding_update: 12n, borrowing_update: 13n, funding_pool: 14n,
            funding_owed: 15n, last_price_time: 16n,
        });
        expect(marketData).toEqual({
            notional: { long: 1n, short: 2n },
            collateral: { long: 3n, short: 4n },
            tokens: { long: 5n, short: 6n },
            fundingIdx: { long: 7n, short: 8n },
            borrowingIdx: { long: 9n, short: 10n },
            fundingRate: 11n,
            fundingUpdate: 12n,
            borrowingUpdate: 13n,
            fundingPool: 14n,
            fundingOwed: 15n,
            lastPriceTime: 16n,
        });
    });

    it('parseAdlState maps the per-side flags', () => {
        expect(parseAdlState({ long: true, short: false })).toEqual({ long: true, short: false });
    });
});
