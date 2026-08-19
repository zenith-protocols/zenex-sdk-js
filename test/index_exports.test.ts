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
        expect(SDK.OracleContract).toBeTypeOf('function');
        expect(SDK.TreasuryContract).toBeTypeOf('function');
        expect(SDK.GovernanceContract).toBeTypeOf('function');
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

    it('exports the estimate tier and keeps the engine internal', () => {
        const sdk = SDK as Record<string, unknown>;
        expect(SDK.estimateMarket).toBeTypeOf('function');
        expect(SDK.estimatePosition).toBeTypeOf('function');
        expect(SDK.previewOrder).toBeTypeOf('function');
        expect(SDK.Price).toBeTypeOf('function');
        expect(SDK.MarketPosition).toBeTypeOf('function');
        // The per-position exact math lives on MarketPosition; the loose
        // engine functions stay internal.
        expect(sdk.positionPnl).toBeUndefined();
        expect(sdk.positionEquity).toBeUndefined();
        expect(sdk.pendingFunding).toBeUndefined();
        expect(sdk.quotePositionAction).toBeUndefined();
        expect(sdk.advanceMarketAccruals).toBeUndefined();
        expect(SDK.MarketPosition.prototype.pnl).toBeTypeOf('function');
        expect(SDK.MarketPosition.prototype.equity).toBeTypeOf('function');
        expect(SDK.MarketPosition.prototype.liquidationPrice).toBeTypeOf(
            'function',
        );
        expect(SDK.MarketPosition.prototype.isLiquidatable).toBeTypeOf(
            'function',
        );
        expect(SDK.MarketPosition.prototype.estimate).toBeTypeOf('function');
        expect(SDK.MarketPosition.prototype.preview).toBeTypeOf('function');
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
        expect(SDK.decodeTradingEvent).toBeUndefined();
        // Bare #[contractevent] name topics are snake_case of the struct name.
        expect(SDK.VaultEventType.Deposit).toBe('deposit');
        expect(SDK.VaultEventType.Withdraw).toBe('withdraw');
        expect(SDK.VaultEventType.StrategyWithdraw).toBe('strategy_withdraw');
        expect(SDK.decodeVaultEvent).toBeUndefined();
        expect(SDK.GovernanceEventType.Queued).toBe('queued');
        expect(SDK.GovernanceEventType.StatusSet).toBe('status_set');
        expect(SDK.decodeGovernanceEvent).toBeUndefined();
        expect(SDK.FactoryEventType.Deploy).toBe('deploy');
        expect(SDK.ZenexContractType.Trading).toBe('trading');
        // The event surface is types-only; consumers own their decode path.
        expect(SDK.decodeEvent).toBeUndefined();
        expect(SDK.normalizeRpc).toBeUndefined();
        expect(SDK.normalizeMercury).toBeUndefined();
        expect(SDK.normalizeGoldsky).toBeUndefined();
    });

    it('carries only the contract ABI event kinds', () => {
        // The fill receipts (deposit_fill, redeem_fill, close_fill) are the
        // lifecycle receipts; position_update / execute_vault_order are not
        // contract events.
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
        expect(SDK.TradingError.PositionLiquidatable).toBe(723);
        expect(SDK.TradingError.VaultInsolvent).toBe(755);
        expect(SDK.TradingError.AdlNotEligible).toBe(772);
        expect(SDK.ContractErrorType.OracleFeedMismatch).toBe(790);
        expect(SDK.ContractErrorType.OraclePriceAhead).toBe(793);
        expect(SDK.ContractErrorType.StrategyInvalidAmount).toBe(800);
        expect(SDK.ContractErrorType.GovNotQueued).toBe(810);
        expect(SDK.tradingErrorMessages[700]).toBeTypeOf('string');
        expect(SDK.contractErrorFromCode).toBeTypeOf('function');
        expect(SDK.parseContractErrorCode).toBeTypeOf('function');
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
        // The instance-tier ScVal builders are gone: parseTradingInstance
        // decodes every instance field, so the per-field keys were dead API.
        const sdk = SDK as Record<string, unknown>;
        expect(sdk.tradingConfigKey).toBeUndefined();
        expect(sdk.tradingStatusKey).toBeUndefined();
        expect(sdk.tradingAdlKey).toBeUndefined();
        expect(sdk.tradingExponentKey).toBeUndefined();
        expect(sdk.tradingPriceVerifierKey).toBeUndefined();
        expect(SDK.tradingMarketDataLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingPriceCacheLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingPositionLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingVaultOrderLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingOrderCounterLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingClaimableFundingLedgerKey).toBeTypeOf('function');
        expect(SDK.tradingOrderLedgerKey).toBeTypeOf('function');
    });

    it('exports the math and simulation helpers', () => {
        expect(SDK.FixedMath.SCALAR_18).toBe(10n ** 18n);
        expect(SDK.FixedMath.toFixed).toBeTypeOf('function');
        expect(SDK.FixedMath.toFloat).toBeTypeOf('function');
        expect(SDK.FixedMath.parseAtomic).toBeTypeOf('function');
        expect(SDK.FixedMath.formatAtomic).toBeTypeOf('function');
        expect(SDK.FixedMath.mulDivFloor).toBeTypeOf('function');
        expect(SDK.FixedMath.mulDivCeil).toBeTypeOf('function');
        expect(SDK.parseAtomic).toBeTypeOf('function');
        expect(SDK.formatAtomic).toBeTypeOf('function');
        expect(SDK.toFloat).toBeTypeOf('function');
        expect(SDK.simulateAndParse).toBeTypeOf('function');
        // Not part of the public surface:
        expect(SDK.getAssetKey).toBeUndefined();
        expect(SDK.assetFromKey).toBeUndefined();
        expect(SDK.FixedMath.mulFloor).toBeUndefined();
        expect(SDK.FixedMath.divFloor).toBeUndefined();
        expect(SDK.VaultState).toBeUndefined();
    });

    it('exports the loaded classes, intents, and order helpers', () => {
        expect(SDK.Market).toBeTypeOf('function');
        expect(SDK.MarketUser).toBeTypeOf('function');
        expect(SDK.OrderIntent).toBeTypeOf('function');
        expect(SDK.VaultOrderIntent).toBeTypeOf('function');
        expect(SDK.orderPriceBound).toBeTypeOf('function');
        expect(SDK.maxMarginForBalance).toBeTypeOf('function');
        expect(SDK.loadTokenBalance).toBeTypeOf('function');
        expect(SDK.loadTreasuryRate).toBeTypeOf('function');
        expect(SDK.loadTreasuryInstance).toBeTypeOf('function');
        expect(SDK.MarketStateError).toBeTypeOf('function');
        // The loaded-class surface.
        expect(SDK.Market.prototype.loadUser).toBeTypeOf('function');
        expect(SDK.Market.prototype.estimate).toBeTypeOf('function');
        expect(SDK.Market.prototype.accrue).toBeTypeOf('function');
        expect(SDK.Market.prototype.openCapacity).toBeTypeOf('function');
        expect(SDK.Market.prototype.assetsToShares).toBeTypeOf('function');
        expect(SDK.MarketUser.prototype.loadOrders).toBeTypeOf('function');
        expect(SDK.MarketUser.prototype.claimable).toBeTypeOf('function');
        expect(SDK.OrderIntent.prototype.openMarket).toBeTypeOf('function');
        expect(SDK.OrderIntent.prototype.closePosition).toBeTypeOf('function');
        expect(SDK.OrderIntent.prototype.stopLoss).toBeTypeOf('function');
        expect(SDK.VaultOrderIntent.create).toBeTypeOf('function');
        expect(SDK.VaultOrderIntent.prototype.fills).toBeTypeOf('function');
        expect(SDK.VaultOrderIntent.prototype.toOperation).toBeTypeOf(
            'function',
        );
        // The batching machinery is gone: no consumer ever used it.
        const sdk = SDK as Record<string, unknown>;
        expect(sdk.readEntries).toBeUndefined();
        expect(sdk.EntryBatch).toBeUndefined();
        expect(sdk.MAX_KEYS_PER_REQUEST).toBeUndefined();
        expect(sdk.marketKeys).toBeUndefined();
        expect(sdk.marketUserKeys).toBeUndefined();
        expect((SDK.Market as Record<string, unknown>).loadMany).toBeUndefined();
        expect(
            (SDK.MarketUser as Record<string, unknown>).loadMany,
        ).toBeUndefined();
        // The display module and the old execution machinery are gone.
        expect(sdk.Display).toBeUndefined();
        expect(sdk.positionDisplay).toBeUndefined();
        expect(sdk.sideRates).toBeUndefined();
        expect(sdk.fundingApr).toBeUndefined();
        expect(sdk.buildOrderOperation).toBeUndefined();
        expect(sdk.buildVaultOrderOperation).toBeUndefined();
        expect(sdk.buildVaultActionExecution).toBeUndefined();
        expect(sdk.marketContext).toBeUndefined();
        expect(SDK.isIncreaseOrderKind).toBeTypeOf('function');
        expect(SDK.isDecreaseOrderKind).toBeTypeOf('function');
        expect(SDK.isMarketOrderKind).toBeTypeOf('function');
        expect(SDK.isTriggerOrderKind).toBeTypeOf('function');
        expect(sdk.isRestingOrderKind).toBeUndefined();
        expect(sdk.orderKindCrossing).toBeUndefined();
        expect(sdk.MAX_SIGNED_PRICE_UPDATE_BYTES).toBeUndefined();
    });

    it('does not export the removed intent model', () => {
        const sdk = SDK as Record<string, unknown>;
        expect(sdk.quotePositionDecreaseIntent).toBeUndefined();
        expect(sdk.quotePositionIncreaseIntent).toBeUndefined();
        expect(sdk.quoteMaximumPositionDecreaseIntent).toBeUndefined();
        expect(sdk.quoteMaximumPositionIncreaseIntent).toBeUndefined();
        expect(sdk.quoteMarginAdjustment).toBeUndefined();
        expect(sdk.buildPositionActionExecution).toBeUndefined();
        expect(sdk.buildPositionDecreaseIntentExecution).toBeUndefined();
        expect(sdk.buildPositionIncreaseIntentExecution).toBeUndefined();
        expect(sdk.buildMarginAdjustmentExecution).toBeUndefined();
        expect(sdk.validateTradingConfig).toBeUndefined();
        expect(sdk.validateFillOrKillCalls).toBeUndefined();
        expect(sdk.POSITION_DECREASE_MAX_VALIDITY_LEDGERS).toBeUndefined();
        expect(sdk.POSITION_INCREASE_MAX_VALIDITY_LEDGERS).toBeUndefined();
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

    it('does not carry the extracted backend data and relay surface', () => {
        // The data-service client and relay request building moved to the
        // frontend-internal zenex-data lib; the SDK is chain-only.
        const sdk = SDK as Record<string, unknown>;
        expect(sdk.ZenexDataClient).toBeUndefined();
        expect(sdk.streamZenexEvents).toBeUndefined();
        expect(sdk.executeZenexResync).toBeUndefined();
        expect(sdk.createZenexTrustBundle).toBeUndefined();
        expect(sdk.decodeApiSchema).toBeUndefined();
        expect(sdk.buildRelayCallRequest).toBeUndefined();
        expect(sdk.RELAY_REQUEST_STATES).toBeUndefined();
        expect(sdk.RelaySubmissionAmbiguousError).toBeUndefined();
    });
});
