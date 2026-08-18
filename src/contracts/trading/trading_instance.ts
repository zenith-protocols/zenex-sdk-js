import { xdr, scValToBigInt, scValToNative } from '@stellar/stellar-sdk';
import { instanceStorage } from '../instance.js';
import { Status } from './trading_types.js';
import type { AdlState, TradingConfig } from './trading_types.js';
import { parseAdlState, parseTradingConfig } from './trading_types.js';


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
