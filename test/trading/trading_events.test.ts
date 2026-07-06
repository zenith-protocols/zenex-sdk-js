import { describe, it, expect } from 'vitest';
import { NormalizedEvent } from '../../src/base_event.js';
import {
    TradingEventType,
    decodeTradingEvent,
    TradingCreateOrderEvent,
    TradingCreateVaultOrderEvent,
    TradingConfigUpdateEvent,
    TradingPositionUpdateEvent,
} from '../../src/trading/trading_events.js';
import { TradingConfig } from '../../src/trading/trading_types.js';

const CONTRACT_ID = 'CABCDEF0000000000000000000000000000000000000000000000000000000';
const USER = 'GUSER00000000000000000000000000000000000000000000000000000000';

function baseFixture(overrides: Partial<NormalizedEvent>): NormalizedEvent {
    return {
        contractId: CONTRACT_ID,
        txHash: 'ab',
        ledger: 5,
        ledgerClosedAt: 't',
        id: '5-0',
        eventType: 'unset',
        topicArgs: [],
        data: {},
        ...overrides,
    };
}

// Raw scValToNative-shaped Order (snake_case, enum as one-element array).
function rawOrder(): Record<string, unknown> {
    return {
        is_long: true,
        kind: ['Increase'],
        notional: 1000n,
        collateral: 100n,
        trigger_price: 0n,
        trigger_above: false,
        price_bound: 0n,
        created_at: 500n,
        expiration: 1234,
    };
}

// Raw scValToNative-shaped VaultOrder.
function rawVaultOrder(): Record<string, unknown> {
    return {
        kind: ['Redeem'],
        amount: 42n,
        max_adverse_pnl: 7n,
        created_at: 100n,
        unlocks_at: 160n,
    };
}

// Raw scValToNative-shaped Position.
function rawPosition(): Record<string, unknown> {
    return {
        collateral: 100n,
        notional: 1000n,
        tokens: 5n,
        funding_idx: 0n,
        borrowing_idx: 0n,
        locked_notional: 0n,
        unlocks_at: 0n,
        updated_at: 12n,
    };
}

// Raw scValToNative-shaped Config (all 35 fields; 1n except the u64 lock fields).
function rawConfig(): Record<string, unknown> {
    return {
        keeper_rate: 1n,
        min_position_notional: 1n,
        max_position_notional: 1n,
        max_open_interest: 1n,
        min_order_notional: 1n,
        min_order_collateral: 1n,
        fee_dom: 1n,
        fee_non_dom: 1n,
        impact_divisor: 1n,
        max_util_open: 1n,
        max_util_withdraw: 1n,
        init_margin: 1n,
        maintenance_margin: 1n,
        liq_fee: 1n,
        notional_lock: 60n,
        target_util: 1n,
        borrow_rate: 1n,
        increased_borrow_rate: 1n,
        funding_increase: 1n,
        funding_decrease: 1n,
        threshold_stable_funding: 1n,
        threshold_decrease_funding: 1n,
        funding_min: 1n,
        funding_max: 1n,
        adl_max_pnl: 1n,
        adl_clear_target: 1n,
        max_pnl_trader: 1n,
        redeem_lock: 60n,
        deposit_lock: 60n,
        instant_deposit_pnl: 1n,
        vault_fee: 1n,
        min_deposit: 1n,
        max_pnl_deposit: 1n,
        max_pnl_withdraw: 1n,
        max_vault_balance: 1n,
    };
}

describe('trading_events', () => {
    it('decodes create_order with a full Order via parseOrder', () => {
        const event = baseFixture({
            eventType: 'create_order',
            topicArgs: [USER, 7],
            data: { order: rawOrder() },
        });

        const decoded = decodeTradingEvent(event) as TradingCreateOrderEvent;
        expect(decoded.eventType).toBe(TradingEventType.CreateOrder);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(7);
        expect(decoded.order.isLong).toBe(true);
        expect(decoded.order.kind).toBe('Increase');
        expect(decoded.order.notional).toBe(1000n);
        expect(decoded.order.createdAt).toBe(500n);
        expect(decoded.order.expiration).toBe(1234);
        expect(decoded.contractId).toBe(CONTRACT_ID);
        expect(decoded.orderId).not.toBeUndefined();
    });

    it('decodes cancel_order with no data fields', () => {
        const event = baseFixture({
            eventType: 'cancel_order',
            topicArgs: [USER, 3],
            data: {},
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.CancelOrder);
        expect(decoded).toMatchObject({ user: USER, orderId: 3 });
    });

    it('decodes create_vault_order with a full VaultOrder via parseVaultOrder', () => {
        const event = baseFixture({
            eventType: 'create_vault_order',
            topicArgs: [USER, 11],
            data: { order: rawVaultOrder() },
        });

        const decoded = decodeTradingEvent(event) as TradingCreateVaultOrderEvent;
        expect(decoded.eventType).toBe(TradingEventType.CreateVaultOrder);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(11);
        expect(decoded.order.kind).toBe('Redeem');
        expect(decoded.order.amount).toBe(42n);
        expect(decoded.order.maxAdversePnl).toBe(7n);
        expect(decoded.order.unlocksAt).toBe(160n);
    });

    it('decodes cancel_vault_order with no data fields', () => {
        const event = baseFixture({
            eventType: 'cancel_vault_order',
            topicArgs: [USER, 4],
            data: {},
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.CancelVaultOrder);
        expect(decoded).toMatchObject({ user: USER, orderId: 4 });
    });

    it('decodes execute_vault_order', () => {
        const event = baseFixture({
            eventType: 'execute_vault_order',
            topicArgs: [USER, 11],
            data: { filled: 50n, remaining: 0n },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.ExecuteVaultOrder);
        expect(decoded).toMatchObject({ user: USER, orderId: 11, filled: 50n, remaining: 0n });
    });

    it('decodes claim_funding', () => {
        const event = baseFixture({
            eventType: 'claim_funding',
            topicArgs: [USER],
            data: { amount: 250n },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.ClaimFunding);
        expect(decoded).toMatchObject({ user: USER, amount: 250n });
    });

    it('decodes adl_update with no topics', () => {
        const event = baseFixture({
            eventType: 'adl_update',
            topicArgs: [],
            data: { long: true, short: false },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.AdlUpdate);
        expect(decoded).toMatchObject({ long: true, short: false });
    });

    it('decodes status_update', () => {
        const event = baseFixture({
            eventType: 'status_update',
            topicArgs: [],
            data: { status: 2 },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.StatusUpdate);
        expect(decoded).toMatchObject({ status: 2 });
    });

    it('decodes config_update with a full 35-field Config via parseTradingConfig', () => {
        const event = baseFixture({
            eventType: 'config_update',
            topicArgs: [],
            data: { config: rawConfig() },
        });

        const decoded = decodeTradingEvent(event) as TradingConfigUpdateEvent;
        expect(decoded.eventType).toBe(TradingEventType.ConfigUpdate);
        const config: TradingConfig = decoded.config;
        expect(config.keeperRate).toBe(1n);
        expect(config.notionalLock).toBe(60n);
        expect(config.maxVaultBalance).toBe(1n);
        expect(Object.keys(config)).toHaveLength(35);
    });

    it('decodes terminal_price_update', () => {
        const event = baseFixture({
            eventType: 'terminal_price_update',
            topicArgs: [],
            data: { price: 12345n },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.TerminalPriceUpdate);
        expect(decoded).toMatchObject({ price: 12345n });
    });

    it('decodes increase_fill with camelCased fee fields', () => {
        const event = baseFixture({
            eventType: 'increase_fill',
            topicArgs: [USER, 7, true],
            data: {
                notional: 1000n, tokens: 5n, collateral: 100n, base_fee: 1n,
                impact_fee: 2n, funding: -3n, borrowing: 4n,
            },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.IncreaseFill);
        expect(decoded).toMatchObject({
            user: USER, orderId: 7, isLong: true,
            notional: 1000n, tokens: 5n, collateral: 100n,
            baseFee: 1n, impactFee: 2n, funding: -3n, borrowing: 4n,
        });
    });

    it('decodes decrease_fill with topic id 0 as an ADL slice', () => {
        const event = baseFixture({
            eventType: 'decrease_fill',
            topicArgs: [USER, 0, true],
            data: {
                notional: 500n, tokens: 2n, collateral: 50n, pnl: -10n,
                base_fee: 1n, impact_fee: 2n, funding: 3n, borrowing: 4n,
                bad_debt: 0n, returned: 40n,
            },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.DecreaseFill);
        expect(decoded).toMatchObject({
            user: USER, orderId: 0, isLong: true,
            notional: 500n, tokens: 2n, collateral: 50n, pnl: -10n,
            baseFee: 1n, impactFee: 2n, funding: 3n, borrowing: 4n,
            badDebt: 0n, returned: 40n,
        });
    });

    it('decodes liquidation', () => {
        const event = baseFixture({
            eventType: 'liquidation',
            topicArgs: [USER, false],
            data: {
                notional: 900n, tokens: 4n, collateral: 90n, pnl: -80n,
                base_fee: 1n, impact_fee: 2n, funding: 3n, borrowing: 4n,
                bad_debt: 5n, liq_fee: 6n, returned: 0n, forfeit: 10n,
            },
        });

        const decoded = decodeTradingEvent(event);
        expect(decoded?.eventType).toBe(TradingEventType.Liquidation);
        expect(decoded).toMatchObject({
            user: USER, isLong: false,
            notional: 900n, tokens: 4n, collateral: 90n, pnl: -80n,
            baseFee: 1n, impactFee: 2n, funding: 3n, borrowing: 4n,
            badDebt: 5n, liqFee: 6n, returned: 0n, forfeit: 10n,
        });
    });

    it('decodes position_update with a full Position via parsePosition', () => {
        const event = baseFixture({
            eventType: 'position_update',
            topicArgs: [USER, true],
            data: { position: rawPosition() },
        });

        const decoded = decodeTradingEvent(event) as TradingPositionUpdateEvent;
        expect(decoded.eventType).toBe(TradingEventType.PositionUpdate);
        expect(decoded.user).toBe(USER);
        expect(decoded.isLong).toBe(true);
        expect(decoded.position.collateral).toBe(100n);
        expect(decoded.position.notional).toBe(1000n);
        expect(decoded.position.lockedNotional).toBe(0n);
        expect(decoded.position.updatedAt).toBe(12n);
    });

    it('returns undefined for an unknown event type', () => {
        const event = baseFixture({
            eventType: 'some_unrelated_event',
            topicArgs: [],
            data: {},
        });

        expect(decodeTradingEvent(event)).toBeUndefined();
    });
});
