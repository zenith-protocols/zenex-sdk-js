import { describe, it, expect } from 'vitest';
import { TradingContract } from '../src/trading/trading_contract.js';
import { TradingRouterContract } from '../src/trading-router/router_contract.js';
import { FactoryContract } from '../src/factory/factory_contract.js';
import { VaultContract } from '../src/vault/vault_contract.js';
import { PriceVerifierContract } from '../src/price-verifier/price_verifier_contract.js';
import { TreasuryContract } from '../src/treasury/treasury_contract.js';
import { GovernanceContract } from '../src/governance/governance_contract.js';

import tradingSpec from './fixtures/specs/trading.json';
import tradingRouterSpec from './fixtures/specs/trading_router.json';
import factorySpec from './fixtures/specs/factory.json';
import strategyVaultSpec from './fixtures/specs/strategy_vault.json';
import priceVerifierSpec from './fixtures/specs/price_verifier.json';
import treasurySpec from './fixtures/specs/treasury.json';
import governanceSpec from './fixtures/specs/governance.json';

/**
 * Guards every SDK contract binding's embedded `static spec` against the
 * base64 XDR entries extracted straight from the compiled WASM (via
 * `tools/extracted-specs/*`, committed as fixtures under
 * `test/fixtures/specs/`). A drift here means the hand-maintained binding no
 * longer matches the audited on-chain interface.
 */
describe('spec-vs-WASM consistency', () => {
    it('TradingContract.spec matches the compiled wasm', () => {
        expect(TradingContract.spec.entries.map((e) => e.toXDR('base64')).sort())
            .toEqual([...tradingSpec].sort());
    });

    it('TradingRouterContract.spec matches the compiled wasm', () => {
        expect(TradingRouterContract.spec.entries.map((e) => e.toXDR('base64')).sort())
            .toEqual([...tradingRouterSpec].sort());
    });

    it('FactoryContract.spec matches the compiled wasm', () => {
        expect(FactoryContract.spec.entries.map((e) => e.toXDR('base64')).sort())
            .toEqual([...factorySpec].sort());
    });

    it('VaultContract.spec matches the compiled wasm', () => {
        expect(VaultContract.spec.entries.map((e) => e.toXDR('base64')).sort())
            .toEqual([...strategyVaultSpec].sort());
    });

    it('PriceVerifierContract.spec matches the compiled wasm', () => {
        expect(PriceVerifierContract.spec.entries.map((e) => e.toXDR('base64')).sort())
            .toEqual([...priceVerifierSpec].sort());
    });

    it('TreasuryContract.spec matches the compiled wasm', () => {
        expect(TreasuryContract.spec.entries.map((e) => e.toXDR('base64')).sort())
            .toEqual([...treasurySpec].sort());
    });

    it('GovernanceContract.spec matches the compiled wasm', () => {
        expect(GovernanceContract.spec.entries.map((e) => e.toXDR('base64')).sort())
            .toEqual([...governanceSpec].sort());
    });
});
