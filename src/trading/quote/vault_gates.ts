import {
    marketSidePnl,
    sideCapacity,
    sideReserved,
} from '../market/capacity.js';
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

export interface VaultWithdrawHeadroom {
    utilizationHeadroom: bigint;
    pnlHeadroom: bigint;
}

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

/** @internal Exact gate math for a market already accrued to the quote time. */
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
