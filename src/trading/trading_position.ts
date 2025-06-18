import { Address, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Asset } from './trading_contract.js';
import { descale } from '../utils/scaling.js';
import { i128, u32, u64 } from '../index.js';

export enum PositionStatus {
    Pending = 'Pending',
    Open = 'Open',
    UserClosed = 'UserClosed',
    StopLossClosed = 'StopLossClosed',
    TakeProfitClosed = 'TakeProfitClosed',
    Liquidated = 'Liquidated',
    Cancelled = 'Cancelled',
}

export class Position {
    constructor(
        public id: number,
        public user: string,
        public status: PositionStatus,
        public asset: Asset,
        public isLong: boolean,
        public stopLoss: number, // Price level
        public takeProfit: number, // Price level
        public entryPrice: number,
        public leverage: number, // Descaled (2.0 = 2x)
        public collateral: number,
        public positionIndex: bigint, // Keep as bigint
        public timestamp: number // Seconds
    ) { }

    /**
     * Parse Position from ScVal
     * @param val - The ScVal containing the position data
     * @returns The parsed Position
     */
    static fromScVal(val: xdr.ScVal): Position {
        const map = val.map();
        if (!map) {
            throw new Error('Invalid position data: expected map');
        }

        let id: u32 | undefined;
        let user: string | undefined;
        let status: PositionStatus | undefined;
        let asset: Asset | undefined;
        let isLong: boolean | undefined;
        let stopLoss: i128 | undefined;
        let takeProfit: i128 | undefined;
        let entryPrice: i128 | undefined;
        let leverage: u32 | undefined;
        let collateral: i128 | undefined;
        let positionIndex: i128 | undefined;
        let timestamp: u64 | undefined;

        map.forEach((entry) => {
            const key = entry.key().sym().toString();

            switch (key) {
                case 'id':
                    id = entry.val().u32();
                    break;

                case 'user':
                    user = Address.fromScVal(entry.val()).toString();
                    break;

                case 'status':
                    // Status is an enum - parse the variant
                    const statusVariant = entry.val().vec();
                    if (statusVariant && statusVariant.length > 0) {
                        const variantName = statusVariant[0].sym().toString();
                        status = variantName as PositionStatus;
                    }
                    break;

                case 'asset':
                    // Asset is an enum with Stellar or Other variant
                    const assetVariant = entry.val().vec();
                    if (assetVariant && assetVariant.length >= 2) {
                        const tag = assetVariant[0].sym().toString();
                        if (tag === 'Stellar') {
                            asset = {
                                tag: 'Stellar',
                                values: [Address.fromScVal(assetVariant[1]).toString()]
                            };
                        } else if (tag === 'Other') {
                            asset = {
                                tag: 'Other',
                                values: [assetVariant[1].sym().toString()]
                            };
                        }
                    }
                    break;

                case 'is_long':
                    isLong = entry.val().b();
                    break;

                case 'stop_loss':
                    stopLoss = scValToBigInt(entry.val());
                    break;

                case 'take_profit':
                    takeProfit = scValToBigInt(entry.val());
                    break;

                case 'entry_price':
                    entryPrice = scValToBigInt(entry.val());
                    break;

                case 'leverage':
                    leverage = entry.val().u32();
                    break;

                case 'collateral':
                    collateral = scValToBigInt(entry.val());
                    break;

                case 'position_index':
                    positionIndex = scValToBigInt(entry.val());
                    break;

                case 'timestamp':
                    timestamp = scValToBigInt(entry.val());
                    break;
            }
        });

        // Validate all required fields
        if (
            id === undefined ||
            user === undefined ||
            status === undefined ||
            asset === undefined ||
            isLong === undefined ||
            stopLoss === undefined ||
            takeProfit === undefined ||
            entryPrice === undefined ||
            leverage === undefined ||
            collateral === undefined ||
            positionIndex === undefined ||
            timestamp === undefined
        ) {
            throw new Error('Missing required position fields');
        }

        return new Position(
            Number(id!),
            user!,
            status!,
            asset!,
            isLong!,
            descale(stopLoss!, 7),
            descale(takeProfit!, 7),
            descale(entryPrice!, 7),
            Number(leverage!) / 100, // Convert 200 to 2.0
            descale(collateral!, 7),
            positionIndex!, // Keep as bigint
            Number(timestamp!)
        );
    }
}