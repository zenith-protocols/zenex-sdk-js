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

// These assertions cover the wiring between a generated spec array and the
// contract class that consumes it — that a class reads its own generated
// export and nothing else. They deliberately do NOT pin artifact provenance
// (source commit, toolchain, per-WASM hashes): specs are generated from the
// contracts worktree's current build output, and the deploy path in
// zenex-infra is what verifies artifact hashes before anything reaches chain.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const contracts = [
    {
        package: 'trading',
        exportName: 'tradingSpec',
        spec: tradingSpec,
        fixture: tradingFixture,
        contract: TradingContract,
        source: 'src/contracts/trading/trading_contract.ts',
    },
    {
        package: 'trading-router',
        exportName: 'tradingRouterSpec',
        spec: tradingRouterSpec,
        fixture: tradingRouterFixture,
        contract: TradingRouterContract,
        source: 'src/contracts/router/router_contract.ts',
    },
    {
        package: 'factory',
        exportName: 'factorySpec',
        spec: factorySpec,
        fixture: factoryFixture,
        contract: FactoryContract,
        source: 'src/contracts/factory/factory_contract.ts',
    },
    {
        package: 'strategy-vault',
        exportName: 'strategyVaultSpec',
        spec: strategyVaultSpec,
        fixture: strategyVaultFixture,
        contract: VaultContract,
        source: 'src/contracts/vault/vault_contract.ts',
    },
    {
        package: 'oracle',
        exportName: 'oracleSpec',
        spec: oracleSpec,
        fixture: oracleFixture,
        contract: OracleContract,
        source: 'src/contracts/oracle/oracle_contract.ts',
    },
    {
        package: 'treasury',
        exportName: 'treasurySpec',
        spec: treasurySpec,
        fixture: treasuryFixture,
        contract: TreasuryContract,
        source: 'src/contracts/treasury/treasury_contract.ts',
    },
    {
        package: 'governance',
        exportName: 'governanceSpec',
        spec: governanceSpec,
        fixture: governanceFixture,
        contract: GovernanceContract,
        source: 'src/contracts/governance/governance_contract.ts',
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
