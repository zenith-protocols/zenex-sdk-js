import { describe, expect, it } from 'vitest';
import * as SDK from '../src/index.js';
import * as Order from '../src/trading/order/index.js';

const FORBIDDEN = [
    'buildFeeForwarderOperation',
    'FeeForwarderContract',
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
        const surfaces = [SDK, Order] as readonly Record<
            string,
            unknown
        >[];
        for (const surface of surfaces) {
            for (const name of FORBIDDEN) expect(surface[name]).toBeUndefined();
        }
    });
});
