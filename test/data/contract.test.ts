import { describe, expect, it } from 'vitest';
import {
    API_CONTRACT_PACKAGE_VERSION,
    API_OPENAPI_SHA256,
    API_PACKAGE_CONTENT_SHA256,
    API_PUBLIC_PATHS,
    API_SCHEMAS,
    API_VERSION,
    ATOMIC_FIELD_POINTERS,
} from '../../src/data/generated.js';

describe('generated immutable API contract', () => {
    it('pins the v1 package and its content hashes', () => {
        expect(API_VERSION).toBe('v1');
        expect(API_CONTRACT_PACKAGE_VERSION).toBe('1.0.0');
        expect(API_OPENAPI_SHA256).toMatch(/^[0-9a-f]{64}$/);
        expect(API_PACKAGE_CONTENT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('contains every public route and only the actual relay boundary', () => {
        expect(API_PUBLIC_PATHS).toContain('/v1/accounts/{account}/lifecycles');
        expect(API_PUBLIC_PATHS).toContain('/v1/prices/{feed}/latest');
        expect(API_PUBLIC_PATHS).toContain('/v1/candles');
        expect(API_PUBLIC_PATHS).toContain('/udf/history');
        expect(API_PUBLIC_PATHS).toContain('/v1/stream');
        expect(API_PUBLIC_PATHS).toContain('/v1/relay/submit');
        expect(API_PUBLIC_PATHS).toContain('/v1/relay/requests/{requestId}');
        expect(
            API_PUBLIC_PATHS.filter((path) => path.includes('/relay/submit')),
        ).toEqual(['/v1/relay/submit']);
        expect(
            API_PUBLIC_PATHS.some((path) => path.includes('fee-forwarder')),
        ).toBe(false);
    });

    it('preserves route-specific metadata and declared atomic pointers', () => {
        expect(
            API_SCHEMAS.AccountOrdersResponse.properties?.meta,
        ).toMatchObject({
            additionalProperties: false,
            properties: {
                completeness: expect.any(Object),
                indexedFromLedger: expect.any(Object),
                throughLedger: expect.any(Object),
            },
        });
        expect(API_SCHEMAS.PublicConfigResponse.properties?.meta).toMatchObject(
            {
                additionalProperties: false,
                properties: {
                    schemaVersion: expect.any(Object),
                    source: expect.any(Object),
                },
            },
        );
        expect(ATOMIC_FIELD_POINTERS.AccountOrdersResponse).toContain(
            '/meta/throughLedger',
        );
        expect(ATOMIC_FIELD_POINTERS.LatestPriceResponse).toEqual(
            expect.arrayContaining([
                '/data/price',
                '/data/publishTime',
                '/meta/sourcePublishTime',
            ]),
        );
        expect(ATOMIC_FIELD_POINTERS.StreamEvent).toEqual(
            expect.arrayContaining([
                '/data/feedId',
                '/data/price',
                '/data/confidence',
                '/data/publishTime',
            ]),
        );
        expect(ATOMIC_FIELD_POINTERS.PublicConfigResponse).toEqual(
            expect.arrayContaining([
                '/data/collateralAssets/*/relayFeeToken/minForwardChargeAtomic',
                '/data/collateralAssets/*/relayFeeToken/maxSignedFeeAtomic',
                '/data/smartAccount/verifiers/webauthn/evidence/ledger',
                '/data/smartAccount/verifiers/ed25519/evidence/ledger',
                '/data/smartAccount/sessionPolicy/deployment/evidence/ledger',
                '/data/smartAccount/sessionPolicy/maxDurationLedgers',
            ]),
        );
        const config = JSON.stringify(API_SCHEMAS.PublicConfigResponse);
        expect(config).toContain('accountArtifact');
        expect(config).toContain('single-transfer-destination-v1');
        expect(config).toContain('instanceExecutableHash');
        expect(config).toContain('maxSignedFeeAtomic');
    });

    it('keeps all durable relay states and non-financial invalidations exact', () => {
        expect(JSON.stringify(API_SCHEMAS.RelayRequestStatus)).toContain(
            'confirmed_success',
        );
        expect(JSON.stringify(API_SCHEMAS.RelayRequestStatus)).toContain(
            'failed_no_submit',
        );
        expect(JSON.stringify(API_SCHEMAS.RelayRequestStatus)).toContain(
            'unknown',
        );

        const stream = JSON.stringify(API_SCHEMAS.StreamEvent);
        expect(stream).toContain('account.lifecycles.changed');
        expect(stream).toContain('config.changed');
        expect(stream).toContain('price.tick');
        expect(stream).toContain('resync-required');
        expect(
            API_SCHEMAS.StreamEvent.oneOf?.filter((branch) =>
                Object.prototype.hasOwnProperty.call(
                    branch.properties?.data.properties ?? {},
                    'price',
                ),
            ),
        ).toHaveLength(1);
    });
});
