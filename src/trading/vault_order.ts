import { VaultOrderKind } from '../contracts/market/types.js';
import { ZenexError, ZenexErrorCode, zenexErrorFromGate } from '../errors.js';
import { MarketContract } from '../contracts/market/contract.js';
import {
    BPS_DENOMINATOR,
    SCALAR_18,
    checkedBps,
    mulDivFloor,
} from '../math/fixed.js';
import type { Market } from './market.js';
import type { PriceInput } from './price.js';
import { quoteTime, resolvePrice } from './price.js';
import {
    cappedNetPnl,
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    quoteVaultDepositFill,
    quoteVaultRedeemFill,
} from './internal/vault.js';

/** @internal The SDK sentinel for a codeless unavailable quote. */
function sentinelFor(code: string): number {
    return code === 'CONTRACT_OVERFLOW'
        ? ZenexErrorCode.QuoteOverflow
        : ZenexErrorCode.QuoteInvalidInput;
}

/** @internal Fee-net expected output of a fill, mirroring `execute_vault_order`'s two branches. */
function expectedFillOutput(
    market: Market,
    kind: VaultOrderKind,
    amount: bigint,
    price: PriceInput,
): bigint {
    const p = resolvePrice(price);
    if (kind === VaultOrderKind.Deposit) {
        const fee = mulDivFloor(amount, market.config.depositFee, SCALAR_18);
        const pnl = cappedNetPnl(
            market.data,
            market.config,
            p,
            market.vaultAssets,
            false,
        );
        return convertVaultAssetsToShares(
            market.vaultAtomic(),
            amount - fee,
            pnl,
        );
    }
    const pnl = cappedNetPnl(
        market.data,
        market.config,
        p,
        market.vaultAssets,
        true,
    );
    const gross = convertVaultSharesToAssets(market.vaultAtomic(), amount, pnl);
    return gross - mulDivFloor(gross, market.config.redeemFee, SCALAR_18);
}

/**
 * One vault deposit or redeem order about to be created, holding exactly the
 * `create_vault_order` arguments. {@link VaultOrderIntent.create} derives
 * `minOut` from a slippage bound; the constructor is the raw path.
 *
 * Share pricing is uPnL-aware in both directions: a fill values the vault's
 * assets net of trader PnL at the mark. {@link VaultOrderIntent.fills} is
 * advisory only and never gates creation. An order a capacity gate blocks
 * rests until conditions clear, and cancel refunds it. `minOut` does not
 * wait: a keeper fill quoted below it rejects the order, returning the
 * principal and paying the execution fee to the keeper.
 */
export class VaultOrderIntent {
    constructor(
        /** The market (trading) contract the order is created on. */
        public marketId: string,
        /** The order owner. */
        public user: string,
        public kind: VaultOrderKind,
        /** Assets (token-dec) for a deposit, shares (share-dec) for a redeem. */
        public amount: bigint,
        /** Minimum output net of the vault fee, atomic: shares for a deposit, assets for a redeem. `0n` = unset. A fill quoted below it rejects the order. */
        public minOut: bigint,
    ) {}

    /**
     * Build an order with a slippage-derived `minOut`: assets in, shares out
     * for a deposit; shares in, assets out for a redeem. `slippageBps`
     * (10_000 = 100%) floors the {@link VaultOrderIntent.expectedOut} output,
     * the same fee-net quote `execute_vault_order` checks `minOut` against;
     * it defaults to `0n` (unbounded, the contract's own default). `price` is
     * required only when `slippageBps` is nonzero.
     *
     * @throws {RangeError} when `slippageBps` is nonzero and no price was
     *   given to estimate the output the bound is cut from.
     */
    static create(
        market: Market,
        user: string,
        kind: VaultOrderKind,
        amount: bigint,
        slippageBps?: bigint,
        price?: PriceInput,
    ): VaultOrderIntent {
        const bps = checkedBps(slippageBps ?? 0n);
        let minOut = 0n;
        if (bps > 0n) {
            if (price === undefined) {
                throw new RangeError(
                    'slippageBps is set, so a price is required to derive minOut',
                );
            }
            const expected = expectedFillOutput(market, kind, amount, price);
            minOut = mulDivFloor(
                expected,
                BPS_DENOMINATOR - bps,
                BPS_DENOMINATOR,
            );
        }
        return new VaultOrderIntent(market.id, user, kind, amount, minOut);
    }

    /**
     * What a fill right now would return at `price`, net of the
     * deposit/redeem fee, at the uPnL-aware rate: shares (share-dec) for a
     * deposit, assets (token-dec) for a redeem. This is the quote a keeper
     * fill checks `minOut` against.
     */
    expectedOut(market: Market, price: PriceInput): bigint {
        return expectedFillOutput(market, this.kind, this.amount, price);
    }

    /**
     * Advise how a keeper fill of this order would land at `price`,
     * mirroring the checks `execute_vault_order` runs: the redeem lock
     * (evaluated at the earliest moment a fill is legal, so a fresh redeem
     * reports its lock outcome rather than a false block), `minOut` against
     * the uPnL-aware rate, the vault balance cap on a deposit, and the
     * utilization / pending-PnL exit gates on a redeem. Advisory only —
     * creation is fine either way.
     *
     * - `{ fills: true }`: the order fills.
     * - `{ fills: false, rejected }`: the quote misses `minOut`, so the
     *   keeper's call rejects the order, returning the principal and paying
     *   the execution fee to the keeper. `rejected.quoted` is the fill's
     *   quote, in the unit of `minOut`.
     * - `{ fills: false, block }`: a gate reverts the fill, and the order
     *   stays pending.
     */
    fills(
        market: Market,
        price: PriceInput,
        now?: bigint,
    ):
        | { fills: true }
        | { fills: false; rejected: { quoted: bigint } }
        | { fills: false; block: ZenexError } {
        const createdAt = quoteTime(market, now);
        // Evaluate at the earliest ledger a keeper could legally fill: the
        // next second for a deposit, past the redeem lock for a redeem.
        const lock =
            this.kind === VaultOrderKind.Redeem && market.config.redeemLock > 0n
                ? market.config.redeemLock
                : 1n;
        const p = resolvePrice(price);
        const context = {
            ledger: market.ledger,
            now: createdAt + lock,
            market: market.data,
            config: market.config,
            price: { ...p, publishTime: createdAt + lock },
            vault: market.vaultAtomic(),
            treasuryRate: market.treasuryRate,
            executionFee: market.config.execFee,
            minOut: this.minOut,
            createdAt,
        };
        const quote =
            this.kind === VaultOrderKind.Deposit
                ? quoteVaultDepositFill({ ...context, assets: this.amount })
                : quoteVaultRedeemFill({ ...context, shares: this.amount });

        if (quote.kind === 'unavailable') {
            return {
                fills: false,
                block: zenexErrorFromGate(
                    quote.contractCode ?? sentinelFor(quote.code),
                    quote.reason,
                ),
            };
        }
        if (quote.value.kind === 'rejected') {
            return { fills: false, rejected: { quoted: quote.value.quoted } };
        }
        return { fills: true };
    }

    /**
     * The `create_vault_order` operation, base64 XDR, ready for a
     * transaction. Delegates to `MarketContract.createVaultOrder` on the
     * stored market address.
     */
    toOperation(): string {
        return new MarketContract(this.marketId).createVaultOrder(
            this.user,
            this.kind,
            this.amount,
            this.minOut,
        );
    }
}
