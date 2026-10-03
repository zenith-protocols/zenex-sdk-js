import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { contract } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { MarketContract } from '../src/contracts/market/contract.js';
import { FactoryContract } from '../src/contracts/factory/contract.js';
import { VaultContract } from '../src/contracts/vault/contract.js';
import { OracleContract } from '../src/contracts/oracle/contract.js';
import { TreasuryContract } from '../src/contracts/treasury/contract.js';
import { GovernanceContract } from '../src/contracts/governance/contract.js';
import { FeeForwarderContract } from '../src/contracts/fee_forwarder/contract.js';

// =============================================================================
// Every event a committed spec declares must map onto its SDK interface by
// the documented rules: wire names in camelCase, the market's `id` topic as
// `orderId`, the factory's `trading` topic as `market`, and the derived
// `source` field on the receipts that carry it. The test writes one object
// literal per spec event, under the mapped field names, typed as its SDK
// interface, and type-checks the result: a missing, extra or misnamed field
// is a compile error.
// =============================================================================

interface Domain {
    spec: contract.Spec;
    /** Interface and event-type enum prefix, such as `Market`. */
    prefix: string;
    /** `ZenexContractType` member. */
    contractType: string;
    /** Spec field name to SDK field name, beyond the camelCase rule. */
    renames?: Record<string, string>;
    /** Struct name to the derived fields its SDK interface adds. */
    derived?: Record<string, string[]>;
    /** Struct name to the SDK interface and event-type member it maps to. */
    overrides?: Record<string, { iface: string; member: string }>;
}

const OWNABLE = new Set(['OwnershipTransfer', 'OwnershipTransferCompleted', 'OwnershipRenounced']);

const domains: Domain[] = [
    {
        spec: MarketContract.spec,
        prefix: 'Market',
        contractType: 'Market',
        renames: { id: 'orderId' },
        derived: { RedeemFill: ['source'], DecreaseFill: ['source'], CloseFill: ['source'] },
    },
    {
        spec: FactoryContract.spec,
        prefix: 'Factory',
        contractType: 'Factory',
        renames: { trading: 'market' },
    },
    {
        spec: VaultContract.spec,
        prefix: 'Vault',
        contractType: 'Vault',
        overrides: { MuxedTransfer: { iface: 'VaultTransferEvent', member: 'Transfer' } },
    },
    { spec: OracleContract.spec, prefix: 'Oracle', contractType: 'Oracle' },
    { spec: TreasuryContract.spec, prefix: 'Treasury', contractType: 'Treasury' },
    { spec: GovernanceContract.spec, prefix: 'Governance', contractType: 'Governance' },
    { spec: FeeForwarderContract.spec, prefix: 'FeeForwarder', contractType: 'FeeForwarder' },
];

const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function eventLiterals(domain: Domain): { iface: string; enumName: string; literal: string }[] {
    return domain.spec.entries
        .filter((entry) => entry.switch().name === 'scSpecEntryEventV0')
        .map((entry) => {
            const event = entry.eventV0();
            const struct = event.name().toString();
            const ownable = OWNABLE.has(struct);
            const override = domain.overrides?.[struct];
            const iface = ownable
                ? `${struct}Event<ZenexContractType.${domain.contractType}>`
                : override?.iface ?? `${domain.prefix}${struct}Event`;
            const enumName = ownable ? 'OwnableEventType' : `${domain.prefix}EventType`;
            const member = override?.member ?? struct;
            const fields = [
                ...event.params().map((param) => {
                    const wire = param.name().toString();
                    return ownable ? camel(wire) : domain.renames?.[wire] ?? camel(wire);
                }),
                ...(ownable ? [] : domain.derived?.[struct] ?? []),
            ];
            const body = fields.map((field) => `${field}: v`).join(', ');
            const literal = `{ ...base, contractType: ZenexContractType.${domain.contractType}, `
                + `eventType: ${enumName}.${member}${body ? `, ${body}` : ''} }`;
            return { iface: iface.replace(/<.*>/, ''), enumName, literal: `${literal} satisfies ${iface}` };
        });
}

function typeCheck(files: Record<string, string>): Record<string, string[]> {
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Node16,
        moduleResolution: ts.ModuleResolutionKind.Node16,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (path) => path in files || fileExists(path);
    host.readFile = (path) => files[path] ?? readFile(path);
    host.getSourceFile = (path, languageVersion) => {
        const contents = host.readFile(path);
        return contents === undefined
            ? undefined
            : ts.createSourceFile(path, contents, languageVersion, true);
    };
    const program = ts.createProgram(Object.keys(files), options, host);
    const byFile: Record<string, string[]> = Object.fromEntries(
        Object.keys(files).map((path) => [path, []]),
    );
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
        const path = diagnostic.file?.fileName ?? '';
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        (byFile[path] ??= []).push(message);
    }
    return byFile;
}

function consumer(literals: { iface: string; enumName: string; literal: string }[]): string {
    const ifaces = [...new Set(literals.map((entry) => entry.iface))].sort();
    const enums = [...new Set(literals.map((entry) => entry.enumName))].sort();
    return [
        `import type { ${ifaces.join(', ')} } from '../src/index.js';`,
        `import { ZenexContractType, ${enums.join(', ')} } from '../src/index.js';`,
        "const base = { id: '', contractId: '', ledger: 0, ledgerClosedAt: '', txHash: '' };",
        'const v = {} as never;',
        ...literals.map((entry, index) => `export const event${index} = ${entry.literal};`),
    ].join('\n');
}

describe('spec event fields map onto the SDK event interfaces', () => {
    it('every spec event type-checks under the documented field rules', () => {
        const literals = domains.flatMap(eventLiterals);
        // 21 market, 5 factory, 6 vault, 5 oracle, 5 treasury, 8 governance, 1 forwarder.
        expect(literals).toHaveLength(51);

        const good = fileURLToPath(new URL('./event-field-consumer.ts', import.meta.url));
        const bad = fileURLToPath(new URL('./event-field-misnamed.ts', import.meta.url));
        const diagnostics = typeCheck({
            [good]: consumer(literals),
            // The raw wire name instead of the documented rename must fail.
            [bad]: consumer(literals).replace('orderId: v', 'id: v'),
        });

        expect(diagnostics[good]).toEqual([]);
        expect(diagnostics[bad].length).toBeGreaterThan(0);
    }, 30_000);
});
