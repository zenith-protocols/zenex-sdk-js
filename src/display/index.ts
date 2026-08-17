// =============================================================================
// Display layer: float views over the SDK's exact math.
//
// Everything exported here returns approximate `number` values intended for
// rendering. None of it may be fed back into a transaction — quote with
// `quotePositionAction` / `quoteTradeFees` and parse input with `parseAtomic`.
//
// It lives outside `src/math/` and `src/trading/` so the architecture linter can
// keep proving those directories are float-free. Every figure is computed by an
// exact mirror first and converted only at the boundary, so a preview cannot
// drift from the fill.
// =============================================================================

export * from './format.js';
export * from './rates.js';
export * from './position.js';
export * from './costs.js';
