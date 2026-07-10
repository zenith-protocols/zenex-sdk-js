import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, xdr, nativeToScVal, Address, StrKey } from '@stellar/stellar-sdk';
import { PositionView } from '../src/trading/trading_position.js';
import { MarketView } from '../src/trading/trading_market.js';
import { VaultState } from '../src/vault/vault_state.js';
import { SCALAR_18 } from '../src/math.js';
import { Network } from '../src/index.js';
import { TradingConfig } from '../src/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const ASSET = StrKey.encodeContract(Buffer.alloc(32, 2));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));

const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};

const i128 = (v: bigint) => nativeToScVal(v, { type: 'i128' });
const u64 = (v: bigint) => nativeToScVal(v, { type: 'u64' });
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(k), val: v });
const sidePair = (long: bigint, short: bigint) =>
    xdr.ScVal.scvMap([entry('long', i128(long)), entry('short', i128(short))]);

/** Wrap a storage-value ScVal in the LedgerEntryData shape getLedgerEntries returns. */
function contractDataEntry(val: xdr.ScVal) {
    return {
        lastModifiedLedgerSeq: 1,
        key: xdr.ScVal.scvVoid() as unknown as xdr.LedgerKey,
        val: xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
            ext: new xdr.ExtensionPoint(0),
            contract: Address.fromString(CONTRACT_ID).toScAddress(),
            key: xdr.ScVal.scvVoid(),
            durability: xdr.ContractDataDurability.persistent(),
            val,
        })),
    };
}

const positionScVal = xdr.ScVal.scvMap([
    entry('borrowing_idx', i128(0n)),
    entry('collateral', i128(100n)),
    entry('decrease_orders', xdr.ScVal.scvVec([xdr.ScVal.scvU32(3), xdr.ScVal.scvU32(7)])),
    entry('funding_idx', i128(0n)),
    entry('locked_notional', i128(200n)),
    entry('notional', i128(1000n)),
    entry('priced_at', u64(1500n)),
    entry('tokens', i128(500n)),
    entry('unlocks_at', u64(2000n)),
]);

// Long-side indices: funding -0.02e18 (longs have EARNED funding),
// borrowing 0.003e18. Both position snapshots are 0, so against a
// notional of 1000: pendingFunding = ceil(1000 * -0.02) = -20 and
// pendingBorrowing = ceil(1000 * 0.003) = 3.
const marketDataScVal = xdr.ScVal.scvMap([
    entry('borrowing_idx', sidePair(3n * 10n ** 15n, 0n)),
    entry('borrowing_update', u64(500n)),
    entry('collateral', sidePair(100n, 100n)),
    entry('funding_idx', sidePair(-2n * 10n ** 16n, 0n)),
    entry('funding_owed', i128(0n)),
    entry('funding_pool', i128(0n)),
    entry('funding_rate', i128(0n)),
    entry('funding_update', u64(600n)),
    entry('last_price_time', u64(1234n)),
    entry('notional', sidePair(1000n, 500n)),
    entry('tokens', sidePair(500n, 250n)),
]);

function makeConfig(): TradingConfig {
    return {
        keeperRate: 0n, minPositionNotional: 1n, maxPositionNotional: 10n ** 12n,
        maxOpenInterest: 10n ** 12n, minOrderNotional: 1n, minOrderCollateral: 1n,
        execFee: 0n, feeDom: 5n * 10n ** 15n, feeNonDom: 2n * 10n ** 15n,
        impactScalar: 10n * SCALAR_18, maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18, initMargin: SCALAR_18 / 10n,
        maintenanceMargin: SCALAR_18 / 100n, liqFee: 0n, notionalLock: 60n,
        targetUtil: SCALAR_18 / 2n, borrowRate: 0n, increasedBorrowRate: 0n,
        fundingIncrease: 0n, fundingDecrease: 0n, thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n, fundingMin: 0n, fundingMax: 0n,
        adlMaxPnl: SCALAR_18 / 2n, adlClearTarget: (45n * SCALAR_18) / 100n,
        maxPnlTrader: (90n * SCALAR_18) / 100n, maxPnlWithdraw: SCALAR_18 / 2n,
        redeemLock: 60n, depositFee: 0n, redeemFee: 0n, minDeposit: 1n,
        maxVaultBalance: 10n ** 12n,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PositionView', () => {
    it('loads a position via getLedgerEntries and binds the math', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue({
            entries: [contractDataEntry(positionScVal)],
            latestLedger: 1,
        } as never);

        const view = await PositionView.load(network, CONTRACT_ID, USER, true);
        expect(view).not.toBeNull();
        expect(view!.position.notional).toBe(1000n);
        expect(view!.position.pricedAt).toBe(1500n);
        expect(view!.position.decreaseOrders).toEqual([3, 7]);
        expect(view!.user).toBe(USER);

        // pnl at price 3 * SCALAR_18: floor(500 * 3) - 1000 = 500
        const price = 3n * SCALAR_18;
        expect(view!.pnl(price)).toBe(500n);
        // funding index delta -0.02 on notional 1000: ceil(-20) = -20 (earned)
        expect(view!.pendingFunding(await marketData())).toBe(-20n);
        // borrowing index delta 0.003 on notional 1000: ceil(3) = 3
        expect(view!.pendingBorrowing(await marketData())).toBe(3n);
        // equity = 100 + 500 - max(0, -20) - 3 = 597; the earned funding is
        // clamped out (it accrues to the claimable balance, not the margin),
        // so equity is NOT 617.
        expect(view!.equity(await marketData(), price)).toBe(597n);
        // maintenance = ceil(1000 * 0.01) = 10; long solve:
        // floor(500 * p / 1e18) = 10 + 1000 - 100 + 0 + 3 = 913
        // p = floor(913e18 / 500) = 1.826e18
        expect(view!.liquidationPrice(makeConfig(), await marketData()))
            .toBe(1_826_000_000_000_000_000n);
        expect(view!.unlockedNotional(1000n)).toBe(800n);
        expect(view!.unlockedNotional(2000n)).toBe(1000n);
    });

    it('returns null when the entry is absent or the read throws', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [], latestLedger: 1 } as never)
            .mockRejectedValueOnce(new Error('rpc down'));
        expect(await PositionView.load(network, CONTRACT_ID, USER, false)).toBeNull();
        expect(await PositionView.load(network, CONTRACT_ID, USER, false)).toBeNull();
    });
});

async function marketData() {
    vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue({
        entries: [contractDataEntry(marketDataScVal)],
        latestLedger: 1,
    } as never);
    const view = await MarketView.load(network, CONTRACT_ID);
    return view!.data;
}

describe('MarketView', () => {
    it('loads the market singleton and binds the math', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries').mockResolvedValue({
            entries: [contractDataEntry(marketDataScVal)],
            latestLedger: 1,
        } as never);

        const view = await MarketView.load(network, CONTRACT_ID);
        expect(view).not.toBeNull();
        expect(view!.data.notional).toEqual({ long: 1000n, short: 500n });
        expect(view!.data.lastPriceTime).toBe(1234n);

        const price = 3n * SCALAR_18;
        // long: floor(500 * 3) - 1000 = 500 (above the -100 collateral floor)
        expect(view!.sidePnl(price, true)).toBe(500n);
        // short: 500 - ceil(250 * 3) = -250, floored at -collateral = -100
        expect(view!.sidePnl(price, false)).toBe(-100n);
        expect(view!.netPnl(price)).toBe(400n);
        // OI 1500 / vault 3000 = 0.5
        expect(view!.utilization(3000n)).toBe(SCALAR_18 / 2n);
        expect(view!.utilization(0n)).toBe(0n);
    });

    it('computes skew-split fees and the size-quadratic impact fee', async () => {
        const data = await marketData();
        const view = new MarketView(data);
        const config = makeConfig();

        // Long increase of 1000 notional / 50 tokens: token imbalance goes
        // 250 -> 300, all worsening. base = ceil(1000 * 0.005) = 5.
        // impact = min(ceil(1000^2 / 10e18), ceil(1000 * 0.1))
        //        = min(ceil(1e6 / 1e19) = 1, 100) = 1.
        const increaseFees = view.skewSplitFees(config, true, 1000n, 50n);
        expect(increaseFees.worsening).toBe(1000n);
        expect(increaseFees.improving).toBe(0n);
        expect(increaseFees.base).toBe(5n);
        expect(increaseFees.impact).toBe(1n);

        // Long decrease of 1200 notional / 600 tokens crosses the balance
        // point: imbalance 250 -> -350, so 250 tokens improve and 350 worsen.
        // worsening notional = ceil(1200 * 350 / 600) = 700, improving = 500.
        // base = ceil(700 * 0.005) + ceil(500 * 0.002) = ceil(3.5) + 1 = 5.
        // impact = min(ceil(1200^2 / 10e18) = 1, ceil(1200 * 0.1) = 120) = 1.
        const crossingFees = view.skewSplitFees(config, true, -1200n, -600n);
        expect(crossingFees.worsening).toBe(700n);
        expect(crossingFees.improving).toBe(500n);
        expect(crossingFees.base).toBe(5n);
        expect(crossingFees.impact).toBe(1n);
    });

    it('returns null when the entry is absent or the read throws', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [], latestLedger: 1 } as never)
            .mockRejectedValueOnce(new Error('rpc down'));
        expect(await MarketView.load(network, CONTRACT_ID)).toBeNull();
        expect(await MarketView.load(network, CONTRACT_ID)).toBeNull();
    });
});

describe('VaultState.load', () => {
    function instanceEntry(storage: xdr.ScMapEntry[]) {
        return contractDataEntry(xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({
            executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
            storage,
        })));
    }

    /** OZ `Metadata { decimals, name, symbol }` instance-storage value. */
    function metaEntry(decimals: number) {
        return entry('Meta', xdr.ScVal.scvMap([
            entry('decimals', xdr.ScVal.scvU32(decimals)),
            entry('name', xdr.ScVal.scvString('Zenex Vault')),
            entry('symbol', xdr.ScVal.scvString('zTKN')),
        ]));
    }

    it('derives share/asset decimals from Meta and descales (SEP-41 map balance)', async () => {
        const storage = [
            entry('AssetAddress', Address.fromString(ASSET).toScVal()),
            metaEntry(8),
            entry('TotalSupply', i128(10_000_000_00n)),
            entry('VirtualDecimalsOffset', xdr.ScVal.scvU32(1)),
        ];
        const balanceMap = xdr.ScVal.scvMap([
            entry('amount', i128(50_000_000n)),
            entry('authorized', xdr.ScVal.scvBool(true)),
            entry('clawback', xdr.ScVal.scvBool(false)),
        ]);
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [instanceEntry(storage)], latestLedger: 1 } as never)
            .mockResolvedValueOnce({ entries: [contractDataEntry(balanceMap)], latestLedger: 1 } as never);

        const state = await VaultState.load(network, CONTRACT_ID);
        expect(state.asset).toBe(ASSET);
        expect(state.shareDecimals).toBe(8);
        // assetDecimals = shareDecimals - decimalsOffset = 8 - 1 = 7
        expect(state.assetDecimals).toBe(7);
        // shares descaled by the Meta decimals 8: 10_000_000_00 / 1e8 = 10
        expect(state.totalShares).toBe(10);
        // assets descaled by the derived 7: 50_000_000 / 1e7 = 5
        expect(state.totalAssets).toBe(5);
        expect(state.decimalsOffset).toBe(1);
        expect(state.sharePrice()).toBe(0.5);
    });

    it('descales a 9-decimal asset from Meta (no 7-decimal hardcode) and defaults to 0 assets when absent', async () => {
        const storage = [
            entry('AssetAddress', Address.fromString(ASSET).toScVal()),
            metaEntry(9),
            entry('TotalSupply', i128(0n)),
            entry('VirtualDecimalsOffset', xdr.ScVal.scvU32(0)),
        ];
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [instanceEntry(storage)], latestLedger: 1 } as never)
            .mockResolvedValueOnce({ entries: [contractDataEntry(i128(3_000_000_000n))], latestLedger: 1 } as never);
        const state = await VaultState.load(network, CONTRACT_ID);
        // assetDecimals = 9 - 0 = 9; direct i128 balance 3_000_000_000 / 1e9 = 3
        expect(state.assetDecimals).toBe(9);
        expect(state.totalAssets).toBe(3);

        vi.restoreAllMocks();
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [instanceEntry(storage)], latestLedger: 1 } as never)
            .mockRejectedValueOnce(new Error('no balance entry'));
        const empty = await VaultState.load(network, CONTRACT_ID);
        expect(empty.totalAssets).toBe(0);
    });

    it('throws when the instance, asset address, or share metadata is missing', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [], latestLedger: 1 } as never);
        await expect(VaultState.load(network, CONTRACT_ID)).rejects.toThrow('Vault contract not found');

        vi.restoreAllMocks();
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({
                entries: [instanceEntry([entry('TotalSupply', i128(1n)), metaEntry(7)])],
                latestLedger: 1,
            } as never);
        await expect(VaultState.load(network, CONTRACT_ID)).rejects.toThrow('asset address not found');

        vi.restoreAllMocks();
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({
                entries: [instanceEntry([
                    entry('AssetAddress', Address.fromString(ASSET).toScVal()),
                    entry('TotalSupply', i128(1n)),
                ])],
                latestLedger: 1,
            } as never);
        await expect(VaultState.load(network, CONTRACT_ID)).rejects.toThrow('share metadata not found');
    });
});
