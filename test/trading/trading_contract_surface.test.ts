import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { TradingContract, DeployArgs } from '../../src/trading/trading_contract.js';
import {
    OrderKind, VaultOrderKind, FULL_CLOSE, TradingConfig, tradingConfigToScVal,
} from '../../src/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 5));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 6));
const PV = StrKey.encodeContract(Buffer.alloc(32, 7));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 8));

const PRICE = Buffer.from('deadbeef', 'hex');

function decodeInvoke(op: string) {
    const body = xdr.Operation.fromXDR(op, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((a) => scValToNative(a)),
    };
}

function makeConfig(): TradingConfig {
    return {
        keeperRate: 1n, minPositionNotional: 1n, maxPositionNotional: 2n,
        maxOpenInterest: 2n, minOrderNotional: 1n, minOrderCollateral: 1n,
        feeDom: 1n, feeNonDom: 1n, impactDivisor: 1n, maxUtilOpen: 1n,
        maxUtilWithdraw: 1n, initMargin: 1n, maintenanceMargin: 1n, liqFee: 1n,
        notionalLock: 60n, targetUtil: 1n, borrowRate: 1n, increasedBorrowRate: 1n,
        fundingIncrease: 1n, fundingDecrease: 1n, thresholdStableFunding: 1n,
        thresholdDecreaseFunding: 1n, fundingMin: 1n, fundingMax: 1n,
        adlMaxPnl: 1n, adlClearTarget: 1n, maxPnlTrader: 1n, redeemLock: 60n,
        depositLock: 60n, instantDepositPnl: 1n, vaultFee: 1n, minDeposit: 1n,
        maxPnlDeposit: 1n, maxPnlWithdraw: 1n, maxVaultBalance: 100n,
    };
}

const i128 = (v: bigint) => nativeToScVal(v, { type: 'i128' });
const u64 = (v: bigint) => nativeToScVal(v, { type: 'u64' });
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(k), val: v });
const sidePair = (long: bigint, short: bigint) =>
    xdr.ScVal.scvMap([entry('long', i128(long)), entry('short', i128(short))]);

describe('TradingContract full surface', () => {
    const contract = new TradingContract(CONTRACT_ID);

    it('deploy builds a createCustomContract op with the constructor args', () => {
        const args: DeployArgs = {
            owner: OWNER, token: TOKEN, vault: VAULT, priceVerifier: PV,
            treasury: TREASURY, feedId: 1, exponent: -8, config: makeConfig(),
        };
        const opHex = TradingContract.deploy(OWNER, Buffer.alloc(32, 9).toString('hex'), args);
        const body = xdr.Operation.fromXDR(opHex, 'base64').body().invokeHostFunctionOp();
        const create = body.hostFunction().createContractV2();
        expect(create.constructorArgs().length).toBe(8);
        expect(scValToNative(create.constructorArgs()[0])).toBe(OWNER);
        expect(scValToNative(create.constructorArgs()[5])).toBe(1);
        expect(scValToNative(create.constructorArgs()[6])).toBe(-8);

        // Buffer wasmHash + salt variant
        const opBuf = TradingContract.deploy(OWNER, Buffer.alloc(32, 9), args, Buffer.alloc(32, 2));
        expect(opBuf).toBeTypeOf('string');
        // base64 string format variant
        const opB64 = TradingContract.deploy(OWNER, Buffer.alloc(32, 9).toString('base64'), args, undefined, 'base64');
        expect(opB64).toBeTypeOf('string');
    });

    it('builds every admin op', () => {
        expect(decodeInvoke(contract.setConfig(makeConfig())).fn).toBe('set_config');
        const setStatus = decodeInvoke(contract.setStatus(2));
        expect(setStatus.fn).toBe('set_status');
        expect(setStatus.args).toEqual([2]);
        const setTp = decodeInvoke(contract.setTerminalPrice(123n));
        expect(setTp.fn).toBe('set_terminal_price');
        expect(setTp.args).toEqual([123n]);
    });

    it('builds trader ops (vault orders, funding claim, cancels)', () => {
        const cvo = decodeInvoke(contract.createVaultOrder(USER, VaultOrderKind.Deposit, 100n, 5n));
        expect(cvo.fn).toBe('create_vault_order');
        expect(cvo.args).toEqual([USER, ['Deposit'], 100n, 5n]);

        const cancel = decodeInvoke(contract.cancelVaultOrder(USER, 3));
        expect(cancel.fn).toBe('cancel_vault_order');
        expect(cancel.args).toEqual([USER, 3]);

        const claim = decodeInvoke(contract.claimFunding(USER));
        expect(claim.fn).toBe('claim_funding');
        expect(claim.args).toEqual([USER]);
    });

    it('builds keeper ops with Buffer and Uint8Array price payloads', () => {
        const exec = decodeInvoke(contract.executeOrder(KEEPER, USER, 1, PRICE));
        expect(exec.fn).toBe('execute_order');
        expect(exec.args).toEqual([KEEPER, USER, 1, PRICE]);

        const execU8 = decodeInvoke(contract.executeOrder(KEEPER, USER, 1, new Uint8Array([1, 2, 3])));
        expect(execU8.args[3]).toEqual(Buffer.from([1, 2, 3]));

        const liq = decodeInvoke(contract.executeLiquidation(KEEPER, USER, true, PRICE));
        expect(liq.fn).toBe('execute_liquidation');
        expect(liq.args).toEqual([KEEPER, USER, true, PRICE]);

        const adlState = decodeInvoke(contract.updateAdlState(PRICE));
        expect(adlState.fn).toBe('update_adl_state');

        const adl = decodeInvoke(contract.executeAdl(KEEPER, USER, false, 50n, PRICE));
        expect(adl.fn).toBe('execute_adl');
        expect(adl.args).toEqual([KEEPER, USER, false, 50n, PRICE]);

        const evo = decodeInvoke(contract.executeVaultOrder(KEEPER, USER, 2, 75n, PRICE));
        expect(evo.fn).toBe('execute_vault_order');
        expect(evo.args).toEqual([KEEPER, USER, 2, 75n, PRICE]);
    });

    it('builds maintenance and view ops', () => {
        expect(decodeInvoke(contract.accrueFunding()).fn).toBe('accrue_funding');
        expect(decodeInvoke(contract.accrue(PRICE)).fn).toBe('accrue');
        expect(decodeInvoke(contract.getConfig()).fn).toBe('get_config');
        expect(decodeInvoke(contract.getMarketData()).fn).toBe('get_market_data');
        expect(decodeInvoke(contract.getPosition(USER, true)).args).toEqual([USER, true]);
        expect(decodeInvoke(contract.getOrder(USER, 9)).args).toEqual([USER, 9]);
        expect(decodeInvoke(contract.getStatus()).fn).toBe('get_status');
        expect(decodeInvoke(contract.getVaultOrder(USER, 8)).args).toEqual([USER, 8]);
        expect(decodeInvoke(contract.getAdl()).fn).toBe('get_adl');
        expect(decodeInvoke(contract.getClaimableFunding(USER)).args).toEqual([USER]);
        expect(decodeInvoke(contract.getToken()).fn).toBe('get_token');
        expect(decodeInvoke(contract.getVault()).fn).toBe('get_vault');
        expect(decodeInvoke(contract.getTreasury()).fn).toBe('get_treasury');
        expect(decodeInvoke(contract.getPriceVerifier()).fn).toBe('get_price_verifier');
        expect(decodeInvoke(contract.getRetirement()).fn).toBe('get_retirement');
        expect(decodeInvoke(contract.getFeed()).fn).toBe('get_feed');
    });

    it('builds ownable ops', () => {
        expect(decodeInvoke(contract.getOwner()).fn).toBe('get_owner');
        const t = decodeInvoke(contract.transferOwnership(OWNER, 5000));
        expect(t.fn).toBe('transfer_ownership');
        expect(t.args).toEqual([OWNER, 5000]);
        expect(decodeInvoke(contract.acceptOwnership()).fn).toBe('accept_ownership');
        expect(decodeInvoke(contract.renounceOwnership()).fn).toBe('renounce_ownership');
    });

    it('builds every semantic helper on top of create_order / create_vault_order', () => {
        const openMarket = decodeInvoke(contract.openMarket({
            user: USER, isLong: true, notional: 100n, collateral: 10n, priceBound: 5n, expiration: 99,
        }));
        expect(openMarket.args).toEqual([USER, true, ['Increase'], 100n, 10n, 0n, false, 5n, 99]);

        const openLimit = decodeInvoke(contract.openLimit({
            user: USER, isLong: true, notional: 100n, collateral: 10n,
            triggerPrice: 42n, priceBound: 5n, expiration: 99,
        }));
        expect(openLimit.args).toEqual([USER, true, ['Increase'], 100n, 10n, 42n, false, 5n, 99]);

        const decrease = decodeInvoke(contract.decreasePosition({
            user: USER, isLong: false, notional: 40n, collateral: 4n, priceBound: 0n, expiration: 1,
        }));
        expect(decrease.args).toEqual([USER, false, ['Decrease'], 40n, 4n, 0n, false, 0n, 1]);

        const add = decodeInvoke(contract.addCollateral({ user: USER, isLong: true, amount: 7n, expiration: 2 }));
        expect(add.args).toEqual([USER, true, ['Increase'], 0n, 7n, 0n, false, 0n, 2]);

        const withdraw = decodeInvoke(contract.withdrawCollateral({ user: USER, isLong: true, amount: 7n, expiration: 2 }));
        expect(withdraw.args).toEqual([USER, true, ['Decrease'], 0n, 7n, 0n, false, 0n, 2]);

        const tp = decodeInvoke(contract.placeTakeProfit({
            user: USER, isLong: true, triggerPrice: 200n, notional: 50n, priceBound: 0n, expiration: 3,
        }));
        expect(tp.args).toEqual([USER, true, ['Decrease'], 50n, 0n, 200n, true, 0n, 3]);

        const tpFull = decodeInvoke(contract.placeTakeProfit({
            user: USER, isLong: false, triggerPrice: 200n, priceBound: 0n, expiration: 3,
        }));
        expect(tpFull.args[3]).toBe(FULL_CLOSE);
        expect(tpFull.args[6]).toBe(false);

        const sl = decodeInvoke(contract.placeStopLoss({
            user: USER, isLong: false, triggerPrice: 90n, priceBound: 0n, expiration: 3,
        }));
        expect(sl.args[6]).toBe(true);

        const dep = decodeInvoke(contract.depositVault({ user: USER, amount: 10n, maxAdversePnl: 1n }));
        expect(dep.args).toEqual([USER, ['Deposit'], 10n, 1n]);

        const red = decodeInvoke(contract.redeemVault({ user: USER, shares: 20n, maxAdversePnl: 2n }));
        expect(red.args).toEqual([USER, ['Redeem'], 20n, 2n]);
    });

    it('createOrder builds an increase with all trigger fields', () => {
        const co = decodeInvoke(contract.createOrder(USER, false, OrderKind.Decrease, 1n, 2n, 3n, true, 4n, 5));
        expect(co.fn).toBe('create_order');
        expect(co.args).toEqual([USER, false, ['Decrease'], 1n, 2n, 3n, true, 4n, 5]);
        expect(decodeInvoke(contract.cancelOrder(USER, 6)).args).toEqual([USER, 6]);
    });

    describe('parsers', () => {
        const p = TradingContract.parsers;

        it('parses void admin results', () => {
            expect(p.setConfig()).toBeUndefined();
            expect(p.setStatus()).toBeUndefined();
            expect(p.setTerminalPrice()).toBeUndefined();
            expect(p.cancelOrder()).toBeUndefined();
            expect(p.transferOwnership()).toBeUndefined();
            expect(p.acceptOwnership()).toBeUndefined();
            expect(p.renounceOwnership()).toBeUndefined();
        });

        it('parses numeric and scalar results', () => {
            expect(p.createOrder(xdr.ScVal.scvU32(4).toXDR('base64'))).toBe(4);
            expect(p.createVaultOrder(xdr.ScVal.scvU32(5).toXDR('base64'))).toBe(5);
            expect(p.cancelVaultOrder(i128(10n).toXDR('base64'))).toBe(10n);
            expect(p.claimFunding(i128(11n).toXDR('base64'))).toBe(11n);
            expect(p.executeOrder(i128(12n).toXDR('base64'))).toBe(12n);
            expect(p.executeLiquidation(i128(13n).toXDR('base64'))).toBe(13n);
            expect(p.executeAdl(i128(14n).toXDR('base64'))).toBe(14n);
            expect(p.executeVaultOrder(i128(15n).toXDR('base64'))).toBe(15n);
            expect(p.getClaimableFunding(i128(16n).toXDR('base64'))).toBe(16n);
            expect(p.getStatus(xdr.ScVal.scvU32(3).toXDR('base64'))).toBe(3);
            expect(p.getToken(Address.fromString(TOKEN).toScVal().toXDR('base64'))).toBe(TOKEN);
            expect(p.getVault(Address.fromString(VAULT).toScVal().toXDR('base64'))).toBe(VAULT);
            expect(p.getTreasury(Address.fromString(TREASURY).toScVal().toXDR('base64'))).toBe(TREASURY);
            expect(p.getPriceVerifier(Address.fromString(PV).toScVal().toXDR('base64'))).toBe(PV);
            expect(p.getOwner(Address.fromString(OWNER).toScVal().toXDR('base64'))).toBe(OWNER);
            expect(p.getOwner(xdr.ScVal.scvVoid().toXDR('base64'))).toBeNull();
        });

        it('parses tuple views', () => {
            const feed = xdr.ScVal.scvVec([xdr.ScVal.scvU32(7), xdr.ScVal.scvI32(-8)]).toXDR('base64');
            expect(p.getFeed(feed)).toEqual([7, -8]);
            const ret = xdr.ScVal.scvVec([i128(100n), u64(123n)]).toXDR('base64');
            expect(p.getRetirement(ret)).toEqual([100n, 123n]);
            expect(p.getRetirement(xdr.ScVal.scvVoid().toXDR('base64'))).toBeNull();
        });

        it('parses struct views (AdlState, MarketData, Position, Order, VaultOrder, Config)', () => {
            const adl = xdr.ScVal.scvMap([
                entry('long', xdr.ScVal.scvBool(true)),
                entry('short', xdr.ScVal.scvBool(false)),
            ]).toXDR('base64');
            expect(p.getAdl(adl)).toEqual({ long: true, short: false });
            expect(p.updateAdlState(adl)).toEqual({ long: true, short: false });

            const marketData = xdr.ScVal.scvMap([
                entry('borrowing_idx', sidePair(1n, 2n)),
                entry('borrowing_update', u64(3n)),
                entry('collateral', sidePair(4n, 5n)),
                entry('funding_idx', sidePair(6n, 7n)),
                entry('funding_owed', i128(8n)),
                entry('funding_pool', i128(9n)),
                entry('funding_rate', i128(10n)),
                entry('funding_update', u64(11n)),
                entry('notional', sidePair(12n, 13n)),
                entry('tokens', sidePair(14n, 15n)),
            ]).toXDR('base64');
            const md = p.getMarketData(marketData);
            expect(md.notional).toEqual({ long: 12n, short: 13n });
            expect(md.fundingRate).toBe(10n);
            expect(p.accrue(marketData).fundingOwed).toBe(8n);
            expect(p.accrueFunding(marketData).fundingPool).toBe(9n);

            const position = xdr.ScVal.scvMap([
                entry('borrowing_idx', i128(1n)),
                entry('collateral', i128(2n)),
                entry('funding_idx', i128(3n)),
                entry('locked_notional', i128(4n)),
                entry('notional', i128(5n)),
                entry('tokens', i128(6n)),
                entry('unlocks_at', u64(7n)),
                entry('updated_at', u64(8n)),
            ]).toXDR('base64');
            const pos = p.getPosition(position);
            expect(pos.collateral).toBe(2n);
            expect(pos.lockedNotional).toBe(4n);

            const order = xdr.ScVal.scvMap([
                entry('collateral', i128(1n)),
                entry('created_at', u64(2n)),
                entry('expiration', xdr.ScVal.scvU32(3)),
                entry('is_long', xdr.ScVal.scvBool(true)),
                entry('kind', xdr.ScVal.scvVec([sym('Increase')])),
                entry('notional', i128(4n)),
                entry('price_bound', i128(5n)),
                entry('trigger_above', xdr.ScVal.scvBool(false)),
                entry('trigger_price', i128(6n)),
            ]).toXDR('base64');
            const ord = p.getOrder(order);
            expect(ord.kind).toBe(OrderKind.Increase);
            expect(ord.expiration).toBe(3);

            const vaultOrder = xdr.ScVal.scvMap([
                entry('amount', i128(1n)),
                entry('created_at', u64(2n)),
                entry('kind', xdr.ScVal.scvVec([sym('Redeem')])),
                entry('max_adverse_pnl', i128(3n)),
                entry('unlocks_at', u64(4n)),
            ]).toXDR('base64');
            const vo = p.getVaultOrder(vaultOrder);
            expect(vo.kind).toBe(VaultOrderKind.Redeem);
            expect(vo.unlocksAt).toBe(4n);

            const config = tradingConfigToScVal(makeConfig()).toXDR('base64');
            const cfg = p.getConfig(config);
            expect(cfg).toEqual(makeConfig());
        });
    });
});
