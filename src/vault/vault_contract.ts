import { Address, Contract, contract } from "@stellar/stellar-sdk";
import { i128, u64 } from "../index.js";

export interface WithdrawalRequest {
    shares: i128;
    unlock_time: u64;
}

export interface VaultDepositArgs {
    tokens: i128;
    receiver: Address | string;
}

export interface VaultQueueWithdrawArgs {
    shares: i128;
    owner: Address | string;
}

export interface VaultTransferArgs {
    strategy: Address | string;
    amount: i128;
}

export class VaultContract extends Contract {
    // Contract specification (generated from Rust contract)
    static readonly spec: contract.Spec = new contract.Spec(["AAAABAAAAAAAAAAAAAAAClZhdWx0RXJyb3IAAAAAAAcAAAAAAAAAClplcm9BbW91bnQAAAAAD8kAAAAAAAAAEkluc3VmZmljaWVudFNoYXJlcwAAAAAPygAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAD8sAAAAAAAAAGEluc3VmZmljaWVudFZhdWx0QmFsYW5jZQAAD80AAAAAAAAAFFdpdGhkcmF3YWxJblByb2dyZXNzAAAPzgAAAAAAAAAQV2l0aGRyYXdhbExvY2tlZAAAD88AAAAAAAAAFFVuYXV0aG9yaXplZFN0cmF0ZWd5AAAP0A==",
        "AAAAAQAAAAAAAAAAAAAAEVdpdGhkcmF3YWxSZXF1ZXN0AAAAAAAAAgAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAAAAAAt1bmxvY2tfdGltZQAAAAAG",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAEAAAAAAAAACFN0cmF0ZWd5AAAAAQAAABMAAAABAAAAAAAAABFXaXRoZHJhd2FsUmVxdWVzdAAAAAAAAAEAAAAT",
        "AAAAAAAAAnhJbml0aWFsaXplcyB0aGUgaW1tdXRhYmxlIHZhdWx0CgpDcmVhdGVzIGEgbmV3IHZhdWx0IHdpdGggZml4ZWQgcGFyYW1ldGVycyB0aGF0IGNhbm5vdCBiZSBjaGFuZ2VkIGFmdGVyIGRlcGxveW1lbnQuCkRlcGxveXMgYSBuZXcgc2hhcmUgdG9rZW4gY29udHJhY3QgYW5kIHJlZ2lzdGVycyB0aGUgcHJvdmlkZWQgc3RyYXRlZ2llcy4KCiMgQXJndW1lbnRzCiogYHRva2VuYCAtIEFkZHJlc3Mgb2YgdGhlIHVuZGVybHlpbmcgdG9rZW4gY29udHJhY3QKKiBgdG9rZW5fd2FzbV9oYXNoYCAtIFdBU00gaGFzaCBmb3IgZGVwbG95aW5nIHRoZSBzaGFyZSB0b2tlbiBjb250cmFjdAoqIGBuYW1lYCAtIE5hbWUgZm9yIHRoZSBzaGFyZSB0b2tlbgoqIGBzeW1ib2xgIC0gU3ltYm9sIGZvciB0aGUgc2hhcmUgdG9rZW4KKiBgc3RyYXRlZ2llc2AgLSBMaXN0IG9mIHN0cmF0ZWd5IGNvbnRyYWN0IGFkZHJlc3NlcwoqIGBsb2NrX3RpbWVgIC0gRGVsYXkgaW4gc2Vjb25kcyBiZWZvcmUgd2l0aGRyYXdhbHMgY2FuIGJlIGV4ZWN1dGVkCiogYHBlbmFsdHlfcmF0ZWAgLSBQZW5hbHR5IHJhdGUgaW4gU0NBTEFSXzcgZm9ybWF0CgojIFBhbmljcwotIGBJbnZhbGlkQW1vdW50YCBpZiBwZW5hbHR5X3JhdGUgPCAwIG9yID4gMTAwJQAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAA90b2tlbl93YXNtX2hhc2gAAAAD7gAAACAAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAZzeW1ib2wAAAAAABAAAAAAAAAACnN0cmF0ZWdpZXMAAAAAA+oAAAATAAAAAAAAAAlsb2NrX3RpbWUAAAAAAAAGAAAAAAAAAAxwZW5hbHR5X3JhdGUAAAALAAAAAA==",
        "AAAAAAAAAAAAAAAFdG9rZW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAALc2hhcmVfdG9rZW4AAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAMdG90YWxfc2hhcmVzAAAAAAAAAAEAAAAL",
        "AAAAAAAAAAAAAAAKbmV0X2ltcGFjdAAAAAAAAQAAAAAAAAAIc3RyYXRlZ3kAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAAZ0b2tlbnMAAAAAAAsAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAOcXVldWVfd2l0aGRyYXcAAAAAAAIAAAAAAAAABnNoYXJlcwAAAAAACwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAASZW1lcmdlbmN5X3dpdGhkcmF3AAAAAAABAAAAAAAAAAVvd25lcgAAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAPY2FuY2VsX3dpdGhkcmF3AAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAALdHJhbnNmZXJfdG8AAAAAAgAAAAAAAAAIc3RyYXRlZ3kAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAIAAAAAAAAACHN0cmF0ZWd5AAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA=="]);

    static readonly parsers = {
        // Parse function results
        token: (result: string): Address =>
            VaultContract.spec.funcResToNative('token', result),
        shareToken: (result: string): Address =>
            VaultContract.spec.funcResToNative('share_token', result),
        totalShares: (result: string): i128 =>
            VaultContract.spec.funcResToNative('total_shares', result),
        netImpact: (result: string): i128 =>
            VaultContract.spec.funcResToNative('net_impact', result),
        deposit: (result: string): i128 =>
            VaultContract.spec.funcResToNative('deposit', result),
        withdraw: (result: string): i128 =>
            VaultContract.spec.funcResToNative('withdraw', result),
        emergencyWithdraw: (result: string): i128 =>
            VaultContract.spec.funcResToNative('emergency_withdraw', result),
        getWithdrawalRequest: (result: string): WithdrawalRequest | undefined =>
            VaultContract.spec.funcResToNative('get_withdrawal_request', result),
        getStrategies: (result: string): Address[] =>
            VaultContract.spec.funcResToNative('get_strategies', result),
    };

    /**
     * Get the underlying token address
     */
    token(): string {
        return this.call(
            'token',
            ...VaultContract.spec.funcArgsToScVals('token', {})
        ).toXDR('base64');
    }

    /**
     * Get the share token address
     */
    shareToken(): string {
        return this.call(
            'share_token',
            ...VaultContract.spec.funcArgsToScVals('share_token', {})
        ).toXDR('base64');
    }

    /**
     * Get total shares in circulation
     */
    totalShares(): string {
        return this.call(
            'total_shares',
            ...VaultContract.spec.funcArgsToScVals('total_shares', {})
        ).toXDR('base64');
    }

    /**
     * Get net impact for a strategy
     */
    netImpact(strategy: Address | string): string {
        return this.call(
            'net_impact',
            ...VaultContract.spec.funcArgsToScVals('net_impact', { strategy })
        ).toXDR('base64');
    }

    /**
     * Deposit tokens and receive shares
     */
    deposit(args: VaultDepositArgs): string {
        return this.call(
            'deposit',
            ...VaultContract.spec.funcArgsToScVals('deposit', args)
        ).toXDR('base64');
    }

    /**
     * Queue shares for withdrawal
     */
    queueWithdraw(args: VaultQueueWithdrawArgs): string {
        return this.call(
            'queue_withdraw',
            ...VaultContract.spec.funcArgsToScVals('queue_withdraw', args)
        ).toXDR('base64');
    }

    /**
     * Complete a queued withdrawal
     */
    withdraw(user: Address | string): string {
        return this.call(
            'withdraw',
            ...VaultContract.spec.funcArgsToScVals('withdraw', { user })
        ).toXDR('base64');
    }

    /**
     * Emergency withdraw with penalty
     */
    emergencyWithdraw(owner: Address | string): string {
        return this.call(
            'emergency_withdraw',
            ...VaultContract.spec.funcArgsToScVals('emergency_withdraw', { owner })
        ).toXDR('base64');
    }

    /**
     * Cancel a withdrawal request
     */
    cancelWithdraw(owner: Address | string): string {
        return this.call(
            'cancel_withdraw',
            ...VaultContract.spec.funcArgsToScVals('cancel_withdraw', { owner })
        ).toXDR('base64');
    }

    /**
     * Transfer tokens to a strategy (strategy auth required)
     */
    transferTo(args: VaultTransferArgs): string {
        return this.call(
            'transfer_to',
            ...VaultContract.spec.funcArgsToScVals('transfer_to', args)
        ).toXDR('base64');
    }

    /**
     * Transfer tokens from a strategy (strategy auth required)
     */
    transferFrom(args: VaultTransferArgs): string {
        return this.call(
            'transfer_from',
            ...VaultContract.spec.funcArgsToScVals('transfer_from', args)
        ).toXDR('base64');
    }

    // === READ METHODS (for RPC queries) ===

    /**
     * Get withdrawal request for a user
     */
    getWithdrawalRequest(owner: Address | string): string {
        return this.call(
            'get_withdrawal_request',
            ...VaultContract.spec.funcArgsToScVals('get_withdrawal_request', { owner })
        ).toXDR('base64');
    }

    /**
     * Get all authorized strategies
     */
    getStrategies(): string {
        return this.call(
            'get_strategies',
            ...VaultContract.spec.funcArgsToScVals('get_strategies', {})
        ).toXDR('base64');
    }
}
