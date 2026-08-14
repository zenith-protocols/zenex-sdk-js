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
// (trading/src/storage.rs). This walks the instance map, matching each key by
// variant name; the lazy keys (`DelistedAt`, `TerminalPrice`, `Adl`) yield
// `undefined` / the zeroed default when absent, unknown keys are skipped, and
// any other absent required key is an error.
// =============================================================================


/** The trading contract's decoded instance storage. */
export interface TradingInstanceState {
    /** Global trading parameters. */
    config: TradingConfig;
    /** Price feed id (immutable anchor). */
    feedId: number;
    /** Oracle exponent; price_scalar = 10^-exponent. */
    exponent: number;
    /** Operational status discriminant. */
    status: Status;
    /** Strategy-vault contract. */
    vault: string;
    /** Settlement token (collateral asset) contract. */
    token: string;
    /** Price-verifier contract. */
    priceVerifier: string;
    /** Treasury contract (protocol fee sink). */
    treasury: string;
    /** First-delist timestamp; lazy (absent unless delisted). */
    delistedAt?: bigint;
    /** Flat settlement price (price_scalar); lazy (absent until set). */
    terminalPrice?: bigint;
    /** ADL flags; zeroed default until first written. */
    adl: AdlState;
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
 *   (`Config`, `FeedId`, `Exponent`, `Status`, `Vault`, `Token`,
 *   `PriceVerifier`, `Treasury`) is absent.
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
    let feedId: number | undefined;
    let exponent: number | undefined;
    let status: Status | undefined;
    let vault: string | undefined;
    let token: string | undefined;
    let priceVerifier: string | undefined;
    let treasury: string | undefined;
    let delistedAt: bigint | undefined;
    let terminalPrice: bigint | undefined;
    let adl: AdlState | undefined;

    storage.forEach((item) => {
        switch (entryKeyName(item.key())) {
            case 'Config':
                config = parseTradingConfig(scValToNative(item.val()));
                break;
            case 'FeedId':
                feedId = Number(scValToNative(item.val()));
                break;
            case 'Exponent':
                exponent = Number(scValToNative(item.val()));
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
            case 'PriceVerifier':
                priceVerifier = Address.fromScVal(item.val()).toString();
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
        exponent: required(exponent, 'Exponent'),
        status: required(status, 'Status'),
        vault: required(vault, 'Vault'),
        token: required(token, 'Token'),
        priceVerifier: required(priceVerifier, 'PriceVerifier'),
        treasury: required(treasury, 'Treasury'),
        delistedAt,
        terminalPrice,
        adl: adl ?? { long: false, short: false },
    };
}
