import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, xdr, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { MarketUser } from '../../src/trading/user.js';
import { Market } from '../../src/trading/market.js';
import { marketContext } from '../../src/trading/order.js';
import { Price } from '../../src/trading/price.js';
import { loadTokenBalance, loadTokenBalances } from '../../src/token.js';
import { loadTreasuryInstance, loadTreasuryRate } from '../../src/trading/treasury.js';
import { contractInstanceLedgerKey } from '../../src/contracts/keys.js';
import {
    marketClaimableFundingLedgerKey,
    marketDataLedgerKey,
    marketOrderCounterLedgerKey,
    marketPositionLedgerKey,
} from '../../src/contracts/market/keys.js';
import { tokenBalanceLedgerKey } from '../../src/token.js';
import type { Network } from '../../src/index.js';
import type { PriceData } from '../../src/trading/internal/math.js';
import {
    marketDataScVal,
    positionScVal,
    marketInstanceScVal,
    vaultInstanceScVal,
    treasuryInstanceScVal,
    balanceMapScVal,
    ledgerEntryFor,
} from '../helpers/market_state.js';

const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER_MARKET = StrKey.encodeContract(Buffer.alloc(32, 9));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const USER_B = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));
const RATE = 5n * 10n ** 16n;

const network: Network = {
    rpc: 'http://localhost:1337',
    passphrase: 'Test SDF Network ; September 2015',
    opts: { allowHttp: true },
};
const contracts = { market: MARKET, vault: VAULT, token: TOKEN };

function mockEntries(entries: unknown[], latestLedger = 4242) {
    return vi
        .spyOn(rpc.Server.prototype, 'getLedgerEntries')
        .mockResolvedValue({ entries, latestLedger } as never);
}

function userEntries(
    user: string,
    opts: { long?: boolean; short?: boolean; counter?: number; funding?: bigint } = {},
) {
    const entries = [];
    if (opts.long !== false) {
        entries.push(
            ledgerEntryFor(marketPositionLedgerKey(MARKET, user, true), positionScVal()),
        );
    }
    if (opts.short) {
        entries.push(
            ledgerEntryFor(marketPositionLedgerKey(MARKET, user, false), positionScVal()),
        );
    }
    if (opts.counter !== undefined) {
        entries.push(
            ledgerEntryFor(
                marketOrderCounterLedgerKey(MARKET, user),
                nativeToScVal(opts.counter, { type: 'u32' }),
            ),
        );
    }
    if (opts.funding !== undefined) {
        entries.push(
            ledgerEntryFor(
                marketClaimableFundingLedgerKey(MARKET, user),
                nativeToScVal(opts.funding, { type: 'i128' }),
            ),
        );
    }
    return entries;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('MarketUser.load', () => {
    it('reads both sides, the counter and claimable funding in one call', async () => {
        const spy = mockEntries(
            userEntries(USER, { short: true, counter: 7, funding: 250n }),
        );
        const user = await MarketUser.load(network, MARKET, USER);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toHaveLength(4);
        expect(user.userId).toBe(USER);
        expect(user.marketId).toBe(MARKET);
        expect(user.orderCounter).toBe(7);
        expect(user.claimableFunding).toBe(250n);
        expect(user.long.isOpen()).toBe(true);
        expect(user.short.isOpen()).toBe(true);
    });

    it('reads a never-opened side as Position::zeroed rather than an error', async () => {
        mockEntries(userEntries(USER, { short: false }));
        const user = await MarketUser.load(network, MARKET, USER);

        const short = user.short;
        expect(short.isLong).toBe(false);
        expect(short.notional).toBe(0n);
        expect(short.margin).toBe(0n);
        expect(short.decreaseOrders).toEqual([]);
        expect(short.isOpen()).toBe(false);
    });

    it('gives each zeroed side its own decreaseOrders array', async () => {
        mockEntries([]);
        const user = await MarketUser.load(network, MARKET, USER);
        expect(user.long.decreaseOrders).not.toBe(user.short.decreaseOrders);
    });

    it('defaults an absent counter to 0, since the contract allocates from 1', async () => {
        mockEntries(userEntries(USER));
        const user = await MarketUser.load(network, MARKET, USER);
        expect(user.orderCounter).toBe(0);
        expect(user.claimableFunding).toBe(0n);
    });

    it('stamps each side with the key it was read from', async () => {
        mockEntries(userEntries(USER, { short: true }));
        const user = await MarketUser.load(network, MARKET, USER);
        expect(user.long.isLong).toBe(true);
        expect(user.short.isLong).toBe(false);
    });
});

describe('marketContext', () => {
    const price: PriceData = {
        feedId: Buffer.alloc(32, 1),
        bid: 100n,
        ask: 101n,
        publishTime: 1_000n,
    };

    async function loadPair() {
        mockEntries([
            ledgerEntryFor(
                contractInstanceLedgerKey(MARKET),
                marketInstanceScVal({
                    vault: VAULT,
                    token: TOKEN,
                    oracle: ORACLE,
                    treasury: TREASURY,
                    adl: [false, true],
                }),
            ),
            ledgerEntryFor(marketDataLedgerKey(MARKET), marketDataScVal()),
            ledgerEntryFor(
                contractInstanceLedgerKey(VAULT),
                vaultInstanceScVal({
                    asset: TOKEN,
                    strategy: MARKET,
                    totalSupply: 1_000n,
                    decimalsOffset: 1,
                    shareDecimals: 8,
                }),
            ),
            ledgerEntryFor(tokenBalanceLedgerKey(TOKEN, VAULT), balanceMapScVal(500n)),
            ...userEntries(USER),
        ]);
        const market = await Market.load(network, contracts);
        const user = await MarketUser.load(network, MARKET, USER);
        return { market, user };
    }

    it('composes market, position and a caller-supplied price', async () => {
        const { market, user } = await loadPair();
        const context = marketContext(
            market,
            user.long,
            new Price(price.bid, price.ask, price.publishTime),
            1_500n,
            USER,
        );

        expect(context.subject).toEqual({ user: USER, isLong: true });
        expect(context.ledger).toBe(4242);
        expect(context.ledgerTime).toBe(1_500n);
        expect(context.config).toEqual(market.config);
        expect(context.market).toBe(market.data);
        expect(context.position).toBe(user.long);
        expect(context.price.bid).toBe(price.bid);
        expect(context.price.ask).toBe(price.ask);
        expect(context.vault).toEqual(market.vaultAtomic());
        expect(context.treasuryRate).toBe(0n);
        expect(context.adl).toEqual({ long: false, short: true });
        expect(context.collateralToken).toBe(TOKEN);
    });

    it('falls back to the wall clock, which the entries read cannot supply', async () => {
        const { market, user } = await loadPair();
        const before = BigInt(Math.floor(Date.now() / 1000));
        const context = marketContext(market, user.long, 100n * 10n ** 18n);
        expect(context.ledgerTime).toBeGreaterThanOrEqual(before);
    });
});

describe('MarketUser.claimable', () => {
    it('caps the payout at what the funding pool holds', async () => {
        mockEntries(userEntries(USER, { funding: 250n }));
        const user = await MarketUser.load(network, MARKET, USER);
        const poor = { data: { fundingPool: 40n } } as never;
        const rich = { data: { fundingPool: 1_000n } } as never;
        const drained = { data: { fundingPool: -5n } } as never;
        expect(user.claimable(poor)).toBe(40n);
        expect(user.claimable(rich)).toBe(250n);
        expect(user.claimable(drained)).toBe(0n);
    });
});

describe('token balance', () => {
    function mockBalanceSim(amount: bigint) {
        return vi
            .spyOn(rpc.Server.prototype, 'simulateTransaction')
            .mockResolvedValue({
                latestLedger: 4242,
                transactionData: {},
                minResourceFee: '1',
                result: { retval: nativeToScVal(amount, { type: 'i128' }), auth: [] },
                events: [],
                _parsed: true,
            } as never);
    }

    // The property that matters: ONE path for every holder and every token.
    // Where a balance physically lives varies by both -- a classic account's
    // SAC balance is a trustline, not contract data -- so reading the ledger
    // key would report a confident zero for a funded account.
    it('reads a classic holder through the token, not through a ledger key', async () => {
        const spy = mockBalanceSim(522_235_922_427n);
        expect(await loadTokenBalance(network, TOKEN, USER)).toBe(522_235_922_427n);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('reads a contract holder the same way, with no branch', async () => {
        const vaultHolder = StrKey.encodeContract(Buffer.alloc(32, 21));
        mockBalanceSim(4_248_930_129_558n);
        expect(await loadTokenBalance(network, TOKEN, vaultHolder)).toBe(
            4_248_930_129_558n,
        );
    });

    it('needs no classic Asset, so a share token works too', async () => {
        // The vault's share token is a pure-Soroban fungible with no
        // code/issuer; `getAssetBalance` could not address it at all.
        mockBalanceSim(4_995_000_000_000_000_000n);
        expect(await loadTokenBalance(network, VAULT, USER)).toBe(
            4_995_000_000_000_000_000n,
        );
    });

    it('reads several tokens for one holder, in request order', async () => {
        const other = StrKey.encodeContract(Buffer.alloc(32, 11));
        let call = 0;
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockImplementation(
            async () =>
                ({
                    latestLedger: 4242,
                    result: { retval: nativeToScVal(++call === 1 ? 42n : 7n, { type: 'i128' }), auth: [] },
                    _parsed: true,
                }) as never,
        );
        expect(await loadTokenBalances(network, [TOKEN, other], USER)).toEqual([42n, 7n]);
    });

    it('surfaces a failed simulation rather than reporting zero', async () => {
        vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
            latestLedger: 1,
            error: 'boom',
            _parsed: true,
        } as never);
        await expect(loadTokenBalance(network, TOKEN, USER)).rejects.toThrow(
            /Simulation failed/,
        );
    });
});

describe('loadTreasuryRate', () => {
    it('reads the rate from the treasury instance', async () => {
        const spy = mockEntries([
            ledgerEntryFor(contractInstanceLedgerKey(TREASURY), treasuryInstanceScVal(RATE)),
        ]);
        expect(await loadTreasuryRate(network, TREASURY)).toBe(RATE);
        expect(spy.mock.calls[0]).toHaveLength(1);
    });

    it('reads an absent Rate key as the contract default of zero', async () => {
        mockEntries([
            ledgerEntryFor(contractInstanceLedgerKey(TREASURY), treasuryInstanceScVal()),
        ]);
        expect(await loadTreasuryRate(network, TREASURY)).toBe(0n);
    });

    it('reads the owner from the same key, with no extra call', async () => {
        const owner = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
        const spy = mockEntries([
            ledgerEntryFor(
                contractInstanceLedgerKey(TREASURY),
                treasuryInstanceScVal(RATE, owner),
            ),
        ]);
        const state = await loadTreasuryInstance(network, TREASURY);
        expect(state).toEqual({ rate: RATE, owner });
        expect(spy.mock.calls[0]).toHaveLength(1);
    });

    it('fails closed when the treasury instance is absent', async () => {
        mockEntries([]);
        await expect(loadTreasuryRate(network, TREASURY)).rejects.toMatchObject({
            code: 'MISSING_STATE',
        });
    });
});
