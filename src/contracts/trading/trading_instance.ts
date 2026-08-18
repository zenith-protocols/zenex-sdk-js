import { xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';
import { Status } from './trading_types.js';
import type { AdlState, TradingConfig } from './trading_types.js';
import { parseAdlState, parseTradingConfig } from './trading_types.js';

// =============================================================================
// Trading contract instance-storage walker for `getLedgerEntries` reads.
//
// The trading contract keeps
// its config, oracle anchors, wired addresses, status, and the lazy
// delist/ADL state in instance storage, each under a `DataKey` variant
// under a `DataKey` variant, plus `Owner` from `stellar_access::ownable`. This
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
    const storage = instanceStorage(instanceVal, 'trading');
    const delistedAt = storage.get('DelistedAt');
    const terminalPrice = storage.get('TerminalPrice');
    const adl = storage.get('Adl');

    return {
        config: parseTradingConfig(scValToNative(storage.require('Config'))),
        feedId: Buffer.from(storage.require('FeedId').bytes()),
        status: Number(scValToNative(storage.require('Status'))) as Status,
        vault: storage.address('Vault'),
        token: storage.address('Token'),
        oracle: storage.address('Oracle'),
        treasury: storage.address('Treasury'),
        delistedAt: delistedAt ? scValToBigInt(delistedAt) : undefined,
        terminalPrice: terminalPrice ? scValToBigInt(terminalPrice) : undefined,
        adl: adl
            ? parseAdlState(scValToNative(adl))
            : { long: false, short: false },
        owner: storage.optionalAddress('Owner'),
    };
}
