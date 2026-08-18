import { factorySpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32 } from '../../index.js';
import { TradingConfig, tradingConfigToScVal } from '../trading/trading_types.js';

/**
 * Deployment inputs for the markets this factory creates. Replaceable by the
 * owner through `set_init_meta`. A later change does not affect markets
 * already deployed.
 */
export interface FactoryInitMeta {
    /** WASM hash of the trading contract installed on new deploys. */
    trading_hash: Buffer | Uint8Array;
    /** Treasury address wired into every newly deployed trading contract. */
    treasury: string;
    /** WASM hash of the strategy-vault contract installed on new deploys. */
    vault_hash: Buffer | Uint8Array;
}

/** Constructor arguments for deploying the Factory contract itself. */
export interface FactoryConstructorArgs {
    init_meta: FactoryInitMeta;
}

/**
 * Operation builder for the Zenex Factory contract (deploys an isolated
 * trading and strategy-vault pair for each market).
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class FactoryContract extends Contract {
    static spec: contract.Spec = new contract.Spec(factorySpec);

    static readonly parsers = {
        /** Returns the deployed `[trading, vault]` address pair. */
        deployMarket: (result: string): [string, string] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        /** Returns whether the queried trading address was deployed by this factory. */
        isDeployed: (result: string): boolean =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
    };

    /**
     * Deploy a new instance of the Factory contract.
     *
     * Constructor: `__constructor(owner, init_meta)`. `args.init_meta` sets
     * the trading and vault WASM hashes and the treasury address that
     * future `deployMarket` calls use.
     *
     * # Errors
     * - This builder encodes only `init_meta` into `constructorArgs`. The
     *   deployed constructor also takes `owner` as its first argument, so
     *   the resulting operation fails.
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: FactoryConstructorArgs,
        salt?: Buffer,
        format: 'hex' | 'base64' = 'hex'
    ): string {
        const tradingHash = args.init_meta.trading_hash instanceof Buffer
            ? args.init_meta.trading_hash
            : Buffer.from(args.init_meta.trading_hash);
        const vaultHash = args.init_meta.vault_hash instanceof Buffer
            ? args.init_meta.vault_hash
            : Buffer.from(args.init_meta.vault_hash);

        const initMetaScVal = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('trading_hash'),
                val: xdr.ScVal.scvBytes(tradingHash),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('treasury'),
                val: Address.fromString(args.init_meta.treasury).toScVal(),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('vault_hash'),
                val: xdr.ScVal.scvBytes(vaultHash),
            }),
        ]);

        return Operation.createCustomContract({
            address: Address.fromString(deployer),
            wasmHash: typeof wasmHash === 'string'
                ? Buffer.from(wasmHash, format)
                : wasmHash,
            salt,
            constructorArgs: [initMetaScVal],
        }).toXDR('base64');
    }

    // ============================================================
    // Market Deployment
    // ============================================================

    /**
     * Deploy a single-market pair (strategy-vault and trading contract)
     * atomically, and return the `(trading, vault)` address pair.
     *
     * The vault becomes the trading contract's collateral vault, and the
     * trading contract becomes the vault's immutable strategy. Both
     * addresses derive from `admin` and the salts, so a salt alone cannot
     * be front-run by another deployer. `admin` must authorize the call and
     * both deployments. It becomes the owner of the new trading contract.
     *
     * @param salt - Salt for the trading address. The vault salt derives from it.
     * @param token - Collateral token used by both the trading contract and the vault.
     * @param oracle - Oracle contract that supplies prices for `feedId`.
     * @param feedId - 32-byte Data Streams stream id for the market. Fixed
     *   for the life of the deployed trading contract.
     * @param config - Initial `TradingConfig` for the deployed trading contract.
     * @param vaultDecimalsOffset - Extra decimals on the vault's share
     *   token. Higher values reduce inflation-attack risk on share pricing.
     *
     * # Returns
     * - The `(trading, vault)` address pair. Parse with `parsers.deployMarket`.
     *
     * # Errors
     * - Propagates the trading contract's constructor validation.
     * - `InvalidConfig` (700) if `config` fails its bounds, or `feedId` is
     *   not a V3 (`0x0003…`) stream id.
     * - `NegativeValueNotAllowed` (710) if a rate, fee, or margin in
     *   `config` is negative.
     *
     * # Events
     * - Emits `Deploy` with topics `(trading: Address, vault: Address)`.
     */
    deployMarket(
        admin: string,
        salt: Buffer | Uint8Array,
        token: string,
        oracle: string,
        feedId: Buffer | Uint8Array,
        config: TradingConfig,
        vaultName: string,
        vaultSymbol: string,
        vaultDecimalsOffset: u32,
    ): string {
        const saltBuffer = salt instanceof Buffer ? salt : Buffer.from(salt);
        const feedIdBuffer = feedId instanceof Buffer ? feedId : Buffer.from(feedId);
        return this.call(
            'deploy',
            Address.fromString(admin).toScVal(),
            xdr.ScVal.scvBytes(saltBuffer),
            Address.fromString(token).toScVal(),
            Address.fromString(oracle).toScVal(),
            xdr.ScVal.scvBytes(feedIdBuffer),
            tradingConfigToScVal(config),
            nativeToScVal(vaultName, { type: 'string' }),
            nativeToScVal(vaultSymbol, { type: 'string' }),
            xdr.ScVal.scvU32(vaultDecimalsOffset),
        ).toXDR('base64');
    }

    // ============================================================
    // View Methods
    // ============================================================

    /**
     * Returns whether `tradingId` was deployed by this factory. An address
     * that this factory never deployed decodes to `false` rather than an error.
     */
    isDeployed(tradingId: string): string {
        return this.call(
            'is_deployed',
            Address.fromString(tradingId).toScVal(),
        ).toXDR('base64');
    }
}
