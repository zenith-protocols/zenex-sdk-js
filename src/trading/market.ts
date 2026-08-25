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
import { parseVaultInstance } from '../contracts/vault/instance.js';
import { contractInstanceLedgerKey } from '../contracts/keys.js';
import { marketDataLedgerKey } from '../contracts/market/keys.js';
import { tokenBalanceLedgerKey, tokenBalanceOrZero } from '../token.js';
import { MarketStateError, readEntries } from '../entries.js';
import type { EntryBatch } from '../entries.js';
import { MarketUser, decodeUser, marketUserKeys } from './user.js';
import type { PriceInput } from './price.js';
import { resolvePrice } from './price.js';
import type { MarketEstimate } from './market_est.js';
import { estimateMarket } from './market_est.js';
import {
    advanceFunding,
    advanceMarketAccruals,
    borrowingRate,
    marketNetPnl,
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

/**
 * The contracts a market is read from: everything needed to build its ledger
 * keys, and nothing more. Oracle and treasury are outputs of the load, not
 * inputs.
 */
export interface MarketContracts {
    /** The market (trading) contract. */
    market: string;
    /** Strategy vault wired to the market. */
    vault: string;
    /** Settlement token (the vault's asset). */
    token: string;
}

function zero(value: bigint): bigint {
    return value > 0n ? value : 0n;
}

/**
 * One loaded market: instance config, the market singleton, and the vault
 * state it settles against. Plain public fields, one snapshot per load.
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
        /** `(terminalPrice, delistedAt)` once delisted, else `undefined`. */
        public retirement: readonly [bigint, bigint] | undefined,
        /** Vault margin balance, token-dec; equals `total_assets()`. */
        public vaultAssets: bigint,
        /** Vault shares in circulation, share-dec. */
        public vaultShares: bigint,
        /** Virtual-share decimals offset (share decimals = asset decimals + offset). */
        public vaultDecimalsOffset: number,
        /** Settlement-token decimals. */
        public assetDecimals: number,
        /**
         * Protocol fee rate (SCALAR_18 fraction) used to split fees between
         * vault and treasury in exact previews. Not read by the load — the
         * rate lives on the treasury contract, which the load discovers —
         * so it defaults to `0n`, pricing previews as if the treasury takes
         * nothing. For the exact split, attach it:
         * `market.withTreasuryRate(await loadTreasuryRate(network, market.treasury))`.
         */
        public treasuryRate: bigint = 0n,
    ) {}

    /**
     * Load one market. One `getLedgerEntries`: instance, market data, vault
     * instance, vault balance. The supplied vault/token are verified against
     * the instance's own wiring; a mismatch throws rather than blending one
     * market's positions with an unrelated vault's balance.
     *
     * Refreshing is calling this again.
     *
     * @throws {MarketStateError} `MISSING_STATE` when the market or vault
     *   instance is absent or TTL-expired; `IDENTITY_MISMATCH` when the
     *   instance names a different vault or token than `contracts`.
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
        ]);
        return decodeMarket(network, contracts, batch);
    }

    /**
     * Resolve `MarketContracts` from the market contract id alone. One
     * `getLedgerEntries`: the instance names its own vault and token, so the
     * result always passes `load`'s identity check.
     */
    static async resolveContracts(
        network: Network,
        marketId: string,
    ): Promise<MarketContracts> {
        const key = contractInstanceLedgerKey(marketId);
        const batch = await readEntries(network, [key]);
        const instance = parseMarketInstance(
            batch.require(key, `market instance ${marketId}`),
        );
        return { market: marketId, vault: instance.vault, token: instance.token };
    }

    /**
     * Load a market and one subject's state on it in a single
     * `getLedgerEntries` (the market's four keys plus the user's four).
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
            userKeys.long,
            userKeys.short,
            userKeys.orderCounter,
            userKeys.claimableCredit,
        ]);
        return {
            market: decodeMarket(network, contracts, batch),
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
     * Advance the funding and borrowing indices to `now` (defaults to the
     * wall clock, clamped to never predate the stored accrual) at `price`,
     * mirroring the contract's `accrue`. Returns a NEW `Market` carrying the
     * post-accrual data; this snapshot is not mutated.
     */
    accrue(price: PriceInput, now?: bigint): Market {
        const clock = now ?? BigInt(Math.floor(Date.now() / 1000));
        const at = clock > this.data.accruedAt ? clock : this.data.accruedAt;
        const advanced = advanceMarketAccruals(
            this.data,
            this.config,
            resolvePrice(price),
            this.vaultAssets,
            at,
        ).market;
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
            advanced,
            this.adl,
            this.retirement,
            this.vaultAssets,
            this.vaultShares,
            this.vaultDecimalsOffset,
            this.assetDecimals,
            this.treasuryRate,
        );
    }

    /**
     * One side's reserve utilization at `price`: reserved notional over the
     * side's capacity. SCALAR_18 fraction (1e18 = 100%).
     */
    utilization(isLong: boolean, price: PriceInput): bigint {
        return reserveUtilization(
            sideReserved(this.data, resolvePrice(price), isLong),
            sideCapacity(this.vaultAssets, this.config.maxUtilOpen),
        );
    }

    /**
     * Notional (token-dec) that can still open on a side before an open gate
     * trips: the smaller of the `max_util_open` headroom at `price` and the
     * `max_open_interest` headroom. The "max size" a trade ticket shows.
     */
    openCapacity(isLong: boolean, price: PriceInput): bigint {
        const reserved = sideReserved(this.data, resolvePrice(price), isLong);
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
        const p = resolvePrice(price);
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
        return marketSidePnl(this.data, resolvePrice(price), isLong, true);
    }

    /** Net unrealized trader PnL across both sides at `price`, token-dec. The quantity share pricing nets out. */
    netPnl(price: PriceInput): bigint {
        return marketNetPnl(this.data, resolvePrice(price), true);
    }

    /** The per-second borrowing rate a side pays at its current utilization (SCALAR_18). */
    borrowingRate(isLong: boolean, price: PriceInput): bigint {
        return borrowingRate(this.config, this.utilization(isLong, price));
    }

    /**
     * The per-second funding rate as accrual would charge it at `now`
     * (defaults to the wall clock): the stored rate evolved over the elapsed
     * window by the book's skew. Signed, SCALAR_18: positive means longs pay
     * shorts. Skew-driven, so no price is involved.
     */
    fundingRate(now?: bigint): bigint {
        const clock = now ?? BigInt(Math.floor(Date.now() / 1000));
        const elapsed = zero(clock - this.data.accruedAt);
        return advanceFunding(this.data, this.config, elapsed).fundingRate;
    }

    /**
     * Convert an asset amount to shares at the effective deposit fill rate:
     * vault assets net of capped trader uPnL at `price`, virtual-offset
     * rounding, mirroring `execute_vault_order`'s deposit branch pre-fee.
     * Token-dec in, share-dec out.
     */
    assetsToShares(assets: bigint, price: PriceInput): bigint {
        const p = resolvePrice(price);
        const pnl = cappedNetPnl(this.data, this.config, p, this.vaultAssets, false);
        return convertVaultAssetsToShares(this.vaultAtomic(), assets, pnl);
    }

    /**
     * Convert shares to assets at the effective redeem fill rate (capped
     * uPnL maximized against the redeemer at `price`, pre-fee). Share-dec
     * in, token-dec out.
     */
    sharesToAssets(shares: bigint, price: PriceInput): bigint {
        const p = resolvePrice(price);
        const pnl = cappedNetPnl(this.data, this.config, p, this.vaultAssets, true);
        return convertVaultSharesToAssets(this.vaultAtomic(), shares, pnl);
    }

    /**
     * A copy of this snapshot carrying `rate` as the treasury fee rate, for
     * exact fee splits in previews. Pair with {@link loadTreasuryRate}.
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
            this.retirement,
            this.vaultAssets,
            this.vaultShares,
            this.vaultDecimalsOffset,
            this.assetDecimals,
            this.treasuryRate,
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

/** @internal Decode one market from a batch holding its four keys. */
function decodeMarket(
    network: Network,
    contracts: MarketContracts,
    batch: EntryBatch,
): Market {
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

    const retirement =
        instance.terminalPrice !== undefined && instance.delistedAt !== undefined
            ? ([instance.terminalPrice, instance.delistedAt] as const)
            : undefined;

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
        retirement,
        vaultAssets,
        vaultInstance.totalSharesAtomic,
        vaultInstance.decimalsOffset,
        vaultInstance.assetDecimals,
    );
}
