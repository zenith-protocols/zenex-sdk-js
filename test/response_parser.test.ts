import { describe, it, expect } from 'vitest';
import { rpc } from '@stellar/stellar-sdk';
import { parseError } from '../src/response_parser.js';
import { ContractErrorType, TradingError } from '../src/errors.js';

function simError(code: number): rpc.Api.SimulateTransactionErrorResponse {
    return {
        id: '1',
        latestLedger: 1,
        events: [],
        error: `HostError: Error(Contract, #${code})`,
    } as unknown as rpc.Api.SimulateTransactionErrorResponse;
}

describe('parseError code resolution (v2)', () => {
    it('resolves a non-colliding trading code without a hint (704 -> MarketFrozen)', () => {
        const err = parseError(simError(704));
        expect(err.type).toBe(TradingError.MarketFrozen);
        expect(err.type).toBe(704);
        expect(err.message).not.toContain('Unknown');
    });

    it('resolves new price-verifier payload parser codes (784 -> PVTruncatedData)', () => {
        const err = parseError(simError(784));
        expect(err.type).toBe(ContractErrorType.PVTruncatedData);
        expect(err.type).toBe(784);
    });

    it('covers the full 784-789 PV payload parser range', () => {
        expect(ContractErrorType.PVTruncatedData).toBe(784);
        expect(ContractErrorType.PVInvalidPayloadLength).toBe(785);
        expect(ContractErrorType.PVInvalidPayloadMagic).toBe(786);
        expect(ContractErrorType.PVInvalidChannel).toBe(787);
        expect(ContractErrorType.PVInvalidProperty).toBe(788);
        expect(ContractErrorType.PVInvalidMarketSession).toBe(789);
    });

    it('770 without a contract hint stays ambiguous (UnknownError)', () => {
        const err = parseError(simError(770));
        expect(err.type).toBe(ContractErrorType.UnknownError);
    });

    it('770 with a trading hint resolves to AdlNotTriggered (ADL message, not the governance one)', () => {
        const err = parseError(simError(770), 'trading');
        expect(err.type).toBe(TradingError.AdlNotTriggered);
        expect(err.message).toMatch(/ADL/);
        expect(err.message).not.toMatch(/[Qq]ueued/);
    });

    it('770 with a governance hint resolves to GovNotQueued (queue message, not the ADL one)', () => {
        const err = parseError(simError(770), 'governance');
        expect(err.type).toBe(ContractErrorType.GovNotQueued);
        expect(err.message).toMatch(/[Qq]ueued/);
        expect(err.message).not.toMatch(/ADL/);
    });

    it('a trading hint does not block non-trading codes surfaced by a trading tx (780 -> PVInvalidData)', () => {
        const err = parseError(simError(780), 'trading');
        expect(err.type).toBe(ContractErrorType.PVInvalidData);
    });

    it('790/791 keep their strategy-vault meaning (collision resolved in favor of the merged enum)', () => {
        expect(parseError(simError(790)).type).toBe(ContractErrorType.StrategyInvalidAmount);
        expect(parseError(simError(791)).type).toBe(ContractErrorType.SharesLocked);
    });

    it('unknown codes still fall back to UnknownError', () => {
        expect(parseError(simError(999)).type).toBe(ContractErrorType.UnknownError);
    });
});
