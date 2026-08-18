import { xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';
import { Status } from './trading_types.js';
import type { AdlState, TradingConfig } from './trading_types.js';
import { parseAdlState, parseTradingConfig } from './trading_types.js';


export interface TradingInstanceState {
    /** Global trading parameters, mostly SCALAR_18 rates and ratios; mutable at runtime via the owner-only `set_config`. */
    config: TradingConfig;
    /** 32-byte Chainlink Data Streams stream id (`BytesN<32>` on-chain); a V3 (`0x0003…`) stream, immutable after construction. */
    feedId: Buffer;
    /** Market lifecycle stage; only `Active` admits new position opens. */
    status: Status;
    /** Strategy-vault contract. */
    vault: string;
    /** Settlement token (collateral asset) contract. */
    token: string;
    /** Oracle contract. */
    oracle: string;
    /** Treasury contract (protocol fee sink). */
    treasury: string;
    /** First-delist timestamp, unix seconds; anchors the grace/deadline window and stays set through the wind-down; lazy (absent unless ever delisted). */
    delistedAt?: bigint;
    /** Flat settlement price, price_scalar units; lazy, settable only once a delisted market's grace window has expired. */
    terminalPrice?: bigint;
    /** ADL flags; zeroed default until first written. */
    adl: AdlState;
    /**
     * Current owner (`stellar_access::ownable`) — check this equals the
     * governance contract rather than a bare key. Absent once ownership has
     * been renounced. Not a `DataKey` variant — the OZ module owns this slot.
     */
    owner?: string;
}

/**
 * Throws unless `Config`, `FeedId`, `Status`, `Vault`, `Token`, `Oracle` and
 * `Treasury` are all set; the lazy keys fall back to `undefined` or a zeroed
 * `AdlState`.
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
