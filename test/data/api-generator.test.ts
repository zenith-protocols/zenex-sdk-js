import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
    findNullableEnums,
    renderType,
} from '../../scripts/api-type-renderer.mjs';

const OPENAPI_PATH = new URL(
    '../../node_modules/@zenith-protocols/zenex-api-contracts/dist/openapi.json',
    import.meta.url,
);
const GENERATED_PATH = new URL('../../src/data/generated.ts', import.meta.url);

describe('API type renderer', () => {
    it('composes nullable enum types instead of dropping null', () => {
        expect(
            renderType({
                type: ['string', 'null'],
                enum: ['long', 'short'],
            }),
        ).toBe('"long" | "short" | null');
    });

    it('renders standalone null schemas exactly inside unions', () => {
        expect(renderType({ type: 'null' })).toBe('null');
        expect(
            renderType({
                oneOf: [{ type: 'string' }, { type: 'null' }],
            }),
        ).toBe('string | null');
    });

    it('finds and safely renders every nullable enum in API 1.1', async () => {
        const openapi = JSON.parse(await readFile(OPENAPI_PATH, 'utf8'));
        const entries = findNullableEnums(openapi);

        expect(entries.map(({ path }) => path)).toEqual([
            '/components/schemas/CompetitionStanding/properties/side',
            '/components/schemas/CompetitionStandingsResponse/properties/data/properties/items/items/properties/side',
            '/components/schemas/RankedStanding/properties/side',
            '/components/schemas/RollingStandingsResponse/properties/data/properties/items/items/properties/side',
        ]);
        for (const { schema } of entries) {
            expect(renderType(schema).split(' | ')).toContain('null');
        }
    });

    it('keeps RankedStanding.side nullable in generated output', async () => {
        const generated = await readFile(GENERATED_PATH, 'utf8');
        const standing = generated.match(
            /export type WireRankedStanding = \{(?<body>[\s\S]*?)\n\};/,
        );

        expect(standing?.groups?.body).toContain(
            "readonly side: 'long' | 'short' | null;",
        );
    });
});
