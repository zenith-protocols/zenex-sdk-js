import { describe, it, expect } from 'vitest';
import * as SDK from '../src/index.js';

// =============================================================================
// Consumer-surface test: everything a package consumer should be able to
// import from the root barrel. A missing name here is a broken public API.
//
// Type-only exports (interfaces such as TradingDepositFillEvent or the removed
// TradingPositionUpdateEvent) have no runtime value, so this file asserts their
// runtime counterparts instead: the TradingEventType enum members and the
// decoder functions that produce them.
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
        expect(SDK.Status.Retired).toBe(4);
        // v2 order kinds are numeric u32 discriminants (order.rs #[repr(u32)]).
        expect(SDK.OrderKind.MarketIncrease).toBe(0);
        expect(SDK.OrderKind.LimitIncrease).toBe(1);
        expect(SDK.OrderKind.StopIncrease).toBe(2);
        expect(SDK.OrderKind.MarketDecrease).toBe(3);
        expect(SDK.OrderKind.LimitDecrease).toBe(4);
        expect(SDK.OrderKind.StopDecrease).toBe(5);
        expect(SDK.VaultOrderKind.Deposit).toBe(0);
        expect(SDK.VaultOrderKind.Redeem).toBe(1);
        expect(SDK.FULL_CLOSE).toBe(2n ** 127n - 1n);
        expect(SDK.tradingConfigToScVal).toBeTypeOf('function');
        expect(SDK.parseSidePair).toBeTypeOf('function');
        expect(SDK.parseOrder).toBeTypeOf('function');
        expect(SDK.parseVaultOrder).toBeTypeOf('function');
        expect(SDK.parsePosition).toBeTypeOf('function');
        expect(SDK.parseMarketData).toBeTypeOf('function');
        expect(SDK.parseAdlState).toBeTypeOf('function');
        expect(SDK.parseTradingConfig).toBeTypeOf('function');
        expect(SDK.validateTradingConfig).toBeTypeOf('function');
    });

    it('does not export the removed kind-to-ScVal converters', () => {
        // Kinds now cross the ABI as plain u32; the wrapper converters are gone.
        expect(
            (SDK as Record<string, unknown>).orderKindToScVal,
        ).toBeUndefined();
        expect(
            (SDK as Record<string, unknown>).vaultOrderKindToScVal,
        ).toBeUndefined();
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
        expect(SDK.impactFee).toBeTypeOf('function');
        expect(SDK.skewSplitFees).toBeTypeOf('function');
    });

    it('exports the event enums and decoders', () => {
        expect(SDK.TradingEventType.CreateOrder).toBe('create_order');
        expect(SDK.TradingEventType.CancelOrder).toBe('cancel_order');
        expect(SDK.TradingEventType.CreateVaultOrder).toBe(
            'create_vault_order',
        );
        expect(SDK.TradingEventType.CancelVaultOrder).toBe(
            'cancel_vault_order',
        );
        expect(SDK.TradingEventType.DepositFill).toBe('deposit_fill');
        expect(SDK.TradingEventType.RedeemFill).toBe('redeem_fill');
        expect(SDK.TradingEventType.CloseFill).toBe('close_fill');
        expect(SDK.TradingEventType.FundingAccrual).toBe('funding_accrual');
        expect(SDK.TradingEventType.BorrowingAccrual).toBe('borrowing_accrual');
        expect(SDK.TradingEventType.IncreaseFill).toBe('increase_fill');
        expect(SDK.TradingEventType.DecreaseFill).toBe('decrease_fill');
        expect(SDK.TradingEventType.Liquidation).toBe('liquidation');
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

    it('does not carry the removed trading event kinds', () => {
        // position_update and execute_vault_order left the contract ABI; the
        // fill receipts (deposit_fill, redeem_fill, close_fill) replace them.
        const eventTypes = SDK.TradingEventType as Record<string, unknown>;
        expect(eventTypes.PositionUpdate).toBeUndefined();
        expect(eventTypes.ExecuteVaultOrder).toBeUndefined();
        expect(Object.values(SDK.TradingEventType)).not.toContain(
            'position_update',
        );
        expect(Object.values(SDK.TradingEventType)).not.toContain(
            'execute_vault_order',
        );
    });

    it('exports the trading-router converters and parsers', () => {
        expect(SDK.callToScVal).toBeTypeOf('function');
        expect(SDK.createOrderCall).toBeTypeOf('function');
        expect(SDK.parseCallOutcome).toBeTypeOf('function');
        expect(SDK.parseFillAttempt).toBeUndefined();
        expect(SDK.adlTargetToScVal).toBeUndefined();
    });

    it('does not export the removed token approve/bundle helpers', () => {
        expect(SDK.approveCall).toBeUndefined();
        expect(SDK.approveAndOrder).toBeUndefined();
    });

    it('exports the errors and response parsing surface', () => {
        expect(SDK.ContractError).toBeTypeOf('function');
        expect(SDK.ContractErrorType.UnknownError).toBe(-1000);
        expect(SDK.TradingError.InvalidConfig).toBe(700);
        expect(SDK.TradingError.TooManyOrders).toBe(733);
        expect(SDK.TradingError.UnknownKind).toBe(734);
        expect(SDK.TradingError.MinOutNotMet).toBe(752);
        expect(SDK.TradingError.PendingPnlExceeded).toBe(754);
        expect(SDK.TradingError.AdlNotEligible).toBe(772);
        expect(SDK.ContractErrorType.PVFeedNotFound).toBe(790);
        expect(SDK.ContractErrorType.StrategyInvalidAmount).toBe(800);
        expect(SDK.ContractErrorType.GovNotQueued).toBe(810);
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
        expect(SDK.FixedMath.toFixed).toBeTypeOf('function');
        expect(SDK.FixedMath.toFloat).toBeTypeOf('function');
        expect(SDK.FixedMath.parseAtomic).toBeTypeOf('function');
        expect(SDK.FixedMath.formatAtomic).toBeTypeOf('function');
        expect(SDK.parseAtomic).toBeTypeOf('function');
        expect(SDK.formatAtomic).toBeTypeOf('function');
        expect(SDK.FixedMath.mulFloor).toBeTypeOf('function');
        expect(SDK.FixedMath.mulCeil).toBeTypeOf('function');
        expect(SDK.FixedMath.divFloor).toBeTypeOf('function');
        expect(SDK.FixedMath.divCeil).toBeTypeOf('function');
        expect(SDK.VaultState).toBeTypeOf('function');
        expect(SDK.simulateAndParse).toBeTypeOf('function');
        expect(SDK.signerToScVal).toBeTypeOf('function');
        expect(SDK.contextRuleTypeToScVal).toBeTypeOf('function');
        expect(SDK.sessionConfigToScVal).toBeTypeOf('function');
    });

    it('exports exact quote, transaction, relay, and data boundaries', () => {
        expect(SDK.quotePositionAction).toBeTypeOf('function');
        expect(SDK.quoteMarginAdjustment).toBeTypeOf('function');
        expect(SDK.quoteVaultDeposit).toBeTypeOf('function');
        expect(SDK.quoteVaultDepositFill).toBeTypeOf('function');
        expect(SDK.quoteVaultOrderCreation).toBeTypeOf('function');
        expect(SDK.quoteVaultRedeem).toBeTypeOf('function');
        expect(SDK.quoteVaultRedeemFill).toBeTypeOf('function');
        expect(SDK.deriveVaultMinimumOutput).toBeTypeOf('function');
        expect(SDK.loadTradingSnapshot).toBeTypeOf('function');
        expect(SDK.buildOrderOperation).toBeTypeOf('function');
        expect(SDK.buildVaultOrderOperation).toBeTypeOf('function');
        expect(SDK.buildVaultActionExecution).toBeTypeOf('function');
        expect(SDK.buildPositionActionExecution).toBeTypeOf('function');
        expect(SDK.buildMarginAdjustmentExecution).toBeTypeOf('function');
        expect(SDK.isIncreaseOrderKind).toBeTypeOf('function');
        expect(SDK.isDecreaseOrderKind).toBeTypeOf('function');
        expect(SDK.isMarketOrderKind).toBeTypeOf('function');
        expect(SDK.isRestingOrderKind).toBeTypeOf('function');
        expect(SDK.isTriggerOrderKind).toBeTypeOf('function');
        expect(SDK.orderKindCrossing).toBeTypeOf('function');
        expect(SDK.orderKindFiresAbove).toBeTypeOf('function');
        expect(SDK.buildRelayCallRequest).toBeTypeOf('function');
        expect(SDK.prepareRelayAuthDiscovery).toBeTypeOf('function');
        expect(SDK.extractRelayCallAuthorization).toBeTypeOf('function');
        expect(SDK.buildRelayCallRequestFromTransaction).toBeTypeOf('function');
        expect(SDK.buildPriceFreeRelayOperation).toBeTypeOf('function');
        expect(SDK.buildSmartAccountDeploymentRequest).toBeTypeOf('function');
        expect(SDK.verifySmartAccountInstance).toBeTypeOf('function');
        expect(SDK.SMART_ACCOUNT_DEPLOYMENT_MAX_TIMEOUT_SECONDS).toBe(30);
        expect(SDK.buildSingleMarketSessionRule).toBeTypeOf('function');
        expect(SDK.prepareStrictTransaction).toBeTypeOf('function');
        expect(SDK.ZenexDataClient).toBeTypeOf('function');
        expect(SDK.streamZenexEvents).toBeTypeOf('function');
        expect(SDK.executeZenexResync).toBeTypeOf('function');
        expect(SDK.createZenexTrustBundle).toBeTypeOf('function');
        expect(SDK.decodeApiSchema).toBeTypeOf('function');
        expect(SDK.decodeLatestPriceUpdate).toBeTypeOf('function');
        expect(SDK.API_VERSION).toBe('v1');
    });

    it('does not carry the removed v1 FixedMath constants', () => {
        const fixedMath = SDK.FixedMath as Record<string, unknown>;
        expect(fixedMath.SCALAR_7).toBeUndefined();
        expect(fixedMath.SCALAR_14).toBeUndefined();
        expect(fixedMath.MAX_MARKETS).toBeUndefined();
        expect(fixedMath.MAX_POSITIONS).toBeUndefined();
        expect(fixedMath.MIN_OPEN_TIME).toBeUndefined();
    });

    it('does not export the removed v1 oracle helpers', () => {
        expect((SDK as Record<string, unknown>).getOraclePrice).toBeUndefined();
        expect(
            (SDK as Record<string, unknown>).getOracleDecimals,
        ).toBeUndefined();
    });
});
