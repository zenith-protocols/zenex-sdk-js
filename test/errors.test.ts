import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
    ContractError,
    ContractErrorType,
    MarketError,
    contractErrorFromCode,
    parseContractErrorCode,
    marketErrorMessages,
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
// The namespaces are disjoint, so contractErrorFromCode takes no hint.
// UpgradeNotOwner (600) is one shared code raised identically by market,
// oracle and factory, so the bare code still names one condition.
// =============================================================================

describe('MarketError (v2 trading/src/errors.rs)', () => {
    it('matches every v2 market error code exactly', () => {
        // config / construction
        expect(MarketError.InvalidConfig).toBe(700);
        expect(MarketError.InvalidPrice).toBe(701);
        expect(MarketError.InvalidStatus).toBe(702);
        expect(MarketError.MarketNotAccrued).toBe(703);
        expect(MarketError.MarketFrozen).toBe(704);
        expect(MarketError.IncreaseHalted).toBe(705);
        expect(MarketError.MarketNotCleared).toBe(706);
        // general
        expect(MarketError.NegativeValueNotAllowed).toBe(710);
        // position sizing / margin
        expect(MarketError.NotionalBelowMinimum).toBe(711);
        expect(MarketError.NotionalAboveMaximum).toBe(712);
        expect(MarketError.InsufficientMargin).toBe(713);
        expect(MarketError.UtilizationExceeded).toBe(714);
        expect(MarketError.OpenInterestExceeded).toBe(715);
        // position lifecycle
        expect(MarketError.PositionNotFound).toBe(720);
        expect(MarketError.NotionalLocked).toBe(721);
        expect(MarketError.NotLiquidatable).toBe(722);
        expect(MarketError.PositionLiquidatable).toBe(723);
        // orders / price
        expect(MarketError.OrderNotFound).toBe(730);
        expect(MarketError.OrderExpired).toBe(731);
        expect(MarketError.InvalidOrder).toBe(732);
        expect(MarketError.TooManyOrders).toBe(733);
        expect(MarketError.UnknownKind).toBe(734);
        expect(MarketError.StalePrice).toBe(740);
        expect(MarketError.PriceBoundExceeded).toBe(741);
        expect(MarketError.TriggerNotMet).toBe(742);
        // vault orders
        expect(MarketError.VaultOrderNotFound).toBe(750);
        expect(MarketError.VaultOrderLocked).toBe(751);
        expect(MarketError.MinOutNotMet).toBe(752);
        expect(MarketError.VaultBalanceExceeded).toBe(753);
        expect(MarketError.PendingPnlExceeded).toBe(754);
        expect(MarketError.VaultInsolvent).toBe(755);
        // funding
        expect(MarketError.NothingToClaim).toBe(760);
        // ADL
        expect(MarketError.AdlNotTriggered).toBe(770);
        expect(MarketError.AdlOvershoot).toBe(771);
        expect(MarketError.AdlNotEligible).toBe(772);
    });

    it('has exactly 35 members (the full errors.rs surface, no stale codes)', () => {
        // Hand count from errors.rs: 700-706 (7) + 710 (1) + 711-715 (5)
        // + 720-723 (4) + 730-734 (5) + 740-742 (3) + 750-755 (6) + 760 (1)
        // + 770-772 (3) = 35.
        const numericValues = Object.values(MarketError).filter((value) => typeof value === 'number');
        expect(numericValues).toHaveLength(35);
    });

    it('752 means MinOutNotMet, and PendingPnlExceeded moved to 754', () => {
        expect(MarketError[752]).toBe('MinOutNotMet');
        expect(MarketError[754]).toBe('PendingPnlExceeded');
    });

    it('723 and 755 are the settlement-rail rejects added on v2 main', () => {
        expect(MarketError[723]).toBe('PositionLiquidatable');
        expect(MarketError[755]).toBe('VaultInsolvent');
    });

    it('every market code has a human-readable message', () => {
        const numericValues = Object.values(MarketError).filter(
            (value): value is number => typeof value === 'number'
        );
        for (const code of numericValues) {
            expect(marketErrorMessages[code], `message for code ${code}`).toBeTruthy();
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

    it('no ContractErrorType member sits in the market 700-772 range', () => {
        const numericValues = Object.values(ContractErrorType).filter(
            (value): value is number => typeof value === 'number'
        );
        const inMarketRange = numericValues.filter((code) => code >= 700 && code <= 772);
        expect(inMarketRange).toEqual([]);
    });

    it('the stale names are gone (v1 market, old strategy-vault 790-793, governance 770-772 aliases)', () => {
        const memberNames = ContractErrorType as unknown as Record<string, unknown>;
        expect(memberNames.MarketNotFound).toBeUndefined();
        expect(memberNames.PriceSlippage).toBeUndefined();
        expect(memberNames.LeverageAboveMaximum).toBeUndefined();
        expect(memberNames.ContractFrozen).toBeUndefined();
        expect(memberNames.SharesLocked).toBeUndefined();
        // 770-772 no longer resolve inside the merged enum (the market enum owns them)
        expect((ContractErrorType as unknown as Record<number, string>)[770]).toBeUndefined();
        expect((ContractErrorType as unknown as Record<number, string>)[771]).toBeUndefined();
        expect((ContractErrorType as unknown as Record<number, string>)[772]).toBeUndefined();
    });
});

describe('contractErrorFromCode (hint-free resolution)', () => {
    it('takes only the code (collision-hint parameter deleted)', () => {
        expect(contractErrorFromCode.length).toBe(1);
    });

    it('resolves the new market codes', () => {
        expect(contractErrorFromCode(723).type).toBe(MarketError.PositionLiquidatable);
        expect(contractErrorFromCode(733).type).toBe(MarketError.TooManyOrders);
        expect(contractErrorFromCode(734).type).toBe(MarketError.UnknownKind);
        expect(contractErrorFromCode(742).type).toBe(MarketError.TriggerNotMet);
        expect(contractErrorFromCode(752).type).toBe(MarketError.MinOutNotMet);
        expect(contractErrorFromCode(754).type).toBe(MarketError.PendingPnlExceeded);
        expect(contractErrorFromCode(755).type).toBe(MarketError.VaultInsolvent);
        expect(contractErrorFromCode(760).type).toBe(MarketError.NothingToClaim);
    });

    it('resolves 770-772 unhinted to the market ADL errors with ADL messages', () => {
        const adlNotTriggered = contractErrorFromCode(770);
        expect(adlNotTriggered.type).toBe(MarketError.AdlNotTriggered);
        expect(adlNotTriggered.message).toMatch(/ADL/);
        expect(adlNotTriggered.message).not.toMatch(/queued/i);

        expect(contractErrorFromCode(771).type).toBe(MarketError.AdlOvershoot);
        expect(contractErrorFromCode(772).type).toBe(MarketError.AdlNotEligible);
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
