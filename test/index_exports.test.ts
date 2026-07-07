import { describe, it, expect } from 'vitest';
import * as SDK from '../src/index.js';

// =============================================================================
// Consumer-surface test: everything a package consumer should be able to
// import from the root barrel. A missing name here is a broken public API.
// =============================================================================

describe('package root exports', () => {
    it('exports every contract class', () => {
        expect(SDK.TradingContract).toBeTypeOf('function');
        expect(SDK.TradingRouterContract).toBeTypeOf('function');
        expect(SDK.FactoryContract).toBeTypeOf('function');
        expect(SDK.VaultContract).toBeTypeOf('function');
        expect(SDK.PriceVerifierContract).toBeTypeOf('function');
        expect(SDK.TreasuryContract).toBeTypeOf('function');
        expect(SDK.GovernanceContract).toBeTypeOf('function');
        expect(SDK.SmartAccountContract).toBeTypeOf('function');
    });

    it('exports the trading enums, sentinels, converters, and parsers', () => {
        expect(SDK.Status.Active).toBe(0);
        expect(SDK.OrderKind.Increase).toBe('Increase');
        expect(SDK.VaultOrderKind.Redeem).toBe('Redeem');
        expect(SDK.FULL_CLOSE).toBe(2n ** 127n - 1n);
        expect(SDK.orderKindToScVal).toBeTypeOf('function');
        expect(SDK.vaultOrderKindToScVal).toBeTypeOf('function');
        expect(SDK.tradingConfigToScVal).toBeTypeOf('function');
        expect(SDK.parseOrder).toBeTypeOf('function');
        expect(SDK.parseVaultOrder).toBeTypeOf('function');
        expect(SDK.parsePosition).toBeTypeOf('function');
        expect(SDK.parseMarketData).toBeTypeOf('function');
        expect(SDK.parseAdlState).toBeTypeOf('function');
        expect(SDK.parseTradingConfig).toBeTypeOf('function');
        expect(SDK.validateTradingConfig).toBeTypeOf('function');
    });

    it('exports the trading math helpers and loaders', () => {
        expect(SDK.PositionView).toBeTypeOf('function');
        expect(SDK.MarketView).toBeTypeOf('function');
        expect(SDK.positionPnl).toBeTypeOf('function');
        expect(SDK.positionEquity).toBeTypeOf('function');
        expect(SDK.pendingFunding).toBeTypeOf('function');
        expect(SDK.pendingBorrowing).toBeTypeOf('function');
        expect(SDK.liquidationPrice).toBeTypeOf('function');
        expect(SDK.unlockedNotional).toBeTypeOf('function');
        expect(SDK.sidePnl).toBeTypeOf('function');
        expect(SDK.netPnl).toBeTypeOf('function');
        expect(SDK.utilization).toBeTypeOf('function');
        expect(SDK.skewSplitFees).toBeTypeOf('function');
    });

    it('exports the event enums and decoders', () => {
        expect(SDK.TradingEventType.CreateOrder).toBe('create_order');
        expect(SDK.TradingEventType.PositionUpdate).toBe('position_update');
        expect(SDK.decodeTradingEvent).toBeTypeOf('function');
        expect(SDK.VaultEventType.StrategyWithdraw).toBe('StrategyWithdraw');
        expect(SDK.decodeVaultEvent).toBeTypeOf('function');
        expect(SDK.GovernanceEventType.Queued).toBe('Queued');
        expect(SDK.decodeGovernanceEvent).toBeTypeOf('function');
        expect(SDK.ZenexContractType.Trading).toBe('trading');
        expect(SDK.decodeEvent).toBeTypeOf('function');
        expect(SDK.normalizeRpc).toBeTypeOf('function');
        expect(SDK.normalizeMercury).toBeTypeOf('function');
        expect(SDK.normalizeGoldsky).toBeTypeOf('function');
    });

    it('exports the trading-router converters and parsers', () => {
        expect(SDK.callToScVal).toBeTypeOf('function');
        expect(SDK.adlTargetToScVal).toBeTypeOf('function');
        expect(SDK.parseCallOutcome).toBeTypeOf('function');
        expect(SDK.parseFillAttempt).toBeTypeOf('function');
    });

    it('exports the token approve/bundle helpers', () => {
        expect(SDK.approveCall).toBeTypeOf('function');
        expect(SDK.approveAndOrder).toBeTypeOf('function');
    });

    it('exports the errors and response parsing surface', () => {
        expect(SDK.ContractError).toBeTypeOf('function');
        expect(SDK.ContractErrorType.UnknownError).toBe(-1000);
        expect(SDK.TradingError.InvalidConfig).toBe(700);
        expect(SDK.TradingError.AdlNotEligible).toBe(772);
        expect(SDK.tradingErrorMessages[700]).toBeTypeOf('string');
        expect(SDK.contractErrorFromCode).toBeTypeOf('function');
        expect(SDK.parseError).toBeTypeOf('function');
        expect(SDK.parseResult).toBeTypeOf('function');
    });

    it('exports the ledger key builders', () => {
        expect(SDK.enumStorageKeyWithAddress).toBeTypeOf('function');
        expect(SDK.tokenBalanceLedgerKey).toBeTypeOf('function');
        expect(SDK.decodeEntryKey).toBeTypeOf('function');
        expect(SDK.contractInstanceLedgerKey).toBeTypeOf('function');
        expect(SDK.persistentLedgerKey).toBeTypeOf('function');
        expect(SDK.temporaryLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingConfigKey).toBeTypeOf('function');
        expect(SDK.tradingFeedIdKey).toBeTypeOf('function');
        expect(SDK.tradingExponentKey).toBeTypeOf('function');
        expect(SDK.tradingStatusKey).toBeTypeOf('function');
        expect(SDK.tradingVaultKey).toBeTypeOf('function');
        expect(SDK.tradingTokenKey).toBeTypeOf('function');
        expect(SDK.tradingPriceVerifierKey).toBeTypeOf('function');
        expect(SDK.tradingTreasuryKey).toBeTypeOf('function');
        expect(SDK.tradingDelistedAtKey).toBeTypeOf('function');
        expect(SDK.tradingTerminalPriceKey).toBeTypeOf('function');
        expect(SDK.tradingAdlKey).toBeTypeOf('function');
        expect(SDK.tradingMarketDataLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingPositionLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingVaultOrderLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingOrderCounterLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingClaimableFundingLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingOrderLedgerKey).toBeTypeOf('function');
    });

    it('exports the asset, math, vault-state, and simulation helpers', () => {
        expect(SDK.getAssetKey).toBeTypeOf('function');
        expect(SDK.getAssetName).toBeTypeOf('function');
        expect(SDK.assetsEqual).toBeTypeOf('function');
        expect(SDK.assetToScVal).toBeTypeOf('function');
        expect(SDK.assetFromScVal).toBeTypeOf('function');
        expect(SDK.assetFromKey).toBeTypeOf('function');
        expect(SDK.FixedMath.SCALAR_18).toBe(10n ** 18n);
        expect(SDK.VaultState).toBeTypeOf('function');
        expect(SDK.simulateAndParse).toBeTypeOf('function');
        expect(SDK.signerToScVal).toBeTypeOf('function');
        expect(SDK.contextRuleTypeToScVal).toBeTypeOf('function');
        expect(SDK.sessionConfigToScVal).toBeTypeOf('function');
    });

    it('does not export the removed v1 oracle helpers', () => {
        expect((SDK as Record<string, unknown>).getOraclePrice).toBeUndefined();
        expect((SDK as Record<string, unknown>).getOracleDecimals).toBeUndefined();
    });
});
