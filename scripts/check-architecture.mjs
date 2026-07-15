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
    return (
        /\/src\/(?:math|market|position|quote|order|relay|data)\//.test(
            normalized,
        ) || /\/src\/vault\/(?:quote|gates)\.ts$/.test(normalized)
    );
}

function unwrap(expression) {
    let current = expression;
    while (
        ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isSatisfiesExpression(current) ||
        ts.isParenthesizedExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

function nodeName(node) {
    if (node.name && ts.isIdentifier(node.name)) return node.name.text;
    return undefined;
}

function normalizedName(value) {
    return value.replaceAll('_', '').replaceAll('-', '').toLowerCase();
}

function templatePath(node) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (!ts.isTemplateExpression(node)) return undefined;
    return `${node.head.text}${node.templateSpans
        .map((span) => `{}` + span.literal.text)
        .join('')}`;
}

function normalizedRoute(value) {
    const withSlash = value.startsWith('v1/') ? `/${value}` : value;
    return withSlash.replaceAll(/\{[^}]+\}/g, '{}');
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

function generatedRoutes(source) {
    let routes = [];
    function visit(node) {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'API_PUBLIC_PATHS' &&
            node.initializer
        ) {
            const initializer = unwrap(node.initializer);
            if (ts.isArrayLiteralExpression(initializer)) {
                routes = initializer.elements
                    .filter(ts.isStringLiteralLike)
                    .map((element) => normalizedRoute(element.text));
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return new Set(routes);
}

function inspectSource(root, path, source, allowedRoutes) {
    const findings = [];
    const normalizedPath = normalizedFilePath(path);
    const exact =
        isExactModulePath(normalizedPath) &&
        !normalizedPath.endsWith('/data/generated.ts');
    const dataClient = normalizedPath.endsWith('/src/data/client.ts');
    const dataEvents = normalizedPath.endsWith('/src/data/events.ts');

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
            if (forbidden !== undefined) {
                add(
                    node,
                    'forbidden-public-boundary',
                    `${name} exposes forbidden ${forbidden} behavior`,
                );
            }
            if (
                dataClient &&
                (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) &&
                normalized.startsWith('submit') &&
                name !== 'submitRelayRequest'
            ) {
                add(
                    node,
                    'generic-submit',
                    `${name} is not the validated relay submission boundary`,
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

        if (
            (dataClient || dataEvents) &&
            (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))
        ) {
            const route = templatePath(node);
            if (
                route !== undefined &&
                (route.startsWith('/v1/') ||
                    route.startsWith('/udf/') ||
                    route === 'v1/stream') &&
                !allowedRoutes.has(normalizedRoute(route))
            ) {
                add(
                    node,
                    'unknown-api-route',
                    `${route} is absent from API_PUBLIC_PATHS`,
                );
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(source);

    if (dataEvents) {
        const text = source.getFullText();
        const required = [
            [
                "append('scope'",
                'scoped-sse',
                'SSE URL must append repeated scope values',
            ],
            [
                'last-event-id',
                'durable-cursor',
                'SSE reconnect must carry Last-Event-ID',
            ],
            [
                'executeZenexResync',
                'authoritative-resync',
                'resync-required must execute authoritative reads',
            ],
            [
                "event.type === 'price.tick'",
                'financial-event-boundary',
                'Only price.tick may expose live financial payloads',
            ],
        ];
        for (const [needle, rule, message] of required) {
            if (!text.includes(needle)) {
                findings.push({
                    file: normalizedFilePath(relative(root, path)),
                    line: 1,
                    rule,
                    message,
                });
            }
        }
    }
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
    const generated = [...sources.entries()].find(([path]) =>
        normalizedFilePath(path).endsWith('/src/data/generated.ts'),
    )?.[1];
    const allowedRoutes = generated ? generatedRoutes(generated) : new Set();
    return [...sources.entries()].flatMap(([path, source]) =>
        inspectSource(root, path, source, allowedRoutes),
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
