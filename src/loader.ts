// src/loader.ts
import {
    Address,
    Account,
    Contract,
    rpc,
    scValToBigInt,
    scValToNative,
    xdr,
    TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Network } from './index.js';
import {
    contractInstanceLedgerKey,
    persistentLedgerKey,
} from './ledger_entry_helper.js';
import { VaultState } from './vault/vault_state.js';
import { VaultWithdrawal } from './vault/vault_withdrawal.js';
import { TradingConfig } from './trading/trading_config.js';
import { TradingMarket } from './trading/trading_market.js';
import { Position } from './trading/trading_position.js';
import { TokenMetadata } from './token.js';
import type { Asset } from './trading/trading_contract.js';
import { descale } from './utils/scaling.js';

// Re-export classes for convenience
export { VaultState, VaultWithdrawal, TradingConfig, TradingMarket, Position, TokenMetadata };

// ============================
// Simulation Helper
// ============================

/**
 * Helper to simulate a contract call operation
 */
async function simulateContractCall<T>(
    network: Network,
    contractId: string,
    method: string,
    ...args: xdr.ScVal[]
): Promise<T> {
    // Use a dummy account for simulation
    const account = new Account(
        'GANXGJV2RNOFMOSQ2DTI3RKDBAVERXUVFC27KW3RLVQCLB3RYNO3AAI4',
        '123'
    );

    const txBuilder = new TransactionBuilder(account, {
        fee: '1000',
        timebounds: { minTime: 0, maxTime: 0 },
        networkPassphrase: network.passphrase,
    });

    const contract = new Contract(contractId);
    txBuilder.addOperation(contract.call(method, ...args));

    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const result = await stellarRpc.simulateTransaction(txBuilder.build());

    if (!rpc.Api.isSimulationSuccess(result) || !result.result) {
        throw new Error('Simulation failed');
    }

    return scValToNative(result.result.retval) as T;
}

// ============================
// Vault Loading Functions
// ============================

/**
 * Load vault state including configuration and current balance
 */
export async function loadVaultState(
    network: Network,
    vaultId: string,
    tokenId: string
): Promise<VaultState> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);

    // Load vault instance storage
    const instanceKey = contractInstanceLedgerKey(vaultId);
    const response = await stellarRpc.getLedgerEntries(instanceKey);

    if (response.entries.length === 0) {
        throw new Error('Vault not found');
    }

    const contractData = response.entries[0].val.contractData();
    const contractInstance = contractData.val().instance();
    const storage = contractInstance.storage();
    if (!storage) {
        throw new Error('Vault instance storage is empty');
    }

    // Get token balance using simulation
    const balance = await loadTokenBalance(network, tokenId, vaultId);

    return VaultState.fromInstanceStorageAndBalance(storage, balance || 0n);
}

/**
 * Load vault withdrawal request for a user
 */
export async function loadVaultWithdrawal(
    network: Network,
    vaultId: string,
    userId: string
): Promise<VaultWithdrawal | null> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);

    const key = persistentLedgerKey(vaultId, [
        xdr.ScVal.scvSymbol('WithdrawalRequest'),
        Address.fromString(userId).toScVal()
    ]);

    try {
        const response = await stellarRpc.getLedgerEntries(key);
        console.log('Vault withdrawal response:', response);
        if (response.entries.length === 0) return null;

        return VaultWithdrawal.fromScVal(response.entries[0].val.contractData().val());
    } catch {
        return null;
    }
}

/**
 * Load strategy net impacts for a vault
 * Returns a map of strategy addresses to their net impact (P&L) values
 */
export async function loadVaultStrategiesImpact(
    network: Network,
    vaultId: string,
    strategies: string[]
): Promise<Record<string, number>> {
    if (strategies.length === 0) {
        return {};
    }

    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const impacts: Record<string, number> = {};

    // Build all the ledger keys for batch fetching
    const ledgerKeys: xdr.LedgerKey[] = strategies.map(strategy => {
        return persistentLedgerKey(vaultId, [
            xdr.ScVal.scvSymbol('Strategy'),
            Address.fromString(strategy).toScVal()
        ]);
    });

    try {
        // Fetch all strategy impacts in one batch request
        const response = await stellarRpc.getLedgerEntries(...ledgerKeys);

        response.entries.forEach((entry, index) => {
            const strategy = strategies[index];

            if (entry) {
                try {
                    // Extract the i128 value from the contract data
                    const val = entry.val.contractData().val();
                    const impactBigInt = scValToBigInt(val);

                    // Convert from stroops (7 decimals) to regular number
                    impacts[strategy] = descale(impactBigInt, 7);
                } catch (error) {
                    console.warn(`Failed to parse impact for strategy ${strategy}:`, error);
                    impacts[strategy] = 0;
                }
            } else {
                // No entry means no net impact (0)
                impacts[strategy] = 0;
            }
        });
    } catch (error) {
        console.error('Failed to load vault strategies impact:', error);
        // Return all zeros on error
        strategies.forEach(strategy => {
            impacts[strategy] = 0;
        });
    }

    return impacts;
}

// ============================
// Trading Loading Functions
// ============================

/**
 * Load trading contract configuration
 */
export async function loadTradingConfig(
    network: Network,
    tradingId: string
): Promise<TradingConfig> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);

    const key = contractInstanceLedgerKey(tradingId);
    const response = await stellarRpc.getLedgerEntries(key);

    if (response.entries.length === 0) {
        throw new Error('Trading contract not found');
    }

    const contractData = response.entries[0].val.contractData();
    const contractInstance = contractData.val().instance();
    const storage = contractInstance.storage();
    if (!storage) {
        throw new Error('Trading instance storage is empty');
    }

    return TradingConfig.fromInstanceStorage(storage);
}

/**
 * Load trading market data
 */
export async function loadTradingMarket(
    network: Network,
    tradingId: string,
    asset: Asset
): Promise<TradingMarket | null> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);

    // Convert asset to ScVal
    const assetScVal = TradingMarket.assetToScVal(asset);

    const keys = [
        persistentLedgerKey(tradingId, [
            xdr.ScVal.scvSymbol('MarketConfig'),
            assetScVal
        ]),
        persistentLedgerKey(tradingId, [
            xdr.ScVal.scvSymbol('MarketData'),
            assetScVal
        ])
    ];

    try {
        const response = await stellarRpc.getLedgerEntries(...keys);

        if (response.entries.length < 2) return null;

        const configScVal = response.entries[0].val.contractData().val();
        const dataScVal = response.entries[1].val.contractData().val();

        return TradingMarket.fromScVals(asset, configScVal, dataScVal);
    } catch {
        return null;
    }
}
/**
 * Load a single trading position
 */
export async function loadPosition(
    network: Network,
    tradingId: string,
    positionId: number
): Promise<Position | null> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);

    const key = persistentLedgerKey(tradingId,
        [
            xdr.ScVal.scvSymbol('Position'),
            xdr.ScVal.scvU32(positionId)
        ]
    );

    try {
        const response = await stellarRpc.getLedgerEntries(key);
        if (response.entries.length === 0) return null;

        return Position.fromScVal(response.entries[0].val.contractData().val());
    } catch {
        return null;
    }
}

/**
 * Load multiple positions in bulk
 */
export async function loadPositions(
    network: Network,
    tradingId: string,
    positionIds: number[]
): Promise<Map<number, Position>> {
    if (positionIds.length === 0) return new Map();

    const stellarRpc = new rpc.Server(network.rpc, network.opts);
    const positions = new Map<number, Position>();

    // Stellar allows up to 200 keys per request
    const batchSize = 200;

    for (let i = 0; i < positionIds.length; i += batchSize) {
        const batchIds = positionIds.slice(i, i + batchSize);
        const keys = batchIds.map(id =>
            persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('Position'),
                xdr.ScVal.scvU32(id)
            ])
        );

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            response.entries.forEach((entry, index) => {
                try {
                    const position = Position.fromScVal(entry.val.contractData().val());
                    positions.set(batchIds[index], position);
                } catch {
                    // Skip invalid positions
                }
            });
        } catch (error) {
            console.error(`Failed to load position batch starting at ${i}:`, error);
        }
    }

    return positions;
}

/**
 * Load user's position IDs
 */
export async function loadUserPositionIds(
    network: Network,
    tradingId: string,
    userId: string
): Promise<number[]> {
    const stellarRpc = new rpc.Server(network.rpc, network.opts);

    const key = persistentLedgerKey(tradingId, [
        xdr.ScVal.scvSymbol('UserPositions'),
        Address.fromString(userId).toScVal()
    ]);

    try {
        const response = await stellarRpc.getLedgerEntries(key);
        if (response.entries.length === 0) return [];

        const vec = response.entries[0].val.contractData().val().vec();
        if (!vec) return [];

        return vec.map(v => v.u32());
    } catch {
        return [];
    }
}

// ============================
// Token Loading Functions  
// ============================

/**
 * Load token balance using simulation
 */
export async function loadTokenBalance(
    network: Network,
    tokenId: string,
    address: string
): Promise<bigint | null> {
    try {
        const addressScVal = Address.fromString(address).toScVal();
        const balance = await simulateContractCall<bigint>(
            network,
            tokenId,
            'balance',
            addressScVal
        );
        return balance;
    } catch (error) {
        console.error('Error loading token balance:', error);
        return null;
    }
}

/**
 * Load token metadata
 */
export async function loadTokenMetadata(
    network: Network,
    tokenId: string
): Promise<TokenMetadata> {
    return TokenMetadata.load(network, tokenId);
}

// ============================
// Oracle Loading Functions
// ============================

/**
 * Load oracle price for any asset type
 */
export async function loadOraclePrice(
    network: Network,
    oracleId: string,
    asset: Asset
): Promise<{ price: bigint; timestamp: number }> {
    // Convert Asset to ScVal format
    let assetScVal: xdr.ScVal;
    if (asset.tag === 'Stellar') {
        assetScVal = xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Stellar'),
            Address.fromString(asset.values[0] as string).toScVal(),
        ]);
    } else {
        assetScVal = xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Other'),
            xdr.ScVal.scvSymbol(asset.values[0] as string),
        ]);
    }

    const result = await simulateContractCall<any>(
        network,
        oracleId,
        'lastprice',
        assetScVal
    );

    // The result is an array [price, timestamp]
    if (!Array.isArray(result) || result.length < 2) {
        throw new Error('Invalid oracle price result');
    }

    return {
        price: BigInt(result[0]),
        timestamp: Number(result[1]),
    };
}

/**
 * Load oracle decimals configuration
 */
export async function loadOracleDecimals(
    network: Network,
    oracleId: string
): Promise<number> {
    const decimals = await simulateContractCall<bigint>(
        network,
        oracleId,
        'decimals'
    );
    return Number(decimals);
}