// =============================================================================
// Trading-router module public surface (v2).
// =============================================================================

// Contract binding
export { TradingRouterContract } from './router_contract.js';
export type { CreateAndFillWithFeeArgs } from './router_contract.js';

// Core types, converters, and parsers
export {
    callToScVal,
    parseCallOutcome,
    parseFillAttempt,
    UNTYPED_FAILURE,
} from './router_types.js';

export type {
    Call,
    CallOutcome,
    FillAttempt,
} from './router_types.js';
