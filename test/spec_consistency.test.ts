import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TradingContract } from '../src/contracts/trading/trading_contract.js';
import { TradingRouterContract } from '../src/contracts/router/router_contract.js';
import { FactoryContract } from '../src/contracts/factory/factory_contract.js';
import { VaultContract } from '../src/contracts/vault/vault_contract.js';
import { PriceVerifierContract } from '../src/contracts/price-verifier/price_verifier_contract.js';
import { TreasuryContract } from '../src/contracts/treasury/treasury_contract.js';
import { GovernanceContract } from '../src/contracts/governance/governance_contract.js';
import {
    factorySpec,
    governanceSpec,
    priceVerifierSpec,
    strategyVaultSpec,
    tradingRouterSpec,
    tradingSpec,
    treasurySpec,
} from '../src/contracts/contract_specs.js';

import factoryFixture from './fixtures/specs/factory.json';
import governanceFixture from './fixtures/specs/governance.json';
import priceVerifierFixture from './fixtures/specs/price_verifier.json';
import strategyVaultFixture from './fixtures/specs/strategy_vault.json';
import tradingFixture from './fixtures/specs/trading.json';
import tradingRouterFixture from './fixtures/specs/trading_router.json';
import treasuryFixture from './fixtures/specs/treasury.json';
import manifest from './fixtures/specs/wasm-manifest.json';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const contracts = [
    {
        package: 'trading',
        exportName: 'tradingSpec',
        spec: tradingSpec,
        fixture: tradingFixture,
        contract: TradingContract,
        source: 'src/contracts/trading/trading_contract.ts',
        sha256: '1a99a7c8f90b094be36909aa8c180f68c13dbe99861bfb76777b481336fadc92',
        bytes: 66_036,
    },
    {
        package: 'trading-router',
        exportName: 'tradingRouterSpec',
        spec: tradingRouterSpec,
        fixture: tradingRouterFixture,
        contract: TradingRouterContract,
        source: 'src/contracts/router/router_contract.ts',
        sha256: '1affc4279fdc11de0ae14d2a8958f34aa88dfed4759f93a5a49b85c5c545caaa',
        bytes: 12_350,
    },
    {
        package: 'factory',
        exportName: 'factorySpec',
        spec: factorySpec,
        fixture: factoryFixture,
        contract: FactoryContract,
        source: 'src/contracts/factory/factory_contract.ts',
        sha256: 'ad47c71dfa109f4c035c84f8e2b412f0087422d510872d5792c2a7e3de8bc6b8',
        bytes: 7_714,
    },
    {
        package: 'strategy-vault',
        exportName: 'strategyVaultSpec',
        spec: strategyVaultSpec,
        fixture: strategyVaultFixture,
        contract: VaultContract,
        source: 'src/contracts/vault/vault_contract.ts',
        sha256: '26899099b15ef633220eabfd0871d2678170a3faab12a4e45eb1b986964950eb',
        bytes: 20_915,
    },
    {
        package: 'price-verifier',
        exportName: 'priceVerifierSpec',
        spec: priceVerifierSpec,
        fixture: priceVerifierFixture,
        contract: PriceVerifierContract,
        source: 'src/contracts/price-verifier/price_verifier_contract.ts',
        sha256: 'a305fb2c74d335602fc4c29e33f12772e747f80d0734293fbea83b709db0a2b3',
        bytes: 15_247,
    },
    {
        package: 'treasury',
        exportName: 'treasurySpec',
        spec: treasurySpec,
        fixture: treasuryFixture,
        contract: TreasuryContract,
        source: 'src/contracts/treasury/treasury_contract.ts',
        sha256: '85322d7b3edd30ac9c5f9a7dfb187dfa9eadf0781333ad841fe1bedb75a0eae9',
        bytes: 6_248,
    },
    {
        package: 'governance',
        exportName: 'governanceSpec',
        spec: governanceSpec,
        fixture: governanceFixture,
        contract: GovernanceContract,
        source: 'src/contracts/governance/governance_contract.ts',
        sha256: '751b7cc97b3c348e1eaf263eaef0c694ac1c5b3879256e68afe4ab9be8efac87',
        bytes: 10_130,
    },
] as const;

describe('approved v2 contract spec consistency', () => {
    it('pins source commit, source tree, Cargo.lock, and toolchain evidence', () => {
        expect(manifest).toMatchObject({
            schemaVersion: 1,
            contractsCommit: 'fc85144123622676d77c4e72b10aad7eab43d321',
            productionSourceTree: 'd7537b81ec8ecf4f64b1dcb56dadac71894e04f7',
            cargoLock: {
                path: 'Cargo.lock',
                sha256: '79a15142a56b0a97f1b0d3af1f9c0625feaa6e9eb3804089f9e31e268f5484a0',
            },
            toolchain: {
                stellarCli: 'stellar 25.2.0 (28484880988199233a7e8e87c97cb12dac323cb3)',
                stellarXdr: 'stellar-xdr 25.0.0 (dc9f40fcb83c3054341f70b65a2222073369b37b)',
                xdrCurrentRevision: '0a621ec7811db000a60efae5b35f78dee3aa2533',
                sorobanSdk: '25.3.0',
            },
        });
    });

    it.each(contracts)('pins $package spec to its approved rebuilt WASM', (entry) => {
        const artifact = manifest.contracts.find((candidate) => candidate.package === entry.package);

        expect(artifact).toMatchObject({
            sha256: entry.sha256,
            bytes: entry.bytes,
        });
        expect(entry.spec).toEqual(entry.fixture);
        expect(entry.contract.spec.entries.map((specEntry) => specEntry.toXDR('base64')))
            .toEqual(entry.spec);
    });

    it.each(contracts)('$source consumes only its generated $exportName array', (entry) => {
        const source = readFileSync(`${repoRoot}/${entry.source}`, 'utf8');

        expect(source).toContain(`import { ${entry.exportName} } from '../contract_specs.js';`);
        expect(source).toContain(`static spec: contract.Spec = new contract.Spec(${entry.exportName});`);
        expect(source).not.toMatch(/new contract\.Spec\(\[\s*['"]/);
    });
});
