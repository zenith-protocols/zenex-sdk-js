import { Address, rpc, xdr, scValToBigInt } from '@stellar/stellar-sdk';
import { Network } from '../index.ts';
import { Asset } from './trading_contract.js';
import { descale } from '../utils/scaling.js';
import { persistentLedgerKey } from '../ledger_entry_helper.js';
import { i128, u32, u64 } from '../index.ts';

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
     * Load a single trading position from the blockchain
     * @param network - The Stellar network to connect to
     * @param tradingId - The trading contract address
     * @param positionId - The position ID to load
     * @returns A new Position instance with current data, or null if not found
     */
    public static async load(
        network: Network,
        tradingId: string,
        positionId: number
    ): Promise<Position | null> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const key = persistentLedgerKey(tradingId, [
            xdr.ScVal.scvSymbol('Position'),
            xdr.ScVal.scvU32(positionId)
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return null;

            return Position.fromScVal(response.entries[0].val.contractData().val());
        } catch {
            return null;
        }
    }

    /**
     * Load multiple positions in a single RPC call
     * @param network - The Stellar network to connect to
     * @param tradingId - The trading contract address
     * @param positionIds - Array of position IDs to load
     * @returns Array of Position instances (only includes successfully loaded positions)
     */
    public static async loadMultiple(
        network: Network,
        tradingId: string,
        positionIds: number[]
    ): Promise<Position[]> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);
        const positions: Position[] = [];

        // Build keys for all positions
        const keys = positionIds.map(id =>
            persistentLedgerKey(tradingId, [
                xdr.ScVal.scvSymbol('Position'),
                xdr.ScVal.scvU32(id)
            ])
        );

        try {
            const response = await stellarRpc.getLedgerEntries(...keys);

            response.entries.forEach((entry) => {
                try {
                    const position = Position.fromScVal(entry.val.contractData().val());
                    positions.push(position);
                } catch (error) {
                    console.error('Failed to parse position:', error);
                }
            });
        } catch (error) {
            console.error('Failed to load positions:', error);
        }

        return positions;
    }

    /**
     * Load user's position IDs
     * @param network - The Stellar network to connect to
     * @param tradingId - The trading contract address
     * @param userId - The user's address
     * @returns Array of position IDs
     */
    public static async loadUserPositionIds(
        network: Network,
        tradingId: string,
        userId: string
    ): Promise<number[]> {
        const stellarRpc = new rpc.Server(network.rpc, network.opts);

        const key = persistentLedgerKey(tradingId, [
            xdr.ScVal.scvSymbol('UserPositions'),
            Address.fromString(userId).toScVal()
        ]);

        try {
            const response = await stellarRpc.getLedgerEntries(key);
            if (response.entries.length === 0) return [];

            const vec = response.entries[0].val.contractData().val().vec();
            if (!vec) return [];

            return vec.map(v => v.u32());
        } catch {
            return [];
        }
    }

    /**
     * Load all positions for a user
     * @param network - The Stellar network to connect to
     * @param tradingId - The trading contract address
     * @param userId - The user's address
     * @returns Array of Position instances
     */
    public static async loadUserPositions(
        network: Network,
        tradingId: string,
        userId: string
    ): Promise<Position[]> {
        const positionIds = await Position.loadUserPositionIds(network, tradingId, userId);
        return Position.loadMultiple(network, tradingId, positionIds);
    }

    /**
     * Parse Position from ScVal
     * @internal
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

    /**
     * Calculate the position size (notional value)
     */
    getNotionalValue(): number {
        return this.collateral * this.leverage;
    }

    /**
     * Check if position is active (open or pending)
     */
    isActive(): boolean {
        return this.status === PositionStatus.Open || this.status === PositionStatus.Pending;
    }

    /**
     * Check if position was closed by user or system
     */
    isClosed(): boolean {
        return !this.isActive() && this.status !== PositionStatus.Cancelled;
    }

    /**
     * Get human-readable position direction
     */
    getDirection(): string {
        return this.isLong ? 'Long' : 'Short';
    }

    /**
     * Format asset name for display
     */
    getAssetName(): string {
        if (this.asset.tag === 'Other') {
            return this.asset.values[0];
        } else if (this.asset.tag === 'Stellar') {
            return `Stellar:${this.asset.values[0]}`;
        }
        return 'Unknown';
    }
}
