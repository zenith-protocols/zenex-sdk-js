import { strategyVaultSpec } from '../contract_specs.js';
import { Address, Contract, contract, xdr, nativeToScVal, Operation } from '@stellar/stellar-sdk';
import { i128, u32 } from '../../index.js';

export interface VaultConstructorArgs {
    /** Name for the vault share token */
    name: string;
    /** Symbol for the vault share token */
    symbol: string;
    /** Address of the underlying settlement token contract */
    asset: string;
    /** Extra share decimals on top of the asset's decimals; contributes
     * `10^decimals_offset` virtual shares to the exchange rate as
     * inflation-attack protection. Share amounts are therefore NOT the same
     * scale as asset amounts. */
    decimals_offset: u32;
    /** Market contract address; the only caller allowed to invoke the vault's
     * strategy mutations. Immutable for the vault's lifetime. */
    strategy: string;
}

/**
 * Operation builder for the Zenex Strategy Vault contract.
 *
 * Collateral vault for a single trading market. Shares are an
 * OpenZeppelin fungible token; asset amounts are in the settlement token's
 * decimals while share amounts are in share decimals (asset decimals plus
 * the constructor's `decimals_offset`) — the two are never the same scale.
 * Share pricing marks the backing with the strategy-supplied net pending
 * trader PnL (`net_pnl`), so mints and redemptions settle at the market's
 * uPnL-inclusive value. All mutations (`strategyDeposit` / `strategyRedeem`
 * / `strategyWithdraw`) require the registered strategy (trading contract)
 * to authorize the call; LPs route through trading vault orders.
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class VaultContract extends Contract {
    /** Parsed contract spec, used to decode simulation/invocation results. */
    static spec: contract.Spec = new contract.Spec(strategyVaultSpec);

    /** Decoders from base64 XDR result to native TS values, one per entrypoint that returns something. */
    static readonly parsers = {
        // FungibleToken parsers
        totalSupply: (result: string): i128 =>
            VaultContract.spec.funcResToNative('total_supply', result),
        balance: (result: string): i128 =>
            VaultContract.spec.funcResToNative('balance', result),
        allowance: (result: string): i128 =>
            VaultContract.spec.funcResToNative('allowance', result),
        decimals: (result: string): u32 =>
            VaultContract.spec.funcResToNative('decimals', result),
        name: (result: string): string =>
            VaultContract.spec.funcResToNative('name', result),
        symbol: (result: string): string =>
            VaultContract.spec.funcResToNative('symbol', result),

        // Vault view parsers
        queryAsset: (result: string): string =>
            VaultContract.spec.funcResToNative('query_asset', result),
        getStrategy: (result: string): string =>
            VaultContract.spec.funcResToNative('get_strategy', result),
        totalAssets: (result: string): i128 =>
            VaultContract.spec.funcResToNative('total_assets', result),
        previewDeposit: (result: string): i128 =>
            VaultContract.spec.funcResToNative('preview_deposit', result),
        previewRedeem: (result: string): i128 =>
            VaultContract.spec.funcResToNative('preview_redeem', result),

        // Strategy mutation parsers
        strategyDeposit: (result: string): i128 =>
            VaultContract.spec.funcResToNative('strategy_deposit', result),
        strategyRedeem: (result: string): i128 =>
            VaultContract.spec.funcResToNative('strategy_redeem', result),
        strategyWithdraw: () => {},
    };

    /**
     * Builds a `CreateContractV2` operation deploying a new Vault instance
     * with the given constructor args (share metadata, asset, decimals
     * offset, strategy).
     * @param format - Encoding of `wasmHash` when passed as a string
     * @returns Base64-encoded XDR operation
     */
    static deploy(
        deployer: string,
        wasmHash: Buffer | string,
        args: VaultConstructorArgs,
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
                nativeToScVal(args.name, { type: 'string' }),
                nativeToScVal(args.symbol, { type: 'string' }),
                Address.fromString(args.asset).toScVal(),
                xdr.ScVal.scvU32(args.decimals_offset),
                Address.fromString(args.strategy).toScVal(),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // FungibleToken Methods (Share Token)
    // ============================================================

    /**
     * Get total supply of vault shares (share-dec).
     * @returns XDR operation string
     */
    totalSupply(): string {
        return this.call('total_supply').toXDR('base64');
    }

    /**
     * Get an account's share balance (share-dec).
     * @returns XDR operation string
     */
    balance(account: Address | string): string {
        const addr = typeof account === 'string' ? Address.fromString(account) : account;
        return this.call('balance', addr.toScVal()).toXDR('base64');
    }

    /**
     * Get the remaining share allowance (share-dec) `spender` may transfer from `owner`.
     * @returns XDR operation string
     */
    allowance(owner: Address | string, spender: Address | string): string {
        const ownerAddr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        const spenderAddr = typeof spender === 'string' ? Address.fromString(spender) : spender;
        return this.call('allowance', ownerAddr.toScVal(), spenderAddr.toScVal()).toXDR('base64');
    }

    /**
     * Transfer shares from `from` to `to`. `from` must authorize the call.
     * @param amount - Shares to transfer (share-dec)
     * @returns XDR operation string
     */
    transfer(from: Address | string, to: Address | string, amount: i128): string {
        const fromAddr = typeof from === 'string' ? Address.fromString(from) : from;
        const toAddr = typeof to === 'string' ? Address.fromString(to) : to;
        return this.call(
            'transfer',
            fromAddr.toScVal(),
            toAddr.toScVal(),
            nativeToScVal(amount, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Transfer shares from `from` to `to`, spending `spender`'s allowance.
     * `spender` must authorize the call.
     * @param amount - Shares to transfer (share-dec)
     * @returns XDR operation string
     */
    transferFrom(
        spender: Address | string,
        from: Address | string,
        to: Address | string,
        amount: i128
    ): string {
        const spenderAddr = typeof spender === 'string' ? Address.fromString(spender) : spender;
        const fromAddr = typeof from === 'string' ? Address.fromString(from) : from;
        const toAddr = typeof to === 'string' ? Address.fromString(to) : to;
        return this.call(
            'transfer_from',
            spenderAddr.toScVal(),
            fromAddr.toScVal(),
            toAddr.toScVal(),
            nativeToScVal(amount, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Approve `spender` to transfer up to `amount` of `owner`'s shares.
     * `owner` must authorize the call.
     * @param amount - Shares approved (share-dec)
     * @param liveUntilLedger - Ledger sequence at which the approval expires
     * @returns XDR operation string
     */
    approve(
        owner: Address | string,
        spender: Address | string,
        amount: i128,
        liveUntilLedger: u32
    ): string {
        const ownerAddr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        const spenderAddr = typeof spender === 'string' ? Address.fromString(spender) : spender;
        return this.call(
            'approve',
            ownerAddr.toScVal(),
            spenderAddr.toScVal(),
            nativeToScVal(amount, { type: 'i128' }),
            xdr.ScVal.scvU32(liveUntilLedger),
        ).toXDR('base64');
    }

    /**
     * Get the share token's decimals: the asset's decimals plus the
     * constructor's `decimals_offset`.
     * @returns XDR operation string
     */
    decimals(): string {
        return this.call('decimals').toXDR('base64');
    }

    /**
     * Get the share token's name
     * @returns XDR operation string
     */
    name(): string {
        return this.call('name').toXDR('base64');
    }

    /**
     * Get the share token's symbol
     * @returns XDR operation string
     */
    symbol(): string {
        return this.call('symbol').toXDR('base64');
    }

    // ============================================================
    // Vault Views
    // ============================================================

    /**
     * Get the underlying settlement token's address
     * @returns XDR operation string
     */
    queryAsset(): string {
        return this.call('query_asset').toXDR('base64');
    }

    /**
     * Get the registered strategy (market contract) address; the only
     * address authorized to call the strategy mutations.
     * @returns XDR operation string
     */
    getStrategy(): string {
        return this.call('get_strategy').toXDR('base64');
    }

    /**
     * Get the vault's total assets (token-dec): exactly the vault contract's
     * settlement-token `Balance`, before any pending-PnL mark.
     * @returns XDR operation string
     */
    totalAssets(): string {
        return this.call('total_assets').toXDR('base64');
    }

    /**
     * Preview the shares a deposit of `assets` would mint at the
     * uPnL-marked share price (rounded down)
     * @param assets - Assets to quote (token-dec)
     * @param netPnl - Signed pending trader PnL marked against the vault (token-dec)
     * @returns XDR operation string
     */
    previewDeposit(assets: i128, netPnl: i128): string {
        return this.call(
            'preview_deposit',
            nativeToScVal(assets, { type: 'i128' }),
            nativeToScVal(netPnl, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Preview the assets a redemption of `shares` would pay at the
     * uPnL-marked share price (rounded down)
     * @param shares - Shares to quote (share decimals)
     * @param netPnl - Signed pending trader PnL marked against the vault (token-dec)
     * @returns XDR operation string
     */
    previewRedeem(shares: i128, netPnl: i128): string {
        return this.call(
            'preview_redeem',
            nativeToScVal(shares, { type: 'i128' }),
            nativeToScVal(netPnl, { type: 'i128' }),
        ).toXDR('base64');
    }

    // ============================================================
    // Strategy Methods (strategy auth required)
    // ============================================================

    /**
     * Deposit `assets` and mint the uPnL-priced shares to `receiver`;
     * returns the shares minted (share decimals, rounded down in the
     * vault's favor). Strategy auth required.
     * @param assets - Assets to deposit (token-dec)
     * @param receiver - Address receiving the minted shares
     * @param from - Address providing the assets
     * @param netPnl - Signed pending trader PnL marked against the vault
     *   (token-dec); positive is profit the vault still owes
     * @returns XDR operation string
     */
    strategyDeposit(
        assets: i128,
        receiver: Address | string,
        from: Address | string,
        netPnl: i128
    ): string {
        const receiverAddr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        const fromAddr = typeof from === 'string' ? Address.fromString(from) : from;
        return this.call(
            'strategy_deposit',
            nativeToScVal(assets, { type: 'i128' }),
            receiverAddr.toScVal(),
            fromAddr.toScVal(),
            nativeToScVal(netPnl, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Redeem `shares` from `owner` and pay the uPnL-priced assets to
     * `receiver`; returns the assets paid (token-dec, rounded down in the
     * vault's favor). Strategy auth required.
     * @param shares - Shares to burn (share decimals)
     * @param receiver - Address receiving the redeemed assets
     * @param owner - Address whose shares are burned
     * @param netPnl - Signed pending trader PnL marked against the vault
     *   (token-dec); positive is profit the vault still owes
     * @returns XDR operation string
     */
    strategyRedeem(
        shares: i128,
        receiver: Address | string,
        owner: Address | string,
        netPnl: i128
    ): string {
        const receiverAddr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        const ownerAddr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        return this.call(
            'strategy_redeem',
            nativeToScVal(shares, { type: 'i128' }),
            receiverAddr.toScVal(),
            ownerAddr.toScVal(),
            nativeToScVal(netPnl, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Strategy (trading contract) withdraws tokens from the vault to pay
     * winning positions. Decreases `total_assets` and thus share price.
     * Strategy auth required.
     * @param amount - Assets to withdraw to the strategy (token-dec)
     * @returns XDR operation string
     */
    strategyWithdraw(amount: i128): string {
        return this.call(
            'strategy_withdraw',
            nativeToScVal(amount, { type: 'i128' }),
        ).toXDR('base64');
    }
}
