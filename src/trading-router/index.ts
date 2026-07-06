// =============================================================================
// Trading-router module public surface (v2).
// =============================================================================

// Contract binding
export { TradingRouterContract } from './router_contract.js';

// Core types, converters, and parsers
export {
    callToScVal,
    adlTargetToScVal,
    parseCallOutcome,
    parseFillAttempt,
} from './router_types.js';

export type {
    Call,
    CallOutcome,
    FillAttempt,
    AdlTarget,
} from './router_types.js';
