import { factorySpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32 } from '../../index.js';
import { TradingConfig, tradingConfigToScVal } from '../trading/trading_types.js';

/**
 * Deployment inputs for the markets this factory creates. Replaceable by the
 * owner via `set_init_meta`; already-deployed markets are unaffected by a
 * later change.
 */
export interface FactoryInitMeta {
    /** WASM hash of the trading (market) contract installed on new deploys. */
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
 * FactoryContract - Operation builder for the Zenex Factory contract
 *
 * Deploys an isolated trading + strategy-vault pair per market.
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
     * Initialize the factory with compiled WASM hashes and the treasury address.
     *
     * Constructor: `__constructor(init_meta)`.
     *
     * # Parameters
     * - `init_meta` - [`FactoryInitMeta`] containing `trading_hash`, `vault_hash`,
     *   and `treasury` address
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
     * Deploy a single-market pair (strategy-vault + trading contract) atomically
     * and return the `(trading, vault)` address tuple.
     *
     * The vault is registered as the trading contract's collateral vault and the
     * trading contract as the vault's immutable strategy. Both addresses derive
     * from `admin` and the salts, so a salt alone cannot be front-run by another
     * deployer.
     *
     * # Authorization
     * - `admin` must authorize the call and both deployments; it becomes the
     *   owner of the new trading contract.
     *
     * # Arguments
     * - `salt` - Salt for the trading address; the vault salt is derived from it
     * - `token` - Collateral token address (settlement token for both contracts)
     * - `oracle` - Oracle contract address (Chainlink Data Streams verifier wrapper)
     * - `feedId` - 32-byte Chainlink Data Streams stream id of the market
     *   (immutable on trading)
     * - `config` - Initial trading `TradingConfig`
     * - `vaultName` / `vaultSymbol` - Vault share token metadata
     * - `vaultDecimalsOffset` - Extra share decimals (inflation attack mitigation)
     *
     * # Errors
     * - Propagates the trading constructor's validation: `InvalidConfig` if
     *   `config` fails its bounds or `feedId` is not a V3 stream id
     *   (`0x0003` prefix), `NegativeValueNotAllowed` if a rate, fee, or
     *   margin is negative.
     *
     * # Returns
     * - The `(trading, vault)` address tuple; parse with `parsers.deployMarket`.
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
     * Returns whether `tradingId` was deployed by this factory. Never throws
     * — an address never deployed here simply decodes to `false`.
     */
    isDeployed(tradingId: string): string {
        return this.call(
            'is_deployed',
            Address.fromString(tradingId).toScVal(),
        ).toXDR('base64');
    }
}
