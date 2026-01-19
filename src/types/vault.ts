import { i128, u32, u64 } from './primitives.js';

// Vault state data (ERC-4626 style)
export interface VaultStateData {
    /** Underlying asset token address */
    asset: string;
    /** Lock time in seconds for withdrawals */
    lockTime: number;
    /** Total shares in circulation */
    totalShares: number;
    /** Total assets in the vault */
    totalAssets: number;
}

// Constructor arguments for deploying a new vault
export interface VaultConstructorArgs {
    /** Name for the vault share token */
    name: string;
    /** Symbol for the vault share token */
    symbol: string;
    /** Address of the underlying token contract */
    asset: string;
    /** Virtual offset for inflation attack protection (0-10) */
    decimals_offset: u32;
    /** List of authorized strategy contract addresses */
    strategies: string[];
    /** Delay in seconds before redemptions/withdrawals can be executed */
    lock_time: u64;
}
