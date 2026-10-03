import { describe, expect, it } from 'vitest';
import { Status, VaultOrderKind } from '../../src/contracts/market/types.js';
import { ZenexErrorCode } from '../../src/errors.js';
import { VaultOrderIntent } from '../../src/trading/vault_order.js';
import { USER, fixtureMarket, px, unit } from './market_fixture.js';
import type { MarketFixture } from './market_fixture.js';

// fills() advises on an order about to be created, so create_vault_order's
// own rules come first: an order that cannot be created never fills.

const deposit = (amount: bigint, minOut = 0n) =>
    new VaultOrderIntent('C', USER, VaultOrderKind.Deposit, amount, minOut);
const redeem = (amount: bigint, minOut = 0n) =>
    new VaultOrderIntent('C', USER, VaultOrderKind.Redeem, amount, minOut);
const market = (fixture: MarketFixture = {}) =>
    fixtureMarket({ vaultAssets: unit(1000), ...fixture });

describe('VaultOrderIntent.fills applies the creation rules', () => {
    it.each([
        ['a deposit on a frozen market', Status.Frozen, unit(100), 704],
        ['a deposit on a retired market', Status.Retired, unit(100), 702],
        ['a deposit under minDeposit', Status.Active, 999_999n, 732],
        ['a zero deposit', Status.Active, 0n, 732],
        ['a negative deposit, before the status', Status.Frozen, -5n, 710],
    ] as const)('reports %s as invalid', (_label, status, amount, code) => {
        expect(deposit(amount).fills(market({ status }), px(1), 10n)).toEqual({
            fills: false,
            invalid: expect.objectContaining({ code }),
        });
    });

    it('reports a redeem on a frozen market as invalid (#704)', () => {
        expect(redeem(unit(1)).fills(market({ status: Status.Frozen }), px(1), 10n)).toEqual({
            fills: false,
            invalid: expect.objectContaining({ code: 704 }),
        });
    });

    it('reports an unknown kind as invalid (#734)', () => {
        const odd = new VaultOrderIntent('C', USER, 7 as VaultOrderKind, unit(1), 0n);
        expect(odd.fills(market(), px(1), 10n)).toEqual({
            fills: false,
            invalid: expect.objectContaining({ code: ZenexErrorCode.UnknownKind }),
        });
    });

    it('fills a redeem on a retired market at creation, whatever its minOut', () => {
        const retired = market({ status: Status.Retired });
        expect(redeem(unit(100), unit(999)).fills(retired, px(1), 10n)).toEqual({
            fills: true,
        });
    });

    it('still fills a deposit on a delisted or on-ice market', () => {
        for (const status of [Status.Delisted, Status.OnIce]) {
            expect(deposit(unit(100)).fills(market({ status }), px(1), 10n)).toEqual({
                fills: true,
            });
        }
    });

    it('keeps a fill-time gate as a block (#753)', () => {
        const full = market({ config: { maxVaultBalance: unit(1050) } });
        expect(deposit(unit(100)).fills(full, px(1), 10n)).toEqual({
            fills: false,
            block: expect.objectContaining({ code: 753 }),
        });
    });
});

describe('a redeem on a retired market', () => {
    const retired = market({ status: Status.Retired });

    it('quotes the fee-free direct redeem at zero pending PnL', () => {
        // 100 of 1000 shares against 1000.0 of assets: 100.0, with no
        // 0.1% redeem fee taken.
        expect(redeem(unit(100)).expectedOut(retired, px(5))).toBe(unit(100));
        expect(redeem(unit(100)).expectedOut(market(), px(5))).toBe(unit(100) - unit(100) / 1000n);
    });

    it('builds with minOut unset and needs no price, since minOut is never read', () => {
        const intent = VaultOrderIntent.create(retired, USER, VaultOrderKind.Redeem, unit(100), 50n);
        expect(intent.minOut).toBe(0n);
        expect(() =>
            VaultOrderIntent.create(market(), USER, VaultOrderKind.Redeem, unit(100), 50n),
        ).toThrow(/price is required/);
    });
});
