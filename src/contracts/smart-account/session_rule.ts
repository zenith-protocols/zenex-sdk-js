import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { Call } from '../router/router_types.js';
import {
    contextRuleTypeToScVal,
    sessionConfigToScVal,
    signerToScVal,
    type AddContextRuleArgs,
} from './smart_account_contract.js';


export type PolicyBuildResult<T> =
    | { kind: 'ready'; value: T }
    | { kind: 'unavailable'; code: 'INVALID_INPUT'; reason: string };

export interface SingleMarketSessionInput {
    sessionPolicy: string;
    smartAccount: string;
    capability: 'single-transfer-destination-v1';
    markets: readonly {
        trading: string;
        router: string;
        collateral: string;
    }[];
    signer: {
        tag: 'External';
        verifier: string;
        keyData: Uint8Array;
    };
    name: string;
    /** Ledger of the snapshot used to construct this rule. */
    currentLedger: number;
    /** Configured maximum session lifetime from the snapshot. */
    maximumDurationLedgers: bigint;
    validUntil: number;
}

/**
 * Build the single-market session capability rule.
 *
 * This is pure call construction: the session policy contract enforces the
 * installed bounds on-chain, so no deployment-evidence registry is consulted.
 */
export function buildSingleMarketSessionRule(
    input: SingleMarketSessionInput,
): PolicyBuildResult<AddContextRuleArgs> {
    const market = input.markets[0];
    const marketContracts = [market.trading, market.router, market.collateral];

    const rule: AddContextRuleArgs = {
        contextType: { tag: 'Default' },
        name: input.name,
        validUntil: input.validUntil,
        signers: [
            {
                tag: 'External',
                verifier: input.signer.verifier,
                keyData: Uint8Array.from(input.signer.keyData),
            },
        ],
        policies: new Map([
            [
                input.sessionPolicy,
                sessionConfigToScVal({
                    allowedContracts: [...marketContracts],
                    allowedTransferTo: market.trading,
                }),
            ],
        ]),
    };
    return { kind: 'ready', value: rule };
}

function policiesToScVal(policies: Map<string, xdr.ScVal>): xdr.ScVal {
    const entries = [...policies].map(
        ([contractId, parameters]) =>
            new xdr.ScMapEntry({
                key: Address.fromString(contractId).toScVal(),
                val: parameters,
            }),
    );
    entries.sort((left, right) =>
        left.key().toXDR('hex').localeCompare(right.key().toXDR('hex')),
    );
    return xdr.ScVal.scvMap(entries);
}

/** Encode one `add_context_rule` smart-account call from a built rule. */
export function addContextRuleCall(
    smartAccount: string,
    rule: AddContextRuleArgs,
): Call {
    if (rule.validUntil === undefined) {
        throw new TypeError('session rule requires an expiry');
    }
    return {
        contract: smartAccount,
        func: 'add_context_rule',
        args: [
            contextRuleTypeToScVal(rule.contextType),
            nativeToScVal(rule.name, { type: 'string' }),
            xdr.ScVal.scvU32(rule.validUntil),
            xdr.ScVal.scvVec(rule.signers.map(signerToScVal)),
            policiesToScVal(rule.policies),
        ],
    };
}
