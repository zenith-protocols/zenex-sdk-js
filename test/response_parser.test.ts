import { describe, it, expect } from 'vitest';
import { rpc } from '@stellar/stellar-sdk';
import { parseError } from '../src/response_parser.js';
import { ZenexError, ZenexErrorCode } from '../src/errors.js';

// =============================================================================
// parseError code resolution against the disjoint v2 namespaces:
// market 700-772, price-verifier 780-791, strategy-vault 800-801,
// governance 810-812, treasury 900. No contract-type hint exists anymore.
// =============================================================================

function simulationError(code: number): rpc.Api.SimulateTransactionErrorResponse {
    return {
        id: '1',
        latestLedger: 1,
        events: [],
        error: `HostError: Error(Contract, #${code})`,
    } as unknown as rpc.Api.SimulateTransactionErrorResponse;
}

describe('parseError: collision-hint machinery is gone', () => {
    it('parseError takes a single parameter (no contractType hint)', () => {
        expect(parseError.length).toBe(1);
    });

    it('a stray second argument is inert (same resolution with and without it)', () => {
        const parseWithExtraArgument = parseError as unknown as (
            response: unknown,
            legacyHint?: string
        ) => ZenexError;
        expect(parseWithExtraArgument(simulationError(770), 'governance').code).toBe(
            ZenexErrorCode.AdlNotTriggered
        );
        expect(parseWithExtraArgument(simulationError(810), 'market').code).toBe(
            ZenexErrorCode.GovNotQueued
        );
    });
});

describe('parseError: new market codes resolve unhinted', () => {
    it('733 -> TooManyOrders', () => {
        expect(parseError(simulationError(733)).code).toBe(ZenexErrorCode.TooManyOrders);
    });

    it('734 -> UnknownKind', () => {
        expect(parseError(simulationError(734)).code).toBe(ZenexErrorCode.UnknownKind);
    });

    it('742 -> TriggerNotMet', () => {
        expect(parseError(simulationError(742)).code).toBe(ZenexErrorCode.TriggerNotMet);
    });

    it('752 -> MinOutNotMet (the min_out slippage gate, not the old pending-PnL meaning)', () => {
        const error = parseError(simulationError(752));
        expect(error.code).toBe(ZenexErrorCode.MinOutNotMet);
        expect(error.message).toMatch(/min_out/);
    });

    it('754 -> PendingPnlExceeded', () => {
        const error = parseError(simulationError(754));
        expect(error.code).toBe(ZenexErrorCode.PendingPnlExceeded);
        expect(error.message).toMatch(/PnL/i);
    });

    it('760 -> NothingToClaim', () => {
        expect(parseError(simulationError(760)).code).toBe(ZenexErrorCode.NothingToClaim);
    });

    it('770-772 resolve unhinted to the market ADL errors', () => {
        const adlNotTriggered = parseError(simulationError(770));
        expect(adlNotTriggered.code).toBe(ZenexErrorCode.AdlNotTriggered);
        expect(adlNotTriggered.message).toMatch(/ADL/);
        expect(adlNotTriggered.message).not.toMatch(/queued/i);

        expect(parseError(simulationError(771)).code).toBe(ZenexErrorCode.AdlOvershoot);
        expect(parseError(simulationError(772)).code).toBe(ZenexErrorCode.AdlNotEligible);
    });
});

describe('parseError: periphery namespaces resolve unhinted', () => {
    it('governance 810-812', () => {
        const notQueued = parseError(simulationError(810));
        expect(notQueued.code).toBe(ZenexErrorCode.GovNotQueued);
        expect(notQueued.message).toMatch(/queued/i);
        expect(notQueued.message).not.toMatch(/ADL/);

        expect(parseError(simulationError(811)).code).toBe(ZenexErrorCode.GovNotUnlocked);
        expect(parseError(simulationError(812)).code).toBe(ZenexErrorCode.GovInvalidDelay);
    });

    it('strategy-vault 800-801', () => {
        expect(parseError(simulationError(800)).code).toBe(ZenexErrorCode.StrategyInvalidAmount);
        expect(parseError(simulationError(801)).code).toBe(ZenexErrorCode.StrategyPnlExceedsAssets);
    });

    it('oracle feed/clock pair 790/793 (no longer strategy-vault codes)', () => {
        expect(parseError(simulationError(790)).code).toBe(ZenexErrorCode.OracleFeedMismatch);
        expect(parseError(simulationError(793)).code).toBe(ZenexErrorCode.OraclePriceAhead);
    });

    it('oracle Chainlink report rejects 784/785; the Lazer parser range is retired', () => {
        expect(parseError(simulationError(784)).code).toBe(ZenexErrorCode.OracleReportExpired);
        expect(parseError(simulationError(785)).code).toBe(
            ZenexErrorCode.OracleInvalidSpreadReduction
        );
        for (const code of [786, 787, 788, 789, 791, 792]) {
            expect(parseError(simulationError(code)).code, `code ${code}`).toBe(
                ZenexErrorCode.UnknownError
            );
        }
    });

    it('treasury 900', () => {
        expect(parseError(simulationError(900)).code).toBe(ZenexErrorCode.TreasuryInvalidRate);
    });
});

describe('parseError: fallbacks', () => {
    it('a non-colliding market code resolves with its message (704 -> MarketFrozen)', () => {
        const error = parseError(simulationError(704));
        expect(error.code).toBe(ZenexErrorCode.MarketFrozen);
        expect(error.code).toBe(704);
        expect(error.message).not.toContain('Unknown');
    });

    it('unknown codes fall back to UnknownError', () => {
        expect(parseError(simulationError(999)).code).toBe(ZenexErrorCode.UnknownError);
        expect(parseError(simulationError(707)).code).toBe(ZenexErrorCode.UnknownError);
    });
});
