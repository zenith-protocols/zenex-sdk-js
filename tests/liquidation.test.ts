/**
 * Liquidation Price Calculation Tests
 *
 * Tests that SDK liquidation price calculations match the Sentinel/Contract
 * fixed-point arithmetic implementation.
 *
 * Run with: npx tsx tests/liquidation.test.ts
 */

import { Position } from '../src/trading/position.js';
import { Market } from '../src/trading/market.js';
import { PositionStatus } from '../src/types/trading.js';
import { Asset } from '../src/types/asset.js';
import {
    fixedMulFloor,
    fixedMulCeil,
    fixedDivFloor,
    fixedDivCeil,
    SCALAR_7,
    SCALAR_18,
} from '../src/scaling.js';
import { logSection, logSuccess, logError, log } from './setup.js';

// ============================================================
// Test Utilities
// ============================================================

function createMockMarket(overrides: Partial<{
    baseFee: number;
    priceImpactScalar: number;
    maintenanceMargin: number;
    longNotionalSize: number;
    shortNotionalSize: number;
    longInterestIndex: bigint;
    shortInterestIndex: bigint;
}> = {}): Market {
    const asset: Asset = { tag: 'Other', values: ['BTC'] };

    return new Market(0, {
        asset,
        enabled: true,
        maxPayout: 100000,
        minCollateral: 10,
        maxCollateral: 10000,
        initMargin: 0.01,           // 1% initial margin (100x max leverage)
        maintenanceMargin: overrides.maintenanceMargin ?? 0.005, // 0.5% maintenance margin
        baseFee: overrides.baseFee ?? 0.0005,  // 0.05% base fee
        priceImpactScalar: overrides.priceImpactScalar ?? 1000000000, // Very high to minimize impact
        baseHourlyRate: 0.0001,
        longCollateral: 1000,
        longNotionalSize: overrides.longNotionalSize ?? 50000,
        shortCollateral: 1000,
        shortNotionalSize: overrides.shortNotionalSize ?? 40000,
        longInterestIndex: overrides.longInterestIndex ?? 1000000000000000000n, // 1.0 in SCALAR_18
        shortInterestIndex: overrides.shortInterestIndex ?? 1000000000000000000n,
        lastUpdate: Math.floor(Date.now() / 1000),
    });
}

function createMockPosition(overrides: Partial<{
    isLong: boolean;
    entryPrice: number;
    collateral: number;
    notionalSize: number;
    interestIndex: bigint;
}> = {}): Position {
    return new Position({
        id: 1,
        user: 'GTEST...',
        status: PositionStatus.Open,
        assetIndex: 0,
        isLong: overrides.isLong ?? true,
        stopLoss: 0,
        takeProfit: 0,
        entryPrice: overrides.entryPrice ?? 78708.30,
        collateral: overrides.collateral ?? 50,
        notionalSize: overrides.notionalSize ?? 2500, // 50x leverage
        interestIndex: overrides.interestIndex ?? 1000000000000000000n,
        createdAt: Math.floor(Date.now() / 1000),
    });
}

// ============================================================
// Fixed-Point Math Unit Tests
// ============================================================

function testFixedPointMath(): boolean {
    logSection('Fixed-Point Math Unit Tests');
    let allPassed = true;

    // Test 1: fixedMulFloor with positive numbers
    // 100 * 3 / 7 = 42.857... -> floor = 42
    {
        const result = fixedMulFloor(100n, 3n, 7n);
        const expected = 42n;
        if (result === expected) {
            logSuccess(`fixedMulFloor(100, 3, 7) = ${result} (expected ${expected})`);
        } else {
            logError(`fixedMulFloor(100, 3, 7) = ${result} (expected ${expected})`);
            allPassed = false;
        }
    }

    // Test 2: fixedMulFloor with negative numbers
    // -100 * 3 / 7 = -42.857... -> floor = -43
    {
        const result = fixedMulFloor(-100n, 3n, 7n);
        const expected = -43n;
        if (result === expected) {
            logSuccess(`fixedMulFloor(-100, 3, 7) = ${result} (expected ${expected})`);
        } else {
            logError(`fixedMulFloor(-100, 3, 7) = ${result} (expected ${expected})`);
            allPassed = false;
        }
    }

    // Test 3: fixedMulCeil with positive numbers
    // 100 * 3 / 7 = 42.857... -> ceil = 43
    {
        const result = fixedMulCeil(100n, 3n, 7n);
        const expected = 43n;
        if (result === expected) {
            logSuccess(`fixedMulCeil(100, 3, 7) = ${result} (expected ${expected})`);
        } else {
            logError(`fixedMulCeil(100, 3, 7) = ${result} (expected ${expected})`);
            allPassed = false;
        }
    }

    // Test 4: fixedMulCeil with negative numbers
    // -100 * 3 / 7 = -42.857... -> ceil = -42
    {
        const result = fixedMulCeil(-100n, 3n, 7n);
        const expected = -42n;
        if (result === expected) {
            logSuccess(`fixedMulCeil(-100, 3, 7) = ${result} (expected ${expected})`);
        } else {
            logError(`fixedMulCeil(-100, 3, 7) = ${result} (expected ${expected})`);
            allPassed = false;
        }
    }

    // Test 5: fixedDivFloor
    // 100 * 7 / 3 = 233.333... -> floor = 233
    {
        const result = fixedDivFloor(100n, 3n, 7n);
        const expected = 233n;
        if (result === expected) {
            logSuccess(`fixedDivFloor(100, 3, 7) = ${result} (expected ${expected})`);
        } else {
            logError(`fixedDivFloor(100, 3, 7) = ${result} (expected ${expected})`);
            allPassed = false;
        }
    }

    // Test 6: fixedDivCeil
    // 100 * 7 / 3 = 233.333... -> ceil = 234
    {
        const result = fixedDivCeil(100n, 3n, 7n);
        const expected = 234n;
        if (result === expected) {
            logSuccess(`fixedDivCeil(100, 3, 7) = ${result} (expected ${expected})`);
        } else {
            logError(`fixedDivCeil(100, 3, 7) = ${result} (expected ${expected})`);
            allPassed = false;
        }
    }

    // Test 7: SCALAR_7 multiplication
    // 1.5 * 2.0 = 3.0 (scaled)
    {
        const a = 15_000_000n; // 1.5 * SCALAR_7
        const b = 20_000_000n; // 2.0 * SCALAR_7
        const result = fixedMulFloor(a, b, SCALAR_7);
        const expected = 30_000_000n; // 3.0 * SCALAR_7
        if (result === expected) {
            logSuccess(`fixedMulFloor(1.5 * SCALAR_7, 2.0 * SCALAR_7, SCALAR_7) = ${result} (expected ${expected})`);
        } else {
            logError(`fixedMulFloor(1.5 * SCALAR_7, 2.0 * SCALAR_7, SCALAR_7) = ${result} (expected ${expected})`);
            allPassed = false;
        }
    }

    return allPassed;
}

// ============================================================
// Liquidation Price Tests
// ============================================================

function testUserScenario(): boolean {
    logSection('User Scenario Test: 50x Long, 50 Collateral, Entry 78708.30');

    // User's exact scenario:
    // - 50x long position
    // - 50 collateral
    // - Entry price: 78708.30
    // - Expected liquidation price: ~77567.03 (from Sentinel)

    const position = createMockPosition({
        isLong: true,
        entryPrice: 78708.30,
        collateral: 50,
        notionalSize: 2500, // 50 * 50x = 2500
        interestIndex: 1000000000000000000n, // No accrued interest
    });

    const market = createMockMarket({
        maintenanceMargin: 0.005, // 0.5%
        baseFee: 0.0005,          // 0.05%
        priceImpactScalar: 1000000000, // 1B to minimize impact
        longNotionalSize: 50000,
        shortNotionalSize: 40000, // Long dominant, so position pays base fee
        longInterestIndex: 1000000000000000000n,
        shortInterestIndex: 1000000000000000000n,
    });

    const liquidationPrice = position.getLiquidationPrice(market);

    log(`Position Details:`);
    log(`  Entry Price: ${position.entryPrice}`);
    log(`  Collateral: ${position.collateral}`);
    log(`  Notional Size: ${position.notionalSize}`);
    log(`  Leverage: ${position.leverage}x`);
    log(`  Direction: ${position.isLong ? 'Long' : 'Short'}`);
    log(``);
    log(`Market Details:`);
    log(`  Maintenance Margin: ${market.maintenanceMargin * 100}%`);
    log(`  Base Fee: ${market.baseFee * 100}%`);
    log(`  Long Notional: ${market.longNotionalSize}`);
    log(`  Short Notional: ${market.shortNotionalSize}`);
    log(``);
    log(`Calculated Liquidation Price: ${liquidationPrice.toFixed(2)}`);
    log(`Expected (Sentinel): ~77567.03`);

    // Allow for small rounding differences (within 1 price unit)
    const expected = 77567.03;
    const diff = Math.abs(liquidationPrice - expected);
    const tolerance = 1.0; // 1 price unit tolerance

    if (diff <= tolerance) {
        logSuccess(`Liquidation price matches Sentinel within tolerance (diff: ${diff.toFixed(4)})`);
        return true;
    } else {
        logError(`Liquidation price differs from Sentinel by ${diff.toFixed(4)} (tolerance: ${tolerance})`);
        return false;
    }
}

function testShortPosition(): boolean {
    logSection('Short Position Test: 50x Short, 50 Collateral, Entry 78708.30');

    const position = createMockPosition({
        isLong: false,
        entryPrice: 78708.30,
        collateral: 50,
        notionalSize: 2500,
        interestIndex: 1000000000000000000n,
    });

    const market = createMockMarket({
        maintenanceMargin: 0.005,
        baseFee: 0.0005,
        priceImpactScalar: 1000000000,
        longNotionalSize: 40000,
        shortNotionalSize: 50000, // Short dominant, so position pays base fee
        longInterestIndex: 1000000000000000000n,
        shortInterestIndex: 1000000000000000000n,
    });

    const liquidationPrice = position.getLiquidationPrice(market);

    log(`Position Details:`);
    log(`  Entry Price: ${position.entryPrice}`);
    log(`  Collateral: ${position.collateral}`);
    log(`  Notional Size: ${position.notionalSize}`);
    log(`  Leverage: ${position.leverage}x`);
    log(`  Direction: ${position.isLong ? 'Long' : 'Short'}`);
    log(``);
    log(`Calculated Liquidation Price: ${liquidationPrice.toFixed(2)}`);

    // For a short, liquidation is above entry price
    // The symmetry should give us ~79849.57 (same distance above as long is below)
    const longLiqPrice = 77567.03;
    const expectedDiff = 78708.30 - longLiqPrice; // ~1141.27
    const expectedShortLiq = 78708.30 + expectedDiff; // ~79849.57

    log(`Expected (symmetric to long): ~${expectedShortLiq.toFixed(2)}`);

    const diff = Math.abs(liquidationPrice - expectedShortLiq);
    const tolerance = 1.0;

    if (diff <= tolerance) {
        logSuccess(`Short liquidation price is symmetric to long (diff: ${diff.toFixed(4)})`);
        return true;
    } else {
        logError(`Short liquidation price differs from expected by ${diff.toFixed(4)}`);
        return false;
    }
}

function testHighLeverage(): boolean {
    logSection('High Leverage Test: 100x Long');

    const position = createMockPosition({
        isLong: true,
        entryPrice: 78708.30,
        collateral: 25,
        notionalSize: 2500, // 100x leverage
        interestIndex: 1000000000000000000n,
    });

    const market = createMockMarket({
        maintenanceMargin: 0.005,
        baseFee: 0.0005,
        priceImpactScalar: 1000000000,
        longNotionalSize: 50000,
        shortNotionalSize: 40000,
        longInterestIndex: 1000000000000000000n,
        shortInterestIndex: 1000000000000000000n,
    });

    const liquidationPrice = position.getLiquidationPrice(market);

    log(`Position Details:`);
    log(`  Leverage: ${position.leverage}x`);
    log(`  Collateral: ${position.collateral}`);
    log(`  Notional Size: ${position.notionalSize}`);
    log(``);
    log(`Calculated Liquidation Price: ${liquidationPrice.toFixed(2)}`);

    // At 100x, liquidation is much closer to entry
    // With half the collateral, the liquidation should be roughly halfway between
    // entry and the 50x liquidation price
    const fiftyXLiq = 77567.03;
    const midpoint = (78708.30 + fiftyXLiq) / 2; // ~78137.67

    log(`Expected (closer to entry than 50x): between ${midpoint.toFixed(2)} and ${position.entryPrice}`);

    if (liquidationPrice > fiftyXLiq && liquidationPrice < position.entryPrice) {
        logSuccess(`100x liquidation price is between 50x liq and entry (as expected)`);
        return true;
    } else {
        logError(`100x liquidation price is outside expected range`);
        return false;
    }
}

function testWithAccruedInterest(): boolean {
    logSection('Accrued Interest Test');

    // Entry at index 1.0, current index 1.001 (0.1% interest accrued)
    const entryIndex = 1000000000000000000n;
    const currentIndex = 1001000000000000000n; // 1.001 * SCALAR_18

    const position = createMockPosition({
        isLong: true,
        entryPrice: 78708.30,
        collateral: 50,
        notionalSize: 2500,
        interestIndex: entryIndex,
    });

    const market = createMockMarket({
        maintenanceMargin: 0.005,
        baseFee: 0.0005,
        priceImpactScalar: 1000000000,
        longNotionalSize: 50000,
        shortNotionalSize: 40000,
        longInterestIndex: currentIndex,
        shortInterestIndex: currentIndex,
    });

    const liquidationPrice = position.getLiquidationPrice(market);

    // Also calculate without interest for comparison
    const marketNoInterest = createMockMarket({
        maintenanceMargin: 0.005,
        baseFee: 0.0005,
        priceImpactScalar: 1000000000,
        longNotionalSize: 50000,
        shortNotionalSize: 40000,
        longInterestIndex: entryIndex, // Same as entry = no accrued interest
        shortInterestIndex: entryIndex,
    });

    const liqPriceNoInterest = position.getLiquidationPrice(marketNoInterest);

    log(`Entry Interest Index: ${entryIndex}`);
    log(`Current Interest Index: ${currentIndex}`);
    log(`Interest Rate Diff: ${Number(currentIndex - entryIndex) / 1e18 * 100}%`);
    log(``);
    log(`Liquidation Price (with interest): ${liquidationPrice.toFixed(2)}`);
    log(`Liquidation Price (no interest): ${liqPriceNoInterest.toFixed(2)}`);
    log(`Difference: ${(liquidationPrice - liqPriceNoInterest).toFixed(2)}`);

    // With interest, liquidation should be higher (closer to entry) for a long
    if (liquidationPrice > liqPriceNoInterest) {
        logSuccess(`Interest pushes liquidation price higher (closer to entry)`);
        return true;
    } else {
        logError(`Interest should push liquidation price higher for long positions`);
        return false;
    }
}

function testNoBaseFeeScenario(): boolean {
    logSection('No Base Fee Test (Balancing Trade)');

    const position = createMockPosition({
        isLong: true,
        entryPrice: 78708.30,
        collateral: 50,
        notionalSize: 2500,
        interestIndex: 1000000000000000000n,
    });

    // Long is NOT dominant (short > long), so closing long doesn't pay base fee
    const market = createMockMarket({
        maintenanceMargin: 0.005,
        baseFee: 0.0005,
        priceImpactScalar: 1000000000,
        longNotionalSize: 40000,  // Less than short
        shortNotionalSize: 50000, // Shorts dominant
        longInterestIndex: 1000000000000000000n,
        shortInterestIndex: 1000000000000000000n,
    });

    const liquidationPrice = position.getLiquidationPrice(market);

    // Compare with dominant scenario
    const marketDominant = createMockMarket({
        maintenanceMargin: 0.005,
        baseFee: 0.0005,
        priceImpactScalar: 1000000000,
        longNotionalSize: 50000,  // Longs dominant
        shortNotionalSize: 40000,
        longInterestIndex: 1000000000000000000n,
        shortInterestIndex: 1000000000000000000n,
    });

    const liqPriceDominant = position.getLiquidationPrice(marketDominant);

    log(`Long Notional: ${market.longNotionalSize} (non-dominant)`);
    log(`Short Notional: ${market.shortNotionalSize}`);
    log(``);
    log(`Liquidation Price (no base fee): ${liquidationPrice.toFixed(2)}`);
    log(`Liquidation Price (with base fee): ${liqPriceDominant.toFixed(2)}`);
    log(`Difference: ${(liqPriceDominant - liquidationPrice).toFixed(2)}`);

    // Without base fee, liquidation should be lower (further from entry) for a long
    if (liquidationPrice < liqPriceDominant) {
        logSuccess(`No base fee results in lower liquidation price (more buffer)`);
        return true;
    } else {
        logError(`No base fee should result in lower liquidation price`);
        return false;
    }
}

// ============================================================
// Main Test Runner
// ============================================================

async function main() {
    console.log('\n🧪 Zenex SDK Liquidation Price Tests\n');
    console.log('Testing that SDK calculations match Sentinel/Contract fixed-point math.\n');

    const results: { name: string; passed: boolean }[] = [];

    // Run all tests
    results.push({ name: 'Fixed-Point Math', passed: testFixedPointMath() });
    results.push({ name: 'User Scenario (50x Long)', passed: testUserScenario() });
    results.push({ name: 'Short Position', passed: testShortPosition() });
    results.push({ name: 'High Leverage (100x)', passed: testHighLeverage() });
    results.push({ name: 'Accrued Interest', passed: testWithAccruedInterest() });
    results.push({ name: 'No Base Fee', passed: testNoBaseFeeScenario() });

    // Summary
    logSection('Test Summary');
    let passed = 0;
    let failed = 0;

    for (const result of results) {
        if (result.passed) {
            logSuccess(result.name);
            passed++;
        } else {
            logError(result.name);
            failed++;
        }
    }

    console.log(`\n${passed}/${results.length} tests passed`);

    if (failed > 0) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Test runner error:', error);
    process.exit(1);
});
