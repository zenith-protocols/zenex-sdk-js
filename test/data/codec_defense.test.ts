import { describe, expect, it } from 'vitest';
import { decodeApiSchema, ZenexDataDecodeError } from '../../src/data/codec.js';
import { API_SCHEMAS, type ApiSchema } from '../../src/data/generated.js';

describe('generated decoder defensive branches', () => {
    it('rejects non-null values for a null-only generated schema', () => {
        const schemas = API_SCHEMAS as unknown as Record<string, ApiSchema>;
        const original = schemas.ErrorEnvelope;
        schemas.ErrorEnvelope = { type: 'null' };
        try {
            expect(decodeApiSchema('ErrorEnvelope', null)).toBeNull();
            expect(() => decodeApiSchema('ErrorEnvelope', {})).toThrow(
                ZenexDataDecodeError,
            );
        } finally {
            schemas.ErrorEnvelope = original;
        }
    });
});
