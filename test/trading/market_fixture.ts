import { StrKey } from '@stellar/stellar-sdk';
import { SCALAR_18 } from '../../src/math/fixed.js';
import { Status } from '../../src/contracts/market/types.js';
import type {
    AdlState,
    MarketConfig,
    MarketData,
    SidePair,
} from '../../src/contracts/market/types.js';
import { Market } from '../../src/trading/market.js';
import { MarketPosition } from '../../src/trading/position.js';

// Shared builders for trading-tier tests that construct a `Market` directly,
// the way a cache or an indexer does, instead of mocking a ledger read.

export const MARKET = StrKey.encodeContract(Buffer.alloc(32, 1));
export const VAULT = StrKey.encodeContract(Buffer.alloc(32, 2));
export const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 3));
export const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 4));
export const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 5));
export const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
export const NETWORK = { rpc: 'http://localhost', passphrase: 'test' };

export const TOKEN_DECIMALS = 7;
/** A token-dec amount; base size is token-dec too at an 18-dec price. */
export const unit = (whole: number) =>
    BigInt(whole) * 10n ** BigInt(TOKEN_DECIMALS);
/** An 18-dec price from a decimal number of whole units. */
export const px = (whole: number) =>
    (BigInt(Math.round(whole * 1_000_000)) * SCALAR_18) / 1_000_000n;

export const pair = (long = 0n, short = 0n): SidePair => ({ long, short });

/**
 * The contract's own `test_config`: 0.5% / 0.3% fees, 10% initial and 5%
 * maintenance margin, 1% liquidation fee, a 100,000.0 impact scalar.
 */
export function contractTestConfig(
    overrides: Partial<MarketConfig> = {},
): MarketConfig {
    return {
        keeperRate: SCALAR_18 / 10n,
        minPositionNotional: 10_000_000n,
        maxPositionNotional: 1_000_000_000_000n,
        maxOpenInterest: 10_000_000_000_000n,
        minOrderNotional: 1_000_000n,
        minOrderMargin: 1_000_000n,
        execFee: 100_000n,
        feeDom: SCALAR_18 / 200n,
        feeNonDom: (3n * SCALAR_18) / 1000n,
        impactScalar: 1_000_000_000_000n,
        maxUtilOpen: (8n * SCALAR_18) / 10n,
        maxUtilWithdraw: (9n * SCALAR_18) / 10n,
        initMargin: SCALAR_18 / 10n,
        maintenanceMargin: SCALAR_18 / 20n,
        liqFee: SCALAR_18 / 100n,
        notionalLock: 30n,
        targetUtil: SCALAR_18 / 2n,
        borrowRate: 0n,
        increasedBorrowRate: 0n,
        fundingIncrease: 0n,
        fundingDecrease: 0n,
        thresholdStableFunding: 0n,
        thresholdDecreaseFunding: 0n,
        fundingMin: 0n,
        fundingMax: 0n,
        adlMaxPnl: SCALAR_18 / 2n,
        adlClearTarget: (4n * SCALAR_18) / 10n,
        maxPnlTrader: (9n * SCALAR_18) / 10n,
        maxPnlWithdraw: (15n * SCALAR_18) / 100n,
        redeemLock: 0n,
        depositFee: SCALAR_18 / 1000n,
        redeemFee: SCALAR_18 / 1000n,
        minDeposit: 1_000_000n,
        maxVaultBalance: 10_000_000_000_000n,
        ...overrides,
    };
}

export function marketData(overrides: Partial<MarketData> = {}): MarketData {
    return {
        notional: pair(),
        margin: pair(),
        tokens: pair(),
        fundingIdx: pair(),
        borrowingIdx: pair(),
        fundingRate: 0n,
        accruedAt: 0n,
        creditPool: 0n,
        creditOwed: 0n,
        ...overrides,
    };
}

export interface MarketFixture {
    data?: Partial<MarketData>;
    config?: Partial<MarketConfig>;
    vaultAssets?: bigint;
    vaultShares?: bigint;
    status?: Status;
    adl?: AdlState;
    ledger?: number;
}

/** A loaded `Market`, built by constructor on the contract `test_config`. */
export function fixtureMarket(fixture: MarketFixture = {}): Market {
    const vaultAssets = fixture.vaultAssets ?? unit(1000);
    return new Market(
        NETWORK,
        MARKET,
        fixture.ledger ?? 100,
        VAULT,
        TOKEN,
        ORACLE,
        TREASURY,
        undefined,
        Buffer.alloc(32, 1),
        fixture.status ?? Status.Active,
        contractTestConfig(fixture.config),
        marketData(fixture.data),
        fixture.adl ?? { long: false, short: false },
        undefined,
        vaultAssets,
        fixture.vaultShares ?? vaultAssets,
        0,
        TOKEN_DECIMALS,
    );
}

/** A side with no stored size, as `MarketUser.load` reads a never-opened row. */
export function flatPosition(isLong = true): MarketPosition {
    return new MarketPosition(isLong, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, []);
}

/**
 * A lone 10x position: 100.0 notional on 10.0 margin entered at $10, the
 * contract's `long_position` fixture. Pair it with a market whose aggregates
 * carry the same row (`loneBook`).
 */
export function lonePosition(
    overrides: Partial<MarketPosition> = {},
    isLong = true,
): MarketPosition {
    const position = new MarketPosition(
        isLong,
        unit(10),
        unit(100),
        unit(10),
        0n,
        0n,
        0n,
        0n,
        0n,
        [],
    );
    return Object.assign(position, overrides);
}

/** Market aggregates holding exactly `lonePosition` on one side. */
export function loneBook(isLong = true): Partial<MarketData> {
    return {
        notional: isLong ? pair(unit(100), 0n) : pair(0n, unit(100)),
        margin: isLong ? pair(unit(10), 0n) : pair(0n, unit(10)),
        tokens: isLong ? pair(unit(10), 0n) : pair(0n, unit(10)),
    };
}
