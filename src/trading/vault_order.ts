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
import { resolvePrice } from './price.js';
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
 * advisory only and never gates creation — an order that cannot fill yet is
 * legitimate (it rests until conditions clear), `minOut` protects the
 * outcome, and cancel refunds.
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
        /** Minimum output the fill must clear, atomic. `0n` = unset. */
        public minOut: bigint,
    ) {}

    /**
     * Build an order with a slippage-derived `minOut`: assets in, shares out
     * for a deposit; shares in, assets out for a redeem. `slippageBps`
     * (10_000 = 100%) floors the output; it defaults to `0n` (unbounded, the
     * contract's own default). `price` is required only when `slippageBps`
     * is nonzero.
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
     * deposit, assets (token-dec) for a redeem.
     */
    expectedOut(market: Market, price: PriceInput): bigint {
        return expectedFillOutput(market, this.kind, this.amount, price);
    }

    /**
     * Advise whether this order would fill at `price`, mirroring the gates
     * `execute_vault_order` runs: market status, the redeem lock (evaluated
     * at the earliest moment a fill is legal, so a fresh redeem reports its
     * lock outcome rather than a false block), `minOut` against the
     * uPnL-aware rate, the vault balance cap on a deposit, and the
     * utilization / pending-PnL exit gates on a redeem. Advisory only —
     * creation is fine either way.
     */
    fills(
        market: Market,
        price: PriceInput,
        now?: bigint,
    ): { fills: true } | { fills: false; block: ZenexError } {
        const createdAt = now ?? BigInt(Math.floor(Date.now() / 1000));
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
            treasuryRate: 0n,
            executionFee: market.config.execFee,
            minOut: this.minOut,
            createdAt,
        };
        const quoted =
            this.kind === VaultOrderKind.Deposit
                ? quoteVaultDepositFill({ ...context, assets: this.amount })
                : quoteVaultRedeemFill({ ...context, shares: this.amount });

        if (quoted.kind !== 'unavailable') return { fills: true };
        return {
            fills: false,
            block: zenexErrorFromGate(
                quoted.contractCode ?? sentinelFor(quoted.code),
                quoted.reason,
            ),
        };
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
