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
    for (const [path, source] of Object.entries(files)) {
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
        expect(isExactModulePath('/repo/src/trading/internal/order.ts')).toBe(
            true,
        );
        expect(
            isExactModulePath('C:\\repo\\src\\trading\\internal\\order.ts'),
        ).toBe(true);
        expect(isExactModulePath('/repo/src/math/fixed.ts')).toBe(true);
        expect(isExactModulePath('/repo/src/contracts/market/types.ts')).toBe(
            false,
        );
        // The public trading classes and estimate modules are deliberately
        // outside the exact surface.
        expect(isExactModulePath('/repo/src/trading/market.ts')).toBe(false);
        expect(isExactModulePath('/repo/src/trading/user.ts')).toBe(false);
        expect(isExactModulePath('/repo/src/trading/market_est.ts')).toBe(false);
        expect(isExactModulePath('/repo/src/trading/position_est.ts')).toBe(
            false,
        );
        expect(isExactModulePath('/repo/src/trading/index.ts')).toBe(false);
    });

    it('rejects lossy number conversion in exact modules', async () => {
        const root = await fixture({
            'src/trading/internal/order.ts':
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
            'src/trading/internal/order.ts':
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

    it('rejects forbidden try boundaries in exact modules', async () => {
        const root = await fixture({
            'src/trading/internal/position.ts':
                'export const submitTransactionXdr = (value: string) => value;',
        });
        expect(await checkArchitecture(root)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'forbidden-public-boundary' }),
            ]),
        );
    });

    it('leaves the estimate modules outside the exact rules', async () => {
        const root = await fixture({
            'src/trading/position_est.ts':
                'export const est = (atomic: bigint) => Number(atomic);',
            'src/trading/internal/math.ts':
                'export const bad = (atomic: bigint) => Number(atomic);',
        });
        const findings = await checkArchitecture(root);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: 'src/trading/internal/math.ts',
            rule: 'exact-number-conversion',
        });
    });

    it('rejects frontend dependencies in exact modules', async () => {
        const root = await fixture({
            'src/trading/internal/math.ts':
                "export const dependency = 'zenex-trade';",
        });
        expect(await checkArchitecture(root)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'frontend-dependency' }),
            ]),
        );
    });
});
