import { factorySpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, scValToNative, Operation } from '@stellar/stellar-sdk';
import { u32 } from '../../index.js';
import { MarketConfig, marketConfigToScVal } from '../market/types.js';

/**
 * Deployment inputs for the markets this factory creates. Replaceable by the
 * owner through `set_init_meta`. A later change does not affect markets
 * already deployed.
 */
export interface FactoryInitMeta {
    /** WASM hash of the market contract installed on new deploys. */
    market_hash: Buffer | Uint8Array;
    /** Treasury address wired into every newly deployed market contract. */
    treasury: string;
    /** WASM hash of the strategy-vault contract installed on new deploys. */
    vault_hash: Buffer | Uint8Array;
}

/** Encode a `FactoryInitMeta` as its ScMap (keys in symbol order). */
function initMetaToScVal(initMeta: FactoryInitMeta): xdr.ScVal {
    const marketHash = initMeta.market_hash instanceof Buffer
        ? initMeta.market_hash
        : Buffer.from(initMeta.market_hash);
    const vaultHash = initMeta.vault_hash instanceof Buffer
        ? initMeta.vault_hash
        : Buffer.from(initMeta.vault_hash);
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('market_hash'),
            val: xdr.ScVal.scvBytes(marketHash),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('treasury'),
            val: Address.fromString(initMeta.treasury).toScVal(),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('vault_hash'),
            val: xdr.ScVal.scvBytes(vaultHash),
        }),
    ]);
}

/** Constructor arguments for deploying the Factory contract itself. */
export interface FactoryConstructorArgs {
    /** Owner of the factory: may upgrade it and replace `init_meta`. */
    owner: string;
    /** WASM hashes and treasury that future `deployMarket` calls use. */
    init_meta: FactoryInitMeta;
}

/**
 * Operation builder for the Zenex Factory contract (deploys an isolated
 * market and strategy-vault pair for each market).
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class FactoryContract extends Contract {
    /** Parsed spec for the factory contract; used to encode and decode invocations. */
    static spec: contract.Spec = new contract.Spec(factorySpec);

    /** Result decoders for each method's simulated result (base64 XDR), keyed by JS method name. */
    static readonly parsers = {
        /** Returns the deployed `[market, vault]` address pair. */
        deployMarket: (result: string): [string, string] =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        /** Returns whether the queried market address was deployed by this factory. */
        isDeployed: (result: string): boolean =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        /** Returns the factory's current `FactoryInitMeta`. */
        getInitMeta: (result: string): FactoryInitMeta =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')),
        // Admin (void returns)
        setInitMeta: () => {},
        upgrade: () => {},
        // Ownable
        getOwner: (result: string): string | undefined =>
            scValToNative(xdr.ScVal.fromXDR(result, 'base64')) ?? undefined,
        transferOwnership: () => {},
        acceptOwnership: () => {},
        renounceOwnership: () => {},
    };

    /**
     * Deploy a new instance of the Factory contract.
     *
     * Constructor: `__constructor(owner, init_meta)`. `args.owner` becomes
     * the factory's owner (upgrade and `set_init_meta` authority);
     * `args.init_meta` sets the market and vault WASM hashes and the
     * treasury address that future `deployMarket` calls use.
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: FactoryConstructorArgs,
        salt?: Buffer,
        format: 'hex' | 'base64' = 'hex'
    ): string {
        const initMetaScVal = initMetaToScVal(args.init_meta);

        return Operation.createCustomContract({
            address: Address.fromString(deployer),
            wasmHash: typeof wasmHash === 'string'
                ? Buffer.from(wasmHash, format)
                : wasmHash,
            salt,
            constructorArgs: [Address.fromString(args.owner).toScVal(), initMetaScVal],
        }).toXDR('base64');
    }

    // ============================================================
    // Market Deployment
    // ============================================================

    /**
     * Deploy a single-market pair (strategy-vault and market contract)
     * atomically, and return the `(market, vault)` address pair.
     *
     * The vault becomes the market contract's collateral vault, and the
     * market contract becomes the vault's immutable strategy. Both
     * addresses derive from `admin` and the salts, so a salt alone cannot
     * be front-run by another deployer. `admin` must authorize the call and
     * both deployments. It becomes the owner of the new market contract.
     *
     * @param salt - Salt for the market address. The vault salt derives from it.
     * @param token - Collateral token used by both the market contract and the vault.
     * @param oracle - Oracle contract that supplies prices for `feedId`.
     * @param feedId - 32-byte Data Streams stream id for the market. Fixed
     *   for the life of the deployed market contract.
     * @param config - Initial `MarketConfig` for the deployed market contract.
     * @param vaultDecimalsOffset - Extra decimals on the vault's share
     *   token, at most 10. Higher values reduce inflation-attack risk on
     *   share pricing.
     *
     * # Returns
     * - The `(market, vault)` address pair. Parse with `parsers.deployMarket`.
     *
     * # Errors
     * A rejected constructor fails the call as `Error(Context,
     * InvalidAction)`, and its code is in the simulation diagnostics:
     * - `InvalidConfig` (700) if `config` fails its bounds, or `feedId` is
     *   not a V3 (`0x0003…`) stream id.
     * - `NegativeValueNotAllowed` (710) if a fee, margin, borrowing, funding,
     *   ADL or PnL field, `minOrderMargin`, `minDeposit` or `execFee` in
     *   `config` is negative.
     * - `VaultMaxDecimalsOffsetExceeded` (409) if `vaultDecimalsOffset` is
     *   above 10.
     *
     * A repeated `(admin, salt)` finds a contract at the derived address and
     * traps in the host as `Error(Storage, ExistingValue)`, which carries no
     * contract error code.
     *
     * # Events
     * - Emits `Deploy` with the market and vault addresses as topics. The
     *   market topic keeps its wire name `trading`; `FactoryDeployEvent` names
     *   it `market`.
     */
    deployMarket(
        admin: string,
        salt: Buffer | Uint8Array,
        token: string,
        oracle: string,
        feedId: Buffer | Uint8Array,
        config: MarketConfig,
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
            marketConfigToScVal(config),
            nativeToScVal(vaultName, { type: 'string' }),
            nativeToScVal(vaultSymbol, { type: 'string' }),
            xdr.ScVal.scvU32(vaultDecimalsOffset),
        ).toXDR('base64');
    }

    // ============================================================
    // View Methods
    // ============================================================

    /**
     * Returns whether `marketId` was deployed by this factory. An address
     * that this factory never deployed decodes to `false` rather than an error.
     */
    isDeployed(marketId: string): string {
        return this.call(
            'is_deployed',
            Address.fromString(marketId).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Admin Methods
    // ============================================================

    /** Read the factory's current `FactoryInitMeta`. */
    getInitMeta(): string {
        return this.call('get_init_meta').toXDR('base64');
    }

    /**
     * Replace the `FactoryInitMeta` future `deployMarket` calls use (owner
     * only). Markets already deployed are unaffected.
     */
    setInitMeta(initMeta: FactoryInitMeta): string {
        return this.call('set_init_meta', initMetaToScVal(initMeta)).toXDR('base64');
    }

    /**
     * Replace the factory's WASM executable (owner only). Instance storage
     * stays as is, `InitMeta` included, so new markets keep receiving the
     * same WASM hashes. Pair the upgrade with `setInitMeta` to move them
     * too. The host emits a SYSTEM `executable_update` event.
     *
     * @param newWasmHash - Hash of the already-uploaded replacement WASM.
     * @param operator - Must equal the owner. The trait shape mandates the
     *   argument; it carries no authority of its own.
     *
     * # Errors
     * - `OwnerNotSet` (2100) once ownership is renounced.
     * - `UpgradeNotOwner` (600) if `operator` is not the owner.
     */
    upgrade(newWasmHash: Buffer | Uint8Array, operator: string): string {
        const hash = newWasmHash instanceof Buffer ? newWasmHash : Buffer.from(newWasmHash);
        return this.call(
            'upgrade',
            xdr.ScVal.scvBytes(hash),
            Address.fromString(operator).toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Ownable Methods
    // ============================================================

    /** Get the current owner address, or `undefined` if ownership was renounced. */
    getOwner(): string {
        return this.call('get_owner').toXDR('base64');
    }

    /**
     * Begin a two-step transfer to `newOwner`, who must call `acceptOwnership`
     * by `liveUntilLedger` (owner only). A new call replaces any pending
     * transfer.
     *
     * @param liveUntilLedger - Last ledger sequence `newOwner` can accept by.
     *   `0` cancels the pending transfer to `newOwner` instead, and
     *   `newOwner` must then equal the pending owner.
     *
     * # Errors
     * - OwnerNotSet (2100) once ownership is renounced.
     * - TransferInvalidLiveUntilLedger (2201) if `liveUntilLedger` is in the
     *   past or beyond the maximum entry TTL.
     * - NoPendingTransfer (2200) on a cancel with no pending transfer.
     * - InvalidPendingAccount (2202) on a cancel that names another address.
     */
    transferOwnership(newOwner: Address | string, liveUntilLedger: u32): string {
        const addr = typeof newOwner === 'string' ? Address.fromString(newOwner) : newOwner;
        return this.call(
            'transfer_ownership',
            addr.toScVal(),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /**
     * Complete a pending ownership transfer. Only the proposed new owner may
     * call this.
     *
     * # Errors
     * - NoPendingTransfer (2200) if no transfer is pending.
     * - TransferExpired (2203) if the transfer's `liveUntilLedger` has passed.
     */
    acceptOwnership(): string {
        return this.call('accept_ownership').toXDR('base64');
    }

    /**
     * Permanently remove the owner, disabling `upgrade`, `setInitMeta` and
     * `transferOwnership` for good (owner only).
     *
     * # Errors
     * - OwnerNotSet (2100) if ownership is already renounced.
     * - OwnershipTransferInProgress (2101) if an unexpired transfer is pending.
     */
    renounceOwnership(): string {
        return this.call('renounce_ownership').toXDR('base64');
    }
}
