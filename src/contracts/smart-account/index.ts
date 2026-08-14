export {
    SmartAccountContract,
    signerToScVal,
    contextRuleTypeToScVal,
    sessionConfigToScVal,
} from './smart_account_contract.js';

export type {
    Signer,
    ContextRuleType,
    SessionConfig,
    AddContextRuleArgs,
} from './smart_account_contract.js';

export {
    addContextRuleCall,
    buildSingleMarketSessionRule,
} from './session_rule.js';
export type {
    PolicyBuildResult,
    SingleMarketSessionInput,
} from './session_rule.js';

export {
    ED25519_VERIFIER_SPEC_SHA256,
    ED25519_VERIFIER_WASM_SHA256,
    SESSION_POLICY_SPEC_SHA256,
    SESSION_POLICY_WASM_SHA256,
    SMART_ACCOUNT_DEPLOYER,
    SMART_ACCOUNT_DEPLOYMENT_MAX_TIMEOUT_SECONDS,
    SMART_ACCOUNT_SPEC_SHA256,
    SMART_ACCOUNT_WASM_SHA256,
    WEBAUTHN_VERIFIER_SPEC_SHA256,
    WEBAUTHN_VERIFIER_WASM_SHA256,
} from './artifacts.js';
