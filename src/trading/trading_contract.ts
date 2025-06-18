import { Address, Contract, contract } from '@stellar/stellar-sdk';
import { i128, u32, u64 } from '../index.js';

// @dev ENCODING REQUIRES PROPERTY NAMES TO MATCH RUST NAMES

export type Asset =
    | { tag: 'Stellar'; values: [Address | string] }
    | { tag: 'Other'; values: [string] };

export interface MarketConfig {
    enabled: boolean;
    max_leverage: u32;
    max_payout: i128;
    min_collateral: i128;
    max_collateral: i128;
    liquidation_threshold: i128;
    total_available: i128;
    base_fee: i128;
    price_impact_scalar: i128;
    min_hourly_rate: i128;
    max_hourly_rate: i128;
    target_hourly_rate: i128;
    target_utilization: i128;
}


export interface Request {
    action: RequestType;
    position: u32;
}

export enum RequestType {
    Close = 0,
    Fill = 1,
    StopLoss = 2,
    TakeProfit = 3,
    Liquidation = 4,
    Cancel = 5,
}

export interface OpenPositionArgs {
    user: Address | string;
    asset: Asset;
    collateral: i128;
    leverage: u32;
    is_long: boolean;
    entry_price: i128;
}

export interface ModifyRiskArgs {
    position_id: u32;
    stop_loss: i128;
    take_profit: i128;
}

export interface SubmitArgs {
    caller: Address | string;
    request: Request[];
}

export interface UpdateConfigArgs {
    oracle: Address | string;
    caller_take_rate: i128;
    max_positions: u32;
}

export interface QueueSetMarketArgs {
    asset: Asset;
    config: MarketConfig;
}

export class TradingContract extends Contract {

    static spec: contract.Spec = new contract.Spec(["AAAABAAAAAAAAAAAAAAADFRyYWRpbmdFcnJvcgAAAAYAAAAAAAAAClN0YWxlUHJpY2UAAAAAAAoAAAAAAAAAB05vUHJpY2UAAAAACwAAAAAAAAALTm90VW5sb2NrZWQAAAAAQgAAAAAAAAANSW52YWxpZENvbmZpZwAAAAAAAEMAAAAAAAAADE1heFBvc2l0aW9ucwAAAEQAAAAAAAAACkJhZFJlcXVlc3QAAAAAABQ=",
        "AAAAAgAAAAAAAAAAAAAADlRyYWRpbmdEYXRhS2V5AAAAAAAFAAAAAQAAAAAAAAAMTWFya2V0Q29uZmlnAAAAAQAAB9AAAAAFQXNzZXQAAAAAAAABAAAAAAAAAApNYXJrZXRJbml0AAAAAAABAAAH0AAAAAVBc3NldAAAAAAAAAEAAAAAAAAACk1hcmtldERhdGEAAAAAAAEAAAfQAAAABUFzc2V0AAAAAAAAAQAAAAAAAAANVXNlclBvc2l0aW9ucwAAAAAAAAEAAAATAAAAAQAAAAAAAAAIUG9zaXRpb24AAAABAAAABA==",
        "AAAAAAAAADdDb25zdHJ1Y3RvciBmb3IgaW5pdGlhbGl6aW5nIHRoZSBjb250cmFjdCB3aGVuIGRlcGxveWVkAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAZvcmFjbGUAAAAAABMAAAAAAAAAEGNhbGxlcl90YWtlX3JhdGUAAAALAAAAAAAAAA1tYXhfcG9zaXRpb25zAAAAAAAABAAAAAA=",
        "AAAAAAAAAAAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAJc2V0X3ZhdWx0AAAAAAAAAQAAAAAAAAAFdmF1bHQAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAANdXBkYXRlX2NvbmZpZwAAAAAAAAMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAAAAAAQY2FsbGVyX3Rha2VfcmF0ZQAAAAsAAAAAAAAADW1heF9wb3NpdGlvbnMAAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAQcXVldWVfc2V0X21hcmtldAAAAAIAAAAAAAAABWFzc2V0AAAAAAAH0AAAAAVBc3NldAAAAAAAAAAAAAAGY29uZmlnAAAAAAfQAAAADE1hcmtldENvbmZpZwAAAAA=",
        "AAAAAAAAAAAAAAAKc2V0X21hcmtldAAAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAfQAAAABUFzc2V0AAAAAAAAAA==",
        "AAAAAAAAAAAAAAAKc2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAANb3Blbl9wb3NpdGlvbgAAAAAAAAYAAAAAAAAABHVzZXIAAAATAAAAAAAAAAVhc3NldAAAAAAAB9AAAAAFQXNzZXQAAAAAAAAAAAAACmNvbGxhdGVyYWwAAAAAAAsAAAAAAAAACGxldmVyYWdlAAAABAAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAAtlbnRyeV9wcmljZQAAAAALAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAALbW9kaWZ5X3Jpc2sAAAAAAwAAAAAAAAALcG9zaXRpb25faWQAAAAABAAAAAAAAAAJc3RvcF9sb3NzAAAAAAAACwAAAAAAAAALdGFrZV9wcm9maXQAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAAGc3VibWl0AAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACHJlcXVlc3RzAAAD6gAAB9AAAAAHUmVxdWVzdAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAAMdXBncmFkZV93YXNtAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAQAAAAAAAAAAAAAABk1hcmtldAAAAAAAAwAAAAAAAAAFYXNzZXQAAAAAAAfQAAAABUFzc2V0AAAAAAAAAAAAAAZjb25maWcAAAAAB9AAAAAMTWFya2V0Q29uZmlnAAAAAAAAAARkYXRhAAAH0AAAAApNYXJrZXREYXRhAAA=",
        "AAAAAQAAAAAAAAAAAAAAB1JlcXVlc3QAAAAAAgAAAAAAAAAGYWN0aW9uAAAAAAfQAAAAC1JlcXVlc3RUeXBlAAAAAAAAAAAIcG9zaXRpb24AAAAE",
        "AAAAAwAAAC9UaGUgdHlwZSBvZiByZXF1ZXN0IHRvIGJlIG1hZGUgYWdhaW5zdCB0aGUgcG9vbAAAAAAAAAAAC1JlcXVlc3RUeXBlAAAAAAYAAAAAAAAABUNsb3NlAAAAAAAAAAAAAAAAAAAERmlsbAAAAAEAAAAAAAAACFN0b3BMb3NzAAAAAgAAAAAAAAAKVGFrZVByb2ZpdAAAAAAAAwAAAAAAAAALTGlxdWlkYXRpb24AAAAABAAAAAAAAAAGQ2FuY2VsAAAAAAAF",
        "AAAAAQAAAAAAAAAAAAAADVRyYWRpbmdDb25maWcAAAAAAAAEAAAAAAAAABBjYWxsZXJfdGFrZV9yYXRlAAAACwAAAAAAAAANbWF4X3Bvc2l0aW9ucwAAAAAAAAQAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAAE",
        "AAAAAgAAAA9Qb3NpdGlvbiBzdGF0dXMAAAAAAAAAAA5Qb3NpdGlvblN0YXR1cwAAAAAABwAAAAAAAAAAAAAAB1BlbmRpbmcAAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAAClVzZXJDbG9zZWQAAAAAAAAAAAAAAAAADlN0b3BMb3NzQ2xvc2VkAAAAAAAAAAAAAAAAABBUYWtlUHJvZml0Q2xvc2VkAAAAAAAAAAAAAAAKTGlxdWlkYXRlZAAAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAAAAAAAAAAAAADE1hcmtldENvbmZpZwAAAA0AAAAAAAAACGJhc2VfZmVlAAAACwAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAAAAABVsaXF1aWRhdGlvbl90aHJlc2hvbGQAAAAAAAALAAAAAAAAAA5tYXhfY29sbGF0ZXJhbAAAAAAACwAAAAAAAAAPbWF4X2hvdXJseV9yYXRlAAAAAAsAAAAAAAAADG1heF9sZXZlcmFnZQAAAAQAAAAAAAAACm1heF9wYXlvdXQAAAAAAAsAAAAAAAAADm1pbl9jb2xsYXRlcmFsAAAAAAALAAAAAAAAAA9taW5faG91cmx5X3JhdGUAAAAACwAAAAAAAAATcHJpY2VfaW1wYWN0X3NjYWxhcgAAAAALAAAAAAAAABJ0YXJnZXRfaG91cmx5X3JhdGUAAAAAAAsAAAAAAAAAEnRhcmdldF91dGlsaXphdGlvbgAAAAAACwAAAAAAAAAPdG90YWxfYXZhaWxhYmxlAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAAEFF1ZXVlZE1hcmtldEluaXQAAAACAAAAAAAAAAZjb25maWcAAAAAB9AAAAAMTWFya2V0Q29uZmlnAAAAAAAAAAt1bmxvY2tfdGltZQAAAAAG",
        "AAAAAQAAAAAAAAAAAAAACk1hcmtldERhdGEAAAAAAAkAAAAAAAAAC2xhc3RfdXBkYXRlAAAAAAYAAAAAAAAADWxvbmdfYm9ycm93ZWQAAAAAAAALAAAAAAAAAA9sb25nX2NvbGxhdGVyYWwAAAAACwAAAAAAAAAKbG9uZ19jb3VudAAAAAAABAAAAAAAAAATbG9uZ19pbnRlcmVzdF9pbmRleAAAAAALAAAAAAAAAA5zaG9ydF9ib3Jyb3dlZAAAAAAACwAAAAAAAAAQc2hvcnRfY29sbGF0ZXJhbAAAAAsAAAAAAAAAC3Nob3J0X2NvdW50AAAAAAQAAAAAAAAAFHNob3J0X2ludGVyZXN0X2luZGV4AAAACw==",
        "AAAAAQAAAC9TdHJ1Y3R1cmUgdG8gc3RvcmUgaW5mb3JtYXRpb24gYWJvdXQgYSBwb3NpdGlvbgAAAAAAAAAACFBvc2l0aW9uAAAADAAAAAAAAAAFYXNzZXQAAAAAAAfQAAAABUFzc2V0AAAAAAAAAAAAAApjb2xsYXRlcmFsAAAAAAALAAAAAAAAAAtlbnRyeV9wcmljZQAAAAALAAAAAAAAAAJpZAAAAAAABAAAAAAAAAAHaXNfbG9uZwAAAAABAAAAAAAAAAhsZXZlcmFnZQAAAAQAAAAAAAAADnBvc2l0aW9uX2luZGV4AAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAOUG9zaXRpb25TdGF0dXMAAAAAAAAAAAAJc3RvcF9sb3NzAAAAAAAACwAAAAAAAAALdGFrZV9wcm9maXQAAAAACwAAAAAAAAAJdGltZXN0YW1wAAAAAAAABgAAAAAAAAAEdXNlcgAAABM=",
        "AAAAAQAAAC9QcmljZSBkYXRhIGZvciBhbiBhc3NldCBhdCBhIHNwZWNpZmljIHRpbWVzdGFtcAAAAAAAAAAACVByaWNlRGF0YQAAAAAAAAIAAAAAAAAABXByaWNlAAAAAAAACwAAAAAAAAAJdGltZXN0YW1wAAAAAAAABg==",
        "AAAAAgAAAApBc3NldCB0eXBlAAAAAAAAAAAABUFzc2V0AAAAAAAAAgAAAAEAAAAAAAAAB1N0ZWxsYXIAAAAAAQAAABMAAAABAAAAAAAAAAVPdGhlcgAAAAAAAAEAAAAR"]);

    // Result parsers for contract functions
    static readonly parsers = {
        // Parse position ID from open_position result
        openPosition: (result: string): u32 =>
            TradingContract.spec.funcResToNative('open_position', result),

        // Parse fee amount from submit result
        submit: (result: string): i128 =>
            TradingContract.spec.funcResToNative('submit', result),

        // Add more parsers as needed for other functions that return values
    };

    /**
     * (Admin only) Propose a new admin for the trading contract.
     * @param new_admin - The address of the proposed new admin.
     * @returns A base64-encoded string representing the operation.
     */
    proposeAdmin(new_admin: Address | string): string {
        return this.call(
            'propose_admin',
            ...TradingContract.spec.funcArgsToScVals('propose_admin', { new_admin })
        ).toXDR('base64');
    }

    /**
     * (Proposed admin only) Accept the admin role.
     * @returns A base64-encoded string representing the operation.
     */
    acceptAdmin(): string {
        return this.call(
            'accept_admin',
            ...TradingContract.spec.funcArgsToScVals('accept_admin', {})
        ).toXDR('base64');
    }

    /**
     * (Admin only) Set the vault address for the trading contract.
     * @param vault - The vault address.
     * @returns A base64-encoded string representing the operation.
     */
    setVault(vault: Address | string): string {
        return this.call(
            'set_vault',
            ...TradingContract.spec.funcArgsToScVals('set_vault', { vault })
        ).toXDR('base64');
    }

    /**
     * (Admin only) Update the trading configuration.
     * @param contractArgs - The configuration arguments.
     * @returns A base64-encoded string representing the operation.
     */
    updateConfig(contractArgs: UpdateConfigArgs): string {
        return this.call(
            'update_config',
            ...TradingContract.spec.funcArgsToScVals('update_config', contractArgs)
        ).toXDR('base64');
    }

    /**
     * (Admin only) Queue setting data for a market.
     * @param contractArgs - The market configuration arguments.
     * @returns A base64-encoded string representing the operation.
     */
    queueSetMarket(contractArgs: QueueSetMarketArgs): string {
        return this.call(
            'queue_set_market',
            ...TradingContract.spec.funcArgsToScVals('queue_set_market', contractArgs)
        ).toXDR('base64');
    }

    /**
     * Execute the queued set of a market.
     * @param asset - The asset to set as a market.
     * @returns A base64-encoded string representing the operation.
     */
    setMarket(asset: Asset): string {
        return this.call(
            'set_market',
            ...TradingContract.spec.funcArgsToScVals('set_market', { asset })
        ).toXDR('base64');
    }

    /**
     * (Admin only) Set the status of the trading contract.
     * @param status - The new status code.
     * @returns A base64-encoded string representing the operation.
     */
    setStatus(status: u32): string {
        return this.call(
            'set_status',
            ...TradingContract.spec.funcArgsToScVals('set_status', { status })
        ).toXDR('base64');
    }

    /**
     * Open a new position.
     * @param contractArgs - The position opening arguments.
     * @returns A base64-encoded string representing the operation.
     */
    openPosition(contractArgs: OpenPositionArgs): string {
        return this.call(
            'open_position',
            ...TradingContract.spec.funcArgsToScVals('open_position', contractArgs)
        ).toXDR('base64');
    }

    /**
     * Modify position risk parameters.
     * @param contractArgs - The risk modification arguments.
     * @returns A base64-encoded string representing the operation.
     */
    modifyRisk(contractArgs: ModifyRiskArgs): string {
        return this.call(
            'modify_risk',
            ...TradingContract.spec.funcArgsToScVals('modify_risk', contractArgs)
        ).toXDR('base64');
    }

    /**
     * Submit a batch of trading actions.
     * @param contractArgs - The submit arguments including caller and requests.
     * @returns A base64-encoded string representing the operation.
     */
    submit(contractArgs: SubmitArgs): string {
        return this.call(
            'submit',
            ...TradingContract.spec.funcArgsToScVals('submit', contractArgs)
        ).toXDR('base64');
    }
}