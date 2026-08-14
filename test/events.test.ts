import { describe, it, expect } from 'vitest';
import { ZenexContractType } from '../src/base_event.js';
import type { ZenexEvent } from '../src/base_event.js';
import {
    TradingEventType,
} from '../src/contracts/trading/trading_events.js';
import type {
    TradingCancelOrderEvent,
    TradingLiquidationEvent,
} from '../src/contracts/trading/trading_events.js';
import { VaultEventType } from '../src/contracts/vault/vault_events.js';
import type { VaultDepositEvent, VaultWithdrawEvent } from '../src/contracts/vault/vault_events.js';
import { GovernanceEventType } from '../src/contracts/governance/governance_events.js';
import { FactoryEventType } from '../src/contracts/factory/factory_events.js';
import type { FactoryDeployEvent } from '../src/contracts/factory/factory_events.js';

// =============================================================================
// Event-type enums are hand-checked against the contract sources on v2 main:
//   trading/src/events.rs, strategy-vault/src/strategy.rs (+ OZ stellar-tokens
//   v0.7.0 vault/mod.rs Deposit/Withdraw), governance/src/events.rs,
//   factory/src/events.rs.
// Every workspace event uses bare #[contractevent], so each name topic is the
// snake_case of the struct name (soroban-sdk-macros default). The SDK ships
// event TYPES only (no decoders); the shape checks here are compile-time.
// =============================================================================

const base = {
    id: 'e-1',
    contractId: 'C',
    ledger: 1,
    ledgerClosedAt: '2026-08-14T00:00:00Z',
    txHash: 't',
} as const;

describe('trading event surface', () => {
    it('cancel_order carries the escrow refund (owner cancel and closure sweep)', () => {
        const event: TradingCancelOrderEvent = {
            ...base,
            contractType: ZenexContractType.Trading,
            eventType: TradingEventType.CancelOrder,
            user: 'G',
            orderId: 1,
            refund: 500n,
        };
        expect(event.refund).toBe(500n);
    });

    it('liquidation has no liqFee field; tier is keyed on returned vs forfeit', () => {
        type LiquidationKeys = keyof TradingLiquidationEvent;
        // Compile-time: 'liqFee' is not a member of the payload.
        const notAKey: Exclude<'liqFee', LiquidationKeys> = 'liqFee';
        expect(notAKey).toBe('liqFee');
        // Runtime: the tier discriminators stay on the type.
        const tierKeys: LiquidationKeys[] = ['returned', 'forfeit', 'badDebt'];
        expect(tierKeys).toHaveLength(3);
    });
});

describe('vault event surface', () => {
    it('name topics are the snake_case macro defaults', () => {
        expect(VaultEventType.Deposit).toBe('deposit');
        expect(VaultEventType.Withdraw).toBe('withdraw');
        expect(VaultEventType.StrategyWithdraw).toBe('strategy_withdraw');
    });

    it('models the OZ ERC-4626 Deposit/Withdraw receipts', () => {
        const deposit: VaultDepositEvent = {
            ...base,
            contractType: ZenexContractType.Vault,
            eventType: VaultEventType.Deposit,
            operator: 'C-trading',
            from: 'G-payer',
            receiver: 'G-holder',
            assets: 100n,
            shares: 99n,
        };
        const withdraw: VaultWithdrawEvent = {
            ...base,
            contractType: ZenexContractType.Vault,
            eventType: VaultEventType.Withdraw,
            operator: 'C-trading',
            receiver: 'G-payee',
            owner: 'G-holder',
            assets: 100n,
            shares: 99n,
        };
        expect(deposit.shares).toBe(99n);
        expect(withdraw.owner).toBe('G-holder');
    });
});

describe('governance event surface', () => {
    it('name topics are the snake_case macro defaults', () => {
        expect(GovernanceEventType.Queued).toBe('queued');
        expect(GovernanceEventType.Executed).toBe('executed');
        expect(GovernanceEventType.Cancelled).toBe('cancelled');
        expect(GovernanceEventType.StatusSet).toBe('status_set');
        expect(GovernanceEventType.DelaySet).toBe('delay_set');
    });
});

describe('factory event surface', () => {
    it('models the deploy receipt and joins the ZenexEvent union', () => {
        expect(FactoryEventType.Deploy).toBe('deploy');
        const event: FactoryDeployEvent = {
            ...base,
            contractType: ZenexContractType.Factory,
            eventType: FactoryEventType.Deploy,
            trading: 'C-trading',
            vault: 'C-vault',
        };
        // Compile-time: the factory event is assignable to the union.
        const union: ZenexEvent = event;
        expect(union.contractType).toBe(ZenexContractType.Factory);
    });
});
