import { scValToNative, type xdr } from '@stellar/stellar-sdk';
import type { Network } from '../index.js';
import {
    contractInstanceLedgerKey,
    tradingMarketDataLedgerKey,
} from '../ledger-keys.js';
import {
    tokenBalanceLedgerKey,
    tokenBalanceOrZero,
} from '../token.js';
import { parseVaultInstance } from '../contracts/vault/vault_instance.js';
import type { VaultInstanceState } from '../contracts/vault/vault_instance.js';
import type { VaultAtomicState } from '../trading/quote/vault.js';
import { parseTradingInstance } from '../contracts/trading/trading_instance.js';
import type { TradingInstanceState } from '../contracts/trading/trading_instance.js';
import { parseMarketData } from '../contracts/trading/trading_types.js';
import type {
    AdlState,
    MarketData,
    Status,
    TradingConfig,
} from '../contracts/trading/trading_types.js';
import { MarketStateError, readEntries } from './entries.js';
import type { EntryBatch } from './entries.js';

/**
 * The contracts a market is read from. This is everything needed to build its
 * ledger keys, and nothing more.
 *
 * The oracle and feed id are deliberately absent. They build no key, and
 * arrive as outputs of the instance read. The treasury is also absent. It is
 * deployment-level, shared by every market, and its rate is not part of any
 * user-facing number ({@link loadTreasuryRate}).
 */
export interface MarketContracts {
    /** The market (trading) contract. */
    readonly market: string;
    /** Strategy vault wired to the market. */
    readonly vault: string;
    /** Settlement token (the vault's asset). */
    readonly token: string;
}

/** A market's decoded contract state. Plain data: `structuredClone`-safe. */
export interface MarketStateData {
    /** Latest ledger the read closed at. */
    readonly ledger: number;
    /** Contracts this state was read from. */
    readonly contracts: MarketContracts;
    /** Market instance storage: config, status, ADL, wiring, retirement. */
    readonly instance: TradingInstanceState;
    /** The market singleton: open interest, indices, funding. */
    readonly data: MarketData;
    /** Strategy-vault instance storage. */
    readonly vault: VaultInstanceState;
    /** Vault margin balance (token `Balance(vault)`); equals `total_assets()`. */
    readonly vaultAssetsAtomic: bigint;
}

/** The four keys one market's state collapses to. */
export function marketKeys(contracts: MarketContracts): {
    instance: xdr.LedgerKey;
    data: xdr.LedgerKey;
    vaultInstance: xdr.LedgerKey;
    vaultBalance: xdr.LedgerKey;
} {
    return {
        instance: contractInstanceLedgerKey(contracts.market),
        data: tradingMarketDataLedgerKey(contracts.market),
        vaultInstance: contractInstanceLedgerKey(contracts.vault),
        vaultBalance: tokenBalanceLedgerKey(contracts.token, contracts.vault),
    };
}

function decodeMarket(
    contracts: MarketContracts,
    batch: EntryBatch,
): MarketStateData {
    const keys = marketKeys(contracts);

    const instance = parseTradingInstance(
        batch.require(keys.instance, `market instance ${contracts.market}`),
    );

    // The instance is the market's own account of what it is wired to. Trust it
    // over the caller's addresses. A mismatch means the request would blend one
    // market's positions with an unrelated vault's balance.
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

    const vault = parseVaultInstance(
        batch.require(keys.vaultInstance, `vault instance ${contracts.vault}`),
    );

    // The vault's margin balance is an ordinary token Balance slot, the same
    // one `loadTokenBalance` reads for a wallet, through the same decode.
    // Absent means a holder never credited, which the token reports as 0.
    const vaultAssetsAtomic = tokenBalanceOrZero(
        batch.at(keys.vaultBalance, `vault balance for ${contracts.vault}`),
    );

    return {
        ledger: batch.ledger,
        contracts,
        instance,
        data,
        vault,
        vaultAssetsAtomic,
    };
}

/**
 * One market's contract state at a ledger. Each accessor mirrors a field on
 * {@link MarketStateData}, which is held on `state` for caching. Rebuild from
 * cached state with {@link Market.fromData}.
 *
 * The state does not include price. A Data Streams report cannot reach a
 * browser, so the caller supplies the mark price separately.
 */
export class Market {
    private constructor(
        private readonly network: Network,
        readonly state: MarketStateData,
    ) {}

    /**
     * Read one market's state. One `getLedgerEntries`, four keys.
     *
     * @throws {MarketStateError} `MISSING_STATE` when the market or vault
     *   instance is absent or TTL-expired.
     * @throws {MarketStateError} `IDENTITY_MISMATCH` when the market instance
     *   is wired to a different vault or token than `contracts` names.
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
        return new Market(network, decodeMarket(contracts, batch));
    }

    /**
     * Read many markets' state in a single `getLedgerEntries`. Results are
     * returned in request order.
     *
     * Markets sharing a settlement token or vault contribute the same key more
     * than once; duplicates are collapsed before the request, which the RPC
     * would otherwise reject outright.
     *
     * @throws {MarketStateError} `MISSING_STATE` when a market or vault
     *   instance is absent or TTL-expired.
     * @throws {MarketStateError} `IDENTITY_MISMATCH` when a market instance is
     *   wired to a different vault or token than its entry in `contracts`
     *   names.
     */
    static async loadMany(
        network: Network,
        contracts: readonly MarketContracts[],
    ): Promise<Market[]> {
        if (contracts.length === 0) return [];
        const keys = contracts.flatMap((entry) => {
            const k = marketKeys(entry);
            return [k.instance, k.data, k.vaultInstance, k.vaultBalance];
        });
        const batch = await readEntries(network, keys);
        return contracts.map(
            (entry) => new Market(network, decodeMarket(entry, batch)),
        );
    }

    /** Rebuild from cached plain data, such as a rehydrated query cache. */
    static fromData(network: Network, state: MarketStateData): Market {
        return new Market(network, state);
    }

    get contracts(): MarketContracts {
        return this.state.contracts;
    }

    get ledger(): number {
        return this.state.ledger;
    }

    get data(): MarketData {
        return this.state.data;
    }

    get config(): TradingConfig {
        return this.state.instance.config;
    }

    get status(): Status {
        return this.state.instance.status;
    }

    get adl(): AdlState {
        return this.state.instance.adl;
    }

    /** 32-byte Data Streams stream id this market prices against. */
    get feedId(): Buffer {
        return this.state.instance.feedId;
    }

    get oracle(): string {
        return this.state.instance.oracle;
    }

    get treasury(): string {
        return this.state.instance.treasury;
    }

    /**
     * Current owner, or `undefined` once ownership has been renounced.
     *
     * Read from the same instance entry as everything else, so a client can
     * verify the market is governed by the governance contract without a
     * separate `get_owner` simulation.
     */
    get owner(): string | undefined {
        return this.state.instance.owner;
    }

    /** Coherent atomic vault state for the exact vault quote helpers. */
    get vaultAtomic(): VaultAtomicState {
        return {
            totalAssets: this.state.vaultAssetsAtomic,
            totalSupply: this.state.vault.totalSharesAtomic,
            decimalsOffset: this.state.vault.decimalsOffset,
        };
    }

    /** Settlement-token decimals, from the vault's share metadata. */
    get assetDecimals(): number {
        return this.state.vault.assetDecimals;
    }

    /**
     * `(terminalPrice, delistedAt)` once the market has been delisted, else
     * `undefined`. This is the shape `get_retirement` returns.
     */
    get retirement(): readonly [bigint, bigint] | undefined {
        const { terminalPrice, delistedAt } = this.state.instance;
        if (terminalPrice === undefined || delistedAt === undefined) {
            return undefined;
        }
        return [terminalPrice, delistedAt];
    }

    /** Re-read this market's state at the current ledger. */
    async reload(): Promise<Market> {
        return Market.load(this.network, this.state.contracts);
    }

    /**
     * Cross-check the entries-derived vault balance against an authoritative
     * `total_assets()` simulation. The two must agree, because
     * `Vault::total_assets` is exactly the `Balance(vault)` slot read here.
     * Intended as a low-frequency drift alarm on the money path.
     *
     * @throws {MarketStateError} `IDENTITY_MISMATCH` when the values disagree.
     */
    crossCheckTotalAssets(simTotalAssets: bigint): void {
        if (this.state.vaultAssetsAtomic !== simTotalAssets) {
            throw new MarketStateError(
                'IDENTITY_MISMATCH',
                `vault total_assets drift: entries ${this.state.vaultAssetsAtomic} != sim ${simTotalAssets}`,
            );
        }
    }
}
