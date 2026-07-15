import {
    marketSidePnl,
    sideCapacity,
    sideReserved,
} from '../market/capacity.js';
import { checkedI128 } from '../math/fixed.js';
import { advanceMarketAccruals } from '../market/rates.js';
import type { VerifiedPrice } from '../market/types.js';
import { decodeLedgerSequence, exact, unavailable } from '../quote/result.js';
import type { QuoteResult } from '../quote/result.js';
import type { MarketData, TradingConfig } from '../trading/trading_types.js';
import type { VaultGateInput } from './quote.js';

const OVERFLOW_MESSAGE = 'value is outside the i128 range';
const U64_MAX = 2n ** 64n - 1n;

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

function timestamp(value: bigint, label: string): bigint {
    if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
        throw new RangeError(`${label} must be a u64 bigint`);
    }
    return value;
}

function nonnegative(value: bigint, label: string): bigint {
    const checked = checkedI128(value);
    if (checked < 0n) throw new RangeError(`${label} must be nonnegative`);
    return checked;
}

/** @internal Exact gate math for a market already accrued to the quote time. */
export function evaluateVaultWithdrawGates(
    market: MarketData,
    config: TradingConfig,
    price: VerifiedPrice,
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
        decodeLedgerSequence(input.ledger);
        const now = timestamp(input.now, 'quote timestamp');
        const publishTime = timestamp(
            input.price.publishTime,
            'verified price publish time',
        );
        const vaultAssets = nonnegative(
            input.vault.totalAssets,
            'vault total assets',
        );
        const postVaultAssets = nonnegative(
            input.postVaultAssets,
            'post-vault assets',
        );
        if (publishTime > now) {
            throw new RangeError(
                'verified price publish time exceeds quote timestamp',
            );
        }
        const accrued = advanceMarketAccruals(
            input.market,
            input.config,
            input.price,
            vaultAssets,
            now,
        ).market;
        if (publishTime < timestamp(accrued.lastPriceTime, 'last price time')) {
            throw new VaultProtocolGateError(740);
        }
        return exact(
            evaluateVaultWithdrawGates(
                accrued,
                input.config,
                input.price,
                postVaultAssets,
            ),
            input.ledger,
            publishTime,
        );
    } catch (error) {
        return caughtUnavailable(error);
    }
}
