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
export const SCALAR_18 = 1_000_000_000_000_000_000n;

// Max values
export const I128_MAX = BigInt('170141183460469231731687303715884105727');

// Network configuration
export interface Network {
    /** RPC URL (e.g., 'https://soroban-testnet.stellar.org') */
    rpc: string;
    /** Network passphrase for tx signing (use Networks from @stellar/stellar-sdk) */
    passphrase: string;
    /** Optional RPC server options */
    opts?: rpc.Server.Options;
}
