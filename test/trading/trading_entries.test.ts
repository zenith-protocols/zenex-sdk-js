import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, xdr, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import {
    loadTradingEntries,
    loadTradingEntriesBatch,
    crossCheckVaultTotalAssets,
    type TradingEntriesRequest,
} from '../../src/contracts/trading/trading_entries.js';
import {
    contractInstanceLedgerKey,
    tokenBalanceLedgerKey,
    tradingMarketDataLedgerKey,
    tradingPositionLedgerKey,
} from '../../src/ledger-keys.js';
import { Status, tradingConfigToScVal } from '../../src/contracts/trading/trading_types.js';
import { TradingContract } from '../../src/contracts/trading/trading_contract.js';
import { TreasuryContract } from '../../src/contracts/treasury/treasury_contract.js';
import { VaultContract } from '../../src/contracts/vault/vault_contract.js';
import { Network } from '../../src/index.js';
import {
    makeConfig,
    marketDataScVal,
    positionScVal,
    adlScVal,
    tradingInstanceScVal,
    vaultInstanceScVal,
    treasuryInstanceScVal,
    balanceMapScVal,
    ledgerEntryFor,
} from '../helpers/trading_state.js';

const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const RATE = 5n * 10n ** 16n;
const BALANCE = 50_000_000n;
const SUPPLY = 10_000_000_00n;

const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};

const request: TradingEntriesRequest = {
    trading: MARKET,
    vault: VAULT,
    treasury: TREASURY,
    collateralToken: TOKEN,
    user: USER,
    isLong: true,
};

/** The full six-entry result set a healthy market returns. */
function fullEntries(overrides: {
    omitPosition?: boolean;
    omitBalance?: boolean;
    treasuryRate?: bigint;
    tradingInstance?: xdr.ScVal;
} = {}) {
    const tradingInstance =
        overrides.tradingInstance ??
        tradingInstanceScVal({
            vault: VAULT,
            token: TOKEN,
            oracle: ORACLE,
            treasury: TREASURY,
            adl: [true, false],
        });
    const entries = [
        ledgerEntryFor(contractInstanceLedgerKey(MARKET), tradingInstance),
        ledgerEntryFor(tradingMarketDataLedgerKey(MARKET), marketDataScVal()),
        ledgerEntryFor(
            contractInstanceLedgerKey(VAULT),
            vaultInstanceScVal({
                asset: TOKEN,
                strategy: MARKET,
                totalSupply: SUPPLY,
                decimalsOffset: 1,
                shareDecimals: 8,
            }),
        ),
        ledgerEntryFor(
            contractInstanceLedgerKey(TREASURY),
            treasuryInstanceScVal(overrides.treasuryRate),
        ),
    ];
    if (!overrides.omitPosition) {
        entries.push(
            ledgerEntryFor(
                tradingPositionLedgerKey(MARKET, USER, true),
                positionScVal(),
            ),
        );
    }
    if (!overrides.omitBalance) {
        entries.push(
            ledgerEntryFor(
                tokenBalanceLedgerKey(TOKEN, VAULT),
                balanceMapScVal(BALANCE),
            ),
        );
    }
    return entries;
}

function mockEntries(entries: unknown[], latestLedger = 4242) {
    return vi
        .spyOn(rpc.Server.prototype, 'getLedgerEntries')
        .mockResolvedValue({ entries, latestLedger } as never);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('loadTradingEntries: single-market batched read', () => {
    it('decodes the full contract state from one getLedgerEntries call', async () => {
        const spy = mockEntries(fullEntries({ treasuryRate: RATE }));
        const snapshot = await loadTradingEntries(network, request);

        expect(spy).toHaveBeenCalledTimes(1);
        // 6 keys requested in a single call.
        expect(spy.mock.calls[0]).toHaveLength(6);

        expect(snapshot.ledger).toBe(4242);
        expect(snapshot.trading).toBe(MARKET);
        expect(snapshot.subject).toEqual({ user: USER, isLong: true });
        expect(snapshot.instance.config).toEqual(makeConfig());
        expect(snapshot.instance.status).toBe(Status.Active);
        expect(snapshot.instance.adl).toEqual({ long: true, short: false });
        expect(snapshot.market.notional).toEqual({ long: 1000n, short: 500n });
        expect(snapshot.position.notional).toBe(1000n);
        expect(snapshot.position.decreaseOrders).toEqual([3, 7]);
        expect(snapshot.treasuryRate).toBe(RATE);
        expect(snapshot.vaultBalanceAtomic).toBe(BALANCE);
        expect(snapshot.vault.totalSharesAtomic).toBe(SUPPLY);
        expect(snapshot.vaultAtomic).toEqual({
            totalAssets: BALANCE,
            totalSupply: SUPPLY,
            decimalsOffset: 1,
        });
    });

    it('demuxes by exact key bytes regardless of returned order', async () => {
        const entries = fullEntries({ treasuryRate: RATE });
        // Reverse the order the RPC returns entries in.
        mockEntries([...entries].reverse());
        const snapshot = await loadTradingEntries(network, request);
        expect(snapshot.position.notional).toBe(1000n);
        expect(snapshot.vaultBalanceAtomic).toBe(BALANCE);
    });

    it('zeroes an absent position (never-opened side) instead of misreading', async () => {
        mockEntries(fullEntries({ omitPosition: true, treasuryRate: RATE }));
        const snapshot = await loadTradingEntries(network, request);
        expect(snapshot.position).toEqual({
            margin: 0n,
            notional: 0n,
            tokens: 0n,
            fundingIdx: 0n,
            borrowingIdx: 0n,
            lockedNotional: 0n,
            unlocksAt: 0n,
            pricedAt: 0n,
            decreaseOrders: [],
        });
    });

    it('reads an absent vault balance as 0 assets', async () => {
        mockEntries(fullEntries({ omitBalance: true, treasuryRate: RATE }));
        const snapshot = await loadTradingEntries(network, request);
        expect(snapshot.vaultBalanceAtomic).toBe(0n);
        expect(snapshot.vaultAtomic.totalAssets).toBe(0n);
    });

    it('defaults the treasury rate to 0 when the Rate key is absent', async () => {
        mockEntries(fullEntries()); // treasuryRate omitted
        const snapshot = await loadTradingEntries(network, request);
        expect(snapshot.treasuryRate).toBe(0n);
    });

    it('throws MISSING_STATE when the trading instance is absent', async () => {
        const entries = fullEntries({ treasuryRate: RATE }).filter(
            (entry) =>
                entry.key.toXDR('base64') !==
                contractInstanceLedgerKey(MARKET).toXDR('base64'),
        );
        mockEntries(entries);
        await expect(loadTradingEntries(network, request)).rejects.toMatchObject({
            code: 'MISSING_STATE',
        });
    });

    it('fails closed on a RETURNED-but-TTL-expired position instead of decoding it live', async () => {
        // latestLedger is 4242; a liveUntilLedgerSeq behind it means the entry
        // is expired but not yet evicted. Decoding it as a live position (or
        // falling through to "absent -> zeroed") would fail open.
        const entries = fullEntries({ omitPosition: true, treasuryRate: RATE });
        entries.push(
            ledgerEntryFor(
                tradingPositionLedgerKey(MARKET, USER, true),
                positionScVal(),
                4241,
            ),
        );
        mockEntries(entries);
        await expect(loadTradingEntries(network, request)).rejects.toMatchObject(
            {
                code: 'MISSING_STATE',
                message: expect.stringMatching(/TTL-expired/),
            },
        );
    });

    it('fails closed on TTL-expired MarketData and Balance entries too', async () => {
        const expiredMarket = fullEntries({ treasuryRate: RATE }).map((entry) =>
            entry.key.toXDR('base64') ===
            tradingMarketDataLedgerKey(MARKET).toXDR('base64')
                ? ledgerEntryFor(
                      tradingMarketDataLedgerKey(MARKET),
                      marketDataScVal(),
                      4241,
                  )
                : entry,
        );
        mockEntries(expiredMarket);
        await expect(loadTradingEntries(network, request)).rejects.toMatchObject(
            { code: 'MISSING_STATE' },
        );
        vi.restoreAllMocks();

        const expiredBalance = fullEntries({ treasuryRate: RATE }).map(
            (entry) =>
                entry.key.toXDR('base64') ===
                tokenBalanceLedgerKey(TOKEN, VAULT).toXDR('base64')
                    ? ledgerEntryFor(
                          tokenBalanceLedgerKey(TOKEN, VAULT),
                          balanceMapScVal(BALANCE),
                          4241,
                      )
                    : entry,
        );
        mockEntries(expiredBalance);
        await expect(loadTradingEntries(network, request)).rejects.toMatchObject(
            { code: 'MISSING_STATE' },
        );
    });

    it('accepts an entry whose TTL equals the latest ledger (still live)', async () => {
        const entries = fullEntries({ omitPosition: true, treasuryRate: RATE });
        entries.push(
            ledgerEntryFor(
                tradingPositionLedgerKey(MARKET, USER, true),
                positionScVal(),
                4242,
            ),
        );
        mockEntries(entries);
        const snapshot = await loadTradingEntries(network, request);
        expect(snapshot.position.notional).toBe(1000n);
    });
});

describe('loadTradingEntriesBatch: positions-list batching', () => {
    it('reads two markets in a SINGLE getLedgerEntries call', async () => {
        const MARKET2 = StrKey.encodeContract(Buffer.alloc(32, 11));
        const VAULT2 = StrKey.encodeContract(Buffer.alloc(32, 12));
        const TOKEN2 = StrKey.encodeContract(Buffer.alloc(32, 13));
        const TREASURY2 = StrKey.encodeContract(Buffer.alloc(32, 15));
        const request2: TradingEntriesRequest = {
            trading: MARKET2,
            vault: VAULT2,
            treasury: TREASURY2,
            collateralToken: TOKEN2,
            user: USER,
            isLong: false,
        };
        const market2Entries = [
            ledgerEntryFor(
                contractInstanceLedgerKey(MARKET2),
                tradingInstanceScVal({
                    vault: VAULT2,
                    token: TOKEN2,
                    oracle: ORACLE,
                    treasury: TREASURY2,
                }),
            ),
            ledgerEntryFor(tradingMarketDataLedgerKey(MARKET2), marketDataScVal()),
            ledgerEntryFor(
                contractInstanceLedgerKey(VAULT2),
                vaultInstanceScVal({ asset: TOKEN2, strategy: MARKET2, totalSupply: 7n, decimalsOffset: 0, shareDecimals: 6 }),
            ),
            ledgerEntryFor(contractInstanceLedgerKey(TREASURY2), treasuryInstanceScVal(3n)),
            // Market 2's short side was never opened: no Position, no balance.
        ];

        const spy = mockEntries([
            ...fullEntries({ treasuryRate: RATE }),
            ...market2Entries,
        ]);

        const snapshots = await loadTradingEntriesBatch(network, [request, request2]);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toHaveLength(12); // 6 keys x 2 markets
        expect(snapshots).toHaveLength(2);
        expect(snapshots[0].trading).toBe(MARKET);
        expect(snapshots[0].position.notional).toBe(1000n);
        expect(snapshots[1].trading).toBe(MARKET2);
        expect(snapshots[1].position.notional).toBe(0n); // absent -> zeroed
        expect(snapshots[1].vaultBalanceAtomic).toBe(0n); // absent -> 0
        expect(snapshots[1].treasuryRate).toBe(3n);
    });

    it('guards the cross-market request cap before hitting the RPC', async () => {
        const spy = mockEntries([]);
        const many = Array.from({ length: 31 }, () => request); // 186 keys > 180
        await expect(loadTradingEntriesBatch(network, many)).rejects.toMatchObject(
            { code: 'INVALID_INPUT' },
        );
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('crossCheckVaultTotalAssets', () => {
    it('passes when the entries balance matches the simulated total_assets', async () => {
        mockEntries(fullEntries({ treasuryRate: RATE }));
        const snapshot = await loadTradingEntries(network, request);
        expect(() =>
            crossCheckVaultTotalAssets(snapshot, BALANCE),
        ).not.toThrow();
    });

    it('throws on drift between the entries balance and the sim', async () => {
        mockEntries(fullEntries({ treasuryRate: RATE }));
        const snapshot = await loadTradingEntries(network, request);
        expect(() =>
            crossCheckVaultTotalAssets(snapshot, BALANCE + 1n),
        ).toThrow(/drift/);
    });
});

describe('entries-vs-sim differential', () => {
    // The entries path and the simulated multicall path decode the SAME stored
    // ScVals. Prove they yield identical typed state before relying on entries.
    it('decodes config/market/position/adl/rate/supply identically to the sim parsers', async () => {
        mockEntries(fullEntries({ treasuryRate: RATE }));
        const entries = await loadTradingEntries(network, request);

        // The fixture builds Config from makeConfig() via tradingConfigToScVal;
        // reproduce the same encoding for the sim-parser comparison.
        const configXdr = tradingConfigToScVal(makeConfig()).toXDR('base64');
        expect(entries.instance.config).toEqual(
            TradingContract.parsers.getConfig(configXdr),
        );
        expect(entries.market).toEqual(
            TradingContract.parsers.getMarketData(marketDataScVal().toXDR('base64')),
        );
        expect(entries.position).toEqual(
            TradingContract.parsers.getPosition(positionScVal().toXDR('base64')),
        );
        expect(entries.instance.adl).toEqual(
            TradingContract.parsers.getAdl(adlScVal(true, false).toXDR('base64')),
        );
        expect(entries.treasuryRate).toEqual(
            TreasuryContract.parsers.getRate(
                nativeToScVal(RATE, { type: 'i128' }).toXDR('base64'),
            ),
        );
        expect(entries.vault.totalSharesAtomic).toEqual(
            VaultContract.parsers.totalSupply(
                nativeToScVal(SUPPLY, { type: 'i128' }).toXDR('base64'),
            ),
        );
        expect(entries.vaultBalanceAtomic).toEqual(
            VaultContract.parsers.totalAssets(
                nativeToScVal(BALANCE, { type: 'i128' }).toXDR('base64'),
            ),
        );
    });
});
