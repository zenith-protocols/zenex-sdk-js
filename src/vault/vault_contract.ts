import { Address, Contract, contract, xdr, nativeToScVal, Operation } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../index.js';

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
    /** Authorized strategy contract address */
    strategy: string;
    /** Delay in seconds before redemptions/withdrawals can be executed */
    lock_time: u64;
    /** Minimum asset amount per deposit/mint (token_decimals); 0 disables the bound */
    min_deposit: i128;
}

/**
 * VaultContract - Operation builder for the Zenex Vault contract
 *
 * This is an ERC-4626 compliant vault with deposit-based locking.
 * The vault itself IS the share token (implements FungibleToken + FungibleVault).
 *
 * All methods return base64-encoded XDR operations for transaction building.
 */
export class VaultContract extends Contract {
    static spec: contract.Spec = new contract.Spec([
        "AAAAAAAAAJZNaW50IGV4YWN0bHkgYHNoYXJlc2AgdG8gYHJlY2VpdmVyYCBieSBwdWxsaW5nIHRoZSBjb3JyZXNwb25kaW5nIGFzc2V0CmFtb3VudCBmcm9tIGBmcm9tYC4gTmV3bHkgbWludGVkIHNoYXJlcyBlbnRlciB0aGUgbG9jayBmb3IgYGxvY2tfdGltZWAKc2Vjb25kcy4AAAAAAARtaW50AAAABAAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAAAAAAhyZWNlaXZlcgAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAhvcGVyYXRvcgAAABMAAAABAAAACw==",
        "AAAAAAAAAFVSZXR1cm5zIHRoZSBuYW1lIGZvciB0aGlzIHRva2VuLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAAAABG5hbWUAAAAAAAAAAQAAABA=",
        "AAAAAAAAAJVSZWRlZW0gZXhhY3RseSBgc2hhcmVzYCBmcm9tIGBvd25lcmAgYW5kIHNlbmQgdGhlIHVuZGVybHlpbmcgdG8KYHJlY2VpdmVyYC4gUGFuaWNzIGlmIGBvd25lcmAncyBhdmFpbGFibGUgKHVubG9ja2VkKSBzaGFyZSBiYWxhbmNlIGlzCmJlbG93IGBzaGFyZXNgLgAAAAAAAAZyZWRlZW0AAAAAAAQAAAAAAAAABnNoYXJlcwAAAAAACwAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAAL",
        "AAAAAAAAAFdSZXR1cm5zIHRoZSBzeW1ib2wgZm9yIHRoaXMgdG9rZW4uCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4AAAAABnN5bWJvbAAAAAAAAAAAAAEAAAAQ",
        "AAAAAAAAAyZTZXRzIHRoZSBhbW91bnQgb2YgdG9rZW5zIGEgYHNwZW5kZXJgIGlzIGFsbG93ZWQgdG8gc3BlbmQgb24gYmVoYWxmIG9mCmFuIGBvd25lcmAuIE92ZXJyaWRlcyBhbnkgZXhpc3RpbmcgYWxsb3dhbmNlIHNldCBiZXR3ZWVuIGBzcGVuZGVyYCBhbmQKYG93bmVyYC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBvd25lcmAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSB0b2tlbnMuCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3MgYXV0aG9yaXplZCB0byBzcGVuZCB0aGUgdG9rZW5zLgoqIGBhbW91bnRgIC0gVGhlIGFtb3VudCBvZiB0b2tlbnMgbWFkZSBhdmFpbGFibGUgdG8gYHNwZW5kZXJgLgoqIGBsaXZlX3VudGlsX2xlZGdlcmAgLSBUaGUgbGVkZ2VyIG51bWJlciBhdCB3aGljaCB0aGUgYWxsb3dhbmNlCmV4cGlyZXMuCgojIEVycm9ycwoKKiBbYEZ1bmdpYmxlVG9rZW5FcnJvcjo6SW52YWxpZExpdmVVbnRpbExlZGdlcmBdIC0gT2NjdXJzIHdoZW4KYXR0ZW1wdGluZyB0byBzZXQgYGxpdmVfdW50aWxfbGVkZ2VyYCB0aGF0IGlzIGxlc3MgdGhhbiB0aGUgY3VycmVudApsZWRnZXIgbnVtYmVyIGFuZCBncmVhdGVyIHRoYW4gYDBgLgoqIFtgRnVuZ2libGVUb2tlbkVycm9yOjpMZXNzVGhhblplcm9gXSAtIE9jY3VycyB3aGVuIGBhbW91bnQgPCAwYC4KCiMgRXZlbnRzCgoqIHRvcGljcyAtIGBbImFwcHJvdmUiLCBmcm9tOiBBZGRyZXNzLCBzcGVuZGVyOiBBZGRyZXNzXWAKKiBkYXRhIC0gYFthbW91bnQ6IGkxMjgsIGxpdmVfdW50aWxfbGVkZ2VyOiB1MzJdYAAAAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAA==",
        "AAAAAAAAAKpSZXR1cm5zIHRoZSBhbW91bnQgb2YgdG9rZW5zIGhlbGQgYnkgYGFjY291bnRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBhY2NvdW50YCAtIFRoZSBhZGRyZXNzIGZvciB3aGljaCB0aGUgYmFsYW5jZSBpcyBiZWluZyBxdWVyaWVkLgAAAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAINEZXBvc2l0IGBhc3NldHNgIG9mIHRoZSB1bmRlcmx5aW5nIHRva2VuIGFuZCBtaW50IHNoYXJlcyB0byBgcmVjZWl2ZXJgLgpOZXdseSBtaW50ZWQgc2hhcmVzIGVudGVyIHRoZSBsb2NrIGZvciBgbG9ja190aW1lYCBzZWNvbmRzLgAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAZhc3NldHMAAAAAAAsAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAAL",
        "AAAAAAAAAHxSZXR1cm5zIHRoZSBudW1iZXIgb2YgZGVjaW1hbHMgdXNlZCB0byByZXByZXNlbnQgYW1vdW50cyBvZiB0aGlzIHRva2VuLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAACGRlY2ltYWxzAAAAAAAAAAEAAAAE",
        "AAAAAAAAAO5SZXR1cm5zIHRoZSBtYXhpbXVtIGFtb3VudCBvZiB2YXVsdCBzaGFyZXMgdGhhdCBjYW4gYmUgbWludGVkCmZvciB0aGUgZ2l2ZW4gcmVjZWl2ZXIgYWRkcmVzcyAoY3VycmVudGx5IGBpMTI4OjpNQVhgKS4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgcmVjZWl2ZXJgIC0gVGhlIGFkZHJlc3MgdGhhdCB3b3VsZCByZWNlaXZlIHRoZSB2YXVsdCBzaGFyZXMuAAAAAAAIbWF4X21pbnQAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAACw==",
        "AAAAAAAAALZUcmFuc2ZlciBgYW1vdW50YCBzaGFyZXMgZnJvbSBgZnJvbWAgdG8gYHRvYC4gTG9ja2VkIChyZWNlbnRseSBkZXBvc2l0ZWQpCnNoYXJlcyBhcmUgZXhjbHVkZWQgZnJvbSB0aGUgc3BlbmRhYmxlIGJhbGFuY2UgYW5kIHRoZSBjYWxsIHBhbmljcyBpZgp0aGUgYXZhaWxhYmxlIGJhbGFuY2UgaXMgaW5zdWZmaWNpZW50LgAAAAAACHRyYW5zZmVyAAAAAwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAAUAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAALhXaXRoZHJhdyBgYXNzZXRzYCBvZiB0aGUgdW5kZXJseWluZyB0byBgcmVjZWl2ZXJgIGJ5IGJ1cm5pbmcgdGhlCmNvcnJlc3BvbmRpbmcgc2hhcmVzIGZyb20gYG93bmVyYC4gUGFuaWNzIGlmIGBvd25lcmAncyBhdmFpbGFibGUKKHVubG9ja2VkKSBzaGFyZSBiYWxhbmNlIGlzIGJlbG93IHRoZSByZXF1aXJlZCBhbW91bnQuAAAACHdpdGhkcmF3AAAABAAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAAAAAAhyZWNlaXZlcgAAABMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAAAs=",
        "AAAAAAAAAPBSZXR1cm5zIHRoZSBhbW91bnQgb2YgdG9rZW5zIGEgYHNwZW5kZXJgIGlzIGFsbG93ZWQgdG8gc3BlbmQgb24gYmVoYWxmCm9mIGFuIGBvd25lcmAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gVGhlIGFkZHJlc3MgaG9sZGluZyB0aGUgdG9rZW5zLgoqIGBzcGVuZGVyYCAtIFRoZSBhZGRyZXNzIGF1dGhvcml6ZWQgdG8gc3BlbmQgdGhlIHRva2Vucy4AAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAdzcGVuZGVyAAAAABMAAAABAAAACw==",
        "AAAAAAAAACFSZXR1cm5zIHRoZSBsb2NrIHRpbWUgaW4gc2Vjb25kcy4AAAAAAAAJbG9ja190aW1lAAAAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAOVSZXR1cm5zIHRoZSBtYXhpbXVtIGFtb3VudCBvZiB2YXVsdCBzaGFyZXMgdGhhdCBjYW4gYmUgcmVkZWVtZWQKYnkgdGhlIGdpdmVuIG93bmVyIChlcXVhbCB0byB0aGVpciB2YXVsdCBzaGFyZSBiYWxhbmNlKS4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gVGhlIGFkZHJlc3MgdGhhdCBvd25zIHRoZSB2YXVsdCBzaGFyZXMuAAAAAAAACm1heF9yZWRlZW0AAAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAPZSZXR1cm5zIHRoZSBtYXhpbXVtIGFtb3VudCBvZiB1bmRlcmx5aW5nIGFzc2V0cyB0aGF0IGNhbiBiZSBkZXBvc2l0ZWQKZm9yIHRoZSBnaXZlbiByZWNlaXZlciBhZGRyZXNzIChjdXJyZW50bHkgYGkxMjg6Ok1BWGApLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGByZWNlaXZlcmAgLSBUaGUgYWRkcmVzcyB0aGF0IHdvdWxkIHJlY2VpdmUgdGhlIHZhdWx0IHNoYXJlcy4AAAAAAAttYXhfZGVwb3NpdAAAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAACw==",
        "AAAAAAAAAQpSZXR1cm5zIHRoZSBhZGRyZXNzIG9mIHRoZSB1bmRlcmx5aW5nIGFzc2V0IHRoYXQgdGhlIHZhdWx0IG1hbmFnZXMuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjp2YXVsdDo6VmF1bHRUb2tlbkVycm9yOjpWYXVsdEFzc2V0QWRkcmVzc05vdFNldGBdIC0gV2hlbiB0aGUKdmF1bHQncyB1bmRlcmx5aW5nIGFzc2V0IGFkZHJlc3MgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkLgAAAAAAC3F1ZXJ5X2Fzc2V0AAAAAAAAAAABAAAAEw==",
        "AAAAAAAAAa1SZXR1cm5zIHRoZSBtYXhpbXVtIGFtb3VudCBvZiB1bmRlcmx5aW5nIGFzc2V0cyB0aGF0IGNhbiBiZQp3aXRoZHJhd24gYnkgdGhlIGdpdmVuIG93bmVyLCBsaW1pdGVkIGJ5IHRoZWlyIHZhdWx0IHNoYXJlIGJhbGFuY2UuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYG93bmVyYCAtIFRoZSBhZGRyZXNzIHRoYXQgb3ducyB0aGUgdmF1bHQgc2hhcmVzLgoKIyBFcnJvcnMKCiogW2BjcmF0ZTo6dmF1bHQ6OlZhdWx0VG9rZW5FcnJvcjo6VmF1bHRJbnZhbGlkU2hhcmVzQW1vdW50YF0gLSBXaGVuCnNoYXJlcyA8IDAuCiogW2BjcmF0ZTo6dmF1bHQ6OlZhdWx0VG9rZW5FcnJvcjo6TWF0aE92ZXJmbG93YF0gLSBXaGVuIG1hdGhlbWF0aWNhbApvcGVyYXRpb25zIHJlc3VsdCBpbiBvdmVyZmxvdy4AAAAAAAAMbWF4X3dpdGhkcmF3AAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAapTaW11bGF0ZXMgYW5kIHJldHVybnMgdGhlIGFtb3VudCBvZiB1bmRlcmx5aW5nIGFzc2V0cyByZXF1aXJlZCB0byBtaW50CmEgZ2l2ZW4gYW1vdW50IG9mIHZhdWx0IHNoYXJlcyAocm91bmRlZCB1cCkuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHNoYXJlc2AgLSBUaGUgYW1vdW50IG9mIHZhdWx0IHNoYXJlcyB0byBzaW11bGF0ZSBtaW50aW5nLgoKIyBFcnJvcnMKCiogW2BjcmF0ZTo6dmF1bHQ6OlZhdWx0VG9rZW5FcnJvcjo6VmF1bHRJbnZhbGlkU2hhcmVzQW1vdW50YF0gLSBXaGVuCnNoYXJlcyA8IDAuCiogW2BjcmF0ZTo6dmF1bHQ6OlZhdWx0VG9rZW5FcnJvcjo6TWF0aE92ZXJmbG93YF0gLSBXaGVuIG1hdGhlbWF0aWNhbApvcGVyYXRpb25zIHJlc3VsdCBpbiBvdmVyZmxvdy4AAAAAAAxwcmV2aWV3X21pbnQAAAABAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAABAAAACw==",
        "AAAAAAAAAYVSZXR1cm5zIHRoZSB0b3RhbCBhbW91bnQgb2YgdW5kZXJseWluZyBhc3NldHMgaGVsZCBieSB0aGUgdmF1bHQuCgpUaGlzIHJlcHJlc2VudHMgdGhlIHZhdWx0J3MgYmFsYW5jZSBvZiB0aGUgdW5kZXJseWluZyBhc3NldCwgd2hpY2gKZGV0ZXJtaW5lcyB0aGUgY29udmVyc2lvbiByYXRlIGJldHdlZW4gc2hhcmVzIGFuZCBhc3NldHMuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjp2YXVsdDo6VmF1bHRUb2tlbkVycm9yOjpWYXVsdEFzc2V0QWRkcmVzc05vdFNldGBdIC0gV2hlbiB0aGUKdmF1bHQncyB1bmRlcmx5aW5nIGFzc2V0IGFkZHJlc3MgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkLgAAAAAAAAx0b3RhbF9hc3NldHMAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAGtSZXR1cm5zIHRoZSB0b3RhbCBhbW91bnQgb2YgdG9rZW5zIGluIGNpcmN1bGF0aW9uLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgAAAAAMdG90YWxfc3VwcGx5AAAAAAAAAAEAAAAL",
        "AAAAAAAAA5ZJbml0aWFsaXplIHRoZSB2YXVsdCB3aXRoIGl0cyB1bmRlcmx5aW5nIGFzc2V0LCBzaGFyZSBtZXRhZGF0YSwgc3RyYXRlZ3kKYWRkcmVzcywgYW5kIGRlcG9zaXQgbG9jayBkdXJhdGlvbi4KCmBzdHJhdGVneWAgaXMgdGhlIG9ubHkgYWRkcmVzcyBhbGxvd2VkIHRvIGNhbGwgYHN0cmF0ZWd5X3dpdGhkcmF3YCBhbmQKaXMgaW1tdXRhYmxlIGZvciB0aGUgbGlmZXRpbWUgb2YgdGhlIHZhdWx0LiBgZGVjaW1hbHNfb2Zmc2V0YCBhZGRzIGV4dHJhCnByZWNpc2lvbiB0byBzaGFyZSBhY2NvdW50aW5nIChkZWZlbnNlIGFnYWluc3QgRVJDLTQ2MjYgaW5mbGF0aW9uIGF0dGFja3MpLgpgbG9ja190aW1lYCBpcyB0aGUgcGVyLWRlcG9zaXQgY29vbGRvd24gYmVmb3JlIGZyZXNoIHNoYXJlcyBjYW4gYmUKdHJhbnNmZXJyZWQgb3IgcmVkZWVtZWQ7IHByZXZpb3VzbHkgZGVwb3NpdGVkIHNoYXJlcyByZW1haW4gYXZhaWxhYmxlLgoKIyBQYXJhbWV0ZXJzCi0gYG5hbWVgIC8gYHN5bWJvbGAgLSBFUkMtMjAgbWV0YWRhdGEgZm9yIHRoZSBzaGFyZSB0b2tlbgotIGBhc3NldGAgLSBVbmRlcmx5aW5nIGNvbGxhdGVyYWwgdG9rZW4gYWRkcmVzcwotIGBkZWNpbWFsc19vZmZzZXRgIC0gRXh0cmEgc2hhcmUgZGVjaW1hbHMgb24gdG9wIG9mIGBhc3NldC5kZWNpbWFscygpYAotIGBzdHJhdGVneWAgLSBUcmFkaW5nIGNvbnRyYWN0IGFkZHJlc3MgKGltbXV0YWJsZSkKLSBgbG9ja190aW1lYCAtIExvY2sgZHVyYXRpb24gaW4gc2Vjb25kcyBhcHBsaWVkIHRvIG5ldyBkZXBvc2l0cwotIGBtaW5fZGVwb3NpdGAgLSBNaW5pbXVtIGFzc2V0IGFtb3VudCBwZXIgZGVwb3NpdC9taW50ICh0b2tlbl9kZWNpbWFscykKCiMgUGFuaWNzCi0gYFN0cmF0ZWd5VmF1bHRFcnJvcjo6SW52YWxpZEFtb3VudGAgaWYgYG1pbl9kZXBvc2l0IDwgMGAAAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnN5bWJvbAAAAAAAEAAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAA9kZWNpbWFsc19vZmZzZXQAAAAABAAAAAAAAAAIc3RyYXRlZ3kAAAATAAAAAAAAAAlsb2NrX3RpbWUAAAAAAAAGAAAAAAAAAAttaW5fZGVwb3NpdAAAAAALAAAAAA==",
        "AAAAAAAAAG5UcmFuc2ZlciBgYW1vdW50YCBzaGFyZXMgZnJvbSBgZnJvbWAgdG8gYHRvYCB1c2luZyBgc3BlbmRlcmAncyBhbGxvd2FuY2UuClNhbWUgbG9jayBlbmZvcmNlbWVudCBhcyBgdHJhbnNmZXJgLgAAAAAADXRyYW5zZmVyX2Zyb20AAAAAAAAEAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAcJTaW11bGF0ZXMgYW5kIHJldHVybnMgdGhlIGFtb3VudCBvZiB1bmRlcmx5aW5nIGFzc2V0cyB0aGF0IHdvdWxkIGJlCnJlY2VpdmVkIGZvciByZWRlZW1pbmcgYSBnaXZlbiBhbW91bnQgb2YgdmF1bHQgc2hhcmVzIChyb3VuZGVkIGRvd24pLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBzaGFyZXNgIC0gVGhlIGFtb3VudCBvZiB2YXVsdCBzaGFyZXMgdG8gc2ltdWxhdGUgcmVkZWVtaW5nLgoKIyBFcnJvcnMKCiogW2BjcmF0ZTo6dmF1bHQ6OlZhdWx0VG9rZW5FcnJvcjo6VmF1bHRJbnZhbGlkU2hhcmVzQW1vdW50YF0gLSBXaGVuCnNoYXJlcyA8IDAuCiogW2BjcmF0ZTo6dmF1bHQ6OlZhdWx0VG9rZW5FcnJvcjo6TWF0aE92ZXJmbG93YF0gLSBXaGVuIG1hdGhlbWF0aWNhbApvcGVyYXRpb25zIHJlc3VsdCBpbiBvdmVyZmxvdy4AAAAAAA5wcmV2aWV3X3JlZGVlbQAAAAAAAQAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAb1TaW11bGF0ZXMgYW5kIHJldHVybnMgdGhlIGFtb3VudCBvZiB2YXVsdCBzaGFyZXMgdGhhdCB3b3VsZCBiZSBtaW50ZWQKZm9yIGEgZ2l2ZW4gZGVwb3NpdCBvZiB1bmRlcmx5aW5nIGFzc2V0cyAocm91bmRlZCBkb3duKS4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYXNzZXRzYCAtIFRoZSBhbW91bnQgb2YgdW5kZXJseWluZyBhc3NldHMgdG8gc2ltdWxhdGUgZGVwb3NpdGluZy4KCiMgRXJyb3JzCgoqIFtgY3JhdGU6OnZhdWx0OjpWYXVsdFRva2VuRXJyb3I6OlZhdWx0SW52YWxpZEFzc2V0c0Ftb3VudGBdIC0gV2hlbgphc3NldHMgPCAwLgoqIFtgY3JhdGU6OnZhdWx0OjpWYXVsdFRva2VuRXJyb3I6Ok1hdGhPdmVyZmxvd2BdIC0gV2hlbiBtYXRoZW1hdGljYWwKb3BlcmF0aW9ucyByZXN1bHQgaW4gb3ZlcmZsb3cuAAAAAAAAD3ByZXZpZXdfZGVwb3NpdAAAAAABAAAAAAAAAAZhc3NldHMAAAAAAAsAAAABAAAACw==",
        "AAAAAAAAAIBSZXR1cm5zIHRoZSBudW1iZXIgb2Ygc2hhcmVzIHRoZSB1c2VyIGNhbiBjdXJyZW50bHkgd2l0aGRyYXcvdHJhbnNmZXIuCkxvY2tlZCBzaGFyZXMgKGRlcG9zaXRzIHdpdGhpbiBgbG9ja190aW1lYCkgYXJlIGV4Y2x1ZGVkLgAAABBhdmFpbGFibGVfc2hhcmVzAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAACw==",
        "AAAAAAAAAcNTaW11bGF0ZXMgYW5kIHJldHVybnMgdGhlIGFtb3VudCBvZiB2YXVsdCBzaGFyZXMgdGhhdCB3b3VsZCBiZSBidXJuZWQKdG8gd2l0aGRyYXcgYSBnaXZlbiBhbW91bnQgb2YgdW5kZXJseWluZyBhc3NldHMgKHJvdW5kZWQgdXApLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBhc3NldHNgIC0gVGhlIGFtb3VudCBvZiB1bmRlcmx5aW5nIGFzc2V0cyB0byBzaW11bGF0ZSB3aXRoZHJhd2luZy4KCiMgRXJyb3JzCgoqIFtgY3JhdGU6OnZhdWx0OjpWYXVsdFRva2VuRXJyb3I6OlZhdWx0SW52YWxpZEFzc2V0c0Ftb3VudGBdIC0gV2hlbgphc3NldHMgPCAwLgoqIFtgY3JhdGU6OnZhdWx0OjpWYXVsdFRva2VuRXJyb3I6Ok1hdGhPdmVyZmxvd2BdIC0gV2hlbiBtYXRoZW1hdGljYWwKb3BlcmF0aW9ucyByZXN1bHQgaW4gb3ZlcmZsb3cuAAAAABBwcmV2aWV3X3dpdGhkcmF3AAAAAQAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAY5Db252ZXJ0cyBhbiBhbW91bnQgb2YgdmF1bHQgc2hhcmVzIHRvIHRoZSBlcXVpdmFsZW50IGFtb3VudCBvZgp1bmRlcmx5aW5nIGFzc2V0cyAocm91bmRlZCBkb3duKS4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgc2hhcmVzYCAtIFRoZSBhbW91bnQgb2YgdmF1bHQgc2hhcmVzIHRvIGNvbnZlcnQuCgojIEVycm9ycwoKKiBbYGNyYXRlOjp2YXVsdDo6VmF1bHRUb2tlbkVycm9yOjpWYXVsdEludmFsaWRTaGFyZXNBbW91bnRgXSAtIFdoZW4Kc2hhcmVzIDwgMC4KKiBbYGNyYXRlOjp2YXVsdDo6VmF1bHRUb2tlbkVycm9yOjpNYXRoT3ZlcmZsb3dgXSAtIFdoZW4gbWF0aGVtYXRpY2FsCm9wZXJhdGlvbnMgcmVzdWx0IGluIG92ZXJmbG93LgAAAAAAEWNvbnZlcnRfdG9fYXNzZXRzAAAAAAAAAQAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAZNDb252ZXJ0cyBhbiBhbW91bnQgb2YgdW5kZXJseWluZyBhc3NldHMgdG8gdGhlIGVxdWl2YWxlbnQgYW1vdW50IG9mCnZhdWx0IHNoYXJlcyAocm91bmRlZCBkb3duKS4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYXNzZXRzYCAtIFRoZSBhbW91bnQgb2YgdW5kZXJseWluZyBhc3NldHMgdG8gY29udmVydC4KCiMgRXJyb3JzCgoqIFtgY3JhdGU6OnZhdWx0OjpWYXVsdFRva2VuRXJyb3I6OlZhdWx0SW52YWxpZEFzc2V0c0Ftb3VudGBdIC0gV2hlbgphc3NldHMgPCAwLgoqIFtgY3JhdGU6OnZhdWx0OjpWYXVsdFRva2VuRXJyb3I6Ok1hdGhPdmVyZmxvd2BdIC0gV2hlbiBtYXRoZW1hdGljYWwKb3BlcmF0aW9ucyByZXN1bHQgaW4gb3ZlcmZsb3cuAAAAABFjb252ZXJ0X3RvX3NoYXJlcwAAAAAAAAEAAAAAAAAABmFzc2V0cwAAAAAACwAAAAEAAAAL",
        "AAAAAAAAAb5TdHJhdGVneSAodHJhZGluZyBjb250cmFjdCkgd2l0aGRyYXdzIHRva2VucyBmcm9tIHRoZSB2YXVsdCB0byBwYXkKd2lubmluZyBwb3NpdGlvbnMuIERlY3JlYXNlcyBgdG90YWxfYXNzZXRzYCBhbmQgdGh1cyBzaGFyZSBwcmljZS4KCk9ubHkgdGhlIGBzdHJhdGVneWAgYWRkcmVzcyByZWdpc3RlcmVkIGF0IGNvbnN0cnVjdGlvbiBjYW4gYXV0aG9yaXplCnRoaXMgY2FsbC4KCiMgUGFyYW1ldGVycwotIGBzdHJhdGVneWAgLSBDYWxsZXIsIG11c3QgbWF0Y2ggdGhlIGltbXV0YWJsZSBzdHJhdGVneSBhZGRyZXNzIChhdXRoIHJlcXVpcmVkKQotIGBhbW91bnRgIC0gVG9rZW4gYW1vdW50IHRvIHdpdGhkcmF3ICh0b2tlbl9kZWNpbWFscykKCiMgUGFuaWNzCi0gT24gYHJlcXVpcmVfYXV0aGAgZmFpbHVyZSBpZiB0aGUgY2FsbGVyIGlzIG5vdCB0aGUgcmVnaXN0ZXJlZCBzdHJhdGVneQAAAAAAEXN0cmF0ZWd5X3dpdGhkcmF3AAAAAAAAAgAAAAAAAAAIc3RyYXRlZ3kAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAABQAAAAAAAAAAAAAAEFN0cmF0ZWd5V2l0aGRyYXcAAAABAAAAEXN0cmF0ZWd5X3dpdGhkcmF3AAAAAAAAAgAAAAAAAAAIc3RyYXRlZ3kAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAEJFdmVudCBlbWl0dGVkIHdoZW4gdW5kZXJseWluZyBhc3NldHMgYXJlIGRlcG9zaXRlZCBpbnRvIHRoZSB2YXVsdC4AAAAAAAAAAAAHRGVwb3NpdAAAAAABAAAAB2RlcG9zaXQAAAAABQAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAhyZWNlaXZlcgAAABMAAAABAAAAAAAAAAZhc3NldHMAAAAAAAsAAAAAAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAENFdmVudCBlbWl0dGVkIHdoZW4gc2hhcmVzIGFyZSBleGNoYW5nZWQgYmFjayBmb3IgdW5kZXJseWluZyBhc3NldHMuAAAAAAAAAAAIV2l0aGRyYXcAAAABAAAACHdpdGhkcmF3AAAABQAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAAAAAAGYXNzZXRzAAAAAAALAAAAAAAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAAAAAAI=",
        "AAAABQAAACxFdmVudCBlbWl0dGVkIHdoZW4gYW4gYWxsb3dhbmNlIGlzIGFwcHJvdmVkLgAAAAAAAAAHQXBwcm92ZQAAAAABAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAASFFdmVudCBlbWl0dGVkIHdoZW4gdG9rZW5zIGFyZSB0cmFuc2ZlcnJlZCBiZXR3ZWVuIGFkZHJlc3NlcyB3aXRob3V0IGEKbXV4ZWQgZGVzdGluYXRpb24uCgpQZXIgU0VQLTQxLCB0aGUgZXZlbnQgZGF0YSBpcyBhIGJhcmUgYGkxMjhgIHdoZW4gbm8gbXV4ZWQgYWRkcmVzcyBpcwppbnZvbHZlZC4gVGhlIGBkYXRhX2Zvcm1hdCA9ICJzaW5nbGUtdmFsdWUiYCBhdHRyaWJ1dGUgZW5zdXJlcyB0aGUKYGFtb3VudGAgZmllbGQgaXMgc2VyaWFsaXplZCBhcyBhIGJhcmUgdmFsdWUgcmF0aGVyIHRoYW4gYSBtYXAuAAAAAAAAAAAAAAhUcmFuc2ZlcgAAAAEAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAA=",
        "AAAABQAAAZdFdmVudCBlbWl0dGVkIHdoZW4gdG9rZW5zIGFyZSB0cmFuc2ZlcnJlZCB0byBhIG11eGVkIGFkZHJlc3MuCgpQZXIgU0VQLTQxLCB3aGVuIHRoZSBkZXN0aW5hdGlvbiBpcyBhIFtgTXV4ZWRBZGRyZXNzYF0gdGhlIGV2ZW50IGRhdGEKY2FycmllcyBib3RoIHRoZSBhbW91bnQgYW5kIHRoZSBtdXhlZCBpZGVudGlmaWVyIHNvIHRoYXQgb2ZmLWNoYWluCmNvbnN1bWVycyBjYW4gYXR0cmlidXRlIHRoZSB0cmFuc2ZlciB0byB0aGUgY29ycmVjdCBzdWItYWNjb3VudC4KClVzZXMgYHRvcGljcyA9IFsidHJhbnNmZXIiXWAgc28gdGhhdCBib3RoIFtgVHJhbnNmZXJgXSBhbmQKW2BNdXhlZFRyYW5zZmVyYF0gc2hhcmUgdGhlIHNhbWUgYCJ0cmFuc2ZlciJgIGV2ZW50IHN5bWJvbCwgYXMgcmVxdWlyZWQKYnkgU0VQLTQxLgAAAAAAAAAADU11eGVkVHJhbnNmZXIAAAAAAAABAAAACHRyYW5zZmVyAAAABAAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAAC3RvX211eGVkX2lkAAAAA+gAAAAGAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI="
    ]);

    // Result parsers for functions that return values
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

        // FungibleVault parsers
        queryAsset: (result: string): Address =>
            VaultContract.spec.funcResToNative('query_asset', result),
        totalAssets: (result: string): i128 =>
            VaultContract.spec.funcResToNative('total_assets', result),
        convertToShares: (result: string): i128 =>
            VaultContract.spec.funcResToNative('convert_to_shares', result),
        convertToAssets: (result: string): i128 =>
            VaultContract.spec.funcResToNative('convert_to_assets', result),
        maxDeposit: (result: string): i128 =>
            VaultContract.spec.funcResToNative('max_deposit', result),
        previewDeposit: (result: string): i128 =>
            VaultContract.spec.funcResToNative('preview_deposit', result),
        deposit: (result: string): i128 =>
            VaultContract.spec.funcResToNative('deposit', result),
        maxMint: (result: string): i128 =>
            VaultContract.spec.funcResToNative('max_mint', result),
        previewMint: (result: string): i128 =>
            VaultContract.spec.funcResToNative('preview_mint', result),
        mint: (result: string): i128 =>
            VaultContract.spec.funcResToNative('mint', result),
        maxWithdraw: (result: string): i128 =>
            VaultContract.spec.funcResToNative('max_withdraw', result),
        previewWithdraw: (result: string): i128 =>
            VaultContract.spec.funcResToNative('preview_withdraw', result),
        withdraw: (result: string): i128 =>
            VaultContract.spec.funcResToNative('withdraw', result),
        maxRedeem: (result: string): i128 =>
            VaultContract.spec.funcResToNative('max_redeem', result),
        previewRedeem: (result: string): i128 =>
            VaultContract.spec.funcResToNative('preview_redeem', result),
        redeem: (result: string): i128 =>
            VaultContract.spec.funcResToNative('redeem', result),

        // Custom StrategyVault parsers
        lockTime: (result: string): u64 =>
            VaultContract.spec.funcResToNative('lock_time', result),
        availableShares: (result: string): i128 =>
            VaultContract.spec.funcResToNative('available_shares', result),
    };

    /**
     * Deploy a new instance of the Vault contract
     * @param deployer - Address of the deployer
     * @param wasmHash - Hash of the Vault WASM contract code
     * @param args - Constructor arguments
     * @param salt - Optional salt for deterministic address
     * @param format - Format of wasmHash if string ('hex' or 'base64')
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
                nativeToScVal(args.lock_time, { type: 'u64' }),
                nativeToScVal(args.min_deposit, { type: 'i128' }),
            ],
        }).toXDR('base64');
    }

    // ============================================================
    // FungibleToken Methods (Share Token)
    // ============================================================

    /**
     * Get total supply of shares
     * @returns XDR operation string
     */
    totalSupply(): string {
        return this.call('total_supply').toXDR('base64');
    }

    /**
     * Get share balance of an account
     * @param account - Address to query
     * @returns XDR operation string
     */
    balance(account: Address | string): string {
        const addr = typeof account === 'string' ? Address.fromString(account) : account;
        return this.call('balance', addr.toScVal()).toXDR('base64');
    }

    /**
     * Get allowance between owner and spender
     * @param owner - Token owner address
     * @param spender - Spender address
     * @returns XDR operation string
     */
    allowance(owner: Address | string, spender: Address | string): string {
        const ownerAddr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        const spenderAddr = typeof spender === 'string' ? Address.fromString(spender) : spender;
        return this.call('allowance', ownerAddr.toScVal(), spenderAddr.toScVal()).toXDR('base64');
    }

    /**
     * Transfer shares from caller to recipient
     * @param from - Sender address (requires auth)
     * @param to - Recipient address
     * @param amount - Amount of shares to transfer
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
     * Transfer shares from one address to another using allowance
     * @param spender - Spender address (requires auth)
     * @param from - Token owner address
     * @param to - Recipient address
     * @param amount - Amount of shares to transfer
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
     * Approve spender to transfer shares on behalf of owner
     * @param owner - Token owner address (requires auth)
     * @param spender - Spender address
     * @param amount - Amount of shares to approve
     * @param liveUntilLedger - Ledger number when approval expires
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
     * Get token decimals
     * @returns XDR operation string
     */
    decimals(): string {
        return this.call('decimals').toXDR('base64');
    }

    /**
     * Get token name
     * @returns XDR operation string
     */
    name(): string {
        return this.call('name').toXDR('base64');
    }

    /**
     * Get token symbol
     * @returns XDR operation string
     */
    symbol(): string {
        return this.call('symbol').toXDR('base64');
    }

    // ============================================================
    // FungibleVault Methods (ERC-4626)
    // ============================================================

    /**
     * Get the underlying asset address
     * @returns XDR operation string
     */
    queryAsset(): string {
        return this.call('query_asset').toXDR('base64');
    }

    /**
     * Get total assets held by the vault
     * @returns XDR operation string
     */
    totalAssets(): string {
        return this.call('total_assets').toXDR('base64');
    }

    /**
     * Convert assets to shares (rounded down)
     * @param assets - Amount of assets to convert
     * @returns XDR operation string
     */
    convertToShares(assets: i128): string {
        return this.call(
            'convert_to_shares',
            nativeToScVal(assets, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Convert shares to assets (rounded down)
     * @param shares - Amount of shares to convert
     * @returns XDR operation string
     */
    convertToAssets(shares: i128): string {
        return this.call(
            'convert_to_assets',
            nativeToScVal(shares, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Get max assets that can be deposited for receiver
     * @param receiver - Receiver address
     * @returns XDR operation string
     */
    maxDeposit(receiver: Address | string): string {
        const addr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        return this.call('max_deposit', addr.toScVal()).toXDR('base64');
    }

    /**
     * Preview shares to be received for depositing assets
     * @param assets - Amount of assets
     * @returns XDR operation string
     */
    previewDeposit(assets: i128): string {
        return this.call(
            'preview_deposit',
            nativeToScVal(assets, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Deposit assets and receive shares
     * @param assets - Amount of underlying tokens to deposit
     * @param receiver - Address to receive the shares
     * @param from - Address providing the assets
     * @param operator - Address performing the operation (requires auth)
     * @returns XDR operation string
     */
    deposit(
        assets: i128,
        receiver: Address | string,
        from: Address | string,
        operator: Address | string
    ): string {
        const receiverAddr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        const fromAddr = typeof from === 'string' ? Address.fromString(from) : from;
        const operatorAddr = typeof operator === 'string' ? Address.fromString(operator) : operator;
        return this.call(
            'deposit',
            nativeToScVal(assets, { type: 'i128' }),
            receiverAddr.toScVal(),
            fromAddr.toScVal(),
            operatorAddr.toScVal(),
        ).toXDR('base64');
    }

    /**
     * Get max shares that can be minted for receiver
     * @param receiver - Receiver address
     * @returns XDR operation string
     */
    maxMint(receiver: Address | string): string {
        const addr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        return this.call('max_mint', addr.toScVal()).toXDR('base64');
    }

    /**
     * Preview assets required to mint shares
     * @param shares - Amount of shares
     * @returns XDR operation string
     */
    previewMint(shares: i128): string {
        return this.call(
            'preview_mint',
            nativeToScVal(shares, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Mint exact shares by depositing assets
     * @param shares - Amount of shares to mint
     * @param receiver - Address to receive the shares
     * @param from - Address providing the assets
     * @param operator - Address performing the operation (requires auth)
     * @returns XDR operation string
     */
    mint(
        shares: i128,
        receiver: Address | string,
        from: Address | string,
        operator: Address | string
    ): string {
        const receiverAddr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        const fromAddr = typeof from === 'string' ? Address.fromString(from) : from;
        const operatorAddr = typeof operator === 'string' ? Address.fromString(operator) : operator;
        return this.call(
            'mint',
            nativeToScVal(shares, { type: 'i128' }),
            receiverAddr.toScVal(),
            fromAddr.toScVal(),
            operatorAddr.toScVal(),
        ).toXDR('base64');
    }

    /**
     * Get max assets owner can withdraw (0 if locked)
     * @param owner - Owner address
     * @returns XDR operation string
     */
    maxWithdraw(owner: Address | string): string {
        const addr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        return this.call('max_withdraw', addr.toScVal()).toXDR('base64');
    }

    /**
     * Preview shares to be burned for withdrawing assets
     * @param assets - Amount of assets
     * @returns XDR operation string
     */
    previewWithdraw(assets: i128): string {
        return this.call(
            'preview_withdraw',
            nativeToScVal(assets, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Withdraw exact assets by burning shares
     * @param assets - Amount of underlying tokens to withdraw
     * @param receiver - Address to receive the assets
     * @param owner - Address that owns the shares
     * @param operator - Address performing the operation (requires auth)
     * @returns XDR operation string
     */
    withdraw(
        assets: i128,
        receiver: Address | string,
        owner: Address | string,
        operator: Address | string
    ): string {
        const receiverAddr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        const ownerAddr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        const operatorAddr = typeof operator === 'string' ? Address.fromString(operator) : operator;
        return this.call(
            'withdraw',
            nativeToScVal(assets, { type: 'i128' }),
            receiverAddr.toScVal(),
            ownerAddr.toScVal(),
            operatorAddr.toScVal(),
        ).toXDR('base64');
    }

    /**
     * Get max shares owner can redeem (0 if locked)
     * @param owner - Owner address
     * @returns XDR operation string
     */
    maxRedeem(owner: Address | string): string {
        const addr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        return this.call('max_redeem', addr.toScVal()).toXDR('base64');
    }

    /**
     * Preview assets to be received for redeeming shares
     * @param shares - Amount of shares
     * @returns XDR operation string
     */
    previewRedeem(shares: i128): string {
        return this.call(
            'preview_redeem',
            nativeToScVal(shares, { type: 'i128' }),
        ).toXDR('base64');
    }

    /**
     * Redeem shares for assets
     * @param shares - Amount of shares to redeem
     * @param receiver - Address to receive the assets
     * @param owner - Address that owns the shares
     * @param operator - Address performing the operation (requires auth)
     * @returns XDR operation string
     */
    redeem(
        shares: i128,
        receiver: Address | string,
        owner: Address | string,
        operator: Address | string
    ): string {
        const receiverAddr = typeof receiver === 'string' ? Address.fromString(receiver) : receiver;
        const ownerAddr = typeof owner === 'string' ? Address.fromString(owner) : owner;
        const operatorAddr = typeof operator === 'string' ? Address.fromString(operator) : operator;
        return this.call(
            'redeem',
            nativeToScVal(shares, { type: 'i128' }),
            receiverAddr.toScVal(),
            ownerAddr.toScVal(),
            operatorAddr.toScVal(),
        ).toXDR('base64');
    }

    // ============================================================
    // Custom StrategyVault Methods
    // ============================================================

    /**
     * Get lock time in seconds
     * @returns XDR operation string
     */
    lockTime(): string {
        return this.call('lock_time').toXDR('base64');
    }

    /**
     * Strategy withdraws tokens from the vault (decreases total_assets)
     * @param strategy - Strategy address (requires auth)
     * @param amount - Amount to withdraw
     * @returns XDR operation string
     */
    /**
     * Get the number of shares available (unlocked) for a user
     * @param user - User address
     * @returns XDR operation string
     */
    availableShares(user: Address | string): string {
        const addr = typeof user === 'string' ? Address.fromString(user) : user;
        return this.call('available_shares', addr.toScVal()).toXDR('base64');
    }

    strategyWithdraw(strategy: Address | string, amount: i128): string {
        const addr = typeof strategy === 'string' ? Address.fromString(strategy) : strategy;
        return this.call(
            'strategy_withdraw',
            addr.toScVal(),
            nativeToScVal(amount, { type: 'i128' }),
        ).toXDR('base64');
    }
}
