import { Status, VaultOrderKind } from '../contracts/market/types.js';
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
import { marketPrice, quoteTime } from './price.js';
import {
    cappedNetPnl,
    convertVaultAssetsToShares,
    convertVaultSharesToAssets,
    quoteVaultDepositFill,
    quoteVaultOrderCreation,
    quoteVaultRedeemFill,
} from './internal/vault.js';
import type { QuoteResult } from './internal/quote.js';

/** @internal The SDK sentinel for a codeless unavailable quote. */
function sentinelFor(code: string): number {
    return code === 'CONTRACT_OVERFLOW'
        ? ZenexErrorCode.QuoteOverflow
        : ZenexErrorCode.QuoteInvalidInput;
}

/** @internal An unavailable quote as the `ZenexError` it stands for. */
function gateError(quote: Extract<QuoteResult<unknown>, { kind: 'unavailable' }>): ZenexError {
    return zenexErrorFromGate(
        quote.contractCode ?? sentinelFor(quote.code),
        quote.reason,
    );
}

/** @internal A retired market redeems inside `create_vault_order`, fee-free. */
function redeemsAtCreation(market: Market, kind: VaultOrderKind): boolean {
    return market.status === Status.Retired && kind === VaultOrderKind.Redeem;
}

/** @internal Fee-net expected output of a fill, mirroring `execute_vault_order`'s two branches. */
function expectedFillOutput(
    market: Market,
    kind: VaultOrderKind,
    amount: bigint,
    price: PriceInput,
): bigint {
    // The retirement clear-out left a flat book, so the direct redeem prices
    // at zero pending PnL and charges no fee.
    if (redeemsAtCreation(market, kind)) {
        return convertVaultSharesToAssets(market.vaultAtomic(), amount, 0n);
    }
    const p = marketPrice(market, price, quoteTime(market));
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
 * advice: `toOperation` builds the call whatever it says. An order a
 * capacity gate blocks rests until conditions clear, and cancel refunds it.
 * `minOut` does not wait: a keeper fill quoted below it rejects the order,
 * returning the principal and paying the execution fee to the keeper.
 */
export class VaultOrderIntent {
    constructor(
        /** The market (trading) contract the order is created on. */
        public marketId: string,
        /** The order owner. */
        public user: string,
        /** Deposit assets for shares, or redeem shares for assets. */
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
     * required only when `slippageBps` is nonzero. A redeem on a `Retired`
     * market executes at creation and never reads `minOut`, so it keeps
     * `minOut` at `0n` and needs no price.
     *
     * @throws {RangeError} when `slippageBps` is outside `[0, 10_000]`, or
     *   nonzero with no price to estimate the output the bound is cut from.
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
        if (bps > 0n && !redeemsAtCreation(market, kind)) {
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
     * fill checks `minOut` against. On a `Retired` market a redeem pays at
     * creation instead: no fee, priced at zero pending PnL, `price` unused.
     */
    expectedOut(market: Market, price: PriceInput): bigint {
        return expectedFillOutput(market, this.kind, this.amount, price);
    }

    /**
     * Advise how this order lands if you create it now and a keeper fills it
     * at `price`. The creation rules of `create_vault_order` run first. Then
     * the checks `execute_vault_order` runs: the redeem lock (evaluated at
     * the earliest moment a fill is legal, so a fresh redeem reports its lock
     * outcome rather than a false block), `minOut` against the uPnL-aware
     * rate, the vault balance cap on a deposit, and the utilization and
     * pending-PnL exit gates on a redeem.
     *
     * - `{ fills: true }`: the order fills. A redeem on a `Retired` market
     *   fills at creation, with no fee and no `minOut` check.
     * - `{ fills: false, invalid }`: creation reverts, so no order exists.
     *   `invalid.code` is 710 (a negative amount or `minOut`), 704 (a
     *   `Frozen` market), 702 (a deposit on a `Retired` market) or 732 (a
     *   zero amount, a deposit under `minDeposit`, or an escrow past i128).
     * - `{ fills: false, rejected }`: the quote misses `minOut`, so the
     *   keeper's call rejects the order, returning the principal and paying
     *   the execution fee to the keeper. `rejected.quoted` is the fill's
     *   quote, in the unit of `minOut`.
     * - `{ fills: false, block }`: the order creates, but a gate reverts the
     *   fill, so it rests until conditions clear or you cancel it.
     *
     * @param now Creation time, unix seconds. Defaults to the wall clock and
     *   never reads earlier than the market's stored accrual.
     */
    fills(
        market: Market,
        price: PriceInput,
        now?: bigint,
    ):
        | { fills: true }
        | { fills: false; invalid: ZenexError }
        | { fills: false; rejected: { quoted: bigint } }
        | { fills: false; block: ZenexError } {
        if (
            this.kind !== VaultOrderKind.Deposit &&
            this.kind !== VaultOrderKind.Redeem
        ) {
            return { fills: false, invalid: new ZenexError(ZenexErrorCode.UnknownKind) };
        }
        const createdAt = quoteTime(market, now);
        const creation = quoteVaultOrderCreation({
            ledger: market.ledger,
            now: createdAt,
            status: market.status,
            config: market.config,
            action: this.kind === VaultOrderKind.Deposit ? 'deposit' : 'redeem',
            amount: this.amount,
            minOut: this.minOut,
            vault: market.vaultAtomic(),
        });
        if (creation.kind === 'unavailable') {
            return { fills: false, invalid: gateError(creation) };
        }
        if (
            creation.kind === 'exact' &&
            creation.value.kind === 'retiredImmediateRedeem'
        ) {
            return { fills: true };
        }

        // Evaluate at the earliest ledger a keeper could legally fill: the
        // next second for a deposit, past the redeem lock for a redeem.
        const lock =
            this.kind === VaultOrderKind.Redeem && market.config.redeemLock > 0n
                ? market.config.redeemLock
                : 1n;
        const context = {
            ledger: market.ledger,
            now: createdAt + lock,
            market: market.data,
            config: market.config,
            price: {
                ...marketPrice(market, price, createdAt + lock),
                publishTime: createdAt + lock,
            },
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
            return { fills: false, block: gateError(quote) };
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
