import { describe, expect, it } from 'vitest';
import { SCALAR_18 } from '../../src/math/fixed.js';
import * as SDK from '../../src/index.js';
import { Price, reduceSpread } from '../../src/trading/price.js';
import { OrderIntent, previewOrder } from '../../src/trading/order.js';
import { formatPrice, formatToken } from '../../src/float.js';
import {
    MAINNET_SPREAD_REDUCTION,
    TOKEN_DECIMALS,
    USER,
    fixtureMarket,
    flatPosition,
    unit,
} from './market_fixture.js';

// The oracle narrows a report's spread before the market reads it, so the
// chain fills on the reduced sides. Mainnet's factor is 0.5e18.

describe('reduceSpread: contract vectors', () => {
    // verify.rs reduce_spread_floors_the_half_spread_and_the_cut
    it('floors the half spread and then the cut', () => {
        expect(reduceSpread(100n, 105n, SCALAR_18 / 2n)).toEqual({ bid: 101n, ask: 104n });
    });

    it('collapses onto bid + (ask - bid) / 2 at SCALAR_18', () => {
        expect(reduceSpread(100n, 105n, SCALAR_18)).toEqual({ bid: 102n, ask: 102n });
    });

    it('is the identity at 0', () => {
        expect(reduceSpread(100n, 105n, 0n)).toEqual({ bid: 100n, ask: 105n });
    });

    // verify.rs reduce_spread_never_inverts_the_sides
    it('never inverts the sides', () => {
        for (const factor of [1n, SCALAR_18 / 3n, SCALAR_18 - 1n, SCALAR_18]) {
            const { bid, ask } = reduceSpread(999_999n, 1_000_001n, factor);
            expect(bid <= ask, `factor ${factor}`).toBe(true);
        }
    });

    it('rejects what the oracle rejects', () => {
        expect(() => reduceSpread(105n, 100n, 0n)).toThrow(RangeError);
        expect(() => reduceSpread(0n, 100n, 0n)).toThrow(RangeError);
        expect(() => reduceSpread(100n, 105n, -1n)).toThrow(RangeError);
        expect(() => reduceSpread(100n, 105n, SCALAR_18 + 1n)).toThrow(RangeError);
    });
});

describe('a raw report priced the way the chain prices it', () => {
    // A live mainnet XLM-USD report and the PriceCache pair the market stored
    // for it.
    const RAW_BID = 215_336_939_375_573_000n;
    const RAW_ASK = 215_435_625_628_151_100n;
    const CHAIN_BID = 215_361_610_938_717_525n;
    const CHAIN_ASK = 215_410_954_065_006_575n;

    it('reduces the live report to the stored mainnet pair', () => {
        expect(reduceSpread(RAW_BID, RAW_ASK, MAINNET_SPREAD_REDUCTION)).toEqual({
            bid: CHAIN_BID,
            ask: CHAIN_ASK,
        });
        const price = Price.fromReport(RAW_BID, RAW_ASK, 77n, MAINNET_SPREAD_REDUCTION);
        expect(price).toEqual(new Price(CHAIN_BID, CHAIN_ASK, 77n));
    });

    it('builds the price from the market factor', () => {
        const market = fixtureMarket();
        market.spreadReductionFactor = MAINNET_SPREAD_REDUCTION;
        expect(market.priceFromReport(RAW_BID, RAW_ASK, 77n)).toEqual(
            new Price(CHAIN_BID, CHAIN_ASK, 77n),
        );
        // A directly built snapshot carries no factor and leaves sides as given.
        expect(fixtureMarket().priceFromReport(RAW_BID, RAW_ASK, 77n)).toEqual(
            new Price(RAW_BID, RAW_ASK, 77n),
        );
    });

    it('previews the fill the chain makes on the reduced ask', () => {
        const market = fixtureMarket({
            vaultAssets: unit(1_000_000),
            config: { impactScalar: unit(100_000_000) },
        });
        market.spreadReductionFactor = MAINNET_SPREAD_REDUCTION;
        const notional = unit(10_000);
        const order = new OrderIntent(market, USER, true).openMarket({
            notional,
            margin: unit(1_500),
        });
        const preview = previewOrder(
            market,
            flatPosition(),
            order,
            market.priceFromReport(RAW_BID, RAW_ASK, 77n),
            100n,
        );
        expect(preview.outcome).toBe('fills');
        expect(preview.executionPrice).toBe(formatPrice(CHAIN_ASK));
        // 46,422.8945245 tokens on the chain pair, not 46,417.58 on the raw ask.
        expect(preview.position?.tokens).toBe(
            formatToken((notional * SCALAR_18) / CHAIN_ASK, TOKEN_DECIMALS),
        );
        expect(preview.position?.tokens).toBe(46422.8945245);
    });

    it('is part of the public surface', () => {
        expect(SDK.reduceSpread).toBe(reduceSpread);
        expect(SDK.Price.fromReport).toBeTypeOf('function');
    });
});
