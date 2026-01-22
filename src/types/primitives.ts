import { rpc } from '@stellar/stellar-sdk';

// Primitive numeric types
export type u32 = number;
export type i32 = number;
export type u64 = bigint;
export type i64 = bigint;
export type u128 = bigint;
export type i128 = bigint;
export type Option<T> = T | undefined;

// Scaling constants
export const SCALAR_7 = 10_000_000n;
export const SCALAR_14 = 100_000_000_000_000n;
export const SCALAR_18 = 1_000_000_000_000_000_000n;

// Network configuration
export interface Network {
    /** RPC URL (e.g., 'https://soroban-testnet.stellar.org') */
    rpc: string;
    /** Network passphrase for tx signing (use Networks from @stellar/stellar-sdk) */
    passphrase: string;
    /** Optional RPC server options */
    opts?: rpc.Server.Options;
}
