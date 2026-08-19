import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MarketContract } from '../src/contracts/market/contract.js';
import { MarketRouterContract } from '../src/contracts/router/contract.js';
import { FactoryContract } from '../src/contracts/factory/contract.js';
import { VaultContract } from '../src/contracts/vault/contract.js';
import { OracleContract } from '../src/contracts/oracle/contract.js';
import { TreasuryContract } from '../src/contracts/treasury/contract.js';
import { GovernanceContract } from '../src/contracts/governance/contract.js';
import {
    factorySpec,
    governanceSpec,
    oracleSpec,
    strategyVaultSpec,
    marketRouterSpec,
    marketSpec,
    treasurySpec,
} from '../src/contracts/contract_specs.js';

import factoryFixture from './fixtures/specs/factory.json';
import governanceFixture from './fixtures/specs/governance.json';
import oracleFixture from './fixtures/specs/oracle.json';
import strategyVaultFixture from './fixtures/specs/strategy_vault.json';
import marketFixture from './fixtures/specs/market.json';
import marketRouterFixture from './fixtures/specs/market_router.json';
import treasuryFixture from './fixtures/specs/treasury.json';

// These assertions cover the wiring between a generated spec array and the
// contract class that consumes it — that a class reads its own generated
// export and nothing else. They deliberately do NOT pin artifact provenance
// (source commit, toolchain, per-WASM hashes): specs are generated from the
// contracts worktree's current build output, and the deploy path in
// zenex-infra is what verifies artifact hashes before anything reaches chain.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const contracts = [
    {
        package: 'market',
        exportName: 'marketSpec',
        spec: marketSpec,
        fixture: marketFixture,
        contract: MarketContract,
        source: 'src/contracts/market/contract.ts',
    },
    {
        package: 'market-router',
        exportName: 'marketRouterSpec',
        spec: marketRouterSpec,
        fixture: marketRouterFixture,
        contract: MarketRouterContract,
        source: 'src/contracts/router/contract.ts',
    },
    {
        package: 'factory',
        exportName: 'factorySpec',
        spec: factorySpec,
        fixture: factoryFixture,
        contract: FactoryContract,
        source: 'src/contracts/factory/contract.ts',
    },
    {
        package: 'strategy-vault',
        exportName: 'strategyVaultSpec',
        spec: strategyVaultSpec,
        fixture: strategyVaultFixture,
        contract: VaultContract,
        source: 'src/contracts/vault/contract.ts',
    },
    {
        package: 'oracle',
        exportName: 'oracleSpec',
        spec: oracleSpec,
        fixture: oracleFixture,
        contract: OracleContract,
        source: 'src/contracts/oracle/contract.ts',
    },
    {
        package: 'treasury',
        exportName: 'treasurySpec',
        spec: treasurySpec,
        fixture: treasuryFixture,
        contract: TreasuryContract,
        source: 'src/contracts/treasury/contract.ts',
    },
    {
        package: 'governance',
        exportName: 'governanceSpec',
        spec: governanceSpec,
        fixture: governanceFixture,
        contract: GovernanceContract,
        source: 'src/contracts/governance/contract.ts',
    },
] as const;

describe('contract spec consistency', () => {
    it.each(contracts)('$package parses as a spec the class can serve', (entry) => {
        // A hand-edit of contract_specs.ts that the generator would overwrite
        // shows up here rather than at the next `specs:generate`.
        expect(entry.spec).toEqual(entry.fixture);
        expect(entry.spec.length).toBeGreaterThan(0);

        // The class must expose exactly the entries in its generated array —
        // round-tripping through contract.Spec proves every entry is valid XDR.
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
