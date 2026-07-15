import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCoreArtifactSource } from './contract-specs.mjs';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const approvedContractsRoot = '/home/robin/Zenith/Zenex/zenex-contracts-v2-platform';
const obsoleteContractsRoot = '/home/robin/Zenith/Zenex/zenex-contracts';
const fixtureRoot = resolve(sdkRoot, 'test/fixtures/golden');

const vectors = Object.freeze([
    {
        artifact: 'trading',
        sourcePath: 'test-vectors/trading-v2.json',
        fixtureName: 'trading-v2.json',
        schema: 'zenex.trading-v2.golden-vectors',
        groups: ['fixed', 'capacity', 'borrowing', 'funding', 'position', 'margin', 'vault'],
        sha256: '15b8ff1b98a10733abfae9d9bbc25772fa617f88a30f89dea05095ed859b250e',
        bytes: 56_276,
    },
    {
        artifact: 'strategyVault',
        sourcePath: 'test-vectors/strategy-vault-v2.json',
        fixtureName: 'strategy-vault-v2.json',
        schema: 'zenex.strategy-vault-v2.golden-vectors',
        groups: ['shares'],
        sha256: '55e80e219e5ecb8a5177425df6445274b467fd69ca9436fbadbc13d3e9bff172',
        bytes: 12_355,
    },
]);

function hash(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

export function assertApprovedContractsRoot(candidate) {
    const resolved = resolve(candidate);
    if (resolved === resolve(obsoleteContractsRoot)) {
        throw new Error(`The obsolete contracts checkout is forbidden: ${resolved}`);
    }
    if (resolved !== resolve(approvedContractsRoot)) {
        throw new Error(`Vector source must be the approved v2 contracts worktree: ${resolved}`);
    }
    return resolved;
}

export function verifyVectorFile(path, entry) {
    if (!existsSync(path)) throw new Error(`Vector file is missing: ${path}`);
    const bytes = readFileSync(path);
    if (statSync(path).size !== entry.bytes) {
        throw new Error(`Vector byte size mismatch: ${path}`);
    }
    if (hash(bytes) !== entry.sha256) {
        throw new Error(`Vector SHA-256 mismatch: ${path}`);
    }
    return bytes;
}

function assertVectorShape(bytes, vector, contractsCommit) {
    const document = JSON.parse(bytes.toString('utf8'));
    if (document.schema !== vector.schema || document.schema_version !== '1') {
        throw new Error(`${vector.fixtureName} has an unexpected schema`);
    }
    if (document.provenance?.source_commit !== contractsCommit) {
        throw new Error(`${vector.fixtureName} provenance does not match the reviewed contracts commit`);
    }

    const groups = Object.keys(document).filter((key) => Array.isArray(document[key]));
    if (JSON.stringify(groups) !== JSON.stringify(vector.groups)) {
        throw new Error(`${vector.fixtureName} group set or order changed`);
    }
    for (const group of vector.groups) {
        if (document[group].length === 0) {
            throw new Error(`${vector.fixtureName} group ${group} is empty`);
        }
        const ids = document[group].map((entry) => entry.id);
        if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
            throw new Error(`${vector.fixtureName} group ${group} has invalid or duplicate case ids`);
        }
    }
}

function writeOrCheck(path, expected, mode) {
    if (mode === 'sync') {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, expected);
        return;
    }
    if (!existsSync(path) || !readFileSync(path).equals(expected)) {
        throw new Error(`Golden vector drift at ${relative(sdkRoot, path)}`);
    }
}

function rejectUnexpectedFixtures() {
    if (!existsSync(fixtureRoot)) return;
    const expected = new Set(['manifest.json', ...vectors.map((vector) => vector.fixtureName)]);
    const unexpected = readdirSync(fixtureRoot).filter((entry) => !expected.has(entry));
    if (unexpected.length > 0) {
        throw new Error(`Unexpected golden vector fixtures: ${unexpected.sort().join(', ')}`);
    }
}

function run(mode) {
    if (mode !== 'sync' && mode !== 'check') {
        throw new Error('Usage: node scripts/sync-contract-vectors.mjs <sync|check>');
    }

    const sourceRoot = assertApprovedContractsRoot(approvedContractsRoot);
    const { manifest, manifestBytes } = verifyCoreArtifactSource();
    rejectUnexpectedFixtures();

    for (const vector of vectors) {
        const manifestEntry = manifest.vectors.find((entry) => entry.path === vector.sourcePath);
        if (!manifestEntry) throw new Error(`Manifest is missing ${vector.sourcePath}`);
        if (
            manifestEntry.sha256 !== vector.sha256
            || manifestEntry.bytes !== vector.bytes
            || Object.keys(manifestEntry).join(',') !== 'path,sha256,bytes'
        ) {
            throw new Error(`${vector.sourcePath} does not match the reviewed manifest entry`);
        }

        const sourcePath = resolve(sourceRoot, vector.sourcePath);
        const bytes = verifyVectorFile(sourcePath, vector);
        assertVectorShape(bytes, vector, manifest.contractsCommit);
        writeOrCheck(resolve(fixtureRoot, vector.fixtureName), bytes, mode);
    }

    writeOrCheck(resolve(fixtureRoot, 'manifest.json'), manifestBytes, mode);
    rejectUnexpectedFixtures();
    process.stdout.write(`Core contract vectors ${mode === 'sync' ? 'synchronized' : 'verified'} from ${manifest.contractsCommit}.\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    try {
        run(process.argv[2]);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
