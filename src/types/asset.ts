import { Address } from '@stellar/stellar-sdk';

/**
 * Asset type representing either a Stellar token or an external asset
 */
export type Asset =
    | { tag: 'Stellar'; values: [Address | string] }
    | { tag: 'Other'; values: [string] };

/**
 * Get a unique string key for an asset (useful for Map keys)
 */
export function getAssetKey(asset: Asset): string {
    if (asset.tag === 'Stellar') {
        const address = asset.values[0];
        return `Stellar:${address instanceof Address ? address.toString() : address}`;
    } else {
        return `Other:${asset.values[0]}`;
    }
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
