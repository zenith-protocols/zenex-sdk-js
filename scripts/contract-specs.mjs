import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractsRoot = '/home/robin/Zenith/Zenex/zenex-contracts-v2-platform';
const manifestPath = resolve(contractsRoot, 'artifacts/v2/manifest.json');
const oldContractsRoot = '/home/robin/Zenith/Zenex/zenex-contracts';

const EXPECTED_SOURCE = Object.freeze({
    schemaVersion: 1,
    contractsCommit: '4c631eb17af53ec5e6875f42bf71a43af295e521',
    productionSourceTree: '3c9815124a70cd8ee3f6fddad2baf072606588bb',
    cargoLockSha256: '1b07b1d4d9e7d55ecb66d01b3d9c0e367bf342ab5ea9ed11f2b3c495d7c9eab2',
    rustc: 'rustc 1.93.1 (01f6ddf75 2026-02-11)',
    cargo: 'cargo 1.93.1 (083ac5135 2025-12-15)',
    stellarCli: 'stellar 25.2.0 (28484880988199233a7e8e87c97cb12dac323cb3)',
    stellarXdr: 'stellar-xdr 25.0.0 (dc9f40fcb83c3054341f70b65a2222073369b37b)',
    xdrCurrentRevision: '0a621ec7811db000a60efae5b35f78dee3aa2533',
    sorobanSdk: '25.3.0',
});

const contracts = [
    ['trading', 'tradingSpec'],
    ['trading_router', 'tradingRouterSpec'],
    ['factory', 'factorySpec'],
    ['strategy_vault', 'strategyVaultSpec'],
    ['price_verifier', 'priceVerifierSpec'],
    ['treasury', 'treasurySpec'],
    ['governance', 'governanceSpec'],
];

const bindings = Object.freeze({
    trading: {
        manifestPackage: 'trading',
        classPath: 'src/trading/trading_contract.ts',
        fixturePath: 'test/fixtures/specs/trading.json',
    },
    trading_router: {
        manifestPackage: 'trading-router',
        classPath: 'src/trading-router/router_contract.ts',
        fixturePath: 'test/fixtures/specs/trading_router.json',
    },
    factory: {
        manifestPackage: 'factory',
        classPath: 'src/factory/factory_contract.ts',
        fixturePath: 'test/fixtures/specs/factory.json',
    },
    strategy_vault: {
        manifestPackage: 'strategy-vault',
        classPath: 'src/vault/vault_contract.ts',
        fixturePath: 'test/fixtures/specs/strategy_vault.json',
    },
    price_verifier: {
        manifestPackage: 'price-verifier',
        classPath: 'src/price-verifier/price_verifier_contract.ts',
        fixturePath: 'test/fixtures/specs/price_verifier.json',
    },
    treasury: {
        manifestPackage: 'treasury',
        classPath: 'src/treasury/treasury_contract.ts',
        fixturePath: 'test/fixtures/specs/treasury.json',
    },
    governance: {
        manifestPackage: 'governance',
        classPath: 'src/governance/governance_contract.ts',
        fixturePath: 'test/fixtures/specs/governance.json',
    },
});

const EXPECTED_CONTRACTS = Object.freeze({
    factory: {
        path: 'artifacts/v2/wasm/factory.wasm',
        sha256: '3b4fb39c1733aeb2704acd9bfdc10ba185933ac8624f43b0124a56573adac7bd',
        bytes: 7_722,
    },
    governance: {
        path: 'artifacts/v2/wasm/governance.wasm',
        sha256: '751b7cc97b3c348e1eaf263eaef0c694ac1c5b3879256e68afe4ab9be8efac87',
        bytes: 10_130,
    },
    'price-verifier': {
        path: 'artifacts/v2/wasm/price_verifier.wasm',
        sha256: 'a305fb2c74d335602fc4c29e33f12772e747f80d0734293fbea83b709db0a2b3',
        bytes: 15_247,
    },
    'strategy-vault': {
        path: 'artifacts/v2/wasm/strategy_vault.wasm',
        sha256: '26899099b15ef633220eabfd0871d2678170a3faab12a4e45eb1b986964950eb',
        bytes: 20_915,
    },
    trading: {
        path: 'artifacts/v2/wasm/trading.wasm',
        sha256: 'c5e821f5903ada0021e521af259848b9ea9dd89ae08760dbba950b4fea092794',
        bytes: 64_947,
    },
    'trading-router': {
        path: 'artifacts/v2/wasm/trading_router.wasm',
        sha256: '1affc4279fdc11de0ae14d2a8958f34aa88dfed4759f93a5a49b85c5c545caaa',
        bytes: 12_350,
    },
    treasury: {
        path: 'artifacts/v2/wasm/treasury.wasm',
        sha256: '85322d7b3edd30ac9c5f9a7dfb187dfa9eadf0781333ad841fe1bedb75a0eae9',
        bytes: 6_248,
    },
});

const EXPECTED_VECTORS = Object.freeze({
    'test-vectors/strategy-vault-v2.json': {
        sha256: '55e80e219e5ecb8a5177425df6445274b467fd69ca9436fbadbc13d3e9bff172',
        bytes: 12_355,
    },
    'test-vectors/trading-v2.json': {
        sha256: '15b8ff1b98a10733abfae9d9bbc25772fa617f88a30f89dea05095ed859b250e',
        bytes: 56_276,
    },
});

function fail(message) {
    throw new Error(`Contract artifact verification failed: ${message}`);
}

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function git(...args) {
    return execFileSync('git', ['-C', contractsRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function resolveArtifact(relativePath) {
    if (relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
        fail(`unsafe artifact path ${relativePath}`);
    }

    const artifactPath = resolve(contractsRoot, relativePath);
    const relativeToRoot = relative(contractsRoot, artifactPath);
    if (relativeToRoot.startsWith('..') || relativeToRoot === '') {
        fail(`artifact path leaves the approved source root: ${relativePath}`);
    }
    if (artifactPath.startsWith(oldContractsRoot + '/')) {
        fail(`obsolete contracts checkout is forbidden: ${artifactPath}`);
    }
    return artifactPath;
}

function verifyFile(entry, label) {
    const artifactPath = resolveArtifact(entry.path);
    if (!existsSync(artifactPath)) fail(`${label} is missing at ${entry.path}`);

    const bytes = readFileSync(artifactPath);
    if (statSync(artifactPath).size !== entry.bytes) {
        fail(`${label} byte size does not match its manifest`);
    }
    if (sha256(bytes) !== entry.sha256) {
        fail(`${label} SHA-256 does not match its manifest`);
    }
}

function assertExactObject(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(`${label} does not match the reviewed release values`);
    }
}

export function verifyCoreArtifactSource() {
    if (resolve(dirname(manifestPath), '../..') !== resolve(contractsRoot)) {
        fail('manifest resolved outside the approved v2 worktree');
    }

    const manifestBytes = readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));

    if (manifest.schemaVersion !== EXPECTED_SOURCE.schemaVersion) {
        fail('unsupported manifest schema');
    }
    if (manifest.contractsCommit !== EXPECTED_SOURCE.contractsCommit) {
        fail('contracts commit does not match the reviewed source commit');
    }
    if (manifest.productionSourceTree !== EXPECTED_SOURCE.productionSourceTree) {
        fail('production source tree does not match the reviewed source tree');
    }
    assertExactObject(
        manifest.cargoLock,
        { path: 'Cargo.lock', sha256: EXPECTED_SOURCE.cargoLockSha256 },
        'Cargo.lock evidence',
    );
    assertExactObject(
        manifest.toolchain,
        {
            rustc: EXPECTED_SOURCE.rustc,
            cargo: EXPECTED_SOURCE.cargo,
            stellarCli: EXPECTED_SOURCE.stellarCli,
            stellarXdr: EXPECTED_SOURCE.stellarXdr,
            xdrCurrentRevision: EXPECTED_SOURCE.xdrCurrentRevision,
            sorobanSdk: EXPECTED_SOURCE.sorobanSdk,
        },
        'toolchain evidence',
    );

    const sourceTree = git('rev-parse', `${manifest.contractsCommit}^{tree}`);
    if (sourceTree !== manifest.productionSourceTree) {
        fail('Git source tree does not match productionSourceTree');
    }
    try {
        execFileSync(
            'git',
            ['-C', contractsRoot, 'merge-base', '--is-ancestor', manifest.contractsCommit, 'HEAD'],
            { stdio: 'ignore' },
        );
    } catch {
        fail('reviewed contracts commit is not an ancestor of the artifact checkout');
    }

    const trackedManifest = Buffer.from(
        execFileSync('git', ['-C', contractsRoot, 'show', 'HEAD:artifacts/v2/manifest.json']),
    );
    if (!trackedManifest.equals(manifestBytes)) {
        fail('working manifest differs from the immutable artifact commit');
    }

    const cargoLock = { ...manifest.cargoLock, bytes: statSync(resolveArtifact(manifest.cargoLock.path)).size };
    const cargoLockBytes = readFileSync(resolveArtifact(cargoLock.path));
    if (sha256(cargoLockBytes) !== cargoLock.sha256) {
        fail('Cargo.lock SHA-256 does not match the manifest');
    }

    if (!Array.isArray(manifest.contracts) || manifest.contracts.length !== contracts.length) {
        fail('manifest must contain exactly seven core contracts');
    }
    const actualPackages = manifest.contracts.map((entry) => entry.package).sort();
    const expectedPackages = Object.keys(EXPECTED_CONTRACTS).sort();
    if (JSON.stringify(actualPackages) !== JSON.stringify(expectedPackages)) {
        fail('manifest core contract package set is not exact');
    }
    for (const entry of manifest.contracts) {
        assertExactObject(entry, { package: entry.package, ...EXPECTED_CONTRACTS[entry.package] }, `${entry.package} manifest entry`);
        verifyFile(entry, entry.package);
    }

    if (!Array.isArray(manifest.vectors) || manifest.vectors.length !== 2) {
        fail('manifest must contain exactly two core vector files');
    }
    const actualVectorPaths = manifest.vectors.map((entry) => entry.path).sort();
    const expectedVectorPaths = Object.keys(EXPECTED_VECTORS).sort();
    if (JSON.stringify(actualVectorPaths) !== JSON.stringify(expectedVectorPaths)) {
        fail('manifest vector path set is not exact');
    }
    for (const entry of manifest.vectors) {
        assertExactObject(entry, { path: entry.path, ...EXPECTED_VECTORS[entry.path] }, `${entry.path} manifest entry`);
        verifyFile(entry, entry.path);
    }

    const stellarVersion = execFileSync('stellar', ['--version'], { encoding: 'utf8' }).trim().split('\n');
    assertExactObject(
        stellarVersion,
        [EXPECTED_SOURCE.stellarCli, EXPECTED_SOURCE.stellarXdr, `xdr curr (${EXPECTED_SOURCE.xdrCurrentRevision})`],
        'active Stellar CLI',
    );

    return { manifest, manifestBytes };
}

function extractGeneratedSpec(source, filename) {
    const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const candidates = [];

    function visit(node) {
        if (
            ts.isNewExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'ContractSpec'
            && node.arguments?.length === 1
            && ts.isArrayLiteralExpression(node.arguments[0])
        ) {
            candidates.push(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    if (candidates.length !== 1) {
        fail(`${filename} contains ${candidates.length} generated ContractSpec arrays, expected one`);
    }

    return candidates[0].elements.map((element) => {
        if (!ts.isStringLiteral(element) || !/^[A-Za-z0-9+/]+={0,2}$/.test(element.text)) {
            fail(`${filename} contains a non-base64 ContractSpec entry`);
        }
        const bytes = Buffer.from(element.text, 'base64');
        if (bytes.length === 0 || bytes.toString('base64') !== element.text) {
            fail(`${filename} contains a malformed base64 ContractSpec entry`);
        }
        return element.text;
    });
}

function generateSpecs(manifest) {
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'zenex-contract-specs-'));
    const generated = new Map();

    try {
        for (const [packageName] of contracts) {
            const binding = bindings[packageName];
            const artifact = manifest.contracts.find((entry) => entry.package === binding.manifestPackage);
            if (!artifact) fail(`manifest is missing ${binding.manifestPackage}`);

            const outputDir = resolve(tempRoot, packageName);
            execFileSync(
                'stellar',
                [
                    'contract',
                    'bindings',
                    'typescript',
                    '--wasm',
                    resolveArtifact(artifact.path),
                    '--output-dir',
                    outputDir,
                    '--overwrite',
                ],
                { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            const sourcePath = resolve(outputDir, 'src/index.ts');
            generated.set(packageName, extractGeneratedSpec(readFileSync(sourcePath, 'utf8'), sourcePath));
        }
    } finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }

    return generated;
}

function renderGeneratedModule(generated) {
    const lines = [
        '// Generated by scripts/contract-specs.mjs from the approved v2 WASM manifest.',
        '// Do not edit these base64 XDR arrays by hand.',
        '',
    ];

    for (const [packageName, exportName] of contracts) {
        lines.push(`export const ${exportName}: string[] = [`);
        for (const entry of generated.get(packageName)) {
            lines.push(`    '${entry}',`);
        }
        lines.push('];', '');
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function bindClassToGeneratedSpec(source, exportName, filename) {
    const importLine = `import { ${exportName} } from '../generated/contract_specs.js';`;
    let nextSource = source.includes(importLine) ? source : `${importLine}\n${source}`;
    const sourceFile = ts.createSourceFile(filename, nextSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const initializers = [];

    function visit(node) {
        if (
            ts.isPropertyDeclaration(node)
            && node.name
            && ts.isIdentifier(node.name)
            && node.name.text === 'spec'
            && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
            && node.initializer
            && ts.isNewExpression(node.initializer)
        ) {
            initializers.push(node.initializer);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    if (initializers.length !== 1) {
        fail(`${filename} contains ${initializers.length} static spec initializers, expected one`);
    }

    const initializer = initializers[0];
    const expected = `new contract.Spec(${exportName})`;
    if (initializer.getText(sourceFile) !== expected) {
        nextSource = `${nextSource.slice(0, initializer.getStart(sourceFile))}${expected}${nextSource.slice(initializer.getEnd())}`;
    }
    return nextSource;
}

function writeOrCheck(path, expected, mode) {
    if (mode === 'generate') {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, expected);
        return;
    }

    if (!existsSync(path) || !readFileSync(path).equals(Buffer.isBuffer(expected) ? expected : Buffer.from(expected))) {
        fail(`generated output drift at ${relative(sdkRoot, path)}`);
    }
}

function run(mode) {
    if (mode !== 'generate' && mode !== 'check') {
        throw new Error('Usage: node scripts/contract-specs.mjs <generate|check>');
    }

    const { manifest, manifestBytes } = verifyCoreArtifactSource();
    const generated = generateSpecs(manifest);

    writeOrCheck(resolve(sdkRoot, 'src/generated/contract_specs.ts'), renderGeneratedModule(generated), mode);
    writeOrCheck(resolve(sdkRoot, 'test/fixtures/specs/wasm-manifest.json'), manifestBytes, mode);

    for (const [packageName, exportName] of contracts) {
        const binding = bindings[packageName];
        const fixture = `${JSON.stringify(generated.get(packageName), null, 4)}\n`;
        writeOrCheck(resolve(sdkRoot, binding.fixturePath), fixture, mode);

        const classPath = resolve(sdkRoot, binding.classPath);
        const source = readFileSync(classPath, 'utf8');
        writeOrCheck(classPath, bindClassToGeneratedSpec(source, exportName, classPath), mode);
    }

    process.stdout.write(`Core contract specs ${mode === 'generate' ? 'generated' : 'verified'} from ${manifest.contractsCommit}.\n`);
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
