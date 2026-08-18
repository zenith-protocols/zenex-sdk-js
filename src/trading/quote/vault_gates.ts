import { sideCapacity, sideReserved } from '../market/capacity.js';
import { marketSidePnl } from '../market/pnl.js';
import { advanceMarketAccruals } from '../market/rates.js';
import type { PriceData } from '../market/types.js';
import { decodeLedgerSequence, exact, unavailable } from './result.js';
import type { QuoteResult } from './result.js';
import type { MarketData, TradingConfig } from '../../contracts/trading/trading_types.js';
import type { VaultGateInput } from './vault.js';

const OVERFLOW_MESSAGE = 'value is outside the i128 range';

const GATE_REASONS: Readonly<Record<number, string>> = {
    714: 'utilization exceeded',
    740: 'stale price',
    754: 'pending PnL exceeded',
};

/**
 * Room left before a withdrawal trips a protocol gate, evaluated at the
 * `postVaultAssets` the caller checked. Both fields are token-dec and take
 * the smaller of the long and short side.
 */
export interface VaultWithdrawHeadroom {
    /** Reserved-notional room left before the utilization gate (contract error 714) trips. */
    utilizationHeadroom: bigint;
    /** Pending-profit room left before the withdraw PnL gate (contract error 754) trips. */
    pnlHeadroom: bigint;
}

/**
 * A withdraw-side protocol gate rejected the call. `code` mirrors the
 * contract error number; the message names which gate failed.
 * `checkVaultWithdrawGates` catches this and reports it as `CONTRACT_GATE`
 * instead of throwing it to the caller.
 */
export class VaultProtocolGateError extends Error {
    constructor(readonly code: number) {
        super(
            `contract error #${code}: ${GATE_REASONS[code] ?? 'protocol gate failed'}`,
        );
    }
}

function minimum(left: bigint, right: bigint): bigint {
    return left < right ? left : right;
}

/**
 * @internal Mirror the exit gates `Market::require_utilization` and the
 * redeem PnL check `execute_vault_order` runs after a redeem settles:
 * reserve utilization, then pending trader PnL, both measured against
 * `postVaultAssets`. Assumes `market` is already accrued to the quote time.
 * Returns the headroom on each side if both gates pass.
 *
 * @param postVaultAssets - projected vault backing after the withdrawal, token-dec.
 * @throws {VaultProtocolGateError} code 714 (`MarketError::UtilizationExceeded`)
 *   if either side's reserved notional would exceed `config.maxUtilWithdraw`
 *   of half `postVaultAssets`. A smaller withdrawal or less open interest clears it.
 * @throws {VaultProtocolGateError} code 754 (`MarketError::PendingPnlExceeded`)
 *   if either side's pending profit would exceed `config.maxPnlWithdraw` of
 *   half `postVaultAssets`. A smaller withdrawal or an adverse price move clears it.
 */
export function evaluateVaultWithdrawGates(
    market: MarketData,
    config: TradingConfig,
    price: PriceData,
    postVaultAssets: bigint,
): VaultWithdrawHeadroom {
    const utilizationCapacity = sideCapacity(
        postVaultAssets,
        config.maxUtilWithdraw,
    );
    const longReserved = sideReserved(market, price, true);
    const shortReserved = sideReserved(market, price, false);
    if (
        longReserved > utilizationCapacity ||
        shortReserved > utilizationCapacity
    ) {
        throw new VaultProtocolGateError(714);
    }
    const utilizationHeadroom = minimum(
        utilizationCapacity - longReserved,
        utilizationCapacity - shortReserved,
    );

    const pnlAllowance = sideCapacity(postVaultAssets, config.maxPnlWithdraw);
    const longPnl = marketSidePnl(market, price, true, true);
    const shortPnl = marketSidePnl(market, price, false, true);
    if (longPnl > pnlAllowance || shortPnl > pnlAllowance) {
        throw new VaultProtocolGateError(754);
    }
    const pnlHeadroom = minimum(
        pnlAllowance - longPnl,
        pnlAllowance - shortPnl,
    );

    return { utilizationHeadroom, pnlHeadroom };
}

function caughtUnavailable<T>(error: unknown): QuoteResult<T> {
    if (error instanceof VaultProtocolGateError) {
        return unavailable('CONTRACT_GATE', error.message);
    }
    if (
        error instanceof RangeError &&
        error.message.includes(OVERFLOW_MESSAGE)
    ) {
        return unavailable('CONTRACT_OVERFLOW', error.message);
    }
    return unavailable(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'invalid vault gate input',
    );
}

/**
 * Check whether withdrawing down to `input.postVaultAssets` clears the
 * vault's exit gates, after advancing the market's accrual indices to
 * `input.now`. Mirrors the same checks `quoteVaultRedeemFill` runs inline,
 * so a caller can preview a withdrawal without quoting a full redeem.
 *
 * Returns `unavailable` with `CONTRACT_GATE`:
 * - 714 if either side's reserved notional would leave the vault
 *   under-reserved. A smaller withdrawal or less open interest clears it.
 * - 754 if either side's pending profit would overhang the withdraw PnL cap.
 *   A smaller withdrawal or an adverse price move clears it.
 */
export function checkVaultWithdrawGates(
    input: VaultGateInput,
): QuoteResult<VaultWithdrawHeadroom> {
    try {
        const accrued = advanceMarketAccruals(
            input.market,
            input.config,
            input.price,
            input.vault.totalAssets,
            input.now,
        ).market;
        return exact(
            evaluateVaultWithdrawGates(
                accrued,
                input.config,
                input.price,
                input.postVaultAssets,
            ),
            input.ledger,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}
