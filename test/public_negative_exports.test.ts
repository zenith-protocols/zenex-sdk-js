import { describe, expect, it } from 'vitest';
import * as SDK from '../src/index.js';
import * as Market from '../src/trading/index.js';

// FeeForwarderContract is public: it relays only the market router's own
// entry points. A generic forward builder, one that takes an arbitrary
// target, function and arguments, stays banned.
const FORBIDDEN = [
    'buildFeeForwarderOperation',
    'forwardUnsafe',
    'createAndTryFill',
    'createAndTryFillWithFee',
    'tryFill',
    'tryThenRest',
    'multicallTry',
    'buildRestoreOperation',
    'buildRestoreTransaction',
    'restoreTransaction',
    'submit',
    'submitTransaction',
    'submitTransactionXdr',
    'submitRelay',
    'submitRelayXdr',
    'buildCrossMarketBatch',
    'OpenZeppelinAdapter',
    'KeeperAdapter',
    'Database',
    'Redis',
] as const;

describe('negative public SDK boundary', () => {
    it('does not export unsafe, obsolete, infrastructure, or generic submit APIs', () => {
        const surfaces = [SDK, Market] as readonly Record<
            string,
            unknown
        >[];
        for (const surface of surfaces) {
            for (const name of FORBIDDEN) expect(surface[name]).toBeUndefined();
        }
    });

    it('scopes FeeForwarderContract to the router: no generic forward builder', () => {
        const methods = Object.getOwnPropertyNames(SDK.FeeForwarderContract.prototype)
            .filter((name) => name !== 'constructor')
            .sort();
        expect(methods).toEqual([
            'forwardCreateAndFill',
            'forwardCreateAndTryFill',
            'forwardMulticall',
        ]);
        const statics = Object.getOwnPropertyNames(SDK.FeeForwarderContract)
            .filter((name) => !['length', 'name', 'prototype'].includes(name))
            .sort();
        expect(statics).toEqual(['authorizedArgs', 'parsers', 'spec']);
    });
});
