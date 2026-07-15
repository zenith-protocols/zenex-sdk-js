import {
    Account,
    Address,
    BASE_FEE,
    rpc,
    TimeoutInfinite,
    TransactionBuilder,
    xdr,
} from '@stellar/stellar-sdk';
import { checkedI128 } from '../math/fixed.js';
import type { VerifiedPrice } from '../market/types.js';
import { exact, unavailable } from '../quote/result.js';
import type { QuoteResult, QuoteUnavailableCode } from '../quote/result.js';
import { PriceVerifierContract } from '../price-verifier/price_verifier_contract.js';
import { TradingRouterContract } from '../trading-router/router_contract.js';
import type { Call } from '../trading-router/router_types.js';
import { TreasuryContract } from '../treasury/treasury_contract.js';
import { VaultContract } from '../vault/vault_contract.js';
import type { VaultAtomicState } from '../vault/quote.js';
import type { Network } from '../index.js';
import { TradingContract } from './trading_contract.js';
import { Status } from './trading_types.js';
import type { MarketData, Position, TradingConfig } from './trading_types.js';

const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;
const MAX_DECIMALS_OFFSET = 10;
const EXPECTED_RESULT_COUNT = 16;
const SIMULATION_ACCOUNT =
    'GDMVSPSKEUOTRFSJH2SXVUNB2JGORKDTWBMOP5OZJZP4GKRQUQWFJO4Y';
const SIMULATION_SEQUENCE = '123';

export interface TradingDeployment {
    trading: string;
    router: string;
    vault: string;
    priceVerifier: string;
    treasury: string;
    feedId: number;
    exponent: number;
    vaultDecimalsOffset: number;
}

export interface TradingSnapshot {
    ledger: number;
    ledgerTime: bigint;
    deployment: TradingDeployment;
    status: Status;
    retirement: [bigint, bigint] | undefined;
    config: TradingConfig;
    market: MarketData;
    position: Position;
    price: VerifiedPrice;
    vault: VaultAtomicState;
    treasuryRate: bigint;
}

export interface TradingSnapshotRequest {
    network: Network;
    deployment: TradingDeployment;
    user: string;
    isLong: boolean;
    priceUpdate: Uint8Array;
    maxPriceAge: bigint;
}

class SnapshotUnavailableError extends Error {
    constructor(
        readonly code: QuoteUnavailableCode,
        reason: string,
    ) {
        super(reason);
    }
}

function viewCall(
    contract: string,
    func: string,
    args: xdr.ScVal[] = [],
): Call {
    return { contract, func, args };
}

function checkedU32(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `${label} must be a u32 safe integer`,
        );
    }
    return value;
}

function checkedU64(value: bigint, label: string): bigint {
    if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `${label} must be a u64 bigint`,
        );
    }
    return value;
}

function checkedContractAddress(value: string, label: string): string {
    try {
        const address = Address.fromString(value);
        if (
            address.toScAddress().switch() !==
            xdr.ScAddressType.scAddressTypeContract()
        ) {
            throw new Error('not a contract address');
        }
        return address.toString();
    } catch {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `${label} must be a valid contract address`,
        );
    }
}

function checkedUserAddress(value: string): string {
    try {
        return Address.fromString(value).toString();
    } catch {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'user must be a valid Stellar address',
        );
    }
}

function validateRequest(request: TradingSnapshotRequest): {
    deployment: TradingDeployment;
    user: string;
    maxPriceAge: bigint;
} {
    if (!request || typeof request !== 'object') {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'snapshot request must be an object',
        );
    }
    const source = request.deployment;
    if (!source || typeof source !== 'object') {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'deployment must be an object',
        );
    }
    if (!request.network || typeof request.network !== 'object') {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'network must be an object',
        );
    }
    if (typeof request.isLong !== 'boolean') {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'position side must be boolean',
        );
    }
    if (!(request.priceUpdate instanceof Uint8Array)) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'price update must be bytes',
        );
    }
    const feedId = checkedU32(source.feedId, 'feed id');
    if (
        !Number.isInteger(source.exponent) ||
        source.exponent < -18 ||
        source.exponent > 0
    ) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'price exponent must be between -18 and 0',
        );
    }
    if (
        !Number.isSafeInteger(source.vaultDecimalsOffset) ||
        source.vaultDecimalsOffset < 0 ||
        source.vaultDecimalsOffset > MAX_DECIMALS_OFFSET
    ) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            `vault decimals offset must be between 0 and ${MAX_DECIMALS_OFFSET}`,
        );
    }

    return {
        deployment: {
            trading: checkedContractAddress(source.trading, 'trading'),
            router: checkedContractAddress(source.router, 'router'),
            vault: checkedContractAddress(source.vault, 'vault'),
            priceVerifier: checkedContractAddress(
                source.priceVerifier,
                'price verifier',
            ),
            treasury: checkedContractAddress(source.treasury, 'treasury'),
            feedId,
            exponent: source.exponent,
            vaultDecimalsOffset: source.vaultDecimalsOffset,
        },
        user: checkedUserAddress(request.user),
        maxPriceAge: checkedU64(request.maxPriceAge, 'maximum price age'),
    };
}

function snapshotCalls(
    request: TradingSnapshotRequest,
    deployment: TradingDeployment,
    user: string,
): Call[] {
    return [
        viewCall(deployment.trading, 'get_config'),
        viewCall(deployment.trading, 'get_market_data'),
        viewCall(deployment.trading, 'get_position', [
            Address.fromString(user).toScVal(),
            xdr.ScVal.scvBool(request.isLong),
        ]),
        viewCall(deployment.trading, 'get_status'),
        viewCall(deployment.trading, 'get_retirement'),
        viewCall(deployment.trading, 'get_feed'),
        viewCall(deployment.trading, 'get_token'),
        viewCall(deployment.trading, 'get_vault'),
        viewCall(deployment.trading, 'get_treasury'),
        viewCall(deployment.trading, 'get_price_verifier'),
        viewCall(deployment.vault, 'total_assets'),
        viewCall(deployment.vault, 'total_supply'),
        viewCall(deployment.vault, 'query_asset'),
        viewCall(deployment.vault, 'get_strategy'),
        viewCall(deployment.treasury, 'get_rate'),
        viewCall(deployment.priceVerifier, 'verify_price', [
            xdr.ScVal.scvBytes(Buffer.from(request.priceUpdate)),
            xdr.ScVal.scvU32(deployment.feedId),
            xdr.ScVal.scvI32(deployment.exponent),
        ]),
    ];
}

function simulationTransaction(
    network: Network,
    router: string,
    calls: Call[],
) {
    const operation = new TradingRouterContract(router).multicallTry(calls);
    return new TransactionBuilder(
        new Account(SIMULATION_ACCOUNT, SIMULATION_SEQUENCE),
        {
            networkPassphrase: network.passphrase,
            fee: BASE_FEE,
            timebounds: { maxTime: TimeoutInfinite, minTime: 0 },
        },
    )
        .addOperation(xdr.Operation.fromXDR(operation, 'base64'))
        .build();
}

function simulationValues(
    simulation: rpc.Api.SimulateTransactionResponse,
): xdr.ScVal[] {
    if (
        rpc.Api.isSimulationRestore(simulation) ||
        !rpc.Api.isSimulationSuccess(simulation) ||
        !simulation.result?.retval
    ) {
        const reason = rpc.Api.isSimulationError(simulation)
            ? simulation.error
            : 'snapshot simulation did not return a value';
        throw new SnapshotUnavailableError('MISSING_STATE', reason);
    }
    const values = simulation.result.retval.vec();
    if (!values || values.length !== EXPECTED_RESULT_COUNT) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            `snapshot multicall must return ${EXPECTED_RESULT_COUNT} results`,
        );
    }
    return values;
}

function resultXdr(values: xdr.ScVal[], index: number): string {
    return values[index].toXDR('base64');
}

function requireSuccessfulCall(value: xdr.ScVal, label: string): void {
    if (value.switch() !== xdr.ScValType.scvError()) return;
    const error = value.error();
    const detail =
        error.switch() === xdr.ScErrorType.sceContract()
            ? ` with contract error #${error.contractCode()}`
            : '';
    throw new SnapshotUnavailableError(
        'MISSING_STATE',
        `${label} call failed${detail}`,
    );
}

function identityMismatch(label: string): never {
    throw new SnapshotUnavailableError(
        'INVALID_INPUT',
        `snapshot identity mismatch for single market: ${label}`,
    );
}

function sameIdentity(actual: string, expected: string, label: string): void {
    if (actual !== expected) identityMismatch(label);
}

function parseLedgerTime(value: string): bigint {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            'latest ledger close time is not a canonical integer',
        );
    }
    const timestamp = BigInt(value);
    if (timestamp > U64_MAX) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            'latest ledger close time exceeds u64',
        );
    }
    return timestamp;
}

function checkedStatus(value: number): Status {
    if (
        !Number.isInteger(value) ||
        value < Status.Active ||
        value > Status.Retired
    ) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            'snapshot contains an unknown market status',
        );
    }
    return value as Status;
}

function parseVerifiedPrice(result: string): VerifiedPrice {
    const raw = PriceVerifierContract.parsers.verifyPrice(result);
    return {
        feedId: checkedU32(raw.feed_id, 'verified feed id'),
        exponent: raw.exponent,
        bid: checkedI128(raw.bid),
        ask: checkedI128(raw.ask),
        publishTime: checkedU64(raw.publish_time, 'verified publish time'),
        source: 'pyth',
    };
}

function requirePriceIdentity(
    price: VerifiedPrice,
    deployment: TradingDeployment,
): void {
    if (
        price.feedId !== deployment.feedId ||
        price.exponent !== deployment.exponent
    ) {
        identityMismatch('verified feed');
    }
}

function pythPrice(
    price: VerifiedPrice,
    ledgerTime: bigint,
    maxPriceAge: bigint,
): VerifiedPrice {
    if (price.bid <= 0n || price.ask <= 0n || price.bid > price.ask) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'verified Pyth price must be positive uncrossed',
        );
    }
    if (price.publishTime > ledgerTime) {
        throw new SnapshotUnavailableError(
            'INVALID_INPUT',
            'verified Pyth price postdates the snapshot ledger',
        );
    }
    const age = ledgerTime - price.publishTime;
    if (age > maxPriceAge) {
        throw new SnapshotUnavailableError(
            'STALE_PRICE',
            `verified Pyth price is ${age} seconds old`,
        );
    }
    return price;
}

function decodeSnapshot(
    values: xdr.ScVal[],
    deployment: TradingDeployment,
    ledger: number,
    ledgerTime: bigint,
    maxPriceAge: bigint,
): TradingSnapshot {
    for (let index = 0; index < 15; index += 1) {
        requireSuccessfulCall(values[index], `snapshot state ${index}`);
    }
    const config = TradingContract.parsers.getConfig(resultXdr(values, 0));
    const market = TradingContract.parsers.getMarketData(resultXdr(values, 1));
    const position = TradingContract.parsers.getPosition(resultXdr(values, 2));
    const status = checkedStatus(
        TradingContract.parsers.getStatus(resultXdr(values, 3)),
    );
    const retirement = TradingContract.parsers.getRetirement(
        resultXdr(values, 4),
    );
    const feed = TradingContract.parsers.getFeed(resultXdr(values, 5));
    const collateral = TradingContract.parsers.getToken(resultXdr(values, 6));
    const vaultAddress = TradingContract.parsers.getVault(resultXdr(values, 7));
    const treasuryAddress = TradingContract.parsers.getTreasury(
        resultXdr(values, 8),
    );
    const verifierAddress = TradingContract.parsers.getPriceVerifier(
        resultXdr(values, 9),
    );
    const totalAssets = checkedI128(
        VaultContract.parsers.totalAssets(resultXdr(values, 10)),
    );
    const totalSupply = checkedI128(
        VaultContract.parsers.totalSupply(resultXdr(values, 11)),
    );
    const vaultAsset = VaultContract.parsers.queryAsset(resultXdr(values, 12));
    const vaultStrategy = VaultContract.parsers.getStrategy(
        resultXdr(values, 13),
    );
    const treasuryRate = checkedI128(
        TreasuryContract.parsers.getRate(resultXdr(values, 14)),
    );

    sameIdentity(vaultAddress, deployment.vault, 'vault address');
    sameIdentity(treasuryAddress, deployment.treasury, 'treasury address');
    sameIdentity(
        verifierAddress,
        deployment.priceVerifier,
        'price verifier address',
    );
    if (feed[0] !== deployment.feedId || feed[1] !== deployment.exponent) {
        identityMismatch('feed identity');
    }
    sameIdentity(collateral, vaultAsset, 'collateral mapping');
    sameIdentity(vaultStrategy, deployment.trading, 'vault strategy market');

    if (totalAssets < 0n || totalSupply < 0n || treasuryRate < 0n) {
        throw new SnapshotUnavailableError(
            'MISSING_STATE',
            'snapshot contains negative vault or treasury state',
        );
    }

    let price: VerifiedPrice;
    if (retirement && retirement[0] !== 0n) {
        const terminal = checkedI128(retirement[0]);
        if (terminal <= 0n) {
            throw new SnapshotUnavailableError(
                'MISSING_STATE',
                'terminal price must be positive',
            );
        }
        price = {
            feedId: deployment.feedId,
            exponent: deployment.exponent,
            bid: terminal,
            ask: terminal,
            publishTime: ledgerTime,
            source: 'terminal',
        };
    } else {
        requireSuccessfulCall(values[15], 'price verifier');
        const verifiedPrice = parseVerifiedPrice(resultXdr(values, 15));
        requirePriceIdentity(verifiedPrice, deployment);
        price = pythPrice(verifiedPrice, ledgerTime, maxPriceAge);
    }

    return {
        ledger,
        ledgerTime,
        deployment: { ...deployment },
        status,
        retirement,
        config,
        market,
        position,
        price,
        vault: {
            totalAssets,
            totalSupply,
            decimalsOffset: deployment.vaultDecimalsOffset,
        },
        treasuryRate,
    };
}

export async function loadTradingSnapshot(
    request: TradingSnapshotRequest,
): Promise<QuoteResult<TradingSnapshot>> {
    try {
        const validated = validateRequest(request);
        const server = new rpc.Server(
            request.network.rpc,
            request.network.opts,
        );
        const calls = snapshotCalls(
            request,
            validated.deployment,
            validated.user,
        );

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const header = await server.getLatestLedger();
            const simulation = await server.simulateTransaction(
                simulationTransaction(
                    request.network,
                    validated.deployment.router,
                    calls,
                ),
            );
            if (header.sequence !== simulation.latestLedger) {
                if (attempt === 0) continue;
                throw new SnapshotUnavailableError(
                    'INCONSISTENT_LEDGER',
                    `header ledger ${header.sequence} differs from simulation ledger ${simulation.latestLedger}`,
                );
            }
            const ledger = checkedU32(
                simulation.latestLedger,
                'simulation ledger',
            );
            const snapshot = decodeSnapshot(
                simulationValues(simulation),
                validated.deployment,
                ledger,
                parseLedgerTime(header.closeTime),
                validated.maxPriceAge,
            );
            return exact(snapshot, ledger, snapshot.price.publishTime);
        }

        throw new SnapshotUnavailableError(
            'INCONSISTENT_LEDGER',
            'snapshot ledgers remained inconsistent',
        );
    } catch (error) {
        if (error instanceof SnapshotUnavailableError) {
            return unavailable(error.code, error.message);
        }
        return unavailable(
            'MISSING_STATE',
            error instanceof Error ? error.message : 'snapshot load failed',
        );
    }
}
