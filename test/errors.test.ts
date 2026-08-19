import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
    ZenexError,
    ZenexErrorCode,
    zenexErrorFromCode,
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
// The namespaces are disjoint, so zenexErrorFromCode takes no hint and
// every code lives in the one flat ZenexErrorCode enum. UpgradeNotOwner
// (600) is one shared code raised identically by market, oracle and factory,
// so the bare code still names one condition.
// =============================================================================

describe('market codes inside ZenexErrorCode (market/src/errors.rs)', () => {
    it('matches every v2 market error code exactly', () => {
        // config / construction
        expect(ZenexErrorCode.InvalidConfig).toBe(700);
        expect(ZenexErrorCode.InvalidPrice).toBe(701);
        expect(ZenexErrorCode.InvalidStatus).toBe(702);
        expect(ZenexErrorCode.MarketNotAccrued).toBe(703);
        expect(ZenexErrorCode.MarketFrozen).toBe(704);
        expect(ZenexErrorCode.IncreaseHalted).toBe(705);
        expect(ZenexErrorCode.MarketNotCleared).toBe(706);
        // general
        expect(ZenexErrorCode.NegativeValueNotAllowed).toBe(710);
        // position sizing / margin
        expect(ZenexErrorCode.NotionalBelowMinimum).toBe(711);
        expect(ZenexErrorCode.NotionalAboveMaximum).toBe(712);
        expect(ZenexErrorCode.InsufficientMargin).toBe(713);
        expect(ZenexErrorCode.UtilizationExceeded).toBe(714);
        expect(ZenexErrorCode.OpenInterestExceeded).toBe(715);
        // position lifecycle
        expect(ZenexErrorCode.PositionNotFound).toBe(720);
        expect(ZenexErrorCode.NotionalLocked).toBe(721);
        expect(ZenexErrorCode.NotLiquidatable).toBe(722);
        expect(ZenexErrorCode.PositionLiquidatable).toBe(723);
        // orders / price
        expect(ZenexErrorCode.OrderNotFound).toBe(730);
        expect(ZenexErrorCode.OrderExpired).toBe(731);
        expect(ZenexErrorCode.InvalidOrder).toBe(732);
        expect(ZenexErrorCode.TooManyOrders).toBe(733);
        expect(ZenexErrorCode.UnknownKind).toBe(734);
        expect(ZenexErrorCode.StalePrice).toBe(740);
        expect(ZenexErrorCode.PriceBoundExceeded).toBe(741);
        expect(ZenexErrorCode.TriggerNotMet).toBe(742);
        // vault orders
        expect(ZenexErrorCode.VaultOrderNotFound).toBe(750);
        expect(ZenexErrorCode.VaultOrderLocked).toBe(751);
        expect(ZenexErrorCode.MinOutNotMet).toBe(752);
        expect(ZenexErrorCode.VaultBalanceExceeded).toBe(753);
        expect(ZenexErrorCode.PendingPnlExceeded).toBe(754);
        expect(ZenexErrorCode.VaultInsolvent).toBe(755);
        // funding
        expect(ZenexErrorCode.NothingToClaim).toBe(760);
        // ADL
        expect(ZenexErrorCode.AdlNotTriggered).toBe(770);
        expect(ZenexErrorCode.AdlOvershoot).toBe(771);
        expect(ZenexErrorCode.AdlNotEligible).toBe(772);
    });

    it('carries exactly 35 market members (the full errors.rs surface, no stale codes)', () => {
        // Hand count from errors.rs: 700-706 (7) + 710 (1) + 711-715 (5)
        // + 720-723 (4) + 730-734 (5) + 740-742 (3) + 750-755 (6) + 760 (1)
        // + 770-772 (3) = 35.
        const marketCodes = Object.values(ZenexErrorCode).filter(
            (value): value is number =>
                typeof value === 'number' && value >= 700 && value <= 772,
        );
        expect(marketCodes).toHaveLength(35);
    });

    it('752 means MinOutNotMet, and PendingPnlExceeded moved to 754', () => {
        expect(ZenexErrorCode[752]).toBe('MinOutNotMet');
        expect(ZenexErrorCode[754]).toBe('PendingPnlExceeded');
    });

    it('723 and 755 are the settlement-rail rejects added on v2 main', () => {
        expect(ZenexErrorCode[723]).toBe('PositionLiquidatable');
        expect(ZenexErrorCode[755]).toBe('VaultInsolvent');
    });

    it('every market code resolves with a human-readable message', () => {
        const marketCodes = Object.values(ZenexErrorCode).filter(
            (value): value is number =>
                typeof value === 'number' && value >= 700 && value <= 772,
        );
        for (const code of marketCodes) {
            expect(
                zenexErrorFromCode(code).message,
                `message for code ${code}`,
            ).not.toBe(`Contract error ${code}`);
        }
    });
});

describe('ZenexErrorCode periphery codes (v2 contracts)', () => {
    it('oracle covers the OracleError set (780-785, 790, 793)', () => {
        expect(ZenexErrorCode.OracleInvalidData).toBe(780);
        expect(ZenexErrorCode.OracleInvalidPrice).toBe(781);
        expect(ZenexErrorCode.OraclePriceStale).toBe(782);
        expect(ZenexErrorCode.OracleInvalidStaleness).toBe(783);
        expect(ZenexErrorCode.OracleReportExpired).toBe(784);
        expect(ZenexErrorCode.OracleInvalidSpreadReduction).toBe(785);
        expect(ZenexErrorCode.OracleFeedMismatch).toBe(790);
        expect(ZenexErrorCode.OraclePriceAhead).toBe(793);
    });

    it('the retired Lazer price-verifier codes are gone (786-789, 791, 792)', () => {
        const memberNames = ZenexErrorCode as unknown as Record<string, unknown>;
        expect(memberNames.PVInvalidData).toBeUndefined();
        expect(memberNames.PVTruncatedData).toBeUndefined();
        expect(memberNames.PVWrongExponent).toBeUndefined();
        expect(memberNames.PVInvalidConfidence).toBeUndefined();
        const byCode = ZenexErrorCode as unknown as Record<number, string>;
        for (const code of [786, 787, 788, 789, 791, 792]) {
            expect(byCode[code], `code ${code}`).toBeUndefined();
            expect(zenexErrorFromCode(code).code).toBe(ZenexErrorCode.UnknownError);
        }
    });

    it('fee-abstraction covers the FeeAbstractionError set (5000-5006, OpenZeppelin)', () => {
        expect(ZenexErrorCode.FeeTokenNotAllowed).toBe(5000);
        expect(ZenexErrorCode.FeeTokenAlreadyAllowed).toBe(5001);
        expect(ZenexErrorCode.TokenCountOverflow).toBe(5002);
        expect(ZenexErrorCode.FeeAbstractionInvalidFeeBounds).toBe(5003);
        expect(ZenexErrorCode.NoTokensToSweep).toBe(5004);
        expect(ZenexErrorCode.FeeAbstractionInvalidUser).toBe(5005);
        expect(ZenexErrorCode.FeeAbstractionInvalidExpirationLedger).toBe(5006);
    });

    it('UpgradeNotOwner is the one shared admin code (600), out of the token 1xx domain', () => {
        expect(ZenexErrorCode.UpgradeNotOwner).toBe(600);
        expect(zenexErrorFromCode(600).code).toBe(ZenexErrorCode.UpgradeNotOwner);
        // The token domain keeps 100-102; a bare code cannot be ambiguous.
        expect(zenexErrorFromCode(100).code).toBe(ZenexErrorCode.InsufficientBalance);
        expect(zenexErrorFromCode(102).code).toBe(ZenexErrorCode.InvalidLiveUntilLedger);
    });

    it('ownable and role-transfer cover the OpenZeppelin sets (2100-2102, 2200-2203)', () => {
        expect(ZenexErrorCode.OwnerNotSet).toBe(2100);
        expect(ZenexErrorCode.OwnershipTransferInProgress).toBe(2101);
        expect(ZenexErrorCode.OwnerAlreadySet).toBe(2102);
        expect(ZenexErrorCode.NoPendingTransfer).toBe(2200);
        expect(ZenexErrorCode.TransferInvalidLiveUntilLedger).toBe(2201);
        expect(ZenexErrorCode.InvalidPendingAccount).toBe(2202);
        expect(ZenexErrorCode.TransferExpired).toBe(2203);
    });

    it('strategy-vault is the 800-801 pair from strategy.rs', () => {
        expect(ZenexErrorCode.StrategyInvalidAmount).toBe(800);
        expect(ZenexErrorCode.StrategyPnlExceedsAssets).toBe(801);
    });

    it('governance moved to 810-812 per governance/src/errors.rs', () => {
        expect(ZenexErrorCode.GovNotQueued).toBe(810);
        expect(ZenexErrorCode.GovNotUnlocked).toBe(811);
        expect(ZenexErrorCode.GovInvalidDelay).toBe(812);
    });

    it('treasury InvalidRate stays at 900', () => {
        expect(ZenexErrorCode.TreasuryInvalidRate).toBe(900);
    });

    it('the market 700-772 range lives inside the one flat enum', () => {
        expect(ZenexErrorCode[700]).toBe('InvalidConfig');
        expect(ZenexErrorCode[772]).toBe('AdlNotEligible');
    });

    it('the stale names are gone (v1 market, old strategy-vault 790-793, governance 770-772 aliases)', () => {
        const memberNames = ZenexErrorCode as unknown as Record<string, unknown>;
        expect(memberNames.MarketNotFound).toBeUndefined();
        expect(memberNames.PriceSlippage).toBeUndefined();
        expect(memberNames.LeverageAboveMaximum).toBeUndefined();
        expect(memberNames.ContractFrozen).toBeUndefined();
        expect(memberNames.SharesLocked).toBeUndefined();
        // 770-772 are the market ADL codes, not the old governance aliases
        expect(ZenexErrorCode[770]).toBe('AdlNotTriggered');
        expect(ZenexErrorCode[771]).toBe('AdlOvershoot');
        expect(ZenexErrorCode[772]).toBe('AdlNotEligible');
    });
});

describe('zenexErrorFromCode (hint-free resolution)', () => {
    it('takes only the code (collision-hint parameter deleted)', () => {
        expect(zenexErrorFromCode.length).toBe(1);
    });

    it('resolves the new market codes', () => {
        expect(zenexErrorFromCode(723).code).toBe(ZenexErrorCode.PositionLiquidatable);
        expect(zenexErrorFromCode(733).code).toBe(ZenexErrorCode.TooManyOrders);
        expect(zenexErrorFromCode(734).code).toBe(ZenexErrorCode.UnknownKind);
        expect(zenexErrorFromCode(742).code).toBe(ZenexErrorCode.TriggerNotMet);
        expect(zenexErrorFromCode(752).code).toBe(ZenexErrorCode.MinOutNotMet);
        expect(zenexErrorFromCode(754).code).toBe(ZenexErrorCode.PendingPnlExceeded);
        expect(zenexErrorFromCode(755).code).toBe(ZenexErrorCode.VaultInsolvent);
        expect(zenexErrorFromCode(760).code).toBe(ZenexErrorCode.NothingToClaim);
    });

    it('resolves 770-772 unhinted to the market ADL errors with ADL messages', () => {
        const adlNotTriggered = zenexErrorFromCode(770);
        expect(adlNotTriggered.code).toBe(ZenexErrorCode.AdlNotTriggered);
        expect(adlNotTriggered.message).toMatch(/ADL/);
        expect(adlNotTriggered.message).not.toMatch(/queued/i);

        expect(zenexErrorFromCode(771).code).toBe(ZenexErrorCode.AdlOvershoot);
        expect(zenexErrorFromCode(772).code).toBe(ZenexErrorCode.AdlNotEligible);
    });

    it('resolves governance 810-812 with the queue/timelock messages', () => {
        const notQueued = zenexErrorFromCode(810);
        expect(notQueued.code).toBe(ZenexErrorCode.GovNotQueued);
        expect(notQueued.message).toMatch(/queued/i);
        expect(notQueued.message).not.toMatch(/ADL/);

        expect(zenexErrorFromCode(811).code).toBe(ZenexErrorCode.GovNotUnlocked);
        expect(zenexErrorFromCode(812).code).toBe(ZenexErrorCode.GovInvalidDelay);
    });

    it('resolves strategy-vault 800-801 and the oracle feed/clock pair 790/793', () => {
        expect(zenexErrorFromCode(800).code).toBe(ZenexErrorCode.StrategyInvalidAmount);
        expect(zenexErrorFromCode(801).code).toBe(ZenexErrorCode.StrategyPnlExceedsAssets);
        expect(zenexErrorFromCode(790).code).toBe(ZenexErrorCode.OracleFeedMismatch);
        expect(zenexErrorFromCode(790).message).toBe(
            'Report prices a different stream than the feed anchor'
        );
        expect(zenexErrorFromCode(793).code).toBe(ZenexErrorCode.OraclePriceAhead);
    });

    it('describes 782/783/793 in two-tier staleness terms (contracts #169)', () => {
        // 782 fires against whichever window the call selected, so the message
        // must not imply a single global threshold.
        const stale = zenexErrorFromCode(782).message;
        expect(stale).toMatch(/trade_staleness/);
        expect(stale).toMatch(/close_staleness/);

        // 783 pins both halves of the validity rule: the trade window's own
        // bounds and the ordering against the close window.
        const bounds = zenexErrorFromCode(783).message;
        expect(bounds).toMatch(/3 <= trade_staleness <= 15/);
        expect(bounds).toMatch(/trade_staleness <= close_staleness <= 120/);

        // The forward allowance never widens with the call class — quoting the
        // close window here would misdescribe the gate.
        const ahead = zenexErrorFromCode(793).message;
        expect(ahead).toMatch(/trade_staleness ahead/);
        expect(ahead).not.toMatch(/close_staleness ahead/);
    });

    it('resolves the Chainlink report rejects 784/785 with their new meanings', () => {
        expect(zenexErrorFromCode(784).code).toBe(ZenexErrorCode.OracleReportExpired);
        expect(zenexErrorFromCode(784).message).toBe(
            'Ledger clock has passed the report expiresAt'
        );
        expect(zenexErrorFromCode(785).code).toBe(
            ZenexErrorCode.OracleInvalidSpreadReduction
        );
        expect(zenexErrorFromCode(785).message).not.toMatch(/payload|trailing/i);
    });

    it('resolves fee-abstraction 5003 with the relay fee-bounds message', () => {
        const error = zenexErrorFromCode(5003);
        expect(error.code).toBe(ZenexErrorCode.FeeAbstractionInvalidFeeBounds);
        expect(error.message).toBe('Relayer fee is outside the signed fee bounds');
    });

    it('falls back to UnknownError for codes in no namespace', () => {
        expect(zenexErrorFromCode(999).code).toBe(ZenexErrorCode.UnknownError);
        expect(zenexErrorFromCode(0).code).toBe(ZenexErrorCode.UnknownError);
        expect(zenexErrorFromCode(707).code).toBe(ZenexErrorCode.UnknownError);
    });

    it('returns ZenexError instances carrying the numeric code', () => {
        const error = zenexErrorFromCode(741);
        expect(error).toBeInstanceOf(ZenexError);
        expect(error.code).toBe(741);
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
