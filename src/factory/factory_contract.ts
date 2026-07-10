import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, i32 } from '../index.js';
import { TradingConfig, tradingConfigToScVal } from '../trading/trading_types.js';

// FactoryInitMeta - constructor arg for the factory
export interface FactoryInitMeta {
    trading_hash: Buffer | Uint8Array;
    treasury: string;
    vault_hash: Buffer | Uint8Array;
}

// Constructor arguments
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
    static spec: contract.Spec = new contract.Spec([
        "AAAAAQAAAERNaXJyb3JzIHRoZSB0cmFkaW5nIGNvbnRyYWN0J3MgYENvbmZpZ2AuIFNhbWUgWERSIGVuY29kaW5nIG9uLWNoYWluLgAAAAAAAAAGQ29uZmlnAAAAAAAiAAAAAAAAABBhZGxfY2xlYXJfdGFyZ2V0AAAACwAAAAAAAAALYWRsX21heF9wbmwAAAAACwAAAAAAAAALYm9ycm93X3JhdGUAAAAACwAAAAAAAAALZGVwb3NpdF9mZWUAAAAACwAAAAAAAAAIZXhlY19mZWUAAAALAAAAAAAAAAdmZWVfZG9tAAAAAAsAAAAAAAAAC2ZlZV9ub25fZG9tAAAAAAsAAAAAAAAAEGZ1bmRpbmdfZGVjcmVhc2UAAAALAAAAAAAAABBmdW5kaW5nX2luY3JlYXNlAAAACwAAAAAAAAALZnVuZGluZ19tYXgAAAAACwAAAAAAAAALZnVuZGluZ19taW4AAAAACwAAAAAAAAANaW1wYWN0X3NjYWxhcgAAAAAAAAsAAAAAAAAAFWluY3JlYXNlZF9ib3Jyb3dfcmF0ZQAAAAAAAAsAAAAAAAAAC2luaXRfbWFyZ2luAAAAAAsAAAAAAAAAC2tlZXBlcl9yYXRlAAAAAAsAAAAAAAAAB2xpcV9mZWUAAAAACwAAAAAAAAASbWFpbnRlbmFuY2VfbWFyZ2luAAAAAAALAAAAAAAAABFtYXhfb3Blbl9pbnRlcmVzdAAAAAAAAAsAAAAAAAAADm1heF9wbmxfdHJhZGVyAAAAAAALAAAAAAAAABBtYXhfcG5sX3dpdGhkcmF3AAAACwAAAAAAAAAVbWF4X3Bvc2l0aW9uX25vdGlvbmFsAAAAAAAACwAAAAAAAAANbWF4X3V0aWxfb3BlbgAAAAAAAAsAAAAAAAAAEW1heF91dGlsX3dpdGhkcmF3AAAAAAAACwAAAAAAAAARbWF4X3ZhdWx0X2JhbGFuY2UAAAAAAAALAAAAAAAAAAttaW5fZGVwb3NpdAAAAAALAAAAAAAAABRtaW5fb3JkZXJfY29sbGF0ZXJhbAAAAAsAAAAAAAAAEm1pbl9vcmRlcl9ub3Rpb25hbAAAAAAACwAAAAAAAAAVbWluX3Bvc2l0aW9uX25vdGlvbmFsAAAAAAAACwAAAAAAAAANbm90aW9uYWxfbG9jawAAAAAAAAYAAAAAAAAACnJlZGVlbV9mZWUAAAAAAAsAAAAAAAAAC3JlZGVlbV9sb2NrAAAAAAYAAAAAAAAAC3RhcmdldF91dGlsAAAAAAsAAAAAAAAAGnRocmVzaG9sZF9kZWNyZWFzZV9mdW5kaW5nAAAAAAALAAAAAAAAABh0aHJlc2hvbGRfc3RhYmxlX2Z1bmRpbmcAAAAL",
        "AAAAAAAAAAAAAAAGZGVwbG95AAAAAAAKAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAA5wcmljZV92ZXJpZmllcgAAAAAAEwAAAAAAAAAHZmVlZF9pZAAAAAAEAAAAAAAAAAhleHBvbmVudAAAAAUAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAZDb25maWcAAAAAAAAAAAAKdmF1bHRfbmFtZQAAAAAAEAAAAAAAAAAMdmF1bHRfc3ltYm9sAAAAEAAAAAAAAAAVdmF1bHRfZGVjaW1hbHNfb2Zmc2V0AAAAAAAABAAAAAEAAAPtAAAAAgAAABMAAAAT",
        "AAAAAAAAAAAAAAALaXNfZGVwbG95ZWQAAAAAAQAAAAAAAAAHdHJhZGluZwAAAAATAAAAAQAAAAE=",
        "AAAAAAAAALtJbml0aWFsaXplIHRoZSBmYWN0b3J5IHdpdGggY29tcGlsZWQgV0FTTSBoYXNoZXMgYW5kIHRoZSB0cmVhc3VyeSBhZGRyZXNzLgoKIyBBcmd1bWVudHMKLSBgaW5pdF9tZXRhYCAtIFtgRmFjdG9yeUluaXRNZXRhYF0gY29udGFpbmluZyBgdHJhZGluZ19oYXNoYCwgYHZhdWx0X2hhc2hgLCBhbmQgYHRyZWFzdXJ5YCBhZGRyZXNzAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAAJaW5pdF9tZXRhAAAAAAAH0AAAAA9GYWN0b3J5SW5pdE1ldGEAAAAAAA==",
        "AAAABQAAAAAAAAAAAAAABkRlcGxveQAAAAAAAQAAAAZkZXBsb3kAAAAAAAIAAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAEAAAAAAAAABXZhdWx0AAAAAAAAEwAAAAEAAAAC",
        "AAAAAQAAAAAAAAAAAAAAD0ZhY3RvcnlJbml0TWV0YQAAAAADAAAAAAAAAAx0cmFkaW5nX2hhc2gAAAPuAAAAIAAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAAAAAAp2YXVsdF9oYXNoAAAAAAPuAAAAIA==",
    ]);

    static readonly parsers = {
        /** Returns the deployed `[trading, vault]` address pair. */
        deployMarket: (result: string): [string, string] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
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
     * - `priceVerifier` - Pyth Lazer price verifier contract address
     * - `feedId` - Pyth Lazer feed id of the market (immutable on trading)
     * - `exponent` - Price exponent of the feed (immutable on trading)
     * - `config` - Initial trading `TradingConfig`
     * - `vaultName` / `vaultSymbol` - Vault share token metadata
     * - `vaultDecimalsOffset` - Extra share decimals (inflation attack mitigation)
     *
     * # Errors
     * - Propagates the trading constructor's validation: `InvalidConfig` if
     *   `exponent` is out of range or `config` fails its bounds,
     *   `NegativeValueNotAllowed` if a rate, fee, or margin is negative.
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
        priceVerifier: string,
        feedId: u32,
        exponent: i32,
        config: TradingConfig,
        vaultName: string,
        vaultSymbol: string,
        vaultDecimalsOffset: u32,
    ): string {
        const saltBuffer = salt instanceof Buffer ? salt : Buffer.from(salt);
        return this.call(
            'deploy',
            Address.fromString(admin).toScVal(),
            xdr.ScVal.scvBytes(saltBuffer),
            Address.fromString(token).toScVal(),
            Address.fromString(priceVerifier).toScVal(),
            xdr.ScVal.scvU32(feedId),
            xdr.ScVal.scvI32(exponent),
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
     * Returns `true` if the given trading address was deployed by this factory.
     */
    isDeployed(tradingId: string): string {
        return this.call(
            'is_deployed',
            Address.fromString(tradingId).toScVal(),
        ).toXDR('base64');
    }
}
