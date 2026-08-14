import { StrKey, scValToNative } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
    addContextRuleCall,
    buildSingleMarketSessionRule,
} from '../../../src/contracts/smart-account/session_rule.js';

const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 20));
const TRADING = StrKey.encodeContract(Buffer.alloc(32, 21));
const COLLATERAL = StrKey.encodeContract(Buffer.alloc(32, 22));
const SESSION_POLICY = StrKey.encodeContract(Buffer.alloc(32, 23));
const SMART_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 24));
const ED25519_VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 30));

const INPUT = {
    sessionPolicy: SESSION_POLICY,
    smartAccount: SMART_ACCOUNT,
    capability: 'single-transfer-destination-v1' as const,
    markets: [
        {
            trading: TRADING,
            router: ROUTER,
            collateral: COLLATERAL,
        },
    ],
    signer: {
        tag: 'External' as const,
        verifier: ED25519_VERIFIER,
        keyData: new Uint8Array(32).fill(9),
    },
    name: 'zenex-session',
    currentLedger: 49_000,
    maximumDurationLedgers: 2_000n,
    validUntil: 50_000,
};

describe('buildSingleMarketSessionRule', () => {
    it('builds one Default rule with one single-destination policy', () => {
        const result = buildSingleMarketSessionRule(INPUT);
        expect(result.kind).toBe('ready');
        if (result.kind !== 'ready') return;
        expect(result.value.contextType).toEqual({ tag: 'Default' });
        expect(result.value.name).toBe('zenex-session');
        expect(result.value.validUntil).toBe(50_000);
        expect(result.value.signers).toEqual([INPUT.signer]);
        expect([...result.value.policies.keys()]).toEqual([SESSION_POLICY]);
        expect(
            scValToNative(result.value.policies.get(SESSION_POLICY)!),
        ).toEqual({
            allowed_contracts: [TRADING, ROUTER, COLLATERAL],
            allowed_transfer_to: TRADING,
        });
    });

    it('encodes the built rule as one add_context_rule call', () => {
        const result = buildSingleMarketSessionRule(INPUT);
        expect(result.kind).toBe('ready');
        if (result.kind !== 'ready') return;
        const call = addContextRuleCall(SMART_ACCOUNT, result.value);
        expect(call.contract).toBe(SMART_ACCOUNT);
        expect(call.func).toBe('add_context_rule');
        expect(call.args).toHaveLength(5);
    });
});
