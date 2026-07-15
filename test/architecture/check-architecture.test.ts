import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    checkArchitecture,
    isExactModulePath,
} from '../../scripts/check-architecture.mjs';

const roots: string[] = [];

async function fixture(
    files: Readonly<Record<string, string>>,
): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'zenex-sdk-architecture-'));
    roots.push(root);
    const complete = {
        'src/data/generated.ts':
            "export const API_PUBLIC_PATHS = ['/v1/config', '/v1/stream'] as const;",
        ...files,
    };
    for (const [path, source] of Object.entries(complete)) {
        const destination = join(root, path);
        await mkdir(join(destination, '..'), { recursive: true });
        await writeFile(destination, source);
    }
    return root;
}

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true })),
    );
});

describe('SDK architecture checker mutation fixtures', () => {
    it('recognizes exact modules through portable path separators', () => {
        expect(isExactModulePath('/repo/src/order/bad.ts')).toBe(true);
        expect(isExactModulePath('C:\\repo\\src\\order\\bad.ts')).toBe(true);
        expect(isExactModulePath('C:\\repo\\src\\vault\\quote.ts')).toBe(true);
    });

    it('rejects lossy number conversion in exact modules', async () => {
        const root = await fixture({
            'src/order/bad.ts':
                'export const bad = (atomic: bigint) => Number(atomic);',
        });
        expect(await checkArchitecture(root)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'exact-number-conversion' }),
            ]),
        );
    });

    it('rejects try-fill contract paths', async () => {
        const root = await fixture({
            'src/relay/bad.ts':
                "export const func = 'create_and_try_fill_with_fee';",
        });
        expect(await checkArchitecture(root)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    rule: 'forbidden-contract-function',
                }),
            ]),
        );
    });

    it('rejects API routes absent from the generated contract', async () => {
        const root = await fixture({
            'src/data/client.ts':
                "export const route = '/v1/private/invented-leaderboard';",
        });
        expect(await checkArchitecture(root)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'unknown-api-route' }),
            ]),
        );
    });

    it('rejects generic submission methods', async () => {
        const root = await fixture({
            'src/data/client.ts':
                'export class Client { submitTransactionXdr(value: string) { return value; } }',
        });
        expect(await checkArchitecture(root)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'generic-submit' }),
                expect.objectContaining({ rule: 'forbidden-public-boundary' }),
            ]),
        );
    });

    it('rejects unscoped streams without durable resync handling', async () => {
        const root = await fixture({
            'src/data/events.ts':
                "export const stream = () => new URL('v1/stream', 'https://example.test');",
        });
        const findings = await checkArchitecture(root);
        expect(findings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'scoped-sse' }),
                expect.objectContaining({ rule: 'durable-cursor' }),
                expect.objectContaining({ rule: 'authoritative-resync' }),
                expect.objectContaining({ rule: 'financial-event-boundary' }),
            ]),
        );
    });
});
