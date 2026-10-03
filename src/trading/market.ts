import { scValToNative } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import type {
    AdlState,
    MarketData,
    Status,
    MarketConfig,
} from '../contracts/market/types.js';
import { parseMarketData } from '../contracts/market/types.js';
import { parseMarketInstance } from '../contracts/market/instance.js';
import type { MarketInstanceState } from '../contracts/market/instance.js';
import { parseOracleInstance } from '../contracts/oracle/instance.js';
import { parseTreasuryRate } from '../contracts/treasury/instance.js';
import { parseVaultInstance } from '../contracts/vault/instance.js';
import { contractInstanceLedgerKey } from '../contracts/keys.js';
import { marketDataLedgerKey } from '../contracts/market/keys.js';
import { tokenBalanceLedgerKey, tokenBalanceOrZero } from '../token.js';
import { MarketStateError, readEntries } from '../entries.js';
import type { EntryBatch } from '../entries.js';
import { MarketUser, decodeUser, marketUserKeys } from './user.js';
import type { PriceInput } from './price.js';
import { Price, marketPrice, quoteTime } from './price.js';
import type { MarketEstimate } from './market_est.js';
import { estimateMarket } from './market_est.js';
import {
    advanceFunding,
    advanceMarketAccruals,
    borrowingRate,
    marketSidePnl,
    reserveUtilization,
    sideCapacity,
    sideReserved,
} from './internal/math.js';
import {
    cappedNetPnl,
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
} from './internal/vault.js';
import type { VaultAtomicState } from './internal/vault.js';
import type { PriceData } from './internal/math.js';

/**
 * The contracts a market is read from. The load checks every address given
 * against the market's own wiring.
 */
export interface MarketContracts {
    /** The market (trading) contract. */
    market: string;
    /** Strategy vault wired to the market. */
    vault: string;
    /** Settlement token (the vault's asset). */
    token: string;
    /**
     * Oracle the market verifies prices through. Give it with `treasury` to
     * keep the load at one round trip. If either is omitted, the load finds
     * it in the market instance and reads it in a second round trip.
     */
    oracle?: string;
    /** Treasury the market pays protocol fees to. Optional, as `oracle`. */
    treasury?: string;
}

function zero(value: bigint): bigint {
    return value > 0n ? value : 0n;
}

/**
 * One loaded market: instance config, the market singleton, the vault state
 * it settles against, and the oracle and treasury settings it prices and
 * splits fees with. Plain public fields, one snapshot per load.
 */
export class Market {
    constructor(
        private network: Network,
        /** The market (trading) contract. */
        public id: string,
        /** Latest ledger the read closed at. */
        public ledger: number,
        /** Strategy vault wired to this market (from the instance; authoritative). */
        public vault: string,
        /** Settlement token (the vault's asset). */
        public token: string,
        /** Oracle contract. */
        public oracle: string,
        /** Treasury contract. */
        public treasury: string,
        /** Current owner, or `undefined` once renounced. */
        public owner: string | undefined,
        /** 32-byte Data Streams stream id this market prices against. */
        public feedId: Buffer,
        /** Operational status; only `Active` admits new risk. */
        public status: Status,
        /** Global trading parameters. */
        public config: MarketConfig,
        /** The market singleton: open interest, indices, funding. */
        public data: MarketData,
        /** Per-side ADL flags; a flagged side is closed-only. */
        public adl: AdlState,
        /**
         * Flat settlement price of a wound-down market (18-dec), or
         * `undefined`. Once set, the chain fills, liquidates, accrues and
         * prices shares at it on both sides, and so does every method of
         * this tier that reads the market: the caller's price is ignored.
         */
        public terminalPrice: bigint | undefined,
        /**
         * Unix seconds the current wind-down began, or `undefined` outside
         * one. Past `delistedAt + DELIST_DEADLINE` on a `Delisted` market,
         * any keeper can liquidate any open position.
         */
        public delistedAt: bigint | undefined,
        /** Vault margin balance, token-dec; equals `total_assets()`. */
        public vaultAssets: bigint,
        /** Vault shares in circulation, share-dec. */
        public vaultShares: bigint,
        /** Virtual-share decimals offset (share decimals = asset decimals + offset). */
        public vaultDecimalsOffset: number,
        /** Settlement-token decimals. */
        public assetDecimals: number,
        /**
         * Protocol fee rate (SCALAR_18) the treasury takes from fees, read
         * from the treasury instance by the load. Previews use it to split
         * fees and to gate a fill on the settled vault balance (#714, #753).
         * A directly constructed snapshot defaults to `0n`.
         */
        public treasuryRate: bigint = 0n,
        /**
         * The oracle's spread reduction (SCALAR_18), read from the oracle
         * instance by the load: `0` leaves report sides as they are, and
         * `SCALAR_18` collapses them to the midpoint. Feeds
         * {@link Market.priceFromReport}. A directly constructed snapshot
         * defaults to `0n`.
         */
        public spreadReductionFactor: bigint = 0n,
    ) {}

    /**
     * Load one market: its instance, market data, vault instance and vault
     * balance, plus the oracle and treasury instances it names. One
     * `getLedgerEntries` when `contracts` carries `oracle` and `treasury`
     * (as {@link Market.resolveContracts} returns), else two. Every supplied
     * address is checked against the instance's own wiring, so one market's
     * positions never blend with an unrelated vault's balance.
     *
     * Refreshing is calling this again.
     *
     * @throws {MarketStateError} `MISSING_STATE` when the market data or
     *   the market, vault, oracle or treasury instance is absent or
     *   TTL-expired; `IDENTITY_MISMATCH` when the instance names a
     *   different vault, token, oracle or treasury than `contracts`.
     */
    static async load(
        network: Network,
        contracts: MarketContracts,
    ): Promise<Market> {
        const keys = marketKeys(contracts);
        const batch = await readEntries(network, [
            keys.instance,
            keys.data,
            keys.vaultInstance,
            keys.vaultBalance,
            ...knownLinkKeys(contracts),
        ]);
        return decodeMarket(network, contracts, batch);
    }

    /**
     * Resolve `MarketContracts` from the market contract id alone. One
     * `getLedgerEntries`: the instance names its own vault, token, oracle
     * and treasury, so the result passes `load`'s identity check and keeps
     * every later load at one round trip.
     */
    static async resolveContracts(
        network: Network,
        marketId: string,
    ): Promise<Required<MarketContracts>> {
        const key = contractInstanceLedgerKey(marketId);
        const batch = await readEntries(network, [key]);
        const instance = parseMarketInstance(
            batch.require(key, `market instance ${marketId}`),
        );
        return {
            market: marketId,
            vault: instance.vault,
            token: instance.token,
            oracle: instance.oracle,
            treasury: instance.treasury,
        };
    }

    /**
     * Load a market and one subject's state on it in the same
     * `getLedgerEntries` (the market's keys plus the user's four). Round
     * trips and market-level failures are as {@link Market.load}; the
     * user's entries decode as {@link MarketUser.load} decodes them.
     */
    static async loadWithUser(
        network: Network,
        contracts: MarketContracts,
        userId: string,
    ): Promise<{ market: Market; user: MarketUser }> {
        const keys = marketKeys(contracts);
        const userKeys = marketUserKeys(contracts.market, userId);
        const batch = await readEntries(network, [
            keys.instance,
            keys.data,
            keys.vaultInstance,
            keys.vaultBalance,
            ...knownLinkKeys(contracts),
            userKeys.long,
            userKeys.short,
            userKeys.orderCounter,
            userKeys.claimableCredit,
        ]);
        return {
            market: await decodeMarket(network, contracts, batch),
            user: decodeUser(contracts.market, userId, batch),
        };
    }

    /** Read one subject's state on this market. One `getLedgerEntries`. */
    async loadUser(userId: string): Promise<MarketUser> {
        return MarketUser.load(this.network, this.id, userId);
    }

    /** This market's display estimate at `price`. Delegates to {@link estimateMarket}. */
    estimate(price: PriceInput): MarketEstimate {
        return estimateMarket(this, price);
    }

    /**
     * The price the chain fills at for a raw Data Streams report, narrowed
     * by this market's {@link Market.spreadReductionFactor}. Delegates to
     * {@link Price.fromReport}.
     */
    priceFromReport(bid: bigint, ask: bigint, publishTime: bigint): Price {
        return Price.fromReport(bid, ask, publishTime, this.spreadReductionFactor);
    }

    /**
     * Advance the funding and borrowing indices to `now` (defaults to the
     * wall clock, clamped to never predate the stored accrual) at `price`,
     * mirroring the contract's `accrue`. Returns a NEW `Market` carrying the
     * post-accrual data; this snapshot is not mutated.
     */
    accrue(price: PriceInput, now?: bigint): Market {
        const at = quoteTime(this, now);
        const advanced = advanceMarketAccruals(
            this.data,
            this.config,
            marketPrice(this, price, at),
            this.vaultAssets,
            at,
        ).market;
        return this.withData(advanced);
    }

    /**
     * One side's reserve utilization at `price`: reserved notional over the
     * side's capacity. SCALAR_18 fraction (1e18 = 100%).
     */
    utilization(isLong: boolean, price: PriceInput): bigint {
        return reserveUtilization(
            sideReserved(this.data, this.priceAt(price), isLong),
            sideCapacity(this.vaultAssets, this.config.maxUtilOpen),
        );
    }

    /**
     * Notional (token-dec) the side can still take before a side-level open
     * gate trips: the smaller of the `max_util_open` headroom at `price` and
     * the `max_open_interest` headroom. One order is also capped at
     * `config.maxPositionNotional` less the position's own notional (#712).
     */
    openCapacity(isLong: boolean, price: PriceInput): bigint {
        const reserved = sideReserved(this.data, this.priceAt(price), isLong);
        const capacity = sideCapacity(this.vaultAssets, this.config.maxUtilOpen);
        const utilHeadroom = zero(capacity - reserved);
        const notional = isLong
            ? this.data.notional.long
            : this.data.notional.short;
        const oiHeadroom = zero(this.config.maxOpenInterest - notional);
        return utilHeadroom < oiHeadroom ? utilHeadroom : oiHeadroom;
    }

    /**
     * The ADL flags `update_adl_state` would set at `price`, with the
     * contract's hysteresis: a side arms above the `adl_max_pnl` trigger and
     * stays armed until its pending profit falls back under
     * `adl_clear_target`. The stored {@link Market.adl} is the last state
     * written on-chain; this predicts whether an open would halt before a
     * keeper refreshes it.
     */
    adlState(price: PriceInput): AdlState {
        const p = this.priceAt(price);
        const trigger = sideCapacity(this.vaultAssets, this.config.adlMaxPnl);
        const clear = sideCapacity(this.vaultAssets, this.config.adlClearTarget);
        const longPnl = marketSidePnl(this.data, p, true, true);
        const shortPnl = marketSidePnl(this.data, p, false, true);
        return {
            long: longPnl > trigger || (this.adl.long && longPnl > clear),
            short: shortPnl > trigger || (this.adl.short && shortPnl > clear),
        };
    }

    /**
     * One side's unrealized trader PnL at `price`, token-dec, maximized
     * against the vault (each position marked at its adverse side, matching
     * the vault's own accounting). Positive: traders are up, the vault is
     * down.
     */
    sidePnl(isLong: boolean, price: PriceInput): bigint {
        return marketSidePnl(this.data, this.priceAt(price), isLong, true);
    }

    /**
     * Net unrealized trader PnL across both sides at `price`, token-dec, as a
     * redeem fill nets it out of the share price: each side marked in the
     * traders' favour, its profit capped at the haircut allowance
     * (`maxPnlTrader` of half the vault). The uncapped sum is
     * `sidePnl(true, price) + sidePnl(false, price)`.
     */
    netPnl(price: PriceInput): bigint {
        return cappedNetPnl(
            this.data,
            this.config,
            this.priceAt(price),
            this.vaultAssets,
            true,
        );
    }

    /**
     * The per-second borrowing rate (SCALAR_18) the side is charged at
     * `price`: the kink rate at its utilization while it holds at least as
     * many base tokens as the other side, else `0n`. Only the dominant side
     * pays, and a tie charges both.
     */
    borrowingRate(isLong: boolean, price: PriceInput): bigint {
        const own = isLong ? this.data.tokens.long : this.data.tokens.short;
        const other = isLong ? this.data.tokens.short : this.data.tokens.long;
        if (own < other) return 0n;
        return borrowingRate(this.config, this.utilization(isLong, price));
    }

    /**
     * The stored per-second funding rate, evolved to `now` (defaults to the
     * wall clock) by the book's skew. Signed, SCALAR_18: positive means longs
     * pay shorts. This is the unfloored rate the market keeps. Accrual
     * charges the payer `max(|rate|, config.fundingMin)`, and nothing at a
     * zero rate. Skew-driven, so no price is involved.
     */
    fundingRate(now?: bigint): bigint {
        const elapsed = quoteTime(this, now) - this.data.accruedAt;
        return advanceFunding(this.data, this.config, elapsed).fundingRate;
    }

    /**
     * Convert an asset amount to shares at the effective deposit fill rate:
     * vault assets net of capped trader uPnL at `price`, virtual-offset
     * rounding, mirroring `execute_vault_order`'s deposit branch pre-fee.
     * Token-dec in, share-dec out.
     *
     * Pre-fee, so not a `minOut` source: a deposit order's `minOut` is
     * checked against the shares its assets mint after the `depositFee`
     * cut, which is what `VaultOrderIntent.expectedOut` returns. A bound cut
     * from this conversion can sit above that quote and reject the order.
     */
    assetsToShares(assets: bigint, price: PriceInput): bigint {
        const p = this.priceAt(price);
        const pnl = cappedNetPnl(this.data, this.config, p, this.vaultAssets, false);
        return convertVaultAssetsToShares(this.vaultAtomic(), assets, pnl);
    }

    /**
     * Convert shares to assets at the effective redeem fill rate (capped
     * uPnL maximized against the redeemer at `price`, pre-fee). Share-dec
     * in, token-dec out.
     *
     * Pre-fee, so not a `minOut` source: a redeem order's `minOut` is
     * checked against these assets after the `redeemFee` cut, which is what
     * `VaultOrderIntent.expectedOut` returns.
     */
    sharesToAssets(shares: bigint, price: PriceInput): bigint {
        const p = this.priceAt(price);
        const pnl = cappedNetPnl(this.data, this.config, p, this.vaultAssets, true);
        return convertVaultSharesToAssets(this.vaultAtomic(), shares, pnl);
    }

    /**
     * A copy of this snapshot carrying `rate` (SCALAR_18) as the treasury fee
     * rate in place of {@link Market.treasuryRate}. For a snapshot built by
     * hand, or to preview a rate change.
     */
    withTreasuryRate(rate: bigint): Market {
        const copy = this.withData(this.data);
        copy.treasuryRate = rate;
        return copy;
    }

    /** @internal A copy of this snapshot carrying different market data (post-fill projections). */
    withData(data: MarketData): Market {
        return new Market(
            this.network,
            this.id,
            this.ledger,
            this.vault,
            this.token,
            this.oracle,
            this.treasury,
            this.owner,
            this.feedId,
            this.status,
            this.config,
            data,
            this.adl,
            this.terminalPrice,
            this.delistedAt,
            this.vaultAssets,
            this.vaultShares,
            this.vaultDecimalsOffset,
            this.assetDecimals,
            this.treasuryRate,
            this.spreadReductionFactor,
        );
    }

    /** @internal The engine's atomic vault triple. */
    vaultAtomic(): VaultAtomicState {
        return {
            totalAssets: this.vaultAssets,
            totalSupply: this.vaultShares,
            decimalsOffset: this.vaultDecimalsOffset,
        };
    }

    /** The price this snapshot's own methods measure at: the terminal price once set, else `price`. */
    private priceAt(price: PriceInput): PriceData {
        return marketPrice(this, price, quoteTime(this));
    }
}

/** @internal The four ledger keys one market's state collapses to. */
export function marketKeys(contracts: MarketContracts): {
    instance: ReturnType<typeof contractInstanceLedgerKey>;
    data: ReturnType<typeof marketDataLedgerKey>;
    vaultInstance: ReturnType<typeof contractInstanceLedgerKey>;
    vaultBalance: ReturnType<typeof tokenBalanceLedgerKey>;
} {
    return {
        instance: contractInstanceLedgerKey(contracts.market),
        data: marketDataLedgerKey(contracts.market),
        vaultInstance: contractInstanceLedgerKey(contracts.vault),
        vaultBalance: tokenBalanceLedgerKey(contracts.token, contracts.vault),
    };
}

/**
 * @internal The oracle and treasury instance keys the caller already knows,
 * so the first round trip can read them alongside the market.
 */
function knownLinkKeys(
    contracts: MarketContracts,
): ReturnType<typeof contractInstanceLedgerKey>[] {
    const known: ReturnType<typeof contractInstanceLedgerKey>[] = [];
    if (contracts.oracle !== undefined) {
        known.push(contractInstanceLedgerKey(contracts.oracle));
    }
    if (contracts.treasury !== undefined) {
        known.push(contractInstanceLedgerKey(contracts.treasury));
    }
    return known;
}

/** @internal Throw `IDENTITY_MISMATCH` unless a supplied address matches the instance's. */
function requireWiring(
    market: string,
    role: string,
    wired: string,
    supplied: string | undefined,
): void {
    if (supplied !== undefined && supplied !== wired) {
        throw new MarketStateError(
            'IDENTITY_MISMATCH',
            `market ${market} is wired to ${role} ${wired}, not ${supplied}`,
        );
    }
}

/**
 * @internal The oracle's spread reduction factor and the treasury's fee
 * rate. Each instance comes from `batch` when the caller named it, else
 * from one more round trip that reads every unnamed one.
 */
async function readLinks(
    network: Network,
    contracts: MarketContracts,
    instance: MarketInstanceState,
    batch: EntryBatch,
): Promise<{ spreadReductionFactor: bigint; treasuryRate: bigint }> {
    const oracleKey = contractInstanceLedgerKey(instance.oracle);
    const treasuryKey = contractInstanceLedgerKey(instance.treasury);
    const unnamed = [
        ...(contracts.oracle === undefined ? [oracleKey] : []),
        ...(contracts.treasury === undefined ? [treasuryKey] : []),
    ];
    const second =
        unnamed.length > 0 ? await readEntries(network, unnamed) : batch;
    const oracle = parseOracleInstance(
        (contracts.oracle === undefined ? second : batch).require(
            oracleKey,
            `oracle instance ${instance.oracle}`,
        ),
    );
    const treasuryRate = parseTreasuryRate(
        (contracts.treasury === undefined ? second : batch).require(
            treasuryKey,
            `treasury instance ${instance.treasury}`,
        ),
    );
    return { spreadReductionFactor: oracle.spreadReductionFactor, treasuryRate };
}

/** @internal Decode one market from a batch holding its keys, reading what the batch lacks. */
async function decodeMarket(
    network: Network,
    contracts: MarketContracts,
    batch: EntryBatch,
): Promise<Market> {
    const keys = marketKeys(contracts);

    const instance = parseMarketInstance(
        batch.require(keys.instance, `market instance ${contracts.market}`),
    );

    // The instance is the market's own account of what it is wired to. Trust
    // it over the caller's addresses: a mismatch would blend one market's
    // positions with an unrelated vault's balance.
    if (instance.vault !== contracts.vault) {
        throw new MarketStateError(
            'IDENTITY_MISMATCH',
            `market ${contracts.market} is wired to vault ${instance.vault}, not ${contracts.vault}`,
        );
    }
    if (instance.token !== contracts.token) {
        throw new MarketStateError(
            'IDENTITY_MISMATCH',
            `market ${contracts.market} settles in ${instance.token}, not ${contracts.token}`,
        );
    }
    requireWiring(contracts.market, 'oracle', instance.oracle, contracts.oracle);
    requireWiring(
        contracts.market,
        'treasury',
        instance.treasury,
        contracts.treasury,
    );

    const data = parseMarketData(
        scValToNative(
            batch.require(keys.data, `market data for ${contracts.market}`),
        ),
    );

    const vaultInstance = parseVaultInstance(
        batch.require(keys.vaultInstance, `vault instance ${contracts.vault}`),
    );

    // The vault's margin balance is an ordinary token Balance slot; absent
    // means never credited, which the token reports as 0.
    const vaultAssets = tokenBalanceOrZero(
        batch.at(keys.vaultBalance, `vault balance for ${contracts.vault}`),
    );

    const links = await readLinks(network, contracts, instance, batch);

    return new Market(
        network,
        contracts.market,
        batch.ledger,
        instance.vault,
        instance.token,
        instance.oracle,
        instance.treasury,
        instance.owner,
        instance.feedId,
        instance.status,
        instance.config,
        data,
        instance.adl,
        instance.terminalPrice,
        instance.delistedAt,
        vaultAssets,
        vaultInstance.totalSharesAtomic,
        vaultInstance.decimalsOffset,
        vaultInstance.assetDecimals,
        links.treasuryRate,
        links.spreadReductionFactor,
    );
}
