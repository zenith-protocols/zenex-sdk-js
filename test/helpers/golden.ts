import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type GoldenArtifact = 'trading' | 'strategyVault';

export interface GoldenCase {
    id: string;
    artifact: GoldenArtifact;
    group: string;
    operation: string;
    inputs: unknown;
    work: unknown;
    expected: unknown;
}

interface VectorDefinition {
    filename: string;
    manifestPath: string;
    schema: string;
    groups: readonly string[];
    sha256: string;
    bytes: number;
}

interface VectorDocument {
    schema: string;
    schema_version: string;
    provenance: Record<string, string>;
    [key: string]: unknown;
}

interface ManifestVector {
    path: string;
    sha256: string;
    bytes: number;
}

interface GoldenManifest {
    contractsCommit: string;
    vectors: ManifestVector[];
}

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/golden');
const contractsCommit = '4c631eb17af53ec5e6875f42bf71a43af295e521';

const vectors: Record<GoldenArtifact, VectorDefinition> = {
    trading: {
        filename: 'trading-v2.json',
        manifestPath: 'test-vectors/trading-v2.json',
        schema: 'zenex.trading-v2.golden-vectors',
        groups: ['fixed', 'capacity', 'borrowing', 'funding', 'position', 'margin', 'vault'],
        sha256: '15b8ff1b98a10733abfae9d9bbc25772fa617f88a30f89dea05095ed859b250e',
        bytes: 56_276,
    },
    strategyVault: {
        filename: 'strategy-vault-v2.json',
        manifestPath: 'test-vectors/strategy-vault-v2.json',
        schema: 'zenex.strategy-vault-v2.golden-vectors',
        groups: ['shares'],
        sha256: '55e80e219e5ecb8a5177425df6445274b467fd69ca9436fbadbc13d3e9bff172',
        bytes: 12_355,
    },
};

function parseJson<T>(bytes: Buffer, label: string): T {
    try {
        return JSON.parse(bytes.toString('utf8')) as T;
    } catch {
        throw new Error(`${label} is not valid JSON`);
    }
}

function hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function readManifest(): GoldenManifest {
    const manifest = parseJson<GoldenManifest>(
        readFileSync(resolve(fixtureRoot, 'manifest.json')),
        'golden manifest',
    );
    if (manifest.contractsCommit !== contractsCommit || !Array.isArray(manifest.vectors)) {
        throw new Error('golden manifest provenance is invalid');
    }
    return manifest;
}

function readDocument(artifact: GoldenArtifact): VectorDocument {
    const definition = vectors[artifact];
    const bytes = readFileSync(resolve(fixtureRoot, definition.filename));
    if (bytes.length !== definition.bytes || hash(bytes) !== definition.sha256) {
        throw new Error(`${definition.filename} does not match its reviewed bytes`);
    }

    const document = parseJson<VectorDocument>(bytes, definition.filename);
    if (
        document.schema !== definition.schema
        || document.schema_version !== '1'
        || document.provenance?.source_commit !== contractsCommit
    ) {
        throw new Error(`${definition.filename} provenance is invalid`);
    }

    const groups = Object.keys(document).filter((key) => Array.isArray(document[key]));
    if (JSON.stringify(groups) !== JSON.stringify(definition.groups)) {
        throw new Error(`${definition.filename} group set or order is invalid`);
    }
    return document;
}

export function decodeGoldenInteger(value: string): bigint {
    if (!/^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)) {
        throw new TypeError(`Expected a canonical decimal integer, received ${JSON.stringify(value)}`);
    }
    return BigInt(value);
}

function decodeGoldenValue(value: unknown): unknown {
    if (typeof value === 'string') {
        return /^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)
            ? decodeGoldenInteger(value)
            : value;
    }
    if (typeof value === 'number') {
        throw new TypeError('Golden vector numbers must be encoded as decimal strings');
    }
    if (Array.isArray(value)) return value.map(decodeGoldenValue);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [key, decodeGoldenValue(nested)]),
        );
    }
    return value;
}

export function loadGoldenCases(artifact: GoldenArtifact, group: string): GoldenCase[] {
    const definition = vectors[artifact];
    if (!definition.groups.includes(group)) {
        throw new RangeError(`Unknown ${artifact} golden vector group: ${group}`);
    }

    const rawCases = readDocument(artifact)[group];
    if (!Array.isArray(rawCases)) throw new Error(`${artifact}/${group} is not a case array`);

    const seen = new Set<string>();
    return rawCases.map((rawCase) => {
        if (rawCase === null || typeof rawCase !== 'object' || Array.isArray(rawCase)) {
            throw new Error(`${artifact}/${group} contains a non-object case`);
        }
        const record = rawCase as Record<string, unknown>;
        if (typeof record.id !== 'string' || typeof record.operation !== 'string') {
            throw new Error(`${artifact}/${group} contains a case without an id or operation`);
        }
        if (seen.has(record.id)) throw new Error(`${artifact}/${group} contains duplicate id ${record.id}`);
        seen.add(record.id);

        return {
            id: record.id,
            artifact,
            group,
            operation: record.operation,
            inputs: decodeGoldenValue(record.inputs),
            work: decodeGoldenValue(record.work),
            expected: decodeGoldenValue(record.expected),
        };
    });
}

export async function verifyGoldenFixture(): Promise<{
    contractsCommit: string;
    artifacts: Record<GoldenArtifact, { groups: string[] }>;
}> {
    const manifest = readManifest();

    for (const artifact of Object.keys(vectors) as GoldenArtifact[]) {
        const definition = vectors[artifact];
        const entry = manifest.vectors.find((candidate) => candidate.path === definition.manifestPath);
        if (
            !entry
            || entry.sha256 !== definition.sha256
            || entry.bytes !== definition.bytes
            || Object.keys(entry).join(',') !== 'path,sha256,bytes'
        ) {
            throw new Error(`${artifact} manifest entry does not match the reviewed release`);
        }
        readDocument(artifact);
    }

    return {
        contractsCommit,
        artifacts: {
            trading: { groups: [...vectors.trading.groups] },
            strategyVault: { groups: [...vectors.strategyVault.groups] },
        },
    };
}
