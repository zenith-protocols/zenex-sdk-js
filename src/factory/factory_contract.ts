import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../index.js';
import { TradingConfigArgs, TradingContract } from '../trading/trading_contract.js';

// FactoryInitMeta - constructor arg for the factory
export interface FactoryInitMeta {
    trading_hash: Buffer | Uint8Array;
    treasury: string;
    vault_hash: Buffer | Uint8Array;
}

// Deploy pool arguments
export interface FactoryDeployArgs {
    admin: string;
    salt: Buffer | Uint8Array;
    token: string;
    price_verifier: string;
    config: TradingConfigArgs;
    vault_name: string;
    vault_symbol: string;
    vault_decimals_offset: u32;
    vault_lock_time: u64;
    vault_min_deposit: i128;
}

// Constructor arguments
export interface FactoryConstructorArgs {
    init_meta: FactoryInitMeta;
}

/**
 * FactoryContract - Operation builder for the Zenex Factory contract
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class FactoryContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAAAQAAADtNaXJyb3JzIHRyYWRpbmc6OlRyYWRpbmdDb25maWcuIFNhbWUgWERSIGVuY29kaW5nIG9uLWNoYWluLgAAAAAAAAAADVRyYWRpbmdDb25maWcAAAAAAAAJAAAAAAAAAAtjYWxsZXJfcmF0ZQAAAAALAAAAAAAAAAdmZWVfZG9tAAAAAAsAAAAAAAAAC2ZlZV9ub25fZG9tAAAAAAsAAAAAAAAADG1heF9ub3Rpb25hbAAAAAsAAAAAAAAACG1heF91dGlsAAAACwAAAAAAAAAMbWluX25vdGlvbmFsAAAACwAAAAAAAAAGcl9iYXNlAAAAAAALAAAAAAAAAAlyX2Z1bmRpbmcAAAAAAAALAAAAAAAAAAVyX3ZhcgAAAAAAAAs=",
        "AAAAAAAAAAAAAAAGZGVwbG95AAAAAAAKAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAA5wcmljZV92ZXJpZmllcgAAAAAAEwAAAAAAAAAGY29uZmlnAAAAAAfQAAAADVRyYWRpbmdDb25maWcAAAAAAAAAAAAACnZhdWx0X25hbWUAAAAAABAAAAAAAAAADHZhdWx0X3N5bWJvbAAAABAAAAAAAAAAFXZhdWx0X2RlY2ltYWxzX29mZnNldAAAAAAAAAQAAAAAAAAAD3ZhdWx0X2xvY2tfdGltZQAAAAAGAAAAAAAAABF2YXVsdF9taW5fZGVwb3NpdAAAAAAAAAsAAAABAAAAEw==",
        "AAAAAAAAAAAAAAALaXNfZGVwbG95ZWQAAAAAAQAAAAAAAAAHdHJhZGluZwAAAAATAAAAAQAAAAE=",
        "AAAAAAAAALxJbml0aWFsaXplIHRoZSBmYWN0b3J5IHdpdGggY29tcGlsZWQgV0FTTSBoYXNoZXMgYW5kIHRoZSB0cmVhc3VyeSBhZGRyZXNzLgoKIyBQYXJhbWV0ZXJzCi0gYGluaXRfbWV0YWAgLSBbYEZhY3RvcnlJbml0TWV0YWBdIGNvbnRhaW5pbmcgYHRyYWRpbmdfaGFzaGAsIGB2YXVsdF9oYXNoYCwgYW5kIGB0cmVhc3VyeWAgYWRkcmVzcwAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAAJaW5pdF9tZXRhAAAAAAAH0AAAAA9GYWN0b3J5SW5pdE1ldGEAAAAAAA==",
        "AAAABQAAAAAAAAAAAAAABkRlcGxveQAAAAAAAQAAAAZkZXBsb3kAAAAAAAIAAAAAAAAAB3RyYWRpbmcAAAAAEwAAAAEAAAAAAAAABXZhdWx0AAAAAAAAEwAAAAEAAAAC",
        "AAAAAgAAAAAAAAAAAAAADkZhY3RvcnlEYXRhS2V5AAAAAAABAAAAAQAAAAAAAAAFUG9vbHMAAAAAAAABAAAAEw==",
        "AAAAAQAAAAAAAAAAAAAAD0ZhY3RvcnlJbml0TWV0YQAAAAADAAAAAAAAAAx0cmFkaW5nX2hhc2gAAAPuAAAAIAAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAAAAAAp2YXVsdF9oYXNoAAAAAAPuAAAAIA=="
    ]);

    static readonly parsers = {
        deploy: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        isDeployed: (result: string): boolean =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
    };

    /**
     * Deploy a new instance of the Factory contract
     * Constructor: __constructor(init_meta)
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
    // Pool Deployment
    // ============================================================

    /**
     * Deploy a new trading pool (trading contract + strategy vault)
     * Returns the trading contract address
     */
    deployPool(args: FactoryDeployArgs): string {
        const saltBuffer = args.salt instanceof Buffer ? args.salt : Buffer.from(args.salt);
        return this.call(
            'deploy',
            Address.fromString(args.admin).toScVal(),
            xdr.ScVal.scvBytes(saltBuffer),
            Address.fromString(args.token).toScVal(),
            Address.fromString(args.price_verifier).toScVal(),
            TradingContract.tradingConfigToScVal(args.config),
            nativeToScVal(args.vault_name, { type: 'string' }),
            nativeToScVal(args.vault_symbol, { type: 'string' }),
            xdr.ScVal.scvU32(args.vault_decimals_offset),
            nativeToScVal(args.vault_lock_time, { type: 'u64' }),
            nativeToScVal(args.vault_min_deposit, { type: 'i128' }),
        ).toXDR('base64');
    }

    // ============================================================
    // View Methods
    // ============================================================

    /**
     * Check if a trading contract was deployed by this factory
     */
    isDeployed(tradingId: string): string {
        return this.call(
            'is_deployed',
            Address.fromString(tradingId).toScVal(),
        ).toXDR('base64');
    }
}
