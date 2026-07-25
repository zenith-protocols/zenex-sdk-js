import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
    ContractError,
    ContractErrorType,
    TradingError,
    contractErrorFromCode,
    parseContractErrorCode,
    tradingErrorMessages,
} from '../src/errors.js';

// =============================================================================
// Error enums are hand-checked against the contract sources:
//   trading/src/errors.rs          (TradingError, 700-772)
//   price-verifier/src/error.rs    (PriceVerifierError, 780-792)
//   strategy-vault/src/strategy.rs (StrategyVaultError, 800-801)
//   governance/src/errors.rs       (GovernanceError, 810-812)
//   treasury/src/lib.rs            (TreasuryError, 900)
//   OpenZeppelin fee-abstraction   (FeeAbstractionError::InvalidFeeBounds, 5003)
// The namespaces are disjoint, so contractErrorFromCode takes no hint.
// =============================================================================

describe('TradingError (v2 trading/src/errors.rs)', () => {
    it('matches every v2 trading error code exactly', () => {
        // config / construction
        expect(TradingError.InvalidConfig).toBe(700);
        expect(TradingError.InvalidPrice).toBe(701);
        expect(TradingError.InvalidStatus).toBe(702);
        expect(TradingError.BorrowingNotAccrued).toBe(703);
        expect(TradingError.MarketFrozen).toBe(704);
        expect(TradingError.IncreaseHalted).toBe(705);
        expect(TradingError.MarketNotCleared).toBe(706);
        // general
        expect(TradingError.NegativeValueNotAllowed).toBe(710);
        // position sizing / margin
        expect(TradingError.NotionalBelowMinimum).toBe(711);
        expect(TradingError.NotionalAboveMaximum).toBe(712);
        expect(TradingError.InsufficientMargin).toBe(713);
        expect(TradingError.UtilizationExceeded).toBe(714);
        expect(TradingError.OpenInterestExceeded).toBe(715);
        // position lifecycle
        expect(TradingError.PositionNotFound).toBe(720);
        expect(TradingError.NotionalLocked).toBe(721);
        expect(TradingError.NotLiquidatable).toBe(722);
        // orders / price
        expect(TradingError.OrderNotFound).toBe(730);
        expect(TradingError.OrderExpired).toBe(731);
        expect(TradingError.InvalidOrder).toBe(732);
        expect(TradingError.TooManyOrders).toBe(733);
        expect(TradingError.UnknownKind).toBe(734);
        expect(TradingError.StalePrice).toBe(740);
        expect(TradingError.PriceBoundExceeded).toBe(741);
        expect(TradingError.TriggerNotMet).toBe(742);
        // vault orders
        expect(TradingError.VaultOrderNotFound).toBe(750);
        expect(TradingError.VaultOrderLocked).toBe(751);
        expect(TradingError.MinOutNotMet).toBe(752);
        expect(TradingError.VaultBalanceExceeded).toBe(753);
        expect(TradingError.PendingPnlExceeded).toBe(754);
        // funding
        expect(TradingError.NothingToClaim).toBe(760);
        // ADL
        expect(TradingError.AdlNotTriggered).toBe(770);
        expect(TradingError.AdlOvershoot).toBe(771);
        expect(TradingError.AdlNotEligible).toBe(772);
    });

    it('has exactly 33 members (the full errors.rs surface, no stale codes)', () => {
        // Hand count from errors.rs: 700-706 (7) + 710 (1) + 711-715 (5)
        // + 720-722 (3) + 730-734 (5) + 740-742 (3) + 750-754 (5) + 760 (1)
        // + 770-772 (3) = 33.
        const numericValues = Object.values(TradingError).filter((value) => typeof value === 'number');
        expect(numericValues).toHaveLength(33);
    });

    it('752 means MinOutNotMet, and PendingPnlExceeded moved to 754', () => {
        expect(TradingError[752]).toBe('MinOutNotMet');
        expect(TradingError[754]).toBe('PendingPnlExceeded');
    });

    it('every trading code has a human-readable message', () => {
        const numericValues = Object.values(TradingError).filter(
            (value): value is number => typeof value === 'number'
        );
        for (const code of numericValues) {
            expect(tradingErrorMessages[code], `message for code ${code}`).toBeTruthy();
        }
    });
});

describe('ContractErrorType periphery codes (v2 contracts)', () => {
    it('price-verifier covers 780-792 including the feed-anchor pair', () => {
        expect(ContractErrorType.PVInvalidData).toBe(780);
        expect(ContractErrorType.PVInvalidPrice).toBe(781);
        expect(ContractErrorType.PVPriceStale).toBe(782);
        expect(ContractErrorType.PVInvalidStaleness).toBe(783);
        expect(ContractErrorType.PVTruncatedData).toBe(784);
        expect(ContractErrorType.PVInvalidPayloadLength).toBe(785);
        expect(ContractErrorType.PVInvalidPayloadMagic).toBe(786);
        expect(ContractErrorType.PVInvalidChannel).toBe(787);
        expect(ContractErrorType.PVInvalidProperty).toBe(788);
        expect(ContractErrorType.PVInvalidMarketSession).toBe(789);
        expect(ContractErrorType.PVFeedNotFound).toBe(790);
        expect(ContractErrorType.PVWrongExponent).toBe(791);
        expect(ContractErrorType.PVInvalidConfidence).toBe(792);
    });

    it('fee-abstraction InvalidFeeBounds is 5003 (OpenZeppelin, not a Zenex contract)', () => {
        expect(ContractErrorType.FeeAbstractionInvalidFeeBounds).toBe(5003);
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

    it('no ContractErrorType member sits in the trading 700-772 range', () => {
        const numericValues = Object.values(ContractErrorType).filter(
            (value): value is number => typeof value === 'number'
        );
        const inTradingRange = numericValues.filter((code) => code >= 700 && code <= 772);
        expect(inTradingRange).toEqual([]);
    });

    it('the stale names are gone (v1 trading, old strategy-vault 790-793, governance 770-772 aliases)', () => {
        const memberNames = ContractErrorType as unknown as Record<string, unknown>;
        expect(memberNames.MarketNotFound).toBeUndefined();
        expect(memberNames.PriceSlippage).toBeUndefined();
        expect(memberNames.LeverageAboveMaximum).toBeUndefined();
        expect(memberNames.ContractFrozen).toBeUndefined();
        expect(memberNames.SharesLocked).toBeUndefined();
        // 770-772 no longer resolve inside the merged enum (trading owns them)
        expect((ContractErrorType as unknown as Record<number, string>)[770]).toBeUndefined();
        expect((ContractErrorType as unknown as Record<number, string>)[771]).toBeUndefined();
        expect((ContractErrorType as unknown as Record<number, string>)[772]).toBeUndefined();
    });
});

describe('contractErrorFromCode (hint-free resolution)', () => {
    it('takes only the code (collision-hint parameter deleted)', () => {
        expect(contractErrorFromCode.length).toBe(1);
    });

    it('resolves the new trading codes', () => {
        expect(contractErrorFromCode(733).type).toBe(TradingError.TooManyOrders);
        expect(contractErrorFromCode(734).type).toBe(TradingError.UnknownKind);
        expect(contractErrorFromCode(742).type).toBe(TradingError.TriggerNotMet);
        expect(contractErrorFromCode(752).type).toBe(TradingError.MinOutNotMet);
        expect(contractErrorFromCode(754).type).toBe(TradingError.PendingPnlExceeded);
        expect(contractErrorFromCode(760).type).toBe(TradingError.NothingToClaim);
    });

    it('resolves 770-772 unhinted to the trading ADL errors with ADL messages', () => {
        const adlNotTriggered = contractErrorFromCode(770);
        expect(adlNotTriggered.type).toBe(TradingError.AdlNotTriggered);
        expect(adlNotTriggered.message).toMatch(/ADL/);
        expect(adlNotTriggered.message).not.toMatch(/queued/i);

        expect(contractErrorFromCode(771).type).toBe(TradingError.AdlOvershoot);
        expect(contractErrorFromCode(772).type).toBe(TradingError.AdlNotEligible);
    });

    it('resolves governance 810-812 with the queue/timelock messages', () => {
        const notQueued = contractErrorFromCode(810);
        expect(notQueued.type).toBe(ContractErrorType.GovNotQueued);
        expect(notQueued.message).toMatch(/queued/i);
        expect(notQueued.message).not.toMatch(/ADL/);

        expect(contractErrorFromCode(811).type).toBe(ContractErrorType.GovNotUnlocked);
        expect(contractErrorFromCode(812).type).toBe(ContractErrorType.GovInvalidDelay);
    });

    it('resolves strategy-vault 800-801 and price-verifier 790-792', () => {
        expect(contractErrorFromCode(800).type).toBe(ContractErrorType.StrategyInvalidAmount);
        expect(contractErrorFromCode(801).type).toBe(ContractErrorType.StrategyPnlExceedsAssets);
        expect(contractErrorFromCode(790).type).toBe(ContractErrorType.PVFeedNotFound);
        expect(contractErrorFromCode(791).type).toBe(ContractErrorType.PVWrongExponent);
        expect(contractErrorFromCode(792).type).toBe(ContractErrorType.PVInvalidConfidence);
        expect(contractErrorFromCode(792).message).toBe(
            'Price confidence bound rejects every feed'
        );
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
