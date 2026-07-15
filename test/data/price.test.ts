import { describe, expect, it } from 'vitest';
import {
    decodeLatestPriceUpdate,
    MAX_SIGNED_PRICE_UPDATE_BYTES,
} from '../../src/data/price.js';

describe('decodeLatestPriceUpdate', () => {
    it('decodes canonical padded and unpadded base64 into detached bytes', () => {
        expect(decodeLatestPriceUpdate('AQID')).toEqual(
            new Uint8Array([1, 2, 3]),
        );
        expect(decodeLatestPriceUpdate('AQI=')).toEqual(new Uint8Array([1, 2]));
    });

    it('accepts the exact maximum decoded update size', () => {
        const encoded = Buffer.alloc(MAX_SIGNED_PRICE_UPDATE_BYTES, 7).toString(
            'base64',
        );
        expect(decodeLatestPriceUpdate(encoded)).toHaveLength(
            MAX_SIGNED_PRICE_UPDATE_BYTES,
        );
    });

    it.each([
        ['', 'empty'],
        ['AQI', 'missing padding'],
        ['AQI==', 'excess padding'],
        ['AQI=\n', 'whitespace'],
        ['AQI_', 'base64url alphabet'],
        ['AB==', 'noncanonical trailing bits'],
    ])('rejects %s (%s)', (encoded) => {
        expect(() => decodeLatestPriceUpdate(encoded)).toThrow(/base64/);
    });

    it('rejects updates above the relay discovery ceiling', () => {
        const encoded = Buffer.alloc(
            MAX_SIGNED_PRICE_UPDATE_BYTES + 1,
            7,
        ).toString('base64');
        expect(() => decodeLatestPriceUpdate(encoded)).toThrow(/32 KiB/);
    });
});
