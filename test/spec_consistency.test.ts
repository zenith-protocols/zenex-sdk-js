import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TradingContract } from '../src/contracts/trading/trading_contract.js';
import { TradingRouterContract } from '../src/contracts/router/router_contract.js';
import { FactoryContract } from '../src/contracts/factory/factory_contract.js';
import { VaultContract } from '../src/contracts/vault/vault_contract.js';
import { OracleContract } from '../src/contracts/oracle/oracle_contract.js';
import { TreasuryContract } from '../src/contracts/treasury/treasury_contract.js';
import { GovernanceContract } from '../src/contracts/governance/governance_contract.js';
import {
    factorySpec,
    governanceSpec,
    oracleSpec,
    strategyVaultSpec,
    tradingRouterSpec,
    tradingSpec,
    treasurySpec,
} from '../src/contracts/contract_specs.js';

import factoryFixture from './fixtures/specs/factory.json';
import governanceFixture from './fixtures/specs/governance.json';
import oracleFixture from './fixtures/specs/oracle.json';
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
        sha256: '65f687139a88b839a10c8ff3cb72ca72eccb2f4eaf4f2c5b0bd33a1fef94d561',
        bytes: 65_619,
    },
    {
        package: 'trading-router',
        exportName: 'tradingRouterSpec',
        spec: tradingRouterSpec,
        fixture: tradingRouterFixture,
        contract: TradingRouterContract,
        source: 'src/contracts/router/router_contract.ts',
        sha256: 'd2af8cc360972dfee584be3e4595395765fdbffba833f2e031e53a430742dcf2',
        bytes: 12_312,
    },
    {
        package: 'factory',
        exportName: 'factorySpec',
        spec: factorySpec,
        fixture: factoryFixture,
        contract: FactoryContract,
        source: 'src/contracts/factory/factory_contract.ts',
        sha256: '020f26d51709fe1c7de1280546f4d88ff729d8243c8b12a20906f480dbb773c9',
        bytes: 7_705,
    },
    {
        package: 'strategy-vault',
        exportName: 'strategyVaultSpec',
        spec: strategyVaultSpec,
        fixture: strategyVaultFixture,
        contract: VaultContract,
        source: 'src/contracts/vault/vault_contract.ts',
        sha256: 'afd6fcf06748a6fc21074a48b145288c77ad9ccfee0200b18770c65c326431f4',
        bytes: 20_679,
    },
    {
        package: 'oracle',
        exportName: 'oracleSpec',
        spec: oracleSpec,
        fixture: oracleFixture,
        contract: OracleContract,
        source: 'src/contracts/oracle/oracle_contract.ts',
        sha256: '795ab53defab9982319e62bb855e434068fac5ed74c84258c34ac85327385bf9',
        bytes: 15_592,
    },
    {
        package: 'treasury',
        exportName: 'treasurySpec',
        spec: treasurySpec,
        fixture: treasuryFixture,
        contract: TreasuryContract,
        source: 'src/contracts/treasury/treasury_contract.ts',
        sha256: 'c760dc41ed845fec15361296dbd158f0c2199e67d38ad5f8026048f16162d4f6',
        bytes: 6_320,
    },
    {
        package: 'governance',
        exportName: 'governanceSpec',
        spec: governanceSpec,
        fixture: governanceFixture,
        contract: GovernanceContract,
        source: 'src/contracts/governance/governance_contract.ts',
        sha256: '51c5491b0c24dd1ba805ab1038cbdac63b756c4b84e9a71e91b81885656fd250',
        bytes: 10_260,
    },
] as const;

describe('approved v2 contract spec consistency', () => {
    it('pins source commit, source tree, Cargo.lock, and toolchain evidence', () => {
        expect(manifest).toMatchObject({
            schemaVersion: 1,
            contractsCommit: 'e31ef5f13c8702ba866dd416ba44bd906db818da',
            productionSourceTree: '214c4656dabcc1230dce9f8ce877365eb634401f',
            cargoLock: {
                path: 'Cargo.lock',
                sha256: 'eb5429fcee41a363d0d288f92bccde575add7a22130de7b359fd979746408ca6',
            },
            toolchain: {
                rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
                cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
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
