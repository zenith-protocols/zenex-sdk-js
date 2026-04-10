import { Address, Contract, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { u32, u64 } from '../index.js';

// =============================================================================
// Types matching the on-chain smart account contract (OpenZeppelin stellar-accounts)
// =============================================================================

/**
 * Signer enum — matches Rust `Signer { Delegated(Address), External(Address, Bytes) }`
 */
export type Signer =
    | { tag: 'Delegated'; address: string }
    | { tag: 'External'; verifier: string; keyData: Buffer | Uint8Array };

/**
 * ContextRuleType enum — matches Rust `ContextRuleType { Default, CallContract(Address), CreateContract(BytesN<32>) }`
 */
export type ContextRuleType =
    | { tag: 'Default' }
    | { tag: 'CallContract'; contract: string }
    | { tag: 'CreateContract'; wasmHash: Buffer | Uint8Array };

/**
 * SessionConfig — matches the session-policy contract's install params
 */
export interface SessionConfig {
    /** Contracts the session key is allowed to call */
    allowedContracts: string[];
    /** The only address tokens can be transferred to */
    allowedTransferTo: string;
}

/**
 * Arguments for adding a context rule
 */
export interface AddContextRuleArgs {
    contextType: ContextRuleType;
    name: string;
    validUntil?: u32;
    signers: Signer[];
    /** Map of policy contract address → install params (ScVal). Empty map for no policies. */
    policies: Map<string, xdr.ScVal>;
}

// =============================================================================
// ScVal encoding helpers
// =============================================================================

/** Encode a Signer to ScVal */
export function signerToScVal(signer: Signer): xdr.ScVal {
    if (signer.tag === 'Delegated') {
        return xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Delegated'),
            Address.fromString(signer.address).toScVal(),
        ]);
    }
    const keyData = signer.keyData instanceof Buffer
        ? signer.keyData
        : Buffer.from(signer.keyData);
    return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('External'),
        Address.fromString(signer.verifier).toScVal(),
        xdr.ScVal.scvBytes(keyData),
    ]);
}

/** Encode a ContextRuleType to ScVal */
export function contextRuleTypeToScVal(crt: ContextRuleType): xdr.ScVal {
    switch (crt.tag) {
        case 'Default':
            return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Default')]);
        case 'CallContract':
            return xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('CallContract'),
                Address.fromString(crt.contract).toScVal(),
            ]);
        case 'CreateContract': {
            const hash = crt.wasmHash instanceof Buffer
                ? crt.wasmHash
                : Buffer.from(crt.wasmHash);
            return xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('CreateContract'),
                xdr.ScVal.scvBytes(hash),
            ]);
        }
    }
}

/** Encode a SessionConfig as ScVal (matches Rust SessionConfig contracttype) */
export function sessionConfigToScVal(config: SessionConfig): xdr.ScVal {
    // Soroban #[contracttype] structs encode as ScVal::Map with sorted symbol keys
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('allowed_contracts'),
            val: xdr.ScVal.scvVec(
                config.allowedContracts.map(addr => Address.fromString(addr).toScVal())
            ),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('allowed_transfer_to'),
            val: Address.fromString(config.allowedTransferTo).toScVal(),
        }),
    ]);
}

/** Encode Option<u32> as ScVal */
function optionU32ToScVal(val?: u32): xdr.ScVal {
    if (val === undefined || val === null) {
        return xdr.ScVal.scvVoid();
    }
    return xdr.ScVal.scvU32(val);
}

/** Encode a policies map (Address → Val) as ScVal */
function policiesToScVal(policies: Map<string, xdr.ScVal>): xdr.ScVal {
    if (policies.size === 0) {
        return xdr.ScVal.scvMap([]);
    }
    const entries = Array.from(policies.entries()).map(([addr, params]) =>
        new xdr.ScMapEntry({
            key: Address.fromString(addr).toScVal(),
            val: params,
        })
    );
    // Soroban maps must be sorted by key
    entries.sort((a, b) =>
        a.key().toXDR('hex').localeCompare(b.key().toXDR('hex'))
    );
    return xdr.ScVal.scvMap(entries);
}

// =============================================================================
// SmartAccountContract
// =============================================================================

/**
 * SmartAccountContract — Operation builder for smart account contracts
 *
 * Builds XDR operations for smart account management (context rules, signers, policies).
 * All methods return base64-encoded XDR operations for transaction building.
 *
 * The smart account contract address is the user's wallet address (C... contract).
 */
export class SmartAccountContract extends Contract {

    // ============================================================
    // Context Rules
    // ============================================================

    /**
     * Add a new context rule to the smart account.
     *
     * @returns base64-encoded XDR operation
     */
    addContextRule(args: AddContextRuleArgs): string {
        return this.call(
            'add_context_rule',
            contextRuleTypeToScVal(args.contextType),
            nativeToScVal(args.name, { type: 'string' }),
            optionU32ToScVal(args.validUntil),
            xdr.ScVal.scvVec(args.signers.map(signerToScVal)),
            policiesToScVal(args.policies),
        ).toXDR('base64');
    }

    /**
     * Remove a context rule by ID.
     *
     * @returns base64-encoded XDR operation
     */
    removeContextRule(ruleId: u32): string {
        return this.call(
            'remove_context_rule',
            xdr.ScVal.scvU32(ruleId),
        ).toXDR('base64');
    }

    // ============================================================
    // Signers
    // ============================================================

    /**
     * Add a signer to a context rule.
     *
     * @returns base64-encoded XDR operation
     */
    addSigner(ruleId: u32, signer: Signer): string {
        return this.call(
            'add_signer',
            xdr.ScVal.scvU32(ruleId),
            signerToScVal(signer),
        ).toXDR('base64');
    }

    /**
     * Remove a signer from a context rule.
     *
     * @returns base64-encoded XDR operation
     */
    removeSigner(ruleId: u32, signerId: u32): string {
        return this.call(
            'remove_signer',
            xdr.ScVal.scvU32(ruleId),
            xdr.ScVal.scvU32(signerId),
        ).toXDR('base64');
    }

    // ============================================================
    // Policies
    // ============================================================

    /**
     * Add a policy to a context rule.
     *
     * @param ruleId - Context rule ID
     * @param policyAddress - Policy contract address
     * @param installParams - Pre-encoded ScVal install params for the policy
     * @returns base64-encoded XDR operation
     */
    addPolicy(ruleId: u32, policyAddress: string, installParams: xdr.ScVal): string {
        return this.call(
            'add_policy',
            xdr.ScVal.scvU32(ruleId),
            Address.fromString(policyAddress).toScVal(),
            installParams,
        ).toXDR('base64');
    }

    /**
     * Remove a policy from a context rule.
     *
     * @returns base64-encoded XDR operation
     */
    removePolicy(ruleId: u32, policyAddress: string): string {
        return this.call(
            'remove_policy',
            xdr.ScVal.scvU32(ruleId),
            Address.fromString(policyAddress).toScVal(),
        ).toXDR('base64');
    }
}
