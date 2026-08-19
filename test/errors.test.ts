import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
    ContractError,
    ContractErrorType,
    contractErrorFromCode,
    parseContractErrorCode,
} from '../src/errors.js';

// =============================================================================
// Error enums are hand-checked against the contract sources:
//   market/src/errors.rs           (MarketError, 600 + 700-772)
//   oracle/src/error.rs            (OracleError, 600 + 780-793)
//   factory/src/errors.rs          (FactoryError, 600)
//   strategy-vault/src/strategy.rs (StrategyVaultError, 800-801)
//   governance/src/errors.rs       (GovernanceError, 810-812)
//   treasury/src/lib.rs            (TreasuryError, 900)
//   OpenZeppelin ownable           (OwnableError 2100-2102, RoleTransferError 2200-2203)
//   OpenZeppelin fee-abstraction   (FeeAbstractionError, 5000-5006)
// The namespaces are disjoint, so contractErrorFromCode takes no hint and
// every code lives in the one flat ContractErrorType enum. UpgradeNotOwner
// (600) is one shared code raised identically by market, oracle and factory,
// so the bare code still names one condition.
// =============================================================================

describe('market codes inside ContractErrorType (market/src/errors.rs)', () => {
    it('matches every v2 market error code exactly', () => {
        // config / construction
        expect(ContractErrorType.InvalidConfig).toBe(700);
        expect(ContractErrorType.InvalidPrice).toBe(701);
        expect(ContractErrorType.InvalidStatus).toBe(702);
        expect(ContractErrorType.MarketNotAccrued).toBe(703);
        expect(ContractErrorType.MarketFrozen).toBe(704);
        expect(ContractErrorType.IncreaseHalted).toBe(705);
        expect(ContractErrorType.MarketNotCleared).toBe(706);
        // general
        expect(ContractErrorType.NegativeValueNotAllowed).toBe(710);
        // position sizing / margin
        expect(ContractErrorType.NotionalBelowMinimum).toBe(711);
        expect(ContractErrorType.NotionalAboveMaximum).toBe(712);
        expect(ContractErrorType.InsufficientMargin).toBe(713);
        expect(ContractErrorType.UtilizationExceeded).toBe(714);
        expect(ContractErrorType.OpenInterestExceeded).toBe(715);
        // position lifecycle
        expect(ContractErrorType.PositionNotFound).toBe(720);
        expect(ContractErrorType.NotionalLocked).toBe(721);
        expect(ContractErrorType.NotLiquidatable).toBe(722);
        expect(ContractErrorType.PositionLiquidatable).toBe(723);
        // orders / price
        expect(ContractErrorType.OrderNotFound).toBe(730);
        expect(ContractErrorType.OrderExpired).toBe(731);
        expect(ContractErrorType.InvalidOrder).toBe(732);
        expect(ContractErrorType.TooManyOrders).toBe(733);
        expect(ContractErrorType.UnknownKind).toBe(734);
        expect(ContractErrorType.StalePrice).toBe(740);
        expect(ContractErrorType.PriceBoundExceeded).toBe(741);
        expect(ContractErrorType.TriggerNotMet).toBe(742);
        // vault orders
        expect(ContractErrorType.VaultOrderNotFound).toBe(750);
        expect(ContractErrorType.VaultOrderLocked).toBe(751);
        expect(ContractErrorType.MinOutNotMet).toBe(752);
        expect(ContractErrorType.VaultBalanceExceeded).toBe(753);
        expect(ContractErrorType.PendingPnlExceeded).toBe(754);
        expect(ContractErrorType.VaultInsolvent).toBe(755);
        // funding
        expect(ContractErrorType.NothingToClaim).toBe(760);
        // ADL
        expect(ContractErrorType.AdlNotTriggered).toBe(770);
        expect(ContractErrorType.AdlOvershoot).toBe(771);
        expect(ContractErrorType.AdlNotEligible).toBe(772);
    });

    it('carries exactly 35 market members (the full errors.rs surface, no stale codes)', () => {
        // Hand count from errors.rs: 700-706 (7) + 710 (1) + 711-715 (5)
        // + 720-723 (4) + 730-734 (5) + 740-742 (3) + 750-755 (6) + 760 (1)
        // + 770-772 (3) = 35.
        const marketCodes = Object.values(ContractErrorType).filter(
            (value): value is number =>
                typeof value === 'number' && value >= 700 && value <= 772,
        );
        expect(marketCodes).toHaveLength(35);
    });

    it('752 means MinOutNotMet, and PendingPnlExceeded moved to 754', () => {
        expect(ContractErrorType[752]).toBe('MinOutNotMet');
        expect(ContractErrorType[754]).toBe('PendingPnlExceeded');
    });

    it('723 and 755 are the settlement-rail rejects added on v2 main', () => {
        expect(ContractErrorType[723]).toBe('PositionLiquidatable');
        expect(ContractErrorType[755]).toBe('VaultInsolvent');
    });

    it('every market code resolves with a human-readable message', () => {
        const marketCodes = Object.values(ContractErrorType).filter(
            (value): value is number =>
                typeof value === 'number' && value >= 700 && value <= 772,
        );
        for (const code of marketCodes) {
            expect(
                contractErrorFromCode(code).message,
                `message for code ${code}`,
            ).not.toBe(`Contract error ${code}`);
        }
    });
});

describe('ContractErrorType periphery codes (v2 contracts)', () => {
    it('oracle covers the OracleError set (780-785, 790, 793)', () => {
        expect(ContractErrorType.OracleInvalidData).toBe(780);
        expect(ContractErrorType.OracleInvalidPrice).toBe(781);
        expect(ContractErrorType.OraclePriceStale).toBe(782);
        expect(ContractErrorType.OracleInvalidStaleness).toBe(783);
        expect(ContractErrorType.OracleReportExpired).toBe(784);
        expect(ContractErrorType.OracleInvalidSpreadReduction).toBe(785);
        expect(ContractErrorType.OracleFeedMismatch).toBe(790);
        expect(ContractErrorType.OraclePriceAhead).toBe(793);
    });

    it('the retired Lazer price-verifier codes are gone (786-789, 791, 792)', () => {
        const memberNames = ContractErrorType as unknown as Record<string, unknown>;
        expect(memberNames.PVInvalidData).toBeUndefined();
        expect(memberNames.PVTruncatedData).toBeUndefined();
        expect(memberNames.PVWrongExponent).toBeUndefined();
        expect(memberNames.PVInvalidConfidence).toBeUndefined();
        const byCode = ContractErrorType as unknown as Record<number, string>;
        for (const code of [786, 787, 788, 789, 791, 792]) {
            expect(byCode[code], `code ${code}`).toBeUndefined();
            expect(contractErrorFromCode(code).type).toBe(ContractErrorType.UnknownError);
        }
    });

    it('fee-abstraction covers the FeeAbstractionError set (5000-5006, OpenZeppelin)', () => {
        expect(ContractErrorType.FeeTokenNotAllowed).toBe(5000);
        expect(ContractErrorType.FeeTokenAlreadyAllowed).toBe(5001);
        expect(ContractErrorType.TokenCountOverflow).toBe(5002);
        expect(ContractErrorType.FeeAbstractionInvalidFeeBounds).toBe(5003);
        expect(ContractErrorType.NoTokensToSweep).toBe(5004);
        expect(ContractErrorType.FeeAbstractionInvalidUser).toBe(5005);
        expect(ContractErrorType.FeeAbstractionInvalidExpirationLedger).toBe(5006);
    });

    it('UpgradeNotOwner is the one shared admin code (600), out of the token 1xx domain', () => {
        expect(ContractErrorType.UpgradeNotOwner).toBe(600);
        expect(contractErrorFromCode(600).type).toBe(ContractErrorType.UpgradeNotOwner);
        // The token domain keeps 100-102; a bare code cannot be ambiguous.
        expect(contractErrorFromCode(100).type).toBe(ContractErrorType.InsufficientBalance);
        expect(contractErrorFromCode(102).type).toBe(ContractErrorType.InvalidLiveUntilLedger);
    });

    it('ownable and role-transfer cover the OpenZeppelin sets (2100-2102, 2200-2203)', () => {
        expect(ContractErrorType.OwnerNotSet).toBe(2100);
        expect(ContractErrorType.OwnershipTransferInProgress).toBe(2101);
        expect(ContractErrorType.OwnerAlreadySet).toBe(2102);
        expect(ContractErrorType.NoPendingTransfer).toBe(2200);
        expect(ContractErrorType.TransferInvalidLiveUntilLedger).toBe(2201);
        expect(ContractErrorType.InvalidPendingAccount).toBe(2202);
        expect(ContractErrorType.TransferExpired).toBe(2203);
    });

    it('strategy-vault is the 800-801 pair from strategy.rs', () => {
        expect(ContractErrorType.StrategyInvalidAmount).toBe(800);
        expect(ContractErrorType.StrategyPnlExceedsAssets).toBe(801);
    });

    it('governance moved to 810-812 per governance/src/errors.rs', () => {
        expect(ContractErrorType.GovNotQueued).toBe(810);
        expect(ContractErrorType.GovNotUnlocked).toBe(811);
        expect(ContractErrorType.GovInvalidDelay).toBe(812);
    });

    it('treasury InvalidRate stays at 900', () => {
        expect(ContractErrorType.TreasuryInvalidRate).toBe(900);
    });

    it('the market 700-772 range lives inside the one flat enum', () => {
        expect(ContractErrorType[700]).toBe('InvalidConfig');
        expect(ContractErrorType[772]).toBe('AdlNotEligible');
    });

    it('the stale names are gone (v1 market, old strategy-vault 790-793, governance 770-772 aliases)', () => {
        const memberNames = ContractErrorType as unknown as Record<string, unknown>;
        expect(memberNames.MarketNotFound).toBeUndefined();
        expect(memberNames.PriceSlippage).toBeUndefined();
        expect(memberNames.LeverageAboveMaximum).toBeUndefined();
        expect(memberNames.ContractFrozen).toBeUndefined();
        expect(memberNames.SharesLocked).toBeUndefined();
        // 770-772 are the market ADL codes, not the old governance aliases
        expect(ContractErrorType[770]).toBe('AdlNotTriggered');
        expect(ContractErrorType[771]).toBe('AdlOvershoot');
        expect(ContractErrorType[772]).toBe('AdlNotEligible');
    });
});

describe('contractErrorFromCode (hint-free resolution)', () => {
    it('takes only the code (collision-hint parameter deleted)', () => {
        expect(contractErrorFromCode.length).toBe(1);
    });

    it('resolves the new market codes', () => {
        expect(contractErrorFromCode(723).type).toBe(ContractErrorType.PositionLiquidatable);
        expect(contractErrorFromCode(733).type).toBe(ContractErrorType.TooManyOrders);
        expect(contractErrorFromCode(734).type).toBe(ContractErrorType.UnknownKind);
        expect(contractErrorFromCode(742).type).toBe(ContractErrorType.TriggerNotMet);
        expect(contractErrorFromCode(752).type).toBe(ContractErrorType.MinOutNotMet);
        expect(contractErrorFromCode(754).type).toBe(ContractErrorType.PendingPnlExceeded);
        expect(contractErrorFromCode(755).type).toBe(ContractErrorType.VaultInsolvent);
        expect(contractErrorFromCode(760).type).toBe(ContractErrorType.NothingToClaim);
    });

    it('resolves 770-772 unhinted to the market ADL errors with ADL messages', () => {
        const adlNotTriggered = contractErrorFromCode(770);
        expect(adlNotTriggered.type).toBe(ContractErrorType.AdlNotTriggered);
        expect(adlNotTriggered.message).toMatch(/ADL/);
        expect(adlNotTriggered.message).not.toMatch(/queued/i);

        expect(contractErrorFromCode(771).type).toBe(ContractErrorType.AdlOvershoot);
        expect(contractErrorFromCode(772).type).toBe(ContractErrorType.AdlNotEligible);
    });

    it('resolves governance 810-812 with the queue/timelock messages', () => {
        const notQueued = contractErrorFromCode(810);
        expect(notQueued.type).toBe(ContractErrorType.GovNotQueued);
        expect(notQueued.message).toMatch(/queued/i);
        expect(notQueued.message).not.toMatch(/ADL/);

        expect(contractErrorFromCode(811).type).toBe(ContractErrorType.GovNotUnlocked);
        expect(contractErrorFromCode(812).type).toBe(ContractErrorType.GovInvalidDelay);
    });

    it('resolves strategy-vault 800-801 and the oracle feed/clock pair 790/793', () => {
        expect(contractErrorFromCode(800).type).toBe(ContractErrorType.StrategyInvalidAmount);
        expect(contractErrorFromCode(801).type).toBe(ContractErrorType.StrategyPnlExceedsAssets);
        expect(contractErrorFromCode(790).type).toBe(ContractErrorType.OracleFeedMismatch);
        expect(contractErrorFromCode(790).message).toBe(
            'Report prices a different stream than the feed anchor'
        );
        expect(contractErrorFromCode(793).type).toBe(ContractErrorType.OraclePriceAhead);
    });

    it('describes 782/783/793 in two-tier staleness terms (contracts #169)', () => {
        // 782 fires against whichever window the call selected, so the message
        // must not imply a single global threshold.
        const stale = contractErrorFromCode(782).message;
        expect(stale).toMatch(/trade_staleness/);
        expect(stale).toMatch(/close_staleness/);

        // 783 pins both halves of the validity rule: the trade window's own
        // bounds and the ordering against the close window.
        const bounds = contractErrorFromCode(783).message;
        expect(bounds).toMatch(/3 <= trade_staleness <= 15/);
        expect(bounds).toMatch(/trade_staleness <= close_staleness <= 120/);

        // The forward allowance never widens with the call class — quoting the
        // close window here would misdescribe the gate.
        const ahead = contractErrorFromCode(793).message;
        expect(ahead).toMatch(/trade_staleness ahead/);
        expect(ahead).not.toMatch(/close_staleness ahead/);
    });

    it('resolves the Chainlink report rejects 784/785 with their new meanings', () => {
        expect(contractErrorFromCode(784).type).toBe(ContractErrorType.OracleReportExpired);
        expect(contractErrorFromCode(784).message).toBe(
            'Ledger clock has passed the report expiresAt'
        );
        expect(contractErrorFromCode(785).type).toBe(
            ContractErrorType.OracleInvalidSpreadReduction
        );
        expect(contractErrorFromCode(785).message).not.toMatch(/payload|trailing/i);
    });

    it('resolves fee-abstraction 5003 with the relay fee-bounds message', () => {
        const error = contractErrorFromCode(5003);
        expect(error.type).toBe(ContractErrorType.FeeAbstractionInvalidFeeBounds);
        expect(error.message).toBe('Relayer fee is outside the signed fee bounds');
    });

    it('falls back to UnknownError for codes in no namespace', () => {
        expect(contractErrorFromCode(999).type).toBe(ContractErrorType.UnknownError);
        expect(contractErrorFromCode(0).type).toBe(ContractErrorType.UnknownError);
        expect(contractErrorFromCode(707).type).toBe(ContractErrorType.UnknownError);
    });

    it('returns ContractError instances carrying the numeric code', () => {
        const error = contractErrorFromCode(741);
        expect(error).toBeInstanceOf(ContractError);
        expect(error.type).toBe(741);
    });
});

describe('parseContractErrorCode (strict Error(Contract, #N) shape)', () => {
    it('parses the Error(Contract, #N) pattern anywhere in the diagnostic', () => {
        expect(parseContractErrorCode('HostError: Error(Contract, #713)')).toBe(713);
        expect(
            parseContractErrorCode(
                'host invocation failed\n\nCaused by:\n    Error(Contract, #741)\n    Event log'
            )
        ).toBe(741);
    });

    it('rejects everything else, including bare #N and non-contract errors', () => {
        expect(parseContractErrorCode('generic rpc timeout')).toBeUndefined();
        expect(parseContractErrorCode('simulation failed: #721')).toBeUndefined();
        expect(parseContractErrorCode('Error(WasmVm, InvalidAction)')).toBeUndefined();
        expect(parseContractErrorCode('Error(Contract, #)')).toBeUndefined();
        expect(parseContractErrorCode('')).toBeUndefined();
    });

    it('accepts codes up to u32::MAX and rejects anything larger', () => {
        expect(parseContractErrorCode('Error(Contract, #4294967295)')).toBe(4_294_967_295);
        // 10 digits but past u32::MAX: parses, then the bound guard rejects it.
        expect(parseContractErrorCode('Error(Contract, #4294967296)')).toBeUndefined();
        // 11+ digits never match the pattern at all.
        expect(parseContractErrorCode('Error(Contract, #42949672950)')).toBeUndefined();
    });
});

describe('package exports', () => {
    it('exposes ./errors as a standalone subpath (types + cjs + esm)', () => {
        const packageJson = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8')
        ) as { exports: Record<string, Record<string, string>> };
        expect(packageJson.exports['./errors']).toEqual({
            types: './dist/types/errors.d.ts',
            require: './dist/cjs/errors.js',
            import: './dist/esm/errors.js',
        });
    });

    it('keeps errors.ts import-free so the subpath stays lean', () => {
        const source = readFileSync(new URL('../src/errors.ts', import.meta.url), 'utf8');
        expect(source).not.toMatch(/^\s*import /m);
    });
});
