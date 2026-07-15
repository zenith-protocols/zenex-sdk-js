import { describe, expect, it } from 'vitest';
import { canonicalIdentity } from '../../src/position/decrease_identity.js';

describe('position decrease canonical identity', () => {
    it('distinguishes sparse array holes at different indices', () => {
        const leadingHole = new Array<unknown>(2);
        leadingHole[1] = 'entry';
        const trailingHole = new Array<unknown>(2);
        trailingHole[0] = 'entry';

        expect(canonicalIdentity(leadingHole)).not.toBe(
            canonicalIdentity(trailingHole),
        );
    });

    it('distinguishes a sparse hole from explicit undefined', () => {
        const sparse = new Array<unknown>(1);

        expect(canonicalIdentity(sparse)).not.toBe(
            canonicalIdentity([undefined]),
        );
    });
});
