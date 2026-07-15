import {
    Address,
    StrKey,
    nativeToScVal,
    rpc,
    scValToNative,
    xdr,
} from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import { loadTradingSnapshot } from '../../src/trading/trading_snapshot.js';
import type {
    TradingDeployment,
    TradingSnapshotRequest,
} from '../../src/trading/trading_snapshot.js';
import {
    Status,
    tradingConfigToScVal,
} from '../../src/trading/trading_types.js';
import type {
    MarketData,
    Position,
    SidePair,
    TradingConfig,
} from '../../src/trading/trading_types.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 1));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 2));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 3));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const COLLATERAL = StrKey.encodeContract(Buffer.alloc(32, 6));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 7));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));

const deployment: TradingDeployment = {
    trading: TRADING,
    router: ROUTER,
    vault: VAULT,
    priceVerifier: VERIFIER,
    treasury: TREASURY,
    feedId: 7,
    exponent: -8,
    vaultDecimalsOffset: 11,
    vaultShareDecimals: 18,
};

const request: TradingSnapshotRequest = {
    network: {
        rpc: 'http://localhost:1337',
        passphrase: 'Test SDF Network ; September 2015',
        opts: { allowHttp: true },
    },
    deployment,
    user: USER,
    isLong: true,
    priceUpdate: new Uint8Array([1, 2, 3]),
    maxPriceAge: 30n,
};

function pair(long = 0n, short = 0n): SidePair {
    return { long, short };
}

function config(): TradingConfig {
    return {
        keeperRate: 0n,
        minPositionNotional: 1n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1n,
        minOrderCollateral: 1n,
        execFee: 2n,
        feeDom: 0n,
        feeNonDom: 0n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: SCALAR_18,
        maxUtilWithdraw: SCALAR_18,
        initMargin: 100_000_000_000_000_000n,
        maintenanceMargin: 50_000_000_000_000_000n,
        liqFee: 0n,
        notionalLock: 15n,
        targetUtil: 800_000_000_000_000_000n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: 500_000_000_000_000_000n,
        adlClearTarget: 400_000_000_000_000_000n,
        maxPnlTrader: 900_000_000_000_000_000n,
        maxPnlWithdraw: 150_000_000_000_000_000n,
        redeemLock: 0n,
        depositFee: 0n,
        redeemFee: 0n,
        minDeposit: 1n,
        maxVaultBalance: 10_000_000_000_000n,
    };
}

const expectedMarket: MarketData = {
    notional: pair(100n, 50n),
    collateral: pair(20n, 10n),
    tokens: pair(100_000_000_000n, 50_000_000_000n),
    fundingIdx: pair(1n, 2n),
    borrowingIdx: pair(3n, 4n),
    fundingRate: 5n,
    fundingUpdate: 90n,
    borrowingUpdate: 91n,
    fundingPool: 6n,
    fundingOwed: 7n,
    lastPriceTime: 92n,
};

const expectedPosition: Position = {
    collateral: 20n,
    notional: 100n,
    tokens: 100_000_000_000n,
    fundingIdx: 1n,
    borrowingIdx: 3n,
    lockedNotional: 0n,
    unlocksAt: 0n,
    pricedAt: 92n,
    decreaseOrders: [2, 4],
};

function entry(key: string, value: xdr.ScVal): xdr.ScMapEntry {
    return new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol(key),
        val: value,
    });
}

function i128(value: bigint): xdr.ScVal {
    return nativeToScVal(value, { type: 'i128' });
}

function u64(value: bigint): xdr.ScVal {
    return nativeToScVal(value, { type: 'u64' });
}

function pairScVal(value: SidePair): xdr.ScVal {
    return xdr.ScVal.scvMap([
        entry('long', i128(value.long)),
        entry('short', i128(value.short)),
    ]);
}

function marketScVal(value: MarketData): xdr.ScVal {
    return xdr.ScVal.scvMap([
        entry('borrowing_idx', pairScVal(value.borrowingIdx)),
        entry('borrowing_update', u64(value.borrowingUpdate)),
        entry('collateral', pairScVal(value.collateral)),
        entry('funding_idx', pairScVal(value.fundingIdx)),
        entry('funding_owed', i128(value.fundingOwed)),
        entry('funding_pool', i128(value.fundingPool)),
        entry('funding_rate', i128(value.fundingRate)),
        entry('funding_update', u64(value.fundingUpdate)),
        entry('last_price_time', u64(value.lastPriceTime)),
        entry('notional', pairScVal(value.notional)),
        entry('tokens', pairScVal(value.tokens)),
    ]);
}

function positionScVal(value: Position): xdr.ScVal {
    return xdr.ScVal.scvMap([
        entry('borrowing_idx', i128(value.borrowingIdx)),
        entry('collateral', i128(value.collateral)),
        entry(
            'decrease_orders',
            xdr.ScVal.scvVec(
                value.decreaseOrders.map((id) => xdr.ScVal.scvU32(id)),
            ),
        ),
        entry('funding_idx', i128(value.fundingIdx)),
        entry('locked_notional', i128(value.lockedNotional)),
        entry('notional', i128(value.notional)),
        entry('priced_at', u64(value.pricedAt)),
        entry('tokens', i128(value.tokens)),
        entry('unlocks_at', u64(value.unlocksAt)),
    ]);
}

function address(value: string): xdr.ScVal {
    return Address.fromString(value).toScVal();
}

function priceScVal(
    overrides: Partial<{
        feedId: number;
        exponent: number;
        bid: bigint;
        ask: bigint;
        publishTime: bigint;
    }> = {},
): xdr.ScVal {
    const value = {
        feedId: 7,
        exponent: -8,
        bid: 1_000_000_000n,
        ask: 1_010_000_000n,
        publishTime: 95n,
        ...overrides,
    };
    return xdr.ScVal.scvMap([
        entry('ask', i128(value.ask)),
        entry('bid', i128(value.bid)),
        entry('exponent', xdr.ScVal.scvI32(value.exponent)),
        entry('feed_id', xdr.ScVal.scvU32(value.feedId)),
        entry('publish_time', u64(value.publishTime)),
    ]);
}

const indexes = {
    config: 0,
    market: 1,
    position: 2,
    status: 3,
    retirement: 4,
    feed: 5,
    token: 6,
    vault: 7,
    treasury: 8,
    verifier: 9,
    totalAssets: 10,
    totalSupply: 11,
    vaultAsset: 12,
    vaultStrategy: 13,
    treasuryRate: 14,
    price: 15,
} as const;

function snapshotValues(): xdr.ScVal[] {
    return [
        tradingConfigToScVal(config()),
        marketScVal(expectedMarket),
        positionScVal(expectedPosition),
        xdr.ScVal.scvU32(Status.Active),
        xdr.ScVal.scvVoid(),
        xdr.ScVal.scvVec([
            xdr.ScVal.scvU32(deployment.feedId),
            xdr.ScVal.scvI32(deployment.exponent),
        ]),
        address(COLLATERAL),
        address(VAULT),
        address(TREASURY),
        address(VERIFIER),
        i128(10_000n),
        i128(9_000_000n),
        address(COLLATERAL),
        address(TRADING),
        i128(30_000_000_000_000_000n),
        priceScVal(),
    ];
}

function header(sequence = 42, closeTime = '100') {
    return { sequence, closeTime } as never;
}

function simulation(values = snapshotValues(), latestLedger = 42) {
    return {
        latestLedger,
        events: [],
        transactionData: {},
        minResourceFee: '0',
        result: {
            auth: [],
            xdr: '',
            retval: xdr.ScVal.scvVec(values),
        },
    } as never;
}

function mockSuccess(values = snapshotValues()) {
    const latest = vi
        .spyOn(rpc.Server.prototype, 'getLatestLedger')
        .mockResolvedValue(header());
    const simulate = vi
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue(simulation(values));
    return { latest, simulate };
}

function decodedMulticall(
    transaction: Parameters<rpc.Server['simulateTransaction']>[0],
) {
    const envelope = transaction.toEnvelope();
    const operation = envelope.v1().tx().operations()[0];
    const invoke = operation
        .body()
        .invokeHostFunctionOp()
        .hostFunction()
        .invokeContract();
    return {
        contract: Address.fromScAddress(invoke.contractAddress()).toString(),
        func: invoke.functionName().toString(),
        calls: (invoke.args()[0].vec() ?? []).map(
            (call) => scValToNative(call) as Record<string, unknown>,
        ),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('loadTradingSnapshot', () => {
    it('loads every required view in one router multicall and one simulation', async () => {
        const { latest, simulate } = mockSuccess();
        const result = await loadTradingSnapshot(request);

        expect(latest).toHaveBeenCalledTimes(1);
        expect(simulate).toHaveBeenCalledTimes(1);
        const decoded = decodedMulticall(simulate.mock.calls[0][0]);
        expect(decoded.contract).toBe(ROUTER);
        expect(decoded.func).toBe('multicall_try');
        expect(decoded.calls).toHaveLength(16);
        expect(decoded.calls.map((call) => call.func)).toEqual([
            'get_config',
            'get_market_data',
            'get_position',
            'get_status',
            'get_retirement',
            'get_feed',
            'get_token',
            'get_vault',
            'get_treasury',
            'get_price_verifier',
            'total_assets',
            'total_supply',
            'query_asset',
            'get_strategy',
            'get_rate',
            'verify_price',
        ]);
        expect(decoded.calls[2]).toMatchObject({
            contract: TRADING,
            args: [USER, true],
        });
        expect(decoded.calls[15]).toMatchObject({
            contract: VERIFIER,
            args: [Buffer.from([1, 2, 3]), 7, -8],
        });

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.ledger).toBe(42);
        expect(result.priceTime).toBe(95n);
        expect(result.value).toEqual({
            ledger: 42,
            ledgerTime: 100n,
            deployment,
            status: Status.Active,
            retirement: undefined,
            config: config(),
            market: expectedMarket,
            position: expectedPosition,
            price: {
                feedId: 7,
                exponent: -8,
                bid: 1_000_000_000n,
                ask: 1_010_000_000n,
                publishTime: 95n,
                source: 'pyth',
            },
            priceUpdate: new Uint8Array([1, 2, 3]),
            vault: {
                totalAssets: 10_000n,
                totalSupply: 9_000_000n,
                decimalsOffset: 11,
            },
            treasuryRate: 30_000_000_000_000_000n,
        });
    });

    it('uses a nonzero retirement price as the terminal mark', async () => {
        const values = snapshotValues();
        values[indexes.retirement] = xdr.ScVal.scvVec([
            i128(777_000_000n),
            u64(80n),
        ]);
        values[indexes.price] = xdr.ScVal.scvError(
            xdr.ScError.sceContract(601),
        );
        mockSuccess(values);

        const result = await loadTradingSnapshot(request);

        expect(result.kind).toBe('exact');
        if (result.kind !== 'exact') return;
        expect(result.value.retirement).toEqual([777_000_000n, 80n]);
        expect(result.value.price).toEqual({
            feedId: 7,
            exponent: -8,
            bid: 777_000_000n,
            ask: 777_000_000n,
            publishTime: 100n,
            source: 'terminal',
        });
        expect(result.priceTime).toBe(100n);
    });

    it('requires verifier success while Pyth pricing is authoritative', async () => {
        const values = snapshotValues();
        values[indexes.price] = xdr.ScVal.scvError(
            xdr.ScError.sceContract(601),
        );
        mockSuccess(values);

        const result = await loadTradingSnapshot(request);

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'MISSING_STATE',
            reason: expect.stringContaining('price verifier call failed'),
        });
    });

    it('retries the complete read once when header and simulation differ', async () => {
        const latest = vi
            .spyOn(rpc.Server.prototype, 'getLatestLedger')
            .mockResolvedValueOnce(header(41, '99'))
            .mockResolvedValueOnce(header(42, '100'));
        const simulate = vi
            .spyOn(rpc.Server.prototype, 'simulateTransaction')
            .mockResolvedValue(simulation());

        const result = await loadTradingSnapshot(request);

        expect(result.kind).toBe('exact');
        expect(latest).toHaveBeenCalledTimes(2);
        expect(simulate).toHaveBeenCalledTimes(2);
    });

    it('fails closed when the retry still observes different ledgers', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLatestLedger')
            .mockResolvedValueOnce(header(40, '98'))
            .mockResolvedValueOnce(header(41, '99'));
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue(
            simulation(snapshotValues(), 42),
        );

        await expect(loadTradingSnapshot(request)).resolves.toEqual({
            kind: 'unavailable',
            code: 'INCONSISTENT_LEDGER',
            reason: expect.stringContaining('header ledger 41'),
        });
    });

    it.each([
        ['vault address', indexes.vault, address(OTHER)],
        ['treasury address', indexes.treasury, address(OTHER)],
        ['price verifier address', indexes.verifier, address(OTHER)],
        [
            'feed identity',
            indexes.feed,
            xdr.ScVal.scvVec([xdr.ScVal.scvU32(8), xdr.ScVal.scvI32(-8)]),
        ],
        ['collateral mapping', indexes.vaultAsset, address(OTHER)],
        ['vault strategy market', indexes.vaultStrategy, address(OTHER)],
    ])('rejects a mismatched %s', async (_label, index, replacement) => {
        const values = snapshotValues();
        values[index as number] = replacement as xdr.ScVal;
        mockSuccess(values);

        const result = await loadTradingSnapshot(request);

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('snapshot identity mismatch'),
        });
    });

    it('rejects state assembled from another collateral or market', async () => {
        const values = snapshotValues();
        values[indexes.token] = address(OTHER);
        values[indexes.vaultStrategy] = address(OTHER);
        mockSuccess(values);

        const result = await loadTradingSnapshot(request);

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.code).toBe('INVALID_INPUT');
        expect(result.reason).toContain('single market');
    });

    it('rejects a stale Pyth result without converting it to an estimate', async () => {
        const values = snapshotValues();
        values[indexes.price] = priceScVal({ publishTime: 69n });
        mockSuccess(values);

        await expect(loadTradingSnapshot(request)).resolves.toEqual({
            kind: 'unavailable',
            code: 'STALE_PRICE',
            reason: expect.stringContaining('31 seconds old'),
        });
    });

    it('rejects malformed or crossed verified prices', async () => {
        const values = snapshotValues();
        values[indexes.price] = priceScVal({
            bid: 1_020_000_000n,
            ask: 1_010_000_000n,
        });
        mockSuccess(values);

        const result = await loadTradingSnapshot(request);

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('positive uncrossed'),
        });
    });

    it('does not decode a malformed result as an absent position', async () => {
        mockSuccess(snapshotValues().slice(0, indexes.position));

        const result = await loadTradingSnapshot(request);

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'MISSING_STATE',
            reason: expect.stringContaining('16 results'),
        });
    });

    it('rejects an isolated state-read failure even with a usable price', async () => {
        const values = snapshotValues();
        values[indexes.position] = xdr.ScVal.scvError(
            xdr.ScError.sceContract(720),
        );
        mockSuccess(values);

        const result = await loadTradingSnapshot(request);

        expect(result).toEqual({
            kind: 'unavailable',
            code: 'MISSING_STATE',
            reason: 'snapshot state 2 call failed with contract error #720',
        });
    });

    it('returns unavailable on an RPC failure', async () => {
        vi.spyOn(rpc.Server.prototype, 'getLatestLedger').mockRejectedValue(
            new Error('rpc down'),
        );

        await expect(loadTradingSnapshot(request)).resolves.toEqual({
            kind: 'unavailable',
            code: 'MISSING_STATE',
            reason: 'rpc down',
        });
    });

    it('maps malformed request structures to INVALID_INPUT', async () => {
        const malformed = {
            ...request,
            deployment: undefined,
        } as unknown as TradingSnapshotRequest;

        await expect(loadTradingSnapshot(malformed)).resolves.toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: 'deployment must be an object',
        });
    });

    it.each([
        ['negative offset', { vaultDecimalsOffset: -1 }],
        ['offset above 38', { vaultDecimalsOffset: 39 }],
        ['fractional offset', { vaultDecimalsOffset: 11.5 }],
        ['negative share decimals', { vaultShareDecimals: -1 }],
        ['share decimals above 38', { vaultShareDecimals: 39 }],
        ['fractional share decimals', { vaultShareDecimals: 18.5 }],
        [
            'share decimals below the offset',
            { vaultDecimalsOffset: 11, vaultShareDecimals: 10 },
        ],
    ])('rejects %s', async (_label, override) => {
        const malformed = {
            ...request,
            deployment: { ...deployment, ...override },
        };

        await expect(loadTradingSnapshot(malformed)).resolves.toEqual({
            kind: 'unavailable',
            code: 'INVALID_INPUT',
            reason: expect.stringContaining('vault'),
        });
    });

    it.each([-39, 1, -8.5])(
        'rejects invalid price exponent %s',
        async (exponent) => {
            const malformed = {
                ...request,
                deployment: { ...deployment, exponent },
            };

            await expect(loadTradingSnapshot(malformed)).resolves.toEqual({
                kind: 'unavailable',
                code: 'INVALID_INPUT',
                reason: expect.stringContaining('price exponent'),
            });
        },
    );
});
