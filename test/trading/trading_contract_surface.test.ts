import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, scValToNative, Address, StrKey } from '@stellar/stellar-sdk';
import { TradingContract, DeployArgs } from '../../src/contracts/trading/trading_contract.js';
import {
    OrderKind, VaultOrderKind, TradingConfig, tradingConfigToScVal,
} from '../../src/contracts/trading/trading_types.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 5));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 6));
const ORACLE = StrKey.encodeContract(Buffer.alloc(32, 7));
const TREASURY = StrKey.encodeContract(Buffer.alloc(32, 8));

const PRICE = Buffer.from('deadbeef', 'hex');
const FEED_ID = Buffer.concat([Buffer.from([0x00, 0x03]), Buffer.alloc(30, 1)]);

function decodeInvoke(operation: string) {
    const body = xdr.Operation.fromXDR(operation, 'base64').body().invokeHostFunctionOp();
    const invoke = body.hostFunction().invokeContract();
    return {
        fn: invoke.functionName().toString(),
        args: invoke.args().map((arg) => scValToNative(arg)),
    };
}

function makeConfig(): TradingConfig {
    return {
        keeperRate: 1n, minPositionNotional: 1n, maxPositionNotional: 2n,
        maxOpenInterest: 2n, minOrderNotional: 1n, minOrderMargin: 1n,
        execFee: 1n, feeDom: 1n, feeNonDom: 1n, impactScalar: 1n,
        maxUtilOpen: 1n, maxUtilWithdraw: 1n, initMargin: 1n,
        maintenanceMargin: 1n, liqFee: 1n, notionalLock: 60n, targetUtil: 1n,
        borrowRate: 1n, increasedBorrowRate: 1n, fundingIncrease: 1n,
        fundingDecrease: 1n, thresholdStableFunding: 1n,
        thresholdDecreaseFunding: 1n, fundingMin: 1n, fundingMax: 1n,
        adlMaxPnl: 1n, adlClearTarget: 1n, maxPnlTrader: 1n,
        maxPnlWithdraw: 1n, redeemLock: 60n, depositFee: 1n, redeemFee: 1n,
        minDeposit: 1n, maxVaultBalance: 100n,
    };
}

const i128 = (value: bigint) => nativeToScVal(value, { type: 'i128' });
const u64 = (value: bigint) => nativeToScVal(value, { type: 'u64' });
const sym = (value: string) => xdr.ScVal.scvSymbol(value);
const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(key), val });
const sidePair = (long: bigint, short: bigint) =>
    xdr.ScVal.scvMap([entry('long', i128(long)), entry('short', i128(short))]);

// Alphabetical field order, matching #[contracttype] serialization.
const marketDataScVal = () => xdr.ScVal.scvMap([
    entry('accrued_at', u64(3n)),
    entry('borrowing_idx', sidePair(1n, 2n)),
    entry('margin', sidePair(4n, 5n)),
    entry('funding_idx', sidePair(6n, 7n)),
    entry('funding_owed', i128(8n)),
    entry('funding_pool', i128(9n)),
    entry('funding_rate', i128(10n)),
    entry('notional', sidePair(12n, 13n)),
    entry('tokens', sidePair(14n, 15n)),
]);

describe('TradingContract full surface', () => {
    const contract = new TradingContract(CONTRACT_ID);

    it('deploy builds a createCustomContract op with the constructor args', () => {
        const args: DeployArgs = {
            owner: OWNER, token: TOKEN, vault: VAULT, oracle: ORACLE,
            treasury: TREASURY, feedId: FEED_ID, config: makeConfig(),
        };
        const opHex = TradingContract.deploy(OWNER, Buffer.alloc(32, 9).toString('hex'), args);
        const body = xdr.Operation.fromXDR(opHex, 'base64').body().invokeHostFunctionOp();
        const create = body.hostFunction().createContractV2();
        expect(create.constructorArgs().length).toBe(7);
        expect(scValToNative(create.constructorArgs()[0])).toBe(OWNER);
        expect(scValToNative(create.constructorArgs()[3])).toBe(ORACLE);
        expect(Buffer.from(create.constructorArgs()[5].bytes())).toEqual(FEED_ID);

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
        const setTerminalPrice = decodeInvoke(contract.setTerminalPrice(123n));
        expect(setTerminalPrice.fn).toBe('set_terminal_price');
        expect(setTerminalPrice.args).toEqual([123n]);
    });

    it('builds trader ops (vault orders, funding claim, cancels)', () => {
        const createVaultOrder = decodeInvoke(contract.createVaultOrder(USER, VaultOrderKind.Deposit, 100n, 5n));
        expect(createVaultOrder.fn).toBe('create_vault_order');
        expect(createVaultOrder.args).toEqual([USER, 0, 100n, 5n]);

        const cancelOrder = decodeInvoke(contract.cancelOrder(USER, 6));
        expect(cancelOrder.fn).toBe('cancel_order');
        expect(cancelOrder.args).toEqual([USER, 6]);

        const cancelVaultOrder = decodeInvoke(contract.cancelVaultOrder(USER, 3));
        expect(cancelVaultOrder.fn).toBe('cancel_vault_order');
        expect(cancelVaultOrder.args).toEqual([USER, 3]);

        const claimFunding = decodeInvoke(contract.claimFunding(USER));
        expect(claimFunding.fn).toBe('claim_funding');
        expect(claimFunding.args).toEqual([USER]);
    });

    it('builds keeper ops with Buffer and Uint8Array price payloads', () => {
        const executeOrder = decodeInvoke(contract.executeOrder(KEEPER, USER, 1, PRICE));
        expect(executeOrder.fn).toBe('execute_order');
        expect(executeOrder.args).toEqual([KEEPER, USER, 1, PRICE]);

        const executeOrderU8 = decodeInvoke(contract.executeOrder(KEEPER, USER, 1, new Uint8Array([1, 2, 3])));
        expect(executeOrderU8.args[3]).toEqual(Buffer.from([1, 2, 3]));

        const liquidation = decodeInvoke(contract.executeLiquidation(KEEPER, USER, true, PRICE));
        expect(liquidation.fn).toBe('execute_liquidation');
        expect(liquidation.args).toEqual([KEEPER, USER, true, PRICE]);

        const adlState = decodeInvoke(contract.updateAdlState(PRICE));
        expect(adlState.fn).toBe('update_adl_state');
        expect(adlState.args).toEqual([PRICE]);

        const adl = decodeInvoke(contract.executeAdl(KEEPER, USER, false, 50n, PRICE));
        expect(adl.fn).toBe('execute_adl');
        expect(adl.args).toEqual([KEEPER, USER, false, 50n, PRICE]);

        // execute_vault_order dropped the amount arg: (keeper, user, id, price)
        const executeVaultOrder = decodeInvoke(contract.executeVaultOrder(KEEPER, USER, 2, PRICE));
        expect(executeVaultOrder.fn).toBe('execute_vault_order');
        expect(executeVaultOrder.args).toEqual([KEEPER, USER, 2, PRICE]);
    });

    it('builds maintenance and view ops', () => {
        expect(decodeInvoke(contract.accrue(PRICE)).fn).toBe('accrue');
        expect(decodeInvoke(contract.getConfig()).fn).toBe('get_config');
        expect(decodeInvoke(contract.getMarketData()).fn).toBe('get_market_data');
        expect(decodeInvoke(contract.getPosition(USER, true)).args).toEqual([USER, true]);
        expect(decodeInvoke(contract.getOrder(USER, 9)).args).toEqual([USER, 9]);
        expect(decodeInvoke(contract.getStatus()).fn).toBe('get_status');
        expect(decodeInvoke(contract.getVaultOrder(USER, 8)).args).toEqual([USER, 8]);
        const orderCounter = decodeInvoke(contract.getOrderCounter(USER));
        expect(orderCounter.fn).toBe('get_order_counter');
        expect(orderCounter.args).toEqual([USER]);
        expect(decodeInvoke(contract.getAdl()).fn).toBe('get_adl');
        expect(decodeInvoke(contract.getClaimableFunding(USER)).args).toEqual([USER]);
        expect(decodeInvoke(contract.getToken()).fn).toBe('get_token');
        expect(decodeInvoke(contract.getVault()).fn).toBe('get_vault');
        expect(decodeInvoke(contract.getTreasury()).fn).toBe('get_treasury');
        expect(decodeInvoke(contract.getOracle()).fn).toBe('get_oracle');
        expect(decodeInvoke(contract.getRetirement()).fn).toBe('get_retirement');
        expect(decodeInvoke(contract.getFeed()).fn).toBe('get_feed');
    });

    it('builds ownable ops', () => {
        expect(decodeInvoke(contract.getOwner()).fn).toBe('get_owner');
        const transfer = decodeInvoke(contract.transferOwnership(OWNER, 5000));
        expect(transfer.fn).toBe('transfer_ownership');
        expect(transfer.args).toEqual([OWNER, 5000]);
        expect(decodeInvoke(contract.acceptOwnership()).fn).toBe('accept_ownership');
        expect(decodeInvoke(contract.renounceOwnership()).fn).toBe('renounce_ownership');
    });

    it('createOrder builds the 8-arg create_order', () => {
        const createOrder = decodeInvoke(
            contract.createOrder(USER, false, OrderKind.MarketDecrease, 1n, 2n, 3n, 4n, 5),
        );
        expect(createOrder.fn).toBe('create_order');
        expect(createOrder.args).toEqual([USER, false, 3, 1n, 2n, 3n, 4n, 5]);
    });

    describe('parsers', () => {
        const parsers = TradingContract.parsers;

        it('parses void admin results', () => {
            expect(parsers.setConfig()).toBeUndefined();
            expect(parsers.setStatus()).toBeUndefined();
            expect(parsers.setTerminalPrice()).toBeUndefined();
            expect(parsers.transferOwnership()).toBeUndefined();
            expect(parsers.acceptOwnership()).toBeUndefined();
            expect(parsers.renounceOwnership()).toBeUndefined();
        });

        it('parses numeric and scalar results', () => {
            expect(parsers.createOrder(xdr.ScVal.scvU32(4).toXDR('base64'))).toBe(4);
            expect(parsers.createVaultOrder(xdr.ScVal.scvU32(5).toXDR('base64'))).toBe(5);
            expect(parsers.cancelOrder(i128(9n).toXDR('base64'))).toBe(9n);
            expect(parsers.cancelVaultOrder(i128(10n).toXDR('base64'))).toBe(10n);
            expect(parsers.claimFunding(i128(11n).toXDR('base64'))).toBe(11n);
            expect(parsers.executeOrder(i128(12n).toXDR('base64'))).toBe(12n);
            expect(parsers.executeLiquidation(i128(13n).toXDR('base64'))).toBe(13n);
            expect(parsers.executeAdl(i128(14n).toXDR('base64'))).toBe(14n);
            expect(parsers.executeVaultOrder(i128(15n).toXDR('base64'))).toBe(15n);
            expect(parsers.getClaimableFunding(i128(16n).toXDR('base64'))).toBe(16n);
            expect(parsers.getStatus(xdr.ScVal.scvU32(3).toXDR('base64'))).toBe(3);
            expect(parsers.getOrderCounter(xdr.ScVal.scvU32(6).toXDR('base64'))).toBe(6);
            expect(parsers.getToken(Address.fromString(TOKEN).toScVal().toXDR('base64'))).toBe(TOKEN);
            expect(parsers.getVault(Address.fromString(VAULT).toScVal().toXDR('base64'))).toBe(VAULT);
            expect(parsers.getTreasury(Address.fromString(TREASURY).toScVal().toXDR('base64'))).toBe(TREASURY);
            expect(parsers.getOracle(Address.fromString(ORACLE).toScVal().toXDR('base64'))).toBe(ORACLE);
            expect(parsers.getOwner(Address.fromString(OWNER).toScVal().toXDR('base64'))).toBe(OWNER);
            expect(parsers.getOwner(xdr.ScVal.scvVoid().toXDR('base64'))).toBeUndefined();
        });

        it('parses the feed bytes and the retirement tuple', () => {
            const feed = xdr.ScVal.scvBytes(FEED_ID).toXDR('base64');
            expect(Buffer.from(parsers.getFeed(feed))).toEqual(FEED_ID);
            const retirement = xdr.ScVal.scvVec([i128(100n), u64(123n)]).toXDR('base64');
            expect(parsers.getRetirement(retirement)).toEqual([100n, 123n]);
            expect(parsers.getRetirement(xdr.ScVal.scvVoid().toXDR('base64'))).toBeUndefined();
        });

        it('parses struct views (AdlState, MarketData, Position)', () => {
            const adl = xdr.ScVal.scvMap([
                entry('long', xdr.ScVal.scvBool(true)),
                entry('short', xdr.ScVal.scvBool(false)),
            ]).toXDR('base64');
            expect(parsers.getAdl(adl)).toEqual({ long: true, short: false });
            expect(parsers.updateAdlState(adl)).toEqual({ long: true, short: false });

            const marketData = marketDataScVal().toXDR('base64');
            const parsedMarketData = parsers.getMarketData(marketData);
            expect(parsedMarketData.notional).toEqual({ long: 12n, short: 13n });
            expect(parsedMarketData.fundingRate).toBe(10n);
            expect('lastPriceTime' in parsedMarketData).toBe(false);
            expect(parsers.accrue(marketData).fundingOwed).toBe(8n);

            const position = xdr.ScVal.scvMap([
                entry('borrowing_idx', i128(1n)),
                entry('margin', i128(2n)),
                entry('decrease_orders', xdr.ScVal.scvVec([xdr.ScVal.scvU32(11), xdr.ScVal.scvU32(12)])),
                entry('funding_idx', i128(3n)),
                entry('locked_notional', i128(4n)),
                entry('notional', i128(5n)),
                entry('priced_at', u64(8n)),
                entry('tokens', i128(6n)),
                entry('unlocks_at', u64(7n)),
            ]).toXDR('base64');
            const parsedPosition = parsers.getPosition(position);
            expect(parsedPosition.margin).toBe(2n);
            expect(parsedPosition.lockedNotional).toBe(4n);
            expect(parsedPosition.pricedAt).toBe(8n);
            expect(parsedPosition.decreaseOrders).toEqual([11, 12]);
        });

        it('parses the Order/VaultOrder rows and the Config mirror', () => {
            const order = xdr.ScVal.scvMap([
                entry('margin', i128(1n)),
                entry('created_at', u64(2n)),
                entry('exec_fee', i128(7n)),
                entry('expiration', xdr.ScVal.scvU32(3)),
                entry('is_long', xdr.ScVal.scvBool(true)),
                entry('kind', xdr.ScVal.scvU32(1)),
                entry('notional', i128(4n)),
                entry('price_bound', i128(5n)),
                entry('trigger_price', i128(6n)),
            ]).toXDR('base64');
            const parsedOrder = parsers.getOrder(order);
            expect(parsedOrder.kind).toBe(OrderKind.LimitIncrease);
            expect(parsedOrder.execFee).toBe(7n);
            expect(parsedOrder.expiration).toBe(3);

            const vaultOrder = xdr.ScVal.scvMap([
                entry('amount', i128(1n)),
                entry('created_at', u64(2n)),
                entry('exec_fee', i128(5n)),
                entry('kind', xdr.ScVal.scvU32(1)),
                entry('min_out', i128(3n)),
            ]).toXDR('base64');
            const parsedVaultOrder = parsers.getVaultOrder(vaultOrder);
            expect(parsedVaultOrder.kind).toBe(VaultOrderKind.Redeem);
            expect(parsedVaultOrder.minOut).toBe(3n);
            expect(parsedVaultOrder.execFee).toBe(5n);

            const config = tradingConfigToScVal(makeConfig()).toXDR('base64');
            expect(parsers.getConfig(config)).toEqual(makeConfig());
        });
    });
});
