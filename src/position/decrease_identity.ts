import type { TradingSnapshot } from '../trading/trading_snapshot.js';

function lengthPrefixed(value: string): string {
    return `${value.length}:${value}`;
}

function canonicalValueInner(value: unknown, stack: WeakSet<object>): string {
    if (value === undefined) return 'undefined;';
    if (value === null) return 'null;';
    if (typeof value === 'boolean') return value ? 'boolean:1;' : 'boolean:0;';
    if (typeof value === 'bigint') return `bigint:${value.toString()};`;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('canonical identity numbers must be finite');
        }
        return `number:${Object.is(value, -0) ? '-0' : value.toString()};`;
    }
    if (typeof value === 'string') {
        return `string:${lengthPrefixed(value)};`;
    }
    if (typeof value !== 'object') {
        throw new TypeError('canonical identity contains an unsupported value');
    }
    if (stack.has(value)) {
        throw new TypeError('canonical identity must not contain a cycle');
    }
    stack.add(value);
    try {
        if (value instanceof Uint8Array) {
            return `bytes:${Array.from(value, (byte) =>
                byte.toString(16).padStart(2, '0'),
            ).join('')};`;
        }
        if (Array.isArray(value)) {
            let entries = '';
            for (let index = 0; index < value.length; index += 1) {
                entries += Object.prototype.hasOwnProperty.call(value, index)
                    ? canonicalValueInner(value[index], stack)
                    : 'hole;';
            }
            return `array:${value.length}:[${entries}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                'canonical identity objects must use a plain prototype',
            );
        }
        if (Object.getOwnPropertySymbols(value).length !== 0) {
            throw new TypeError(
                'canonical identity objects must not contain symbol keys',
            );
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const entries = keys.map(
            (key) =>
                `${lengthPrefixed(key)}=${canonicalValueInner(record[key], stack)}`,
        );
        return `object:${keys.length}:{${entries.join('')}}`;
    } finally {
        stack.delete(value);
    }
}

/** @internal Deterministic, typed structural encoding used for fail-closed identity. */
export function canonicalIdentity(value: unknown): string {
    return canonicalValueInner(value, new WeakSet<object>());
}

/** @internal Bind an intent quote to every field of its coherent snapshot. */
export function positionDecreaseSnapshotBinding(
    snapshot: TradingSnapshot,
): string {
    return canonicalIdentity(snapshot);
}
