import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN_NAMES = [
    'tryfill',
    'trythenrest',
    'multicalltry',
    'forwardunsafe',
    'restoreoperation',
    'restoretransaction',
    'crossmarketbatch',
    'submittransactionxdr',
    'genericrelaysubmit',
];
const FORBIDDEN_FUNCTIONS = new Set(['Number', 'parseFloat', 'toFloat']);
const FORBIDDEN_CONTRACT_FUNCTIONS = new Set([
    'try_fill',
    'create_and_try_fill',
    'create_and_try_fill_with_fee',
    'multicall_try',
    'forward_unsafe',
]);

async function sourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
        () => [],
    );
    const nested = await Promise.all(
        entries.map((entry) => {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) return sourceFiles(path);
            return entry.isFile() && path.endsWith('.ts') ? [path] : [];
        }),
    );
    return nested.flat();
}

function normalizedFilePath(path) {
    return path.replaceAll('\\', '/');
}

export function isExactModulePath(path) {
    const normalized = normalizedFilePath(path);
    return /\/src\/(?:math|trading)\//.test(normalized);
}

function nodeName(node) {
    if (node.name && ts.isIdentifier(node.name)) return node.name.text;
    return undefined;
}

function normalizedName(value) {
    return value.replaceAll('_', '').replaceAll('-', '').toLowerCase();
}

function lineOf(source, node) {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function diagnostic(root, path, source, node, rule, message) {
    return {
        file: normalizedFilePath(relative(root, path)),
        line: lineOf(source, node),
        rule,
        message,
    };
}

function inspectSource(root, path, source) {
    const findings = [];
    const normalizedPath = normalizedFilePath(path);
    const exact = isExactModulePath(normalizedPath);

    function add(node, rule, message) {
        findings.push(diagnostic(root, path, source, node, rule, message));
    }

    function visit(node) {
        if (exact && ts.isCallExpression(node)) {
            if (
                ts.isIdentifier(node.expression) &&
                FORBIDDEN_FUNCTIONS.has(node.expression.text)
            ) {
                add(
                    node,
                    'exact-number-conversion',
                    `${node.expression.text} is forbidden in exact modules`,
                );
            }
            if (
                ts.isPropertyAccessExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                node.expression.expression.text === 'Math' &&
                node.expression.name.text === 'round'
            ) {
                add(
                    node,
                    'exact-rounding',
                    'Math.round is forbidden in exact modules',
                );
            }
        }

        const name = nodeName(node);
        if (exact && name !== undefined) {
            const normalized = normalizedName(name);
            const forbidden = FORBIDDEN_NAMES.find((candidate) =>
                normalized.includes(candidate),
            );
            // snapshot.ts drives a read-only multicall_try simulation; it
            // never submits, so the try-boundary rule does not apply there.
            const exempt =
                forbidden === 'multicalltry' &&
                normalizedPath.endsWith('/src/trading/snapshot.ts');
            if (forbidden !== undefined && !exempt) {
                add(
                    node,
                    'forbidden-public-boundary',
                    `${name} exposes forbidden ${forbidden} behavior`,
                );
            }
        }

        if (exact && ts.isStringLiteralLike(node)) {
            if (FORBIDDEN_CONTRACT_FUNCTIONS.has(node.text)) {
                add(
                    node,
                    'forbidden-contract-function',
                    `${node.text} is not an allowed exact contract path`,
                );
            }
            if (
                node.text.includes('zenex-trade') ||
                node.text.includes('/frontend') ||
                node.text.includes('react')
            ) {
                add(
                    node,
                    'frontend-dependency',
                    'Exact SDK modules must not depend on frontend code',
                );
            }
        }

        ts.forEachChild(node, visit);
    }
    visit(source);
    return findings;
}

export async function checkArchitecture(root = DEFAULT_ROOT) {
    const paths = await sourceFiles(resolve(root, 'src'));
    const sources = new Map(
        await Promise.all(
            paths.map(async (path) => [
                path,
                ts.createSourceFile(
                    path,
                    await readFile(path, 'utf8'),
                    ts.ScriptTarget.Latest,
                    true,
                    ts.ScriptKind.TS,
                ),
            ]),
        ),
    );
    return [...sources.entries()].flatMap(([path, source]) =>
        inspectSource(root, path, source),
    );
}

async function main() {
    const findings = await checkArchitecture(DEFAULT_ROOT);
    if (findings.length === 0) {
        process.stdout.write('SDK architecture invariants verified.\n');
        return;
    }
    for (const finding of findings) {
        process.stderr.write(
            `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}\n`,
        );
    }
    process.exitCode = 1;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    await main();
}
