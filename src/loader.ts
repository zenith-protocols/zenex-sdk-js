// src/loader.ts
import { Address, rpc, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from './index.js';
import { contractInstanceLedgerKey, persistentLedgerKey } from './ledger_entry_helper.js';
import { VaultState } from './vault/vault_state.js';
import { VaultWithdrawal } from './vault/vault_withdrawal.js';
import { TradingConfig } from './trading/trading_config.js';
import { TradingMarket } from './trading/trading_market.js';
import { Position } from './trading/trading_position.js';
import { Asset } from './trading/trading_contract.js';
import { descale } from './utils/scaling.js';

interface Query {
    key: xdr.LedgerKey;
    parser: (entry: xdr.LedgerEntryData) => any;
    optional: boolean;
}

/**
 * Unified loader for Hermes protocol with automatic descaling
 */
export class Loader {
    private network: Network;
    private queries = new Map<string, Query>();
    private cache = new Map<string, any>();
    private lastLoadTime = 0;

    constructor(network: Network) {
        this.network = network;
    }

    // ========== Vault Queries ==========

    /**
     * Queue vault state for loading (includes all config + state data)
     */
    queryVaultState(vaultId: string, tokenId: string): this {
        // Queue instance storage to get all config + totalShares
        const instanceQueryId = `vault:${vaultId}:instance`;
        this.queries.set(instanceQueryId, {
            key: contractInstanceLedgerKey(vaultId),
            parser: (entry) => {
                const storage = entry.contractData().val().instance().storage();
                if (!storage) throw new Error('Vault instance storage is empty');
                return storage;
            },
            optional: false
        });

        // Queue token balance
        const balanceQueryId = `vault:${vaultId}:balance`;
        this.queries.set(balanceQueryId, {
            key: persistentLedgerKey(tokenId, [
                xdr.ScVal.scvSymbol('Balance'),
                Address.fromString(vaultId).toScVal()
            ]),
            parser: (entry) => scValToBigInt(entry.contractData().val()),
            optional: true // Balance might not exist (means 0)
        });

        return this;
    }

    /**
     * Queue vault withdrawal for loading
     */
    queryVaultWithdrawal(vaultId: string, userId: string): this {
        const queryId = `vault:${vaultId}:withdrawal:${userId}`;
        this.queries.set(queryId, {
            key: persistentLedgerKey(vaultId, [
                xdr.ScVal.scvSymbol('Withdrawal'),
                Address.fromString(userId).toScVal()
            ]),
            parser: (entry) => VaultWithdrawal.fromScVal(entry.contractData().val()),
            optional: true
        });
        return this;
    }

    // ========== Trading Queries ==========

    /**
     * Queue trading config for loading
     */
    queryTradingConfig(tradingId: string): this {
        const queryId = `trading:${tradingId}:config`;
        this.queries.set(queryId, {
            key: contractInstanceLedgerKey(tradingId),
            parser: (entry) => {
                const storage = entry.contractData().val().instance().storage();
                if (!storage) throw new Error('Trading instance storage is empty');
                return TradingConfig.fromInstanceStorage(storage);
            },
            optional: false
        });
        return this;
    }

    /**
     * Queue trading market for loading
     */
    queryTradingMarket(tradingId: string, asset: Asset): this {
        const assetScVal = TradingMarket.assetToScVal(asset);
        const assetStr = this.assetToString(asset);
        const configId = `trading:${tradingId}:market:${assetStr}:config`;
        const dataId = `trading:${tradingId}:market:${assetStr}:data`;

        // Market config
        this.queries.set(configId, {
            key: persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('MarketConfig'),
                assetScVal
            ]),
            parser: (entry) => entry.contractData().val(),
            optional: false
        });

        // Market data
        this.queries.set(dataId, {
            key: persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('MarketData'),
                assetScVal
            ]),
            parser: (entry) => entry.contractData().val(),
            optional: false
        });

        return this;
    }

    /**
     * Queue trading position for loading
     */
    queryTradingPosition(tradingId: string, positionId: number): this {
        const queryId = `trading:${tradingId}:position:${positionId}`;
        this.queries.set(queryId, {
            key: persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('Position'),
                xdr.ScVal.scvU32(positionId)
            ]),
            parser: (entry) => Position.fromScVal(entry.contractData().val()),
            optional: false
        });
        return this;
    }

    /**
     * Queue user positions list for loading
     */
    queryTradingUser(tradingId: string, userId: string): this {
        const queryId = `trading:${tradingId}:user:${userId}`;
        this.queries.set(queryId, {
            key: persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('UserPositions'),
                Address.fromString(userId).toScVal()
            ]),
            parser: (entry) => {
                const vec = entry.contractData().val().vec();
                if (!vec) {
                    return [];
                }
                return vec.map(v => Number(v.u32()));
            },
            optional: true
        });
        return this;
    }

    /**
     * Queue token balance for loading
     * Returns descaled balance as a number
     */
    queryTokenBalance(tokenId: string, address: string, identifier?: string): this {
        const queryId = identifier || `balance:${tokenId}:${address}`;
        this.queries.set(queryId, {
            key: persistentLedgerKey(tokenId, [
                xdr.ScVal.scvSymbol('Balance'),
                Address.fromString(address).toScVal()
            ]),
            parser: (entry) => {
                const rawBalance = scValToBigInt(entry.contractData().val());
                return descale(rawBalance, 7); // Auto-descale token balances
            },
            optional: true
        });
        return this;
    }

    // ========== Load and Cache ==========

    /**
     * Execute all queued queries and cache results
     */
    async load(): Promise<void> {
        if (this.queries.size === 0) return;

        const stellarRpc = new rpc.Server(this.network.rpc, this.network.opts);
        const keys = Array.from(this.queries.values()).map(q => q.key);

        const response = await stellarRpc.getLedgerEntries(...keys);

        // Clear cache for new load
        this.cache.clear();

        // Process response
        const queryEntries = Array.from(this.queries.entries());
        let entryIndex = 0;

        for (const [queryId, query] of queryEntries) {
            try {
                if (entryIndex < response.entries.length) {
                    const entry = response.entries[entryIndex];
                    // Simple validation - in production implement proper key comparison
                    const parsed = query.parser(entry.val);
                    this.cache.set(queryId, parsed);
                    entryIndex++;
                } else if (!query.optional) {
                    throw new Error(`Required key not found: ${queryId}`);
                }
            } catch (error) {
                if (!query.optional) {
                    throw error;
                }
                // Optional query failed - that's ok
            }
        }

        this.lastLoadTime = Date.now();
    }

    // ========== Typed Getters (with descaling) ==========

    /**
     * Get vault state with all values descaled
     */
    getVaultState(vaultId: string): VaultState | undefined {
        const instanceStorage = this.cache.get(`vault:${vaultId}:instance`);
        const balance = this.cache.get(`vault:${vaultId}:balance`) || 0n;

        if (!instanceStorage) return undefined;

        return VaultState.fromInstanceStorageAndBalance(instanceStorage, balance);
    }

    /**
     * Get vault withdrawal with descaled values
     */
    getVaultWithdrawal(vaultId: string, userId: string): VaultWithdrawal | undefined {
        return this.cache.get(`vault:${vaultId}:withdrawal:${userId}`);
    }

    /**
     * Get trading config with descaled values
     */
    getTradingConfig(tradingId: string): TradingConfig | undefined {
        return this.cache.get(`trading:${tradingId}:config`);
    }

    /**
     * Get trading market with descaled values
     */
    getTradingMarket(tradingId: string, asset: Asset): TradingMarket | undefined {
        const assetStr = this.assetToString(asset);
        const config = this.cache.get(`trading:${tradingId}:market:${assetStr}:config`);
        const data = this.cache.get(`trading:${tradingId}:market:${assetStr}:data`);

        if (!config || !data) return undefined;

        return TradingMarket.fromScVals(asset, config, data);
    }

    /**
     * Get trading position with descaled values
     */
    getTradingPosition(tradingId: string, positionId: number): Position | undefined {
        return this.cache.get(`trading:${tradingId}:position:${positionId}`);
    }

    /**
     * Get user position IDs
     */
    getTradingUserPositions(tradingId: string, userId: string): number[] | undefined {
        return this.cache.get(`trading:${tradingId}:user:${userId}`);
    }

    /**
     * Get token balance (already descaled)
     */
    getTokenBalance(tokenId: string, address: string): number {
        const balance = this.cache.get(`balance:${tokenId}:${address}`);
        return balance || 0;
    }

    /**
     * Get balance by custom identifier (already descaled)
     */
    getBalanceById(identifier: string): number {
        const balance = this.cache.get(identifier);
        return balance || 0;
    }

    // ========== Utility Methods ==========

    /**
     * Clear all queries and cache
     */
    clear(): void {
        this.queries.clear();
        this.cache.clear();
        this.lastLoadTime = 0;
    }

    /**
     * Get last load time
     */
    getLastLoadTime(): number {
        return this.lastLoadTime;
    }

    /**
     * Check if data needs refreshing
     */
    needsRefresh(maxAge: number): boolean {
        if (this.lastLoadTime === 0) return true;
        return (Date.now() - this.lastLoadTime) > maxAge;
    }

    /**
     * Convert Asset to string for cache key
     */
    private assetToString(asset: Asset): string {
        if (asset.tag === 'Stellar') {
            return `Stellar:${asset.values[0]}`;
        } else {
            return `Other:${asset.values[0]}`;
        }
    }
}