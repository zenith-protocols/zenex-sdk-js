import { Address, xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { decodeEntryKey } from '../../ledger-keys.js';
import { Status } from './trading_types.js';
import type { AdlState, TradingConfig } from './trading_types.js';
import { parseAdlState, parseTradingConfig } from './trading_types.js';

// =============================================================================
// Trading contract instance-storage walker for `getLedgerEntries` reads.
//
// The trading contract keeps
// its config, oracle anchors, wired addresses, status, and the lazy
// delist/ADL state in instance storage, each under a `DataKey` variant
// (trading/src/storage.rs), plus `Owner` from `stellar_access::ownable`. This
// walks the instance map, matching each key by variant name; the lazy keys
// (`DelistedAt`, `TerminalPrice`, `Adl`, `Owner`) yield `undefined` / the
// zeroed default when absent, and any other absent required key is an error.
//
// The walk is exhaustive on purpose. Instance storage is ONE ledger entry, so
// every key is already fetched and paid for by the time this runs — decoding
// fewer of them saves nothing and discards what the caller has bought. `Owner`
// in particular is what a client checks to confirm the market is governed by
// the governance contract rather than a bare key, the same trust check
// `Market.load` runs against the vault and token.
// =============================================================================


/** The trading contract's decoded instance storage. */
export interface TradingInstanceState {
    /** Global trading parameters. */
    config: TradingConfig;
    /** 32-byte price stream id (`BytesN<32>`, immutable anchor). */
    feedId: Buffer;
    /** Operational status discriminant. */
    status: Status;
    /** Strategy-vault contract. */
    vault: string;
    /** Settlement token (collateral asset) contract. */
    token: string;
    /** Oracle contract. */
    oracle: string;
    /** Treasury contract (protocol fee sink). */
    treasury: string;
    /** First-delist timestamp; lazy (absent unless delisted). */
    delistedAt?: bigint;
    /** Flat settlement price (price_scalar); lazy (absent until set). */
    terminalPrice?: bigint;
    /** ADL flags; zeroed default until first written. */
    adl: AdlState;
    /**
     * Current owner (`stellar_access::ownable`); absent once ownership has been
     * renounced. Not a `DataKey` variant — the OZ module owns this slot.
     */
    owner?: string;
}

/** Safely decode a storage entry key to its variant name, `undefined` if not a key shape. */
function entryKeyName(key: xdr.ScVal): string | undefined {
    try {
        return decodeEntryKey(key);
    } catch {
        return undefined;
    }
}

/**
 * Walk a trading contract-instance value (`ScVal::ContractInstance`) into its
 * decoded [`TradingInstanceState`].
 *
 * @param instanceVal - The `.val()` of the trading instance `ContractDataEntry`
 *   (an `scvContractInstance`).
 * @throws If the value is not a contract instance, or any required key
 *   (`Config`, `FeedId`, `Status`, `Vault`, `Token`, `Oracle`, `Treasury`)
 *   is absent.
 */
export function parseTradingInstance(
    instanceVal: xdr.ScVal,
): TradingInstanceState {
    if (instanceVal.switch() !== xdr.ScValType.scvContractInstance()) {
        throw new Error('expected a trading contract-instance value');
    }
    const storage = instanceVal.instance().storage();
    if (!storage) {
        throw new Error('Trading instance storage is empty');
    }

    let config: TradingConfig | undefined;
    let feedId: Buffer | undefined;
    let status: Status | undefined;
    let vault: string | undefined;
    let token: string | undefined;
    let oracle: string | undefined;
    let treasury: string | undefined;
    let delistedAt: bigint | undefined;
    let terminalPrice: bigint | undefined;
    let adl: AdlState | undefined;
    let owner: string | undefined;

    storage.forEach((item) => {
        switch (entryKeyName(item.key())) {
            case 'Config':
                config = parseTradingConfig(scValToNative(item.val()));
                break;
            case 'FeedId':
                feedId = Buffer.from(item.val().bytes());
                break;
            case 'Status':
                status = Number(scValToNative(item.val())) as Status;
                break;
            case 'Vault':
                vault = Address.fromScVal(item.val()).toString();
                break;
            case 'Token':
                token = Address.fromScVal(item.val()).toString();
                break;
            case 'Oracle':
                oracle = Address.fromScVal(item.val()).toString();
                break;
            case 'Treasury':
                treasury = Address.fromScVal(item.val()).toString();
                break;
            case 'DelistedAt':
                delistedAt = scValToBigInt(item.val());
                break;
            case 'TerminalPrice':
                terminalPrice = scValToBigInt(item.val());
                break;
            case 'Adl':
                adl = parseAdlState(scValToNative(item.val()));
                break;
            case 'Owner':
                owner = Address.fromScVal(item.val()).toString();
                break;
        }
    });

    const required = <T>(value: T | undefined, name: string): T => {
        if (value === undefined) {
            throw new Error(`trading instance is missing ${name}`);
        }
        return value;
    };

    return {
        config: required(config, 'Config'),
        feedId: required(feedId, 'FeedId'),
        status: required(status, 'Status'),
        vault: required(vault, 'Vault'),
        token: required(token, 'Token'),
        oracle: required(oracle, 'Oracle'),
        treasury: required(treasury, 'Treasury'),
        delistedAt,
        terminalPrice,
        adl: adl ?? { long: false, short: false },
        owner,
    };
}
