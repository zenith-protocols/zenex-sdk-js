import { Horizon } from "@stellar/stellar-sdk";

export * from './vault'
export * from './trading'
export * from './token'
export * from './ledger_entry_helper'
export * from './simulation_helper'
export * from './oracle'
export * from './response_parser'
export * from './loader'

export type u32 = number;
export type i32 = number;
export type u64 = bigint;
export type i64 = bigint;
export type u128 = bigint;
export type i128 = bigint;
export type Option<T> = T | undefined;

export const I128MAX = BigInt('170141183460469231731687303715884105727');

export enum ErrorTypes {
    LedgerEntryParseError = 'LedgerEntryParseError',
}

export interface Network {
    rpc: string;
    passphrase: string;
    maxConcurrentRequests?: number;
    opts?: Horizon.Server.Options;
}

export const Networks = {
    testnet: {
        rpc: 'https://soroban-testnet.stellar.org',
        passphrase: 'Test SDF Network ; September 2015',
    },
    mainnet: {
        rpc: 'https://roc.zenithprotocols.com',
        passphrase: 'Public Global Stellar Network ; September 2015',
    }
};

if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore Buffer exists
    window.Buffer = window.Buffer || Buffer;
}