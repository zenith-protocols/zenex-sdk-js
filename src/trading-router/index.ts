// =============================================================================
// Trading-router module public surface (v2).
// =============================================================================

// Contract binding
export { TradingRouterContract } from './router_contract.js';
export type { CreateAndFillWithFeeArgs, MulticallWithFeeArgs } from './router_contract.js';

// Core types, converters, and parsers
export {
    callToScVal,
    createOrderCall,
    parseCallOutcome,
    parseFillAttempt,
    UNTYPED_FAILURE,
} from './router_types.js';

export type {
    Call,
    CallOutcome,
    FillAttempt,
    OrderParams,
} from './router_types.js';
