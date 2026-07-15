import {
    API_SCHEMAS,
    type ApiSchema,
    type ApiSchemaMap,
    type ApiSchemaName,
    type ErrorEnvelope,
    type PublicConfig,
} from './generated.js';

const I128_MAX = 2n ** 127n - 1n;
const U32_MAX = 4_294_967_295n;

const DATE_TIME =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A response did not satisfy the exact route schema shipped with this SDK. */
export class ZenexDataDecodeError extends Error {
    readonly schema: ApiSchemaName;
    readonly path: string;

    constructor(schema: ApiSchemaName, path: string, reason: string) {
        super(`Invalid ${schema} at ${path}: ${reason}`);
        this.name = 'ZenexDataDecodeError';
        this.schema = schema;
        this.path = path;
    }
}

class SchemaMismatch extends Error {
    constructor(
        readonly path: string,
        reason: string,
    ) {
        super(reason);
    }
}

function mismatch(path: string, reason: string): never {
    throw new SchemaMismatch(path, reason);
}

function isAtomic(schema: ApiSchema): boolean {
    return (
        typeof schema.description === 'string' &&
        schema.description.startsWith('Canonical ') &&
        schema.description.endsWith('base-10 integer string')
    );
}

function memberPath(path: string, member: string | number): string {
    const escaped = String(member).replaceAll('~', '~0').replaceAll('/', '~1');
    return path === '/' ? `/${escaped}` : `${path}/${escaped}`;
}

function exactLiteral(value: unknown, expected: unknown): boolean {
    return Object.is(value, expected);
}

function decodeUnion(
    branches: readonly ApiSchema[],
    value: unknown,
    path: string,
    exact: boolean,
): unknown {
    const matches: unknown[] = [];
    for (const branch of branches) {
        try {
            matches.push(decodeValue(branch, value, path));
        } catch (error) {
            if (!(error instanceof SchemaMismatch)) throw error;
        }
    }
    if (matches.length === 0) mismatch(path, 'does not match any union branch');
    if (exact && matches.length !== 1) {
        mismatch(path, 'matches more than one oneOf branch');
    }
    return matches[0];
}

function validateString(schema: ApiSchema, value: string, path: string): void {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
        mismatch(path, `must contain at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        mismatch(path, `must contain at most ${schema.maxLength} characters`);
    }
    if (
        schema.pattern !== undefined &&
        !new RegExp(schema.pattern).test(value)
    ) {
        mismatch(path, 'does not match the required pattern');
    }
    if (schema.format === 'date-time') {
        if (!DATE_TIME.test(value) || !Number.isFinite(Date.parse(value))) {
            mismatch(path, 'must be an ISO 8601 date-time with an offset');
        }
    }
    if (schema.format === 'uuid' && !UUID.test(value)) {
        mismatch(path, 'must be an RFC 4122 UUID');
    }
}

function decodeArray(schema: ApiSchema, value: unknown, path: string): unknown {
    if (!Array.isArray(value)) mismatch(path, 'must be an array');
    if (schema.minItems !== undefined && value.length < schema.minItems) {
        mismatch(path, `must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        mismatch(path, `must contain at most ${schema.maxItems} items`);
    }
    if (schema.prefixItems !== undefined) {
        if (value.length !== schema.prefixItems.length) {
            mismatch(
                path,
                `must contain exactly ${schema.prefixItems.length} items`,
            );
        }
        return schema.prefixItems.map((item, index) =>
            decodeValue(item, value[index], memberPath(path, index)),
        );
    }
    if (schema.items === undefined) return [...value];
    return value.map((item, index) =>
        decodeValue(schema.items!, item, memberPath(path, index)),
    );
}

function decodeObject(
    schema: ApiSchema,
    value: unknown,
    path: string,
): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        mismatch(path, 'must be an object');
    }
    const input = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) {
            mismatch(memberPath(path, key), 'is required');
        }
    }
    if (schema.additionalProperties === false) {
        for (const key of Object.keys(input)) {
            if (!Object.prototype.hasOwnProperty.call(properties, key)) {
                mismatch(memberPath(path, key), 'is not allowed');
            }
        }
    }
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
            const decoded = decodeValue(
                child,
                input[key],
                memberPath(path, key),
            );
            if (
                key === 'denominator' &&
                typeof decoded === 'bigint' &&
                decoded <= 0n
            ) {
                mismatch(memberPath(path, key), 'must be positive');
            }
            output[key] = decoded;
        }
    }
    if (schema.additionalProperties !== false) {
        for (const [key, child] of Object.entries(input)) {
            if (!Object.prototype.hasOwnProperty.call(properties, key)) {
                output[key] = child;
            }
        }
    }
    return output;
}

function decodeValue(schema: ApiSchema, value: unknown, path: string): unknown {
    if (schema.oneOf !== undefined) {
        return decodeUnion(schema.oneOf, value, path, true);
    }
    if (schema.anyOf !== undefined) {
        return decodeUnion(schema.anyOf, value, path, false);
    }
    if (schema.const !== undefined && !exactLiteral(value, schema.const)) {
        mismatch(path, `must equal ${JSON.stringify(schema.const)}`);
    }
    if (
        schema.enum !== undefined &&
        !schema.enum.some((candidate) => exactLiteral(value, candidate))
    ) {
        mismatch(path, 'is not an allowed value');
    }

    const declared = Array.isArray(schema.type)
        ? schema.type
        : schema.type === undefined
          ? []
          : [schema.type];
    if (value === null) {
        if (declared.includes('null')) return null;
        mismatch(path, 'must not be null');
    }
    if (
        declared.length > 0 &&
        declared.every((candidate) => candidate === 'null')
    ) {
        mismatch(path, 'must be null');
    }
    const type = declared.find((candidate) => candidate !== 'null');

    if (type === 'string') {
        if (typeof value !== 'string') mismatch(path, 'must be a string');
        validateString(schema, value, path);
        if (isAtomic(schema)) {
            try {
                return BigInt(value);
            } catch {
                mismatch(path, 'must be a canonical atomic integer');
            }
        }
        return value;
    }
    if (type === 'integer' || type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            mismatch(path, 'must be a finite number');
        }
        if (type === 'integer' && !Number.isInteger(value)) {
            mismatch(path, 'must be an integer');
        }
        if (schema.minimum !== undefined && value < schema.minimum) {
            mismatch(path, `must be at least ${schema.minimum}`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            mismatch(path, `must be at most ${schema.maximum}`);
        }
        if (
            schema.exclusiveMinimum !== undefined &&
            value <= schema.exclusiveMinimum
        ) {
            mismatch(path, `must be greater than ${schema.exclusiveMinimum}`);
        }
        if (
            schema.exclusiveMaximum !== undefined &&
            value >= schema.exclusiveMaximum
        ) {
            mismatch(path, `must be less than ${schema.exclusiveMaximum}`);
        }
        return value;
    }
    if (type === 'boolean') {
        if (typeof value !== 'boolean') mismatch(path, 'must be a boolean');
        return value;
    }
    if (type === 'array' || schema.items || schema.prefixItems) {
        return decodeArray(schema, value, path);
    }
    if (type === 'object' || schema.properties) {
        return decodeObject(schema, value, path);
    }
    return value;
}

function unique(values: readonly string[], path: string, label: string): void {
    if (new Set(values).size !== values.length) {
        mismatch(path, `${label} values must be unique`);
    }
}

function validateVerifiedDeployment(
    deployment: PublicConfig['smartAccount']['verifiers']['webauthn'],
    path: string,
): void {
    if (
        deployment.evidence.ledger <= 0n ||
        deployment.evidence.ledger > U32_MAX
    ) {
        mismatch(`${path}/evidence/ledger`, 'must be a positive u32 ledger');
    }
    if (
        deployment.evidence.instanceExecutableHash.toLowerCase() !==
        deployment.wasmHash.toLowerCase()
    ) {
        mismatch(
            `${path}/evidence/instanceExecutableHash`,
            'must match the pinned WASM hash',
        );
    }
    if (
        deployment.evidence.uploadedWasmHash.toLowerCase() !==
        deployment.wasmHash.toLowerCase()
    ) {
        mismatch(
            `${path}/evidence/uploadedWasmHash`,
            'must match the pinned WASM hash',
        );
    }
}

function validatePublicConfig(config: PublicConfig, path: string): void {
    unique(
        config.collateralAssets.map((asset) => asset.id),
        `${path}/collateralAssets`,
        'collateral asset ID',
    );
    unique(
        config.collateralAssets.map((asset) => asset.symbol),
        `${path}/collateralAssets`,
        'collateral asset symbol',
    );
    const assets = new Set(config.collateralAssets.map((asset) => asset.id));
    config.collateralAssets.forEach((asset, index) => {
        const fee = asset.relayFeeToken;
        if (fee === undefined) return;
        const feePath = `${path}/collateralAssets/${index}/relayFeeToken`;
        if (fee.collateralAssetId !== asset.id) {
            mismatch(
                `${feePath}/collateralAssetId`,
                'must match the containing collateral asset',
            );
        }
        if (fee.contractId !== asset.contractId) {
            mismatch(
                `${feePath}/contractId`,
                'must match the containing collateral contract',
            );
        }
        if (fee.decimals !== asset.decimals) {
            mismatch(
                `${feePath}/decimals`,
                'must match the containing collateral decimals',
            );
        }
        if (
            fee.minForwardChargeAtomic < 0n ||
            fee.maxSignedFeeAtomic <= 0n ||
            fee.maxSignedFeeAtomic < fee.minForwardChargeAtomic ||
            fee.maxSignedFeeAtomic > I128_MAX
        ) {
            mismatch(`${feePath}/maxSignedFeeAtomic`, 'fee bounds are invalid');
        }
    });

    unique(
        config.markets.map((market) => market.id),
        `${path}/markets`,
        'market ID',
    );
    unique(
        config.markets.map((market) => market.symbol),
        `${path}/markets`,
        'market symbol',
    );
    unique(
        config.markets.map((market) => market.feedId.toString()),
        `${path}/markets`,
        'market feed ID',
    );
    unique(
        config.markets.map((market) => market.udfSymbol),
        `${path}/markets`,
        'market UDF symbol',
    );
    config.markets.forEach((market, index) => {
        if (!assets.has(market.collateralAssetId)) {
            mismatch(
                `${path}/markets/${index}/collateralAssetId`,
                'must reference a declared collateral asset',
            );
        }
    });

    const smart = config.smartAccount;
    validateVerifiedDeployment(
        smart.verifiers.webauthn,
        `${path}/smartAccount/verifiers/webauthn`,
    );
    validateVerifiedDeployment(
        smart.verifiers.ed25519,
        `${path}/smartAccount/verifiers/ed25519`,
    );
    validateVerifiedDeployment(
        smart.sessionPolicy.deployment,
        `${path}/smartAccount/sessionPolicy/deployment`,
    );
    if (
        smart.sessionPolicy.maxDurationLedgers <= 0n ||
        smart.sessionPolicy.maxDurationLedgers > U32_MAX
    ) {
        mismatch(
            `${path}/smartAccount/sessionPolicy/maxDurationLedgers`,
            'must be a positive u32 ledger duration',
        );
    }
    unique(
        smart.sessionPolicy.allowedContracts,
        `${path}/smartAccount/sessionPolicy/allowedContracts`,
        'allowed contract',
    );
    unique(
        smart.sessionPolicy.allowedTransferDestinations,
        `${path}/smartAccount/sessionPolicy/allowedTransferDestinations`,
        'allowed transfer destination',
    );
}

function validateSemantic(schemaName: ApiSchemaName, value: unknown): void {
    if (schemaName === 'PublicConfig') {
        validatePublicConfig(value as PublicConfig, '');
    }
    if (schemaName === 'PublicConfigResponse') {
        validatePublicConfig(
            (value as { readonly data: PublicConfig }).data,
            '/data',
        );
    }
    if (schemaName === 'UdfHistoryResponse') {
        const history = value as {
            readonly s: string;
            readonly t?: readonly unknown[];
            readonly o?: readonly unknown[];
            readonly h?: readonly unknown[];
            readonly l?: readonly unknown[];
            readonly c?: readonly unknown[];
            readonly v?: readonly unknown[];
        };
        if (history.s === 'ok') {
            const length = history.t?.length;
            for (const field of ['o', 'h', 'l', 'c', 'v'] as const) {
                if (
                    history[field] !== undefined &&
                    history[field]?.length !== length
                ) {
                    mismatch(`/${field}`, 'bar arrays must have equal lengths');
                }
            }
        }
    }
}

/** Strictly validate one generated API schema and convert atomic strings to bigint. */
export function decodeApiSchema<Name extends ApiSchemaName>(
    schemaName: Name,
    value: unknown,
): ApiSchemaMap[Name] {
    try {
        const decoded = decodeValue(
            API_SCHEMAS[schemaName],
            value,
            '/',
        ) as ApiSchemaMap[Name];
        validateSemantic(schemaName, decoded);
        return decoded;
    } catch (error) {
        if (error instanceof SchemaMismatch) {
            throw new ZenexDataDecodeError(
                schemaName,
                error.path,
                error.message,
            );
        }
        throw error;
    }
}

export function tryDecodeErrorEnvelope(
    value: unknown,
): ErrorEnvelope | undefined {
    try {
        return decodeApiSchema('ErrorEnvelope', value);
    } catch {
        return undefined;
    }
}
