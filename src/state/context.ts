import type { PriceData } from '../trading/market/types.js';
import type { MarketContext } from '../trading/position/context.js';
import { MarketStateError } from './entries.js';
import type { Market } from './market.js';
import type { MarketUser } from './market_user.js';

export interface MarketContextInput {
    /** Side under action. */
    isLong: boolean;
    /** Verified mark from the platform's numeric price surface. */
    price: PriceData;
    /**
     * Ledger close time in whole seconds. Defaults to the wall clock.
     * `getLedgerEntries` returns a ledger sequence, not a close time, so it
     * cannot supply this value. The two agree within a few seconds, which
     * every time gate here tolerates. Pass an explicit value when that is not
     * good enough.
     */
    now?: bigint;
    /** Placeholder execution-price payload; defaults to empty. */
    priceUpdate?: Uint8Array;
    /** Protocol fee rate from {@link loadTreasuryRate}; defaults to `0n`. */
    treasuryRate?: bigint;
}

/**
 * Build the context a position action is quoted against.
 *
 * @throws {MarketStateError} `IDENTITY_MISMATCH` when the user state was read
 *   against a different market. Without this check, a mismatched pair would
 *   present a zeroed position as a real one.
 */
export function marketContext(
    market: Market,
    user: MarketUser,
    input: MarketContextInput,
): MarketContext {
    if (user.state.market !== market.contracts.market) {
        throw new MarketStateError(
            'IDENTITY_MISMATCH',
            `user state is for market ${user.state.market}, not ${market.contracts.market}`,
        );
    }

    return {
        subject: { user: user.user, isLong: input.isLong },
        ledger: market.ledger,
        ledgerTime: input.now ?? BigInt(Math.floor(Date.now() / 1000)),
        status: market.status,
        config: market.config,
        market: market.data,
        position: user.position(input.isLong),
        price: input.price,
        priceUpdate: input.priceUpdate ?? new Uint8Array(),
        vault: market.vaultAtomic,
        treasuryRate: input.treasuryRate ?? 0n,
        adl: market.adl,
        retirement: market.retirement,
        collateralToken: market.contracts.token,
    };
}
