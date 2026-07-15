export function isAtomicSchema(schema) {
    return (
        typeof schema?.description === 'string' &&
        schema.description.startsWith('Canonical ') &&
        schema.description.endsWith('base-10 integer string')
    );
}

function propertyName(name) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
        ? name
        : JSON.stringify(name);
}

function literal(value) {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function isNullable(schema) {
    return (
        schema?.nullable === true ||
        (Array.isArray(schema?.type) && schema.type.includes('null')) ||
        (Array.isArray(schema?.enum) && schema.enum.includes(null))
    );
}

function withNullable(schema, rendered) {
    if (!isNullable(schema)) return rendered;
    const alternatives = rendered.split(' | ').map((value) => value.trim());
    return alternatives.includes('null') ? rendered : `${rendered} | null`;
}

export function renderType(schema, level = 0) {
    if (!schema || typeof schema !== 'object') return 'unknown';
    if (isAtomicSchema(schema)) {
        return withNullable(schema, 'CanonicalAtomicString');
    }
    if (
        schema.type === 'null' ||
        (Array.isArray(schema.type) &&
            schema.type.length === 1 &&
            schema.type[0] === 'null')
    ) {
        return 'null';
    }
    if (Array.isArray(schema.oneOf)) {
        return withNullable(
            schema,
            schema.oneOf.map((part) => renderType(part, level)).join(' | '),
        );
    }
    if (Array.isArray(schema.anyOf)) {
        return withNullable(
            schema,
            schema.anyOf.map((part) => renderType(part, level)).join(' | '),
        );
    }
    if (schema.const !== undefined) {
        return withNullable(schema, literal(schema.const));
    }
    if (Array.isArray(schema.enum)) {
        return withNullable(schema, schema.enum.map(literal).join(' | '));
    }
    if (Array.isArray(schema.prefixItems)) {
        return withNullable(
            schema,
            `readonly [${schema.prefixItems
                .map((part) => renderType(part, level))
                .join(', ')}]`,
        );
    }

    const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
    const type = declared.find((candidate) => candidate !== 'null');
    let rendered;
    if (type === 'object' || schema.properties) {
        const required = new Set(schema.required ?? []);
        const properties = Object.entries(schema.properties ?? {}).sort(
            ([left], [right]) => left.localeCompare(right),
        );
        if (properties.length === 0) {
            rendered = 'Record<string, unknown>';
        } else {
            const indent = ' '.repeat((level + 1) * 4);
            const closing = ' '.repeat(level * 4);
            rendered = `\n${indent.slice(4)}{\n${properties
                .map(
                    ([name, child]) =>
                        `${indent}readonly ${propertyName(name)}${required.has(name) ? '' : '?'}: ${renderType(child, level + 1)};`,
                )
                .join('\n')}\n${closing}}`;
        }
    } else if (type === 'array' || schema.items) {
        rendered = `readonly (${renderType(schema.items, level)})[]`;
    } else if (type === 'integer' || type === 'number') {
        rendered = 'number';
    } else if (type === 'boolean') {
        rendered = 'boolean';
    } else if (type === 'string') {
        rendered = 'string';
    } else {
        rendered = 'unknown';
    }
    return withNullable(schema, rendered);
}

function pointerSegment(value) {
    return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function findNullableEnums(value) {
    const matches = [];

    function visit(current, path) {
        if (!current || typeof current !== 'object') return;
        if (
            !Array.isArray(current) &&
            Array.isArray(current.enum) &&
            isNullable(current)
        ) {
            matches.push({ path: path || '/', schema: current });
        }
        for (const [key, child] of Object.entries(current)) {
            visit(child, `${path}/${pointerSegment(key)}`);
        }
    }

    visit(value, '');
    return matches.sort((left, right) => left.path.localeCompare(right.path));
}
