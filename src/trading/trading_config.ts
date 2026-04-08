import { Address, rpc, xdr, scValToNative, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../index.js';
import { ContractStatus } from './trading_contract.js';
import { toFloat } from '../math.js';
import { contractInstanceLedgerKey, decodeEntryKey, persistentLedgerKey } from '../ledger-keys.js';

// Trading configuration (matches Rust TradingConfig)
export interface TradingConfigData {
    callerRate: number;
    minNotional: number;
    maxNotional: number;
    feeDom: number;
    feeNonDom: number;
    maxUtil: number;
    rFunding: bigint;    // SCALAR_18
    rBase: bigint;       // SCALAR_18
    rVar: number;
}

// Full instance + persistent state from a single getLedgerEntries call
export interface TradingInstanceData {
    status: number;
    vault: string;
    token: string;
    treasury: string;
    priceVerifier: string;
    config: TradingConfigData;
    positionCounter: number;
    totalNotional: number;
    lastFundingUpdate: number;
    feedIds: number[];
}

/**
 * TradingConfig - Trading contract state loader
 *
 * Single getLedgerEntries call fetches instance storage + Markets persistent key.
 * Returns all config, addresses, counters, and the list of active feed IDs.
 * Use feedIds with Market.loadMultiple() to fetch market data separately.
 */
export class TradingConfig implements TradingInstanceData {
    status: number;
    vault: string;
    token: string;
    treasury: string;
    priceVerifier: string;
    config: TradingConfigData;
    positionCounter: number;
    totalNotional: number;
    lastFundingUpdate: number;
    feedIds: number[];
    contractId: string;

    constructor(data: TradingInstanceData, contractId: string) {
        this.status = data.status;
        this.vault = data.vault;
        this.token = data.token;
        this.treasury = data.treasury;
        this.priceVerifier = data.priceVerifier;
        this.config = data.config;
        this.positionCounter = data.positionCounter;
        this.totalNotional = data.totalNotional;
        this.lastFundingUpdate = data.lastFundingUpdate;
        this.feedIds = data.feedIds;
        this.contractId = contractId;
    }

    /**
     * Load full trading contract state in a single getLedgerEntries call.
     * Fetches instance storage (config, addresses, counters) and the
     * Markets persistent key (list of active feed IDs).
     */
    public static async load(
        network: Network,
        contractId: string
    ): Promise<TradingConfig> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const response = await stellarRpc.getLedgerEntries(
            contractInstanceLedgerKey(contractId),
            persistentLedgerKey(contractId, [xdr.ScVal.scvSymbol('Markets')]),
        );

        if (response.entries.length === 0) {
            throw new Error('Trading contract not found');
        }

        // Parse instance storage
        const contractInstance = response.entries[0].val.contractData().val().instance();
        const storage = contractInstance.storage();
        if (!storage) throw new Error('Trading instance storage is empty');

        const instanceData = TradingConfig.parseInstanceStorage(storage);

        // Parse feed IDs from Markets persistent key
        let feedIds: number[] = [];
        if (response.entries.length > 1) {
            const vec = response.entries[1].val.contractData().val().vec();
            if (vec) feedIds = vec.map(v => v.u32());
        }

        return new TradingConfig({ ...instanceData, feedIds }, contractId);
    }

    // === Parsers ===

    private static parseInstanceStorage(
        storage: xdr.ScMapEntry[]
    ): Omit<TradingInstanceData, 'feedIds'> {
        let status: number = 0;
        let vault: string | undefined;
        let token: string | undefined;
        let treasury: string | undefined;
        let priceVerifier: string | undefined;
        let config: TradingConfigData | undefined;
        let positionCounter: number = 0;
        let totalNotional: bigint = 0n;
        let lastFundingUpdate: bigint = 0n;

        for (const entry of storage) {
            const key = decodeEntryKey(entry.key());
            switch (key) {
                case 'Status':
                    status = scValToNative(entry.val()) as number;
                    break;
                case 'Vault':
                    vault = Address.fromScVal(entry.val()).toString();
                    break;
                case 'Token':
                    token = Address.fromScVal(entry.val()).toString();
                    break;
                case 'Treasury':
                    treasury = Address.fromScVal(entry.val()).toString();
                    break;
                case 'PriceVerifier':
                    priceVerifier = Address.fromScVal(entry.val()).toString();
                    break;
                case 'Config': {
                    const configMap = entry.val().map();
                    if (configMap) config = TradingConfig.parseConfig(configMap);
                    break;
                }
                case 'PositionCounter':
                    positionCounter = scValToNative(entry.val()) as number;
                    break;
                case 'TotalNotional':
                    totalNotional = scValToBigInt(entry.val());
                    break;
                case 'LastFundingUpdate':
                    lastFundingUpdate = scValToBigInt(entry.val());
                    break;
            }
        }

        if (!vault || !token || !treasury || !priceVerifier || !config) {
            throw new Error('Missing required trading configuration fields');
        }

        return {
            status, vault, token, treasury, priceVerifier, config,
            positionCounter,
            totalNotional: toFloat(totalNotional, 7),
            lastFundingUpdate: Number(lastFundingUpdate),
        };
    }

    private static parseConfig(configMap: xdr.ScMapEntry[]): TradingConfigData | undefined {
        let callerRate: bigint | undefined;
        let minNotional: bigint | undefined;
        let maxNotional: bigint | undefined;
        let feeDom: bigint | undefined;
        let feeNonDom: bigint | undefined;
        let maxUtil: bigint | undefined;
        let rFunding: bigint | undefined;
        let rBase: bigint | undefined;
        let rVar: bigint | undefined;

        for (const entry of configMap) {
            switch (entry.key().sym().toString()) {
                case 'caller_rate':  callerRate = scValToBigInt(entry.val()); break;
                case 'min_notional': minNotional = scValToBigInt(entry.val()); break;
                case 'max_notional': maxNotional = scValToBigInt(entry.val()); break;
                case 'fee_dom':      feeDom = scValToBigInt(entry.val()); break;
                case 'fee_non_dom':  feeNonDom = scValToBigInt(entry.val()); break;
                case 'max_util':     maxUtil = scValToBigInt(entry.val()); break;
                case 'r_funding':    rFunding = scValToBigInt(entry.val()); break;
                case 'r_base':       rBase = scValToBigInt(entry.val()); break;
                case 'r_var':        rVar = scValToBigInt(entry.val()); break;
            }
        }

        if (callerRate === undefined || minNotional === undefined ||
            maxNotional === undefined || feeDom === undefined ||
            feeNonDom === undefined || maxUtil === undefined ||
            rFunding === undefined || rBase === undefined ||
            rVar === undefined
        ) {
            return undefined;
        }

        return {
            callerRate: toFloat(callerRate, 7),
            minNotional: toFloat(minNotional, 7),
            maxNotional: toFloat(maxNotional, 7),
            feeDom: toFloat(feeDom, 7),
            feeNonDom: toFloat(feeNonDom, 7),
            maxUtil: toFloat(maxUtil, 7),
            rFunding, rBase,
            rVar: toFloat(rVar, 18),
        };
    }

    // === Accessors ===

    getStatus(): ContractStatus { return this.status as ContractStatus; }

    get callerRate(): number { return this.config.callerRate; }
    get minNotional(): number { return this.config.minNotional; }
    get maxNotional(): number { return this.config.maxNotional; }
    get feeDom(): number { return this.config.feeDom; }
    get feeNonDom(): number { return this.config.feeNonDom; }
    get maxUtil(): number { return this.config.maxUtil; }
    get rFunding(): bigint { return this.config.rFunding; }
    get rBase(): bigint { return this.config.rBase; }
    get rVar(): number { return this.config.rVar; }
}
