import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The SDK hands live `@stellar/stellar-sdk` objects across its public API
// (`xdr.LedgerKey` from src/ledger-keys.ts, `Call.args: xdr.ScVal[]`, the
// `*Call` builders). That is only safe because of how the dependency is
// declared, so the declaration is pinned here rather than left to review.
//
// - peerDependency, never a bundled hard dependency: the consumer supplies one
//   shared instance instead of us shipping a second copy of js-xdr.
// - floor at >=16.0.0: stellar/js-stellar-base#617 ("Sharing XDR Objects from a
//   Dependency") made objects from two copies non-interoperable, and was fixed
//   in v16. The floor is what guarantees the fix is present when a consumer
//   does end up with two copies -- e.g. anyone also using blend-sdk-js, which
//   bundles its own stellar-sdk pinned at 16.0.0.
//
// Verified interop across separate installs (16.2.0 <-> 16.0.0, both
// directions, runtime and tsc). See ~/notes/sdk-public-api-boundary.md.
// Lowering the floor or moving this into `dependencies` silently re-opens the
// hazard, so both are failures here.
const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

const STELLAR_SDK = '@stellar/stellar-sdk';

describe('stellar-sdk dependency declaration', () => {
    it('is a peer dependency, not a bundled one', () => {
        expect(manifest.peerDependencies?.[STELLAR_SDK]).toBeDefined();
        expect(manifest.dependencies?.[STELLAR_SDK]).toBeUndefined();
    });

    it('floors the peer range at the v16 cross-package XDR fix', () => {
        const range = manifest.peerDependencies?.[STELLAR_SDK] ?? '';
        const match = /^>=\s*(\d+)\./.exec(range);

        expect(
            match,
            `peer range must be a ">=<major>." floor so the v16 XDR fix is guaranteed, got "${range}"`,
        ).not.toBeNull();
        expect(Number(match![1])).toBeGreaterThanOrEqual(16);
    });
});
