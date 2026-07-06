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
    entry('funding_idx', i128(0n)),
    entry('locked_notional', i128(200n)),
    entry('notional', i128(1000n)),
    entry('tokens', i128(500n)),
    entry('unlocks_at', u64(2000n)),
    entry('updated_at', u64(1000n)),
]);

const marketDataScVal = xdr.ScVal.scvMap([
    entry('borrowing_idx', sidePair(0n, 0n)),
    entry('borrowing_update', u64(0n)),
    entry('collateral', sidePair(100n, 100n)),
    entry('funding_idx', sidePair(0n, 0n)),
    entry('funding_owed', i128(0n)),
    entry('funding_pool', i128(0n)),
    entry('funding_rate', i128(0n)),
    entry('funding_update', u64(0n)),
    entry('notional', sidePair(1000n, 500n)),
    entry('tokens', sidePair(500n, 250n)),
]);

function makeConfig(): TradingConfig {
    return {
        keeperRate: 0n, minPositionNotional: 1n, maxPositionNotional: 10n ** 12n,
        maxOpenInterest: 10n ** 12n, minOrderNotional: 1n, minOrderCollateral: 1n,
        feeDom: 0n, feeNonDom: 0n, impactDivisor: 10n * SCALAR_18, maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18, initMargin: SCALAR_18 / 10n,
        maintenanceMargin: SCALAR_18 / 100n, liqFee: 0n, notionalLock: 60n,
        targetUtil: SCALAR_18 / 2n, borrowRate: 0n, increasedBorrowRate: 0n,
        fundingIncrease: 0n, fundingDecrease: 0n, thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n, fundingMin: 0n, fundingMax: 0n,
        adlMaxPnl: SCALAR_18 / 2n, adlClearTarget: (45n * SCALAR_18) / 100n,
        maxPnlTrader: (90n * SCALAR_18) / 100n, redeemLock: 60n, depositLock: 60n,
        instantDepositPnl: 0n, vaultFee: 0n, minDeposit: 1n,
        maxPnlDeposit: SCALAR_18 / 2n, maxPnlWithdraw: SCALAR_18 / 2n,
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
        expect(view!.user).toBe(USER);

        // pnl at price 3 * SCALAR_18: floor(500 * 3) - 1000 = 500
        const price = 3n * SCALAR_18;
        expect(view!.pnl(price)).toBe(500n);
        expect(view!.pendingFunding(await marketData())).toBe(0n);
        expect(view!.pendingBorrowing(await marketData())).toBe(0n);
        expect(view!.equity(await marketData(), price)).toBe(600n);
        expect(view!.liquidationPrice(makeConfig(), await marketData())).toBeGreaterThan(0n);
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
    const mv = await MarketView.load(network, CONTRACT_ID);
    return mv!.data;
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

        const price = 2n * SCALAR_18;
        // long: floor(500 * 2) - 1000 = 0; short: 500 - ceil(250 * 2) = 0
        expect(view!.sidePnl(price, true)).toBe(0n);
        expect(view!.sidePnl(price, false)).toBe(0n);
        expect(view!.netPnl(price)).toBe(0n);
        // OI 1500 / vault 3000 = 0.5
        expect(view!.utilization(3000n)).toBe(SCALAR_18 / 2n);
        expect(view!.utilization(0n)).toBe(0n);

        const fees = view!.skewSplitFees(makeConfig(), true, 100n, 50n);
        expect(fees.worsening + fees.improving).toBe(100n);
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

    it('reads instance storage and the token balance (SEP-41 map form)', async () => {
        const storage = [
            entry('AssetAddress', Address.fromString(ASSET).toScVal()),
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
        // shares descaled by 7 + offset 1 = 8 decimals: 10_000_000_00 / 1e8 = 10
        expect(state.totalShares).toBe(10);
        // assets descaled by 7: 50_000_000 / 1e7 = 5
        expect(state.totalAssets).toBe(5);
        expect(state.decimalsOffset).toBe(1);
        expect(state.sharePrice()).toBe(0.5);
    });

    it('reads a direct i128 balance and defaults to 0 assets when absent', async () => {
        const storage = [
            entry('AssetAddress', Address.fromString(ASSET).toScVal()),
            entry('TotalSupply', i128(0n)),
            entry('VirtualDecimalsOffset', xdr.ScVal.scvU32(0)),
        ];
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [instanceEntry(storage)], latestLedger: 1 } as never)
            .mockResolvedValueOnce({ entries: [contractDataEntry(i128(30_000_000n))], latestLedger: 1 } as never);
        const state = await VaultState.load(network, CONTRACT_ID);
        expect(state.totalAssets).toBe(3);

        vi.restoreAllMocks();
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [instanceEntry(storage)], latestLedger: 1 } as never)
            .mockRejectedValueOnce(new Error('no balance entry'));
        const empty = await VaultState.load(network, CONTRACT_ID);
        expect(empty.totalAssets).toBe(0);
    });

    it('throws when the vault instance is missing or incomplete', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({ entries: [], latestLedger: 1 } as never);
        await expect(VaultState.load(network, CONTRACT_ID)).rejects.toThrow('Vault contract not found');

        vi.restoreAllMocks();
        vi.spyOn(rpc.Server.prototype, 'getLedgerEntries')
            .mockResolvedValueOnce({
                entries: [instanceEntry([entry('TotalSupply', i128(1n))])],
                latestLedger: 1,
            } as never);
        await expect(VaultState.load(network, CONTRACT_ID)).rejects.toThrow('asset address not found');
    });
});
