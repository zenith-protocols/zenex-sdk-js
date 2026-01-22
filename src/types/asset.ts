import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Asset type representing either a Stellar token or an external asset
 */
export type Asset =
    | { tag: 'Stellar'; values: [Address | string] }
    | { tag: 'Other'; values: [string] };

/**
 * Convert an Asset to ScVal for contract calls
 */
export function assetToScVal(asset: Asset): xdr.ScVal {
    if (asset.tag === 'Stellar') {
        const address = asset.values[0] instanceof Address
            ? asset.values[0]
            : Address.fromString(asset.values[0]);

        return xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Stellar'),
            address.toScVal()
        ]);
    } else if (asset.tag === 'Other') {
        return xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Other'),
            xdr.ScVal.scvSymbol(asset.values[0])
        ]);
    }

    throw new Error('Invalid asset type');
}

/**
 * Parse an Asset from ScVal when reading from blockchain
 */
export function assetFromScVal(val: xdr.ScVal): Asset {
    const vec = val.vec();
    if (!vec || vec.length < 2) {
        throw new Error('Invalid asset ScVal: expected vec with at least 2 elements');
    }

    const tag = vec[0].sym().toString();
    if (tag === 'Stellar') {
        return {
            tag: 'Stellar',
            values: [Address.fromScVal(vec[1]).toString()]
        };
    } else if (tag === 'Other') {
        return {
            tag: 'Other',
            values: [vec[1].sym().toString()]
        };
    }

    throw new Error(`Invalid asset tag: ${tag}`);
}

/**
 * Get a unique string key for an asset (useful for Map keys)
 */
export function getAssetKey(asset: Asset): string {
    if (asset.tag === 'Stellar') {
        const address = asset.values[0];
        return address instanceof Address ? address.toString() : address;
    } else {
        return asset.values[0];
    }
}

/**
 * Parse an Asset from a key string (inverse of getAssetKey)
 */
export function assetFromKey(key: string): Asset {
    if (key.length === 56 && key.startsWith('C')) {
        return { tag: 'Stellar', values: [key] };
    }
    return { tag: 'Other', values: [key] };
}

/**
 * Get human-readable asset name
 */
export function getAssetName(asset: Asset): string {
    if (asset.tag === 'Other') {
        return asset.values[0];
    } else if (asset.tag === 'Stellar') {
        const address = asset.values[0];
        return `Stellar:${address instanceof Address ? address.toString() : address}`;
    }
    return 'Unknown';
}

/**
 * Check if two assets are equal
 */
export function assetsEqual(a: Asset, b: Asset): boolean {
    if (a.tag !== b.tag) return false;
    if (a.tag === 'Stellar' && b.tag === 'Stellar') {
        const aAddr = a.values[0] instanceof Address ? a.values[0].toString() : a.values[0];
        const bAddr = b.values[0] instanceof Address ? b.values[0].toString() : b.values[0];
        return aAddr === bAddr;
    }
    if (a.tag === 'Other' && b.tag === 'Other') {
        return a.values[0] === b.values[0];
    }
    return false;
}
