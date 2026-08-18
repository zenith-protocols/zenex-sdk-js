// =============================================================================
// The state bundle a position action is quoted against.
//
// This is the *shape* the exact layer consumes, owned by the exact layer so it
// does not depend on how the state was fetched. `src/state/` composes one from
// a `Market`, a `MarketUser` and a caller-supplied price; a test builds one by
// hand.
//
// The price is an input, never a field the SDK reads from chain: signed Data
// Streams reports are license-restricted and must not reach a browser, so the
// mark comes from the platform's numeric price surface.
// =============================================================================

import type { PriceData } from '../market/types.js';
import type { VaultAtomicState } from '../quote/vault.js';
import type {
    AdlState,
    MarketData,
    Position,
    Status,
    TradingConfig,
} from '../../contracts/trading/trading_types.js';

/** Whose position, and which side, a context describes. */
export interface MarketSubject {
    readonly user: string;
    readonly isLong: boolean;
}

/** A coherent market + position + price view at one ledger. */
export interface MarketContext {
    /** Subject the `position` belongs to, when the context is subject-bound. */
    readonly subject?: MarketSubject;
    /** Ledger sequence the state was read at; order expiry is measured in it. */
    ledger: number;
    /** Ledger close time in whole seconds; the clock every time gate uses. */
    ledgerTime: bigint;
    /** Operational status; only `Active` admits new risk. */
    status: Status;
    /** Market parameters. */
    config: TradingConfig;
    /** The market singleton. */
    market: MarketData;
    /** The subject's stored position on the side under action. */
    position: Position;
    /** Verified mark used to price the action. */
    price: PriceData;
    /**
     * Opaque execution-price payload carried onto a built order and spliced at
     * fill time. In the relay path the relay supplies its own signed update, so
     * this is a caller placeholder and is never verified for pricing here.
     */
    priceUpdate: Uint8Array;
    /** Atomic vault state backing PnL and withdrawal capacity. */
    vault: VaultAtomicState;
    /** Protocol fee rate (SCALAR_18); apportions fees, never charges them. */
    treasuryRate: bigint;
    /** Per-side ADL flags; a flagged side is closed-only. */
    adl?: AdlState;
    /** `(terminalPrice, delistedAt)` once retired. */
    retirement?: readonly [bigint, bigint];
    /** Settlement token, when the context carries it. */
    collateralToken?: string;
}

/** A {@link MarketContext} known to describe a specific subject and side. */
export type SubjectBoundMarketContext = MarketContext & {
    readonly subject: MarketSubject;
    readonly adl: AdlState;
    readonly collateralToken: string;
};
