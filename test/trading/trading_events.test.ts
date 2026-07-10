import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, Address, StrKey } from '@stellar/stellar-sdk';
import { normalizeRpc, NormalizedEvent } from '../../src/base_event.js';
import {
    TradingEventType,
    decodeTradingEvent,
    TradingCreateOrderEvent,
    TradingCancelOrderEvent,
    TradingCreateVaultOrderEvent,
    TradingCancelVaultOrderEvent,
    TradingDepositFillEvent,
    TradingRedeemFillEvent,
    TradingClaimFundingEvent,
    TradingAdlUpdateEvent,
    TradingFundingAccrualEvent,
    TradingBorrowingAccrualEvent,
    TradingStatusUpdateEvent,
    TradingConfigUpdateEvent,
    TradingTerminalPriceUpdateEvent,
    TradingIncreaseFillEvent,
    TradingDecreaseFillEvent,
    TradingCloseFillEvent,
    TradingLiquidationEvent,
} from '../../src/trading/trading_events.js';
import { OrderKind, VaultOrderKind, Status } from '../../src/trading/trading_types.js';

// =============================================================================
// Full wire round-trip matrix for the 17 `trading/src/events.rs` events.
//
// Every fixture is a hand-built XDR event: topics are
// `[scvSymbol(<snake_case event name>), ...#[topic] fields in declaration
// order]` and the data payload is an ScMap of the remaining fields with
// alphabetically sorted symbol keys, exactly what soroban-sdk 25.3's
// `#[contractevent]` default (`DataFormat::Map`) emits on chain. The event
// is base64-encoded, pushed through `normalizeRpc` (the RPC ingestion path),
// and only then decoded, so the assertions cover the XDR encode -> normalize
// -> decode pipeline end to end.
//
// Market conventions for the receipt vectors (repo test data): settlement
// token 7 decimals, oracle exponent -8 (price_scalar = 1e8), base-dec =
// 10^(18 + 7 - 8) = 10^17, so 1 BTC = 10^17 base units and $100,000 =
// 10_000_000_000_000 price units. Every derived field below is computed by
// hand from those units, never copied from SDK or contract output.
// =============================================================================

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));

const symbolVal = (name: string) => xdr.ScVal.scvSymbol(name);
const i128Val = (value: bigint) => nativeToScVal(value, { type: 'i128' });
const u64Val = (value: bigint) => nativeToScVal(value, { type: 'u64' });
const u32Val = (value: number) => xdr.ScVal.scvU32(value);
const boolVal = (value: boolean) => xdr.ScVal.scvBool(value);
const addressVal = (strkey: string) => Address.fromString(strkey).toScVal();

/**
 * Build an ScMap with alphabetically sorted symbol keys, mirroring both the
 * `#[contractevent]` data map and `#[contracttype]` struct encoding.
 */
function sortedScMap(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
    const sorted = [...entries].sort(([keyA], [keyB]) => (keyA < keyB ? -1 : 1));
    return xdr.ScVal.scvMap(
        sorted.map(([key, val]) => new xdr.ScMapEntry({ key: symbolVal(key), val })),
    );
}

/** Encode topics + data to base64 XDR, normalize via the RPC path, and return the intermediate. */
function normalizedFromWire(topics: xdr.ScVal[], data: xdr.ScVal): NormalizedEvent {
    const rawRpcEvent = {
        type: 'contract' as const,
        contractId: CONTRACT_ID,
        id: '0007-3',
        ledger: 4242,
        ledgerClosedAt: '2026-07-10T00:00:00Z',
        txHash: 'feedface',
        topic: topics.map((topic) => topic.toXDR('base64')),
        value: data.toXDR('base64'),
        pagingToken: '1',
        inSuccessfulContractCall: true,
    };
    const normalized = normalizeRpc(rawRpcEvent as never);
    expect(normalized).toBeDefined();
    return normalized!;
}

/** Round-trip helper: wire-encode, normalize, decode. */
function decodeFromWire(topics: xdr.ScVal[], data: xdr.ScVal) {
    return decodeTradingEvent(normalizedFromWire(topics, data));
}

describe('trading_events wire round-trip', () => {
    // -------------------------------------------------------------------------
    // Order lifecycle: fat create events, topics-only cancel events
    // -------------------------------------------------------------------------

    it('decodes create_order with the full stored Order row', () => {
        // A take-profit on a long: LimitDecrease (discriminant 4) triggering at
        // $105,000 = 10_500_000_000_000 price units with a $104,500 bound.
        const orderRow = sortedScMap([
            ['is_long', boolVal(true)],
            ['kind', u32Val(4)],
            ['notional', i128Val(4_000_000_000n)],
            ['collateral', i128Val(500_000_000n)],
            ['trigger_price', i128Val(10_500_000_000_000n)],
            ['price_bound', i128Val(10_450_000_000_000n)],
            ['exec_fee', i128Val(2_000_000n)],
            ['created_at', u64Val(1_759_999_000n)],
            ['expiration', u32Val(123_456)],
        ]);
        const decoded = decodeFromWire(
            [symbolVal('create_order'), addressVal(USER), u32Val(7)],
            sortedScMap([['order', orderRow]]),
        ) as TradingCreateOrderEvent;

        expect(decoded.eventType).toBe(TradingEventType.CreateOrder);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(7);
        expect(decoded.order.isLong).toBe(true);
        expect(decoded.order.kind).toBe(OrderKind.LimitDecrease);
        expect(decoded.order.notional).toBe(4_000_000_000n);
        expect(decoded.order.collateral).toBe(500_000_000n);
        expect(decoded.order.triggerPrice).toBe(10_500_000_000_000n);
        expect(decoded.order.priceBound).toBe(10_450_000_000_000n);
        expect(decoded.order.execFee).toBe(2_000_000n);
        expect(decoded.order.createdAt).toBe(1_759_999_000n);
        expect(decoded.order.expiration).toBe(123_456);
        // Envelope propagation from the raw RPC event.
        expect(decoded.contractId).toBe(CONTRACT_ID);
        expect(decoded.ledger).toBe(4242);
        expect(decoded.ledgerClosedAt).toBe('2026-07-10T00:00:00Z');
        expect(decoded.txHash).toBe('feedface');
        expect(decoded.id).toBe('0007-3');
    });

    it('decodes cancel_order as topics-only with an empty data map', () => {
        const decoded = decodeFromWire(
            [symbolVal('cancel_order'), addressVal(USER), u32Val(3)],
            sortedScMap([]),
        ) as TradingCancelOrderEvent;

        expect(decoded.eventType).toBe(TradingEventType.CancelOrder);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(3);
    });

    it('decodes create_vault_order with the full stored VaultOrder row', () => {
        // A redeem: 500 shares (7-dec) escrowed, minimum 505 assets out.
        const vaultOrderRow = sortedScMap([
            ['kind', u32Val(1)],
            ['amount', i128Val(5_000_000_000n)],
            ['min_out', i128Val(5_050_000_000n)],
            ['exec_fee', i128Val(2_000_000n)],
            ['created_at', u64Val(1_759_999_500n)],
        ]);
        const decoded = decodeFromWire(
            [symbolVal('create_vault_order'), addressVal(USER), u32Val(11)],
            sortedScMap([['order', vaultOrderRow]]),
        ) as TradingCreateVaultOrderEvent;

        expect(decoded.eventType).toBe(TradingEventType.CreateVaultOrder);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(11);
        expect(decoded.order.kind).toBe(VaultOrderKind.Redeem);
        expect(decoded.order.amount).toBe(5_000_000_000n);
        expect(decoded.order.minOut).toBe(5_050_000_000n);
        expect(decoded.order.execFee).toBe(2_000_000n);
        expect(decoded.order.createdAt).toBe(1_759_999_500n);
    });

    it('decodes cancel_vault_order as topics-only with an empty data map', () => {
        const decoded = decodeFromWire(
            [symbolVal('cancel_vault_order'), addressVal(USER), u32Val(4)],
            sortedScMap([]),
        ) as TradingCancelVaultOrderEvent;

        expect(decoded.eventType).toBe(TradingEventType.CancelVaultOrder);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(4);
    });

    // -------------------------------------------------------------------------
    // Vault order fills
    // -------------------------------------------------------------------------

    it('decodes deposit_fill with keeper and pricing fields', () => {
        // Hand math: 1,000 USDC gross = 10_000_000_000 (7-dec); deposit fee
        // 0.1% = 10_000_000; net 9_990_000_000 minted 1:1 at a 1.0 share price.
        const decoded = decodeFromWire(
            [symbolVal('deposit_fill'), addressVal(USER), u32Val(21)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['assets', i128Val(10_000_000_000n)],
                ['shares', i128Val(9_990_000_000n)],
                ['fee', i128Val(10_000_000n)],
                ['net_pnl', i128Val(250_000_000n)],
            ]),
        ) as TradingDepositFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.DepositFill);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(21);
        expect(decoded.keeper).toBe(KEEPER);
        expect(decoded.assets).toBe(10_000_000_000n);
        expect(decoded.shares).toBe(9_990_000_000n);
        expect(decoded.fee).toBe(10_000_000n);
        expect(decoded.netPnl).toBe(250_000_000n);
    });

    it('decodes redeem_fill with a nonzero id as source order', () => {
        // Hand math: 500 shares burned redeem 510 USDC gross = 5_100_000_000;
        // redeem fee 0.1% = 5_100_000; burn priced against net_pnl = -15 USDC.
        const decoded = decodeFromWire(
            [symbolVal('redeem_fill'), addressVal(USER), u32Val(22)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['shares', i128Val(5_000_000_000n)],
                ['assets', i128Val(5_100_000_000n)],
                ['fee', i128Val(5_100_000n)],
                ['net_pnl', i128Val(-150_000_000n)],
            ]),
        ) as TradingRedeemFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.RedeemFill);
        expect(decoded.orderId).toBe(22);
        expect(decoded.source).toBe('order');
        expect(decoded.keeper).toBe(KEEPER);
        expect(decoded.shares).toBe(5_000_000_000n);
        expect(decoded.assets).toBe(5_100_000_000n);
        expect(decoded.fee).toBe(5_100_000n);
        expect(decoded.netPnl).toBe(-150_000_000n);
    });

    it('decodes redeem_fill with id 0 as a retired-market instant redeem', () => {
        // On an instant redeem the reward recipient is the redeeming user.
        const decoded = decodeFromWire(
            [symbolVal('redeem_fill'), addressVal(USER), u32Val(0)],
            sortedScMap([
                ['keeper', addressVal(USER)],
                ['shares', i128Val(1_000_000_000n)],
                ['assets', i128Val(1_020_000_000n)],
                ['fee', i128Val(0n)],
                ['net_pnl', i128Val(0n)],
            ]),
        ) as TradingRedeemFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.RedeemFill);
        expect(decoded.orderId).toBe(0);
        expect(decoded.source).toBe('instant');
        expect(decoded.keeper).toBe(USER);
    });

    // -------------------------------------------------------------------------
    // Funding claims, ADL flags, accrual telemetry
    // -------------------------------------------------------------------------

    it('decodes claim_funding', () => {
        const decoded = decodeFromWire(
            [symbolVal('claim_funding'), addressVal(USER)],
            sortedScMap([['amount', i128Val(250_000_000n)]]),
        ) as TradingClaimFundingEvent;

        expect(decoded.eventType).toBe(TradingEventType.ClaimFunding);
        expect(decoded.user).toBe(USER);
        expect(decoded.amount).toBe(250_000_000n);
    });

    it('decodes adl_update with no topic args', () => {
        const decoded = decodeFromWire(
            [symbolVal('adl_update')],
            sortedScMap([
                ['long', boolVal(true)],
                ['short', boolVal(false)],
            ]),
        ) as TradingAdlUpdateEvent;

        expect(decoded.eventType).toBe(TradingEventType.AdlUpdate);
        expect(decoded.long).toBe(true);
        expect(decoded.short).toBe(false);
    });

    it('decodes funding_accrual with a SidePair index payload', () => {
        // Hand math: a 1%/year rate in SCALAR_18-per-second units is
        // 0.01e18 / 31_536_000 = 317_097_919.8..., floored to 317_097_919.
        const fundingIndexPair = sortedScMap([
            ['long', i128Val(12_345_000_000_000_000n)],
            ['short', i128Val(-12_345_000_000_000_000n)],
        ]);
        const decoded = decodeFromWire(
            [symbolVal('funding_accrual')],
            sortedScMap([
                ['funding_rate', i128Val(317_097_919n)],
                ['funding_idx', fundingIndexPair],
                ['timestamp', u64Val(1_760_000_000n)],
            ]),
        ) as TradingFundingAccrualEvent;

        expect(decoded.eventType).toBe(TradingEventType.FundingAccrual);
        expect(decoded.fundingRate).toBe(317_097_919n);
        expect(decoded.fundingIdx.long).toBe(12_345_000_000_000_000n);
        expect(decoded.fundingIdx.short).toBe(-12_345_000_000_000_000n);
        expect(decoded.timestamp).toBe(1_760_000_000n);
    });

    it('decodes borrowing_accrual with a SidePair index payload', () => {
        const borrowingIndexPair = sortedScMap([
            ['long', i128Val(990_000_000_000_000n)],
            ['short', i128Val(110_000_000_000_000n)],
        ]);
        const decoded = decodeFromWire(
            [symbolVal('borrowing_accrual')],
            sortedScMap([
                ['borrowing_idx', borrowingIndexPair],
                ['timestamp', u64Val(1_760_000_060n)],
            ]),
        ) as TradingBorrowingAccrualEvent;

        expect(decoded.eventType).toBe(TradingEventType.BorrowingAccrual);
        expect(decoded.borrowingIdx.long).toBe(990_000_000_000_000n);
        expect(decoded.borrowingIdx.short).toBe(110_000_000_000_000n);
        expect(decoded.timestamp).toBe(1_760_000_060n);
    });

    // -------------------------------------------------------------------------
    // Admin events
    // -------------------------------------------------------------------------

    it('decodes status_update', () => {
        const decoded = decodeFromWire(
            [symbolVal('status_update')],
            sortedScMap([['status', u32Val(3)]]),
        ) as TradingStatusUpdateEvent;

        expect(decoded.eventType).toBe(TradingEventType.StatusUpdate);
        expect(decoded.status).toBe(Status.Delisted);
    });

    it('decodes config_update mapping every one of the 34 Config fields', () => {
        // Distinct value per field, numbered in config.rs declaration order,
        // so any swapped snake_case -> camelCase mapping shows up as a mismatch.
        const configRow = sortedScMap([
            ['keeper_rate', i128Val(101n)],
            ['min_position_notional', i128Val(102n)],
            ['max_position_notional', i128Val(103n)],
            ['max_open_interest', i128Val(104n)],
            ['min_order_notional', i128Val(105n)],
            ['min_order_collateral', i128Val(106n)],
            ['exec_fee', i128Val(107n)],
            ['fee_dom', i128Val(108n)],
            ['fee_non_dom', i128Val(109n)],
            ['impact_scalar', i128Val(110n)],
            ['max_util_open', i128Val(111n)],
            ['max_util_withdraw', i128Val(112n)],
            ['init_margin', i128Val(113n)],
            ['maintenance_margin', i128Val(114n)],
            ['liq_fee', i128Val(115n)],
            ['notional_lock', u64Val(116n)],
            ['target_util', i128Val(117n)],
            ['borrow_rate', i128Val(118n)],
            ['increased_borrow_rate', i128Val(119n)],
            ['funding_increase', i128Val(120n)],
            ['funding_decrease', i128Val(121n)],
            ['threshold_stable_funding', i128Val(122n)],
            ['threshold_decrease_funding', i128Val(123n)],
            ['funding_min', i128Val(124n)],
            ['funding_max', i128Val(125n)],
            ['adl_max_pnl', i128Val(126n)],
            ['adl_clear_target', i128Val(127n)],
            ['max_pnl_trader', i128Val(128n)],
            ['max_pnl_withdraw', i128Val(129n)],
            ['redeem_lock', u64Val(130n)],
            ['deposit_fee', i128Val(131n)],
            ['redeem_fee', i128Val(132n)],
            ['min_deposit', i128Val(133n)],
            ['max_vault_balance', i128Val(134n)],
        ]);
        const decoded = decodeFromWire(
            [symbolVal('config_update')],
            sortedScMap([['config', configRow]]),
        ) as TradingConfigUpdateEvent;

        expect(decoded.eventType).toBe(TradingEventType.ConfigUpdate);
        const config = decoded.config;
        expect(config.keeperRate).toBe(101n);
        expect(config.minPositionNotional).toBe(102n);
        expect(config.maxPositionNotional).toBe(103n);
        expect(config.maxOpenInterest).toBe(104n);
        expect(config.minOrderNotional).toBe(105n);
        expect(config.minOrderCollateral).toBe(106n);
        expect(config.execFee).toBe(107n);
        expect(config.feeDom).toBe(108n);
        expect(config.feeNonDom).toBe(109n);
        expect(config.impactScalar).toBe(110n);
        expect(config.maxUtilOpen).toBe(111n);
        expect(config.maxUtilWithdraw).toBe(112n);
        expect(config.initMargin).toBe(113n);
        expect(config.maintenanceMargin).toBe(114n);
        expect(config.liqFee).toBe(115n);
        expect(config.notionalLock).toBe(116n);
        expect(config.targetUtil).toBe(117n);
        expect(config.borrowRate).toBe(118n);
        expect(config.increasedBorrowRate).toBe(119n);
        expect(config.fundingIncrease).toBe(120n);
        expect(config.fundingDecrease).toBe(121n);
        expect(config.thresholdStableFunding).toBe(122n);
        expect(config.thresholdDecreaseFunding).toBe(123n);
        expect(config.fundingMin).toBe(124n);
        expect(config.fundingMax).toBe(125n);
        expect(config.adlMaxPnl).toBe(126n);
        expect(config.adlClearTarget).toBe(127n);
        expect(config.maxPnlTrader).toBe(128n);
        expect(config.maxPnlWithdraw).toBe(129n);
        expect(config.redeemLock).toBe(130n);
        expect(config.depositFee).toBe(131n);
        expect(config.redeemFee).toBe(132n);
        expect(config.minDeposit).toBe(133n);
        expect(config.maxVaultBalance).toBe(134n);
        expect(Object.keys(config)).toHaveLength(34);
    });

    it('decodes terminal_price_update', () => {
        const decoded = decodeFromWire(
            [symbolVal('terminal_price_update')],
            sortedScMap([['price', i128Val(9_876_543_210_000n)]]),
        ) as TradingTerminalPriceUpdateEvent;

        expect(decoded.eventType).toBe(TradingEventType.TerminalPriceUpdate);
        expect(decoded.price).toBe(9_876_543_210_000n);
    });

    // -------------------------------------------------------------------------
    // Trade fill receipts
    // -------------------------------------------------------------------------

    it('decodes increase_fill with keeper and execution price', () => {
        // Hand math: long buys $1,000 notional = 10_000_000_000 (7-dec) at the
        // $100,000 ask = 10_000_000_000_000 price units. tokens = notional *
        // 1e18 / price = 1e10 * 1e18 / 1e13 = 1e15 base-dec (0.01 BTC at
        // 1e17/BTC). Fees: base 0.05% of notional = 5_000_000; impact 0.02% =
        // 2_000_000. Funding -3_000_000 is earned (credited claimable).
        const decoded = decodeFromWire(
            [symbolVal('increase_fill'), addressVal(USER), u32Val(7), boolVal(true)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['price', i128Val(10_000_000_000_000n)],
                ['notional', i128Val(10_000_000_000n)],
                ['tokens', i128Val(1_000_000_000_000_000n)],
                ['collateral', i128Val(1_000_000_000n)],
                ['base_fee', i128Val(5_000_000n)],
                ['impact_fee', i128Val(2_000_000n)],
                ['funding', i128Val(-3_000_000n)],
                ['borrowing', i128Val(1_000_000n)],
            ]),
        ) as TradingIncreaseFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.IncreaseFill);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(7);
        expect(decoded.isLong).toBe(true);
        expect(decoded.keeper).toBe(KEEPER);
        expect(decoded.price).toBe(10_000_000_000_000n);
        expect(decoded.notional).toBe(10_000_000_000n);
        expect(decoded.tokens).toBe(1_000_000_000_000_000n);
        expect(decoded.collateral).toBe(1_000_000_000n);
        expect(decoded.baseFee).toBe(5_000_000n);
        expect(decoded.impactFee).toBe(2_000_000n);
        expect(decoded.funding).toBe(-3_000_000n);
        expect(decoded.borrowing).toBe(1_000_000n);
        // Increase receipts carry no provenance discriminator.
        expect((decoded as unknown as Record<string, unknown>).source).toBeUndefined();
    });

    it('decodes decrease_fill (order fill) without a badDebt field', () => {
        // Hand math: partial close of a long entered at $100,000. Closed chunk
        // at entry pricing: notional 4_000_000_000 (7-dec), tokens 4e14, so
        // entry = 4e9 * 1e18 / 4e14 = 1e13 = $100,000. Exit bid $105,000 =
        // 10_500_000_000_000; pnl = floor(4e14 * 1.05e13 / 1e18) - 4e9 =
        // 4_200_000_000 - 4_000_000_000 = +200_000_000. Fees on the exit value
        // 4.2e9: base 0.05% = 2_100_000, impact 0.02% = 840_000; funding paid
        // 1_500_000; borrowing 700_000. returned = withdrawal 500_000_000 +
        // profit 200_000_000 - 2_100_000 - 840_000 - 1_500_000 - 700_000 =
        // 694_860_000.
        const decoded = decodeFromWire(
            [symbolVal('decrease_fill'), addressVal(USER), u32Val(9), boolVal(true)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['price', i128Val(10_500_000_000_000n)],
                ['notional', i128Val(4_000_000_000n)],
                ['tokens', i128Val(400_000_000_000_000n)],
                ['collateral', i128Val(500_000_000n)],
                ['pnl', i128Val(200_000_000n)],
                ['base_fee', i128Val(2_100_000n)],
                ['impact_fee', i128Val(840_000n)],
                ['funding', i128Val(1_500_000n)],
                ['borrowing', i128Val(700_000n)],
                ['returned', i128Val(694_860_000n)],
            ]),
        ) as TradingDecreaseFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.DecreaseFill);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(9);
        expect(decoded.source).toBe('order');
        expect(decoded.isLong).toBe(true);
        expect(decoded.keeper).toBe(KEEPER);
        expect(decoded.price).toBe(10_500_000_000_000n);
        expect(decoded.notional).toBe(4_000_000_000n);
        expect(decoded.tokens).toBe(400_000_000_000_000n);
        expect(decoded.collateral).toBe(500_000_000n);
        expect(decoded.pnl).toBe(200_000_000n);
        expect(decoded.baseFee).toBe(2_100_000n);
        expect(decoded.impactFee).toBe(840_000n);
        expect(decoded.funding).toBe(1_500_000n);
        expect(decoded.borrowing).toBe(700_000n);
        expect(decoded.returned).toBe(694_860_000n);
        // Partial decreases never carry bad debt (the surviving margin absorbs
        // realized losses); the decoded shape must not have the field at all.
        expect((decoded as unknown as Record<string, unknown>).badDebt).toBeUndefined();
        expect('badDebt' in decoded).toBe(false);
    });

    it('decodes decrease_fill with id 0 as a forced ADL close slice', () => {
        const decoded = decodeFromWire(
            [symbolVal('decrease_fill'), addressVal(USER), u32Val(0), boolVal(false)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['price', i128Val(9_000_000_000_000n)],
                ['notional', i128Val(2_000_000_000n)],
                ['tokens', i128Val(200_000_000_000_000n)],
                ['collateral', i128Val(0n)],
                ['pnl', i128Val(200_000_000n)],
                ['base_fee', i128Val(900_000n)],
                ['impact_fee', i128Val(0n)],
                ['funding', i128Val(0n)],
                ['borrowing', i128Val(0n)],
                ['returned', i128Val(199_100_000n)],
            ]),
        ) as TradingDecreaseFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.DecreaseFill);
        expect(decoded.orderId).toBe(0);
        expect(decoded.source).toBe('adl');
        expect(decoded.isLong).toBe(false);
    });

    it('decodes close_fill (order fill) with bad debt', () => {
        // Hand math: full close of a long entered at $100,000: notional 1e10,
        // tokens 1e15. Exit bid $89,000 = 8_900_000_000_000; pnl =
        // floor(1e15 * 8.9e12 / 1e18) - 1e10 = 8_900_000_000 - 10_000_000_000
        // = -1_100_000_000. Freed margin 1_000_000_000. Fees on exit value
        // 8.9e9: base 0.05% = 4_450_000, impact 0.02% = 1_780_000; funding
        // 2_000_000; borrowing 900_000. Equity = 1_000_000_000 - 1_100_000_000
        // - 4_450_000 - 1_780_000 - 2_000_000 - 900_000 = -109_130_000, so
        // returned = 0 and bad_debt = 109_130_000 absorbed by the vault.
        const decoded = decodeFromWire(
            [symbolVal('close_fill'), addressVal(USER), u32Val(12), boolVal(true)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['price', i128Val(8_900_000_000_000n)],
                ['notional', i128Val(10_000_000_000n)],
                ['tokens', i128Val(1_000_000_000_000_000n)],
                ['collateral', i128Val(1_000_000_000n)],
                ['pnl', i128Val(-1_100_000_000n)],
                ['base_fee', i128Val(4_450_000n)],
                ['impact_fee', i128Val(1_780_000n)],
                ['funding', i128Val(2_000_000n)],
                ['borrowing', i128Val(900_000n)],
                ['bad_debt', i128Val(109_130_000n)],
                ['returned', i128Val(0n)],
            ]),
        ) as TradingCloseFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.CloseFill);
        expect(decoded.user).toBe(USER);
        expect(decoded.orderId).toBe(12);
        expect(decoded.source).toBe('order');
        expect(decoded.isLong).toBe(true);
        expect(decoded.keeper).toBe(KEEPER);
        expect(decoded.price).toBe(8_900_000_000_000n);
        expect(decoded.notional).toBe(10_000_000_000n);
        expect(decoded.tokens).toBe(1_000_000_000_000_000n);
        expect(decoded.collateral).toBe(1_000_000_000n);
        expect(decoded.pnl).toBe(-1_100_000_000n);
        expect(decoded.baseFee).toBe(4_450_000n);
        expect(decoded.impactFee).toBe(1_780_000n);
        expect(decoded.funding).toBe(2_000_000n);
        expect(decoded.borrowing).toBe(900_000n);
        expect(decoded.badDebt).toBe(109_130_000n);
        expect(decoded.returned).toBe(0n);
    });

    it('decodes close_fill with id 0 as a forced ADL close', () => {
        // Hand math: profitable long ADL-closed at the $110,000 bid =
        // 11_000_000_000_000: pnl = floor(1e15 * 1.1e13 / 1e18) - 1e10 =
        // +1_000_000_000. returned = collateral 1_000_000_000 + pnl
        // 1_000_000_000 - base fee 5_500_000 (0.05% of 1.1e10) = 1_994_500_000.
        const decoded = decodeFromWire(
            [symbolVal('close_fill'), addressVal(USER), u32Val(0), boolVal(true)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['price', i128Val(11_000_000_000_000n)],
                ['notional', i128Val(10_000_000_000n)],
                ['tokens', i128Val(1_000_000_000_000_000n)],
                ['collateral', i128Val(1_000_000_000n)],
                ['pnl', i128Val(1_000_000_000n)],
                ['base_fee', i128Val(5_500_000n)],
                ['impact_fee', i128Val(0n)],
                ['funding', i128Val(0n)],
                ['borrowing', i128Val(0n)],
                ['bad_debt', i128Val(0n)],
                ['returned', i128Val(1_994_500_000n)],
            ]),
        ) as TradingCloseFillEvent;

        expect(decoded.eventType).toBe(TradingEventType.CloseFill);
        expect(decoded.orderId).toBe(0);
        expect(decoded.source).toBe('adl');
        expect(decoded.badDebt).toBe(0n);
        expect(decoded.returned).toBe(1_994_500_000n);
    });

    it('decodes liquidation with keeper, price, and tier fields', () => {
        // Hand math: short entered at $100,000 (notional 1e10, tokens 1e15)
        // liquidated at the $110,000 ask = 11_000_000_000_000. Short pnl =
        // notional - tokens * price / 1e18 = 1e10 - 1.1e10 = -1_000_000_000.
        // Freed margin 1_200_000_000. Fees on exit value 1.1e10: base 0.05% =
        // 5_500_000, impact 0.02% = 2_200_000; funding paid 800_000; borrowing
        // 500_000. Equity = 1_200_000_000 - 1_000_000_000 - 5_500_000 -
        // 2_200_000 - 800_000 - 500_000 = 191_000_000; hard tier takes liq_fee
        // 60_000_000 and forfeits the remainder 131_000_000 to the vault, so
        // returned = 0 and bad_debt = 0.
        const decoded = decodeFromWire(
            [symbolVal('liquidation'), addressVal(USER), boolVal(false)],
            sortedScMap([
                ['keeper', addressVal(KEEPER)],
                ['price', i128Val(11_000_000_000_000n)],
                ['notional', i128Val(10_000_000_000n)],
                ['tokens', i128Val(1_000_000_000_000_000n)],
                ['collateral', i128Val(1_200_000_000n)],
                ['pnl', i128Val(-1_000_000_000n)],
                ['base_fee', i128Val(5_500_000n)],
                ['impact_fee', i128Val(2_200_000n)],
                ['funding', i128Val(800_000n)],
                ['borrowing', i128Val(500_000n)],
                ['bad_debt', i128Val(0n)],
                ['liq_fee', i128Val(60_000_000n)],
                ['returned', i128Val(0n)],
                ['forfeit', i128Val(131_000_000n)],
            ]),
        ) as TradingLiquidationEvent;

        expect(decoded.eventType).toBe(TradingEventType.Liquidation);
        expect(decoded.user).toBe(USER);
        expect(decoded.isLong).toBe(false);
        expect(decoded.keeper).toBe(KEEPER);
        expect(decoded.price).toBe(11_000_000_000_000n);
        expect(decoded.notional).toBe(10_000_000_000n);
        expect(decoded.tokens).toBe(1_000_000_000_000_000n);
        expect(decoded.collateral).toBe(1_200_000_000n);
        expect(decoded.pnl).toBe(-1_000_000_000n);
        expect(decoded.baseFee).toBe(5_500_000n);
        expect(decoded.impactFee).toBe(2_200_000n);
        expect(decoded.funding).toBe(800_000n);
        expect(decoded.borrowing).toBe(500_000n);
        expect(decoded.badDebt).toBe(0n);
        expect(decoded.liqFee).toBe(60_000_000n);
        expect(decoded.returned).toBe(0n);
        expect(decoded.forfeit).toBe(131_000_000n);
    });

    // -------------------------------------------------------------------------
    // Deleted and unknown event types
    // -------------------------------------------------------------------------

    it('returns undefined for the deleted position_update event', () => {
        const positionRow = sortedScMap([
            ['collateral', i128Val(1_000_000_000n)],
            ['notional', i128Val(10_000_000_000n)],
            ['tokens', i128Val(1_000_000_000_000_000n)],
            ['funding_idx', i128Val(0n)],
            ['borrowing_idx', i128Val(0n)],
            ['locked_notional', i128Val(0n)],
            ['unlocks_at', u64Val(0n)],
            ['priced_at', u64Val(1_760_000_000n)],
            ['decrease_orders', xdr.ScVal.scvVec([])],
        ]);
        const decoded = decodeFromWire(
            [symbolVal('position_update'), addressVal(USER), boolVal(true)],
            sortedScMap([['position', positionRow]]),
        );
        expect(decoded).toBeUndefined();
    });

    it('returns undefined for the deleted execute_vault_order event', () => {
        const decoded = decodeFromWire(
            [symbolVal('execute_vault_order'), addressVal(USER), u32Val(11)],
            sortedScMap([
                ['filled', i128Val(50n)],
                ['remaining', i128Val(0n)],
            ]),
        );
        expect(decoded).toBeUndefined();
    });

    it('returns undefined for an unknown event type', () => {
        const decoded = decodeFromWire(
            [symbolVal('some_unrelated_event')],
            sortedScMap([]),
        );
        expect(decoded).toBeUndefined();
    });
});
