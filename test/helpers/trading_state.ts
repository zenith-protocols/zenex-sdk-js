import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { SCALAR_18 } from '../../src/math/index.js';
import {
    tradingConfigToScVal,
    type TradingConfig,
} from '../../src/contracts/trading/trading_types.js';

// =============================================================================
// Test builders for contract-instance / persistent ledger-entry values, shared
// by the trading-instance, treasury-rate, vault-instance, and batched-entries
// tests. Everything is built the way `getLedgerEntries` actually returns it: a
// `LedgerEntryResult { key: LedgerKey, val: LedgerEntryData }` keyed by the same
// ledger key the reader requests.
// =============================================================================

const i128 = (v: bigint) => nativeToScVal(v, { type: 'i128' });
const u64 = (v: bigint) => nativeToScVal(v, { type: 'u64' });
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
export const mapEntry = (k: string, v: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: sym(k), val: v });
const sidePair = (long: bigint, short: bigint) =>
    xdr.ScVal.scvMap([mapEntry('long', i128(long)), mapEntry('short', i128(short))]);

/** A `#[contracttype]` enum unit-variant storage KEY: `Vec[Symbol(name)]`. */
export const unitKey = (name: string): xdr.ScVal =>
    xdr.ScVal.scvVec([sym(name)]);

export function makeConfig(): TradingConfig {
    return {
        keeperRate: 5n * 10n ** 16n,
        minPositionNotional: 10n,
        maxPositionNotional: 10n ** 12n,
        maxOpenInterest: 10n ** 12n,
        minOrderNotional: 1n,
        minOrderMargin: 1n,
        execFee: 7n,
        feeDom: 5n * 10n ** 15n,
        feeNonDom: 2n * 10n ** 15n,
        impactScalar: 10n * SCALAR_18,
        maxUtilOpen: (8n * SCALAR_18) / 10n,
        maxUtilWithdraw: (9n * SCALAR_18) / 10n,
        initMargin: SCALAR_18 / 10n,
        maintenanceMargin: SCALAR_18 / 100n,
        liqFee: SCALAR_18 / 1000n,
        notionalLock: 60n,
        targetUtil: SCALAR_18 / 2n,
        borrowRate: 11n,
        increasedBorrowRate: 22n,
        fundingIncrease: 33n,
        fundingDecrease: 44n,
        thresholdStableFunding: SCALAR_18 / 20n,
        thresholdDecreaseFunding: SCALAR_18 / 40n,
        fundingMin: 1n,
        fundingMax: 999n,
        adlMaxPnl: SCALAR_18 / 2n,
        adlClearTarget: (45n * SCALAR_18) / 100n,
        maxPnlTrader: (90n * SCALAR_18) / 100n,
        maxPnlWithdraw: SCALAR_18 / 2n,
        redeemLock: 120n,
        depositFee: SCALAR_18 / 500n,
        redeemFee: SCALAR_18 / 400n,
        minDeposit: 5n,
        maxVaultBalance: 10n ** 13n,
    };
}

export function marketDataScVal(): xdr.ScVal {
    return xdr.ScVal.scvMap([
        mapEntry('borrowing_idx', sidePair(3n * 10n ** 15n, 0n)),
        mapEntry('borrowing_update', u64(500n)),
        mapEntry('margin', sidePair(100n, 100n)),
        mapEntry('funding_idx', sidePair(-2n * 10n ** 16n, 0n)),
        mapEntry('funding_owed', i128(0n)),
        mapEntry('funding_pool', i128(0n)),
        mapEntry('funding_rate', i128(0n)),
        mapEntry('funding_update', u64(600n)),
        mapEntry('notional', sidePair(1000n, 500n)),
        mapEntry('tokens', sidePair(500n, 250n)),
    ]);
}

export function positionScVal(): xdr.ScVal {
    return xdr.ScVal.scvMap([
        mapEntry('borrowing_idx', i128(0n)),
        mapEntry('margin', i128(100n)),
        mapEntry(
            'decrease_orders',
            xdr.ScVal.scvVec([xdr.ScVal.scvU32(3), xdr.ScVal.scvU32(7)]),
        ),
        mapEntry('funding_idx', i128(0n)),
        mapEntry('locked_notional', i128(200n)),
        mapEntry('notional', i128(1000n)),
        mapEntry('priced_at', u64(1500n)),
        mapEntry('tokens', i128(500n)),
        mapEntry('unlocks_at', u64(2000n)),
    ]);
}

export function adlScVal(long: boolean, short: boolean): xdr.ScVal {
    return xdr.ScVal.scvMap([
        mapEntry('long', xdr.ScVal.scvBool(long)),
        mapEntry('short', xdr.ScVal.scvBool(short)),
    ]);
}

/** A contract-instance value with the given `#[contracttype]`-keyed storage. */
export function contractInstance(storage: xdr.ScMapEntry[]): xdr.ScVal {
    return xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({
            executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
            storage,
        }),
    );
}

/** Default 32-byte V3 (`0x0003…`) stream id used by the instance fixtures. */
export const TEST_FEED_ID: Buffer = Buffer.concat([
    Buffer.from([0x00, 0x03]),
    Buffer.alloc(30, 23),
]);

export interface TradingInstanceOptions {
    vault: string;
    token: string;
    oracle: string;
    treasury: string;
    feedId?: Buffer;
    status?: number;
    adl?: [boolean, boolean];
    delistedAt?: bigint;
    terminalPrice?: bigint;
    /** Include a foreign OZ `Owner` key the walker must skip. */
    withOwner?: string;
}

export function tradingInstanceScVal(options: TradingInstanceOptions): xdr.ScVal {
    const addr = (id: string) => Address.fromString(id).toScVal();
    const storage: xdr.ScMapEntry[] = [
        new xdr.ScMapEntry({ key: unitKey('Config'), val: tradingConfigToScVal(makeConfig()) }),
        new xdr.ScMapEntry({ key: unitKey('FeedId'), val: xdr.ScVal.scvBytes(options.feedId ?? TEST_FEED_ID) }),
        new xdr.ScMapEntry({ key: unitKey('Status'), val: xdr.ScVal.scvU32(options.status ?? 0) }),
        new xdr.ScMapEntry({ key: unitKey('Vault'), val: addr(options.vault) }),
        new xdr.ScMapEntry({ key: unitKey('Token'), val: addr(options.token) }),
        new xdr.ScMapEntry({ key: unitKey('Oracle'), val: addr(options.oracle) }),
        new xdr.ScMapEntry({ key: unitKey('Treasury'), val: addr(options.treasury) }),
    ];
    if (options.delistedAt !== undefined) {
        storage.push(new xdr.ScMapEntry({ key: unitKey('DelistedAt'), val: u64(options.delistedAt) }));
    }
    if (options.terminalPrice !== undefined) {
        storage.push(new xdr.ScMapEntry({ key: unitKey('TerminalPrice'), val: i128(options.terminalPrice) }));
    }
    if (options.adl !== undefined) {
        storage.push(new xdr.ScMapEntry({ key: unitKey('Adl'), val: adlScVal(options.adl[0], options.adl[1]) }));
    }
    if (options.withOwner !== undefined) {
        storage.push(new xdr.ScMapEntry({ key: unitKey('Owner'), val: addr(options.withOwner) }));
    }
    return contractInstance(storage);
}

export interface VaultInstanceOptions {
    asset: string;
    strategy?: string;
    totalSupply?: bigint;
    decimalsOffset?: number;
    shareDecimals?: number;
}

export function vaultInstanceScVal(options: VaultInstanceOptions): xdr.ScVal {
    const metaMap = xdr.ScVal.scvMap([
        mapEntry('decimals', xdr.ScVal.scvU32(options.shareDecimals ?? 8)),
        mapEntry('name', xdr.ScVal.scvString('Zenex Vault')),
        mapEntry('symbol', xdr.ScVal.scvString('zTKN')),
    ]);
    const storage: xdr.ScMapEntry[] = [
        new xdr.ScMapEntry({ key: unitKey('AssetAddress'), val: Address.fromString(options.asset).toScVal() }),
        new xdr.ScMapEntry({ key: unitKey('Meta'), val: metaMap }),
        new xdr.ScMapEntry({ key: unitKey('TotalSupply'), val: i128(options.totalSupply ?? 0n) }),
        new xdr.ScMapEntry({ key: unitKey('VirtualDecimalsOffset'), val: xdr.ScVal.scvU32(options.decimalsOffset ?? 1) }),
    ];
    if (options.strategy !== undefined) {
        storage.push(new xdr.ScMapEntry({ key: unitKey('Strategy'), val: Address.fromString(options.strategy).toScVal() }));
    }
    return contractInstance(storage);
}

/** Treasury instance carrying a BARE `Symbol("Rate")` key (or none). */
export function treasuryInstanceScVal(rate?: bigint): xdr.ScVal {
    const storage: xdr.ScMapEntry[] = [];
    if (rate !== undefined) {
        storage.push(new xdr.ScMapEntry({ key: sym('Rate'), val: i128(rate) }));
    }
    return contractInstance(storage);
}

/** SAC-map token balance value (`{ amount, authorized, clawback }`). */
export function balanceMapScVal(amount: bigint): xdr.ScVal {
    return xdr.ScVal.scvMap([
        mapEntry('amount', i128(amount)),
        mapEntry('authorized', xdr.ScVal.scvBool(true)),
        mapEntry('clawback', xdr.ScVal.scvBool(false)),
    ]);
}

/**
 * Wrap a value ScVal into a `LedgerEntryResult`, keyed by the SAME ledger key
 * the reader requests, exactly as `getLedgerEntries` returns it.
 *
 * `liveUntilLedgerSeq` defaults far past the mocked `latestLedger` (a live
 * entry); pass an explicit value to model an expired-but-not-yet-evicted one.
 */
export function ledgerEntryFor(
    key: xdr.LedgerKey,
    val: xdr.ScVal,
    liveUntilLedgerSeq = 1_000_000,
) {
    const cd = key.contractData();
    return {
        lastModifiedLedgerSeq: 1,
        liveUntilLedgerSeq,
        key,
        val: xdr.LedgerEntryData.contractData(
            new xdr.ContractDataEntry({
                ext: new xdr.ExtensionPoint(0),
                contract: cd.contract(),
                key: cd.key(),
                durability: cd.durability(),
                val,
            }),
        ),
    };
}
