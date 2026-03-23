import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32, u64, i128 } from '../index.js';
import { TradingConfigArgs, MarketConfigArgs, TradingContract } from '../trading/trading_contract.js';

// Queued config update
export interface QueuedConfig {
    config: TradingConfigArgs;
    unlock_time: u64;
}

// Queued market update
export interface QueuedMarket {
    config: MarketConfigArgs;
    feed_id: u32;
    nonce: u32;
    unlock_time: u64;
}

// Constructor arguments
export interface GovernanceConstructorArgs {
    owner: string;
    trading: string;
    delay: u64;
}

/**
 * GovernanceContract - Operation builder for the Zenex Governance contract
 *
 * Provides time-locked admin operations for the trading contract.
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class GovernanceContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAABAAAAAAAAAAAAAAACkFkbWluRXJyb3IAAAAAAAMAAAAAAAAADFVuYXV0aG9yaXplZAAAAAEAAAAAAAAAD1VwZGF0ZU5vdFF1ZXVlZAAAAAACAAAAAAAAABFVcGRhdGVOb3RVbmxvY2tlZAAAAAAAAAM=",
        "AAAAAQAAAAAAAAAAAAAADFF1ZXVlZENvbmZpZwAAAAIAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA1UcmFkaW5nQ29uZmlnAAAAAAAAAAAAAAt1bmxvY2tfdGltZQAAAAAG",
        "AAAAAQAAAAAAAAAAAAAADFF1ZXVlZE1hcmtldAAAAAQAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAxNYXJrZXRDb25maWcAAAAAAAAAB2ZlZWRfaWQAAAAABAAAAAAAAAAFbm9uY2UAAAAAAAAEAAAAAAAAAAt1bmxvY2tfdGltZQAAAAAG",
        "AAAAAgAAAAAAAAAAAAAAD0FkbWluU3RvcmFnZUtleQAAAAAFAAAAAAAAAAAAAAAHVHJhZGluZwAAAAAAAAAAAAAAAAVEZWxheQAAAAAAAAAAAAAAAAAADENvbmZpZ1VwZGF0ZQAAAAEAAAAAAAAADE1hcmtldFVwZGF0ZQAAAAEAAAAEAAAAAAAAAAAAAAALTWFya2V0Tm9uY2UA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAACAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAJZ2V0X2RlbGF5AAAAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAJBSZXR1cm5zIGBTb21lKEFkZHJlc3MpYCBpZiBvd25lcnNoaXAgaXMgc2V0LCBvciBgTm9uZWAgaWYgb3duZXJzaGlwIGhhcwpiZWVuIHJlbm91bmNlZC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAJZ2V0X293bmVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAKc2V0X21hcmtldAAAAAAAAQAAAAAAAAAFbm9uY2UAAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAKc2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAALZ2V0X3RyYWRpbmcAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAHdHJhZGluZwAAAAATAAAAAAAAAAVkZWxheQAAAAAAAAYAAAAA",
        "AAAAAAAAATBBY2NlcHRzIGEgcGVuZGluZyBvd25lcnNoaXAgdHJhbnNmZXIuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsib3duZXJzaGlwX3RyYW5zZmVyX2NvbXBsZXRlZCJdYAoqIGRhdGEgLSBgW25ld19vd25lcjogQWRkcmVzc11gAAAAEGFjY2VwdF9vd25lcnNoaXAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAQcXVldWVfc2V0X2NvbmZpZwAAAAEAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA1UcmFkaW5nQ29uZmlnAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAQcXVldWVfc2V0X21hcmtldAAAAAIAAAAAAAAAB2ZlZWRfaWQAAAAABAAAAAAAAAAGY29uZmlnAAAAAAfQAAAADE1hcmtldENvbmZpZwAAAAEAAAAE",
        "AAAAAAAAAAAAAAARY2FuY2VsX3NldF9jb25maWcAAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAARY2FuY2VsX3NldF9tYXJrZXQAAAAAAAABAAAAAAAAAAVub25jZQAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAARZ2V0X3F1ZXVlZF9jb25maWcAAAAAAAAAAAAAAQAAB9AAAAAMUXVldWVkQ29uZmln",
        "AAAAAAAAAAAAAAARZ2V0X3F1ZXVlZF9tYXJrZXQAAAAAAAABAAAAAAAAAAVub25jZQAAAAAAAAQAAAABAAAH0AAAAAxRdWV1ZWRNYXJrZXQ=",
    ]);

    static readonly parsers = {
        // Admin methods
        queueSetConfig: () => {},
        cancelSetConfig: () => {},
        setConfig: () => {},
        queueSetMarket: (result: string): u32 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        cancelSetMarket: () => {},
        setMarket: () => {},
        setStatus: () => {},
        upgrade: () => {},
        // Getters
        getTrading: (result: string): string =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getDelay: (result: string): u64 =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getQueuedConfig: (result: string): QueuedConfig =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        getQueuedMarket: (result: string): QueuedMarket =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Ownable
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
    };

    /**
     * Deploy a new instance of the Governance contract
     * Constructor: __constructor(owner, trading, delay)
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: GovernanceConstructorArgs,
        salt?: Buffer,
        format: 'hex' | 'base64' = 'hex'
    ): string {
        return Operation.createCustomContract({
            address: Address.fromString(deployer),
            wasmHash: typeof wasmHash === 'string'
                ? Buffer.from(wasmHash, format)
                : wasmHash,
            salt,
            constructorArgs: [
                Address.fromString(args.owner).toScVal(),
                Address.fromString(args.trading).toScVal(),
                nativeToScVal(args.delay, { type: 'u64' }),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // Time-locked Admin Methods (Owner only)
    // ============================================================

    /**
     * Queue a config update for the trading contract (owner only)
     */
    queueSetConfig(config: TradingConfigArgs): string {
        return this.call(
            'queue_set_config',
            TradingContract.tradingConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Cancel a queued config update (owner only)
     */
    cancelSetConfig(): string {
        return this.call('cancel_set_config').toXDR('base64');
    }

    /**
     * Apply a queued config update after the delay has passed (permissionless)
     */
    setConfig(): string {
        return this.call('set_config').toXDR('base64');
    }

    /**
     * Queue a new market for the trading contract (owner only)
     * Returns the nonce for this queued market
     */
    queueSetMarket(feedId: u32, config: MarketConfigArgs): string {
        return this.call(
            'queue_set_market',
            xdr.ScVal.scvU32(feedId),
            TradingContract.marketConfigToScVal(config),
        ).toXDR('base64');
    }

    /**
     * Cancel a queued market (owner only)
     */
    cancelSetMarket(nonce: u32): string {
        return this.call(
            'cancel_set_market',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    /**
     * Apply a queued market after the delay has passed (permissionless)
     */
    setMarket(nonce: u32): string {
        return this.call(
            'set_market',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }

    /**
     * Set the status on the trading contract (immediate, no delay) (owner only)
     */
    setStatus(status: u32): string {
        return this.call(
            'set_status',
            xdr.ScVal.scvU32(status),
        ).toXDR('base64');
    }

    // ============================================================
    // Upgradeable
    // ============================================================

    /**
     * Upgrade contract WASM (owner only)
     */
    upgrade(wasmHash: Buffer | Uint8Array, operator: string): string {
        const hashBuffer = wasmHash instanceof Buffer ? wasmHash : Buffer.from(wasmHash);
        return this.call(
            'upgrade',
            xdr.ScVal.scvBytes(hashBuffer),
            Address.fromString(operator).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Ownable Methods
    // ============================================================

    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    transferOwnership(newOwner: Address | string, liveUntilLedger: u32): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }

    // ============================================================
    // View / Getter Methods
    // ============================================================

    /**
     * Get the trading contract address
     */
    getTrading(): string {
        return this.call('get_trading').toXDR('base64');
    }

    /**
     * Get the configured delay in seconds
     */
    getDelay(): string {
        return this.call('get_delay').toXDR('base64');
    }

    /**
     * Get a queued config update (if any)
     */
    getQueuedConfig(): string {
        return this.call('get_queued_config').toXDR('base64');
    }

    /**
     * Get a queued market by nonce
     */
    getQueuedMarket(nonce: u32): string {
        return this.call(
            'get_queued_market',
            xdr.ScVal.scvU32(nonce),
        ).toXDR('base64');
    }
}
