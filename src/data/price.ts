/** Maximum public update accepted for strict fill authorization discovery. */
export const MAX_SIGNED_PRICE_UPDATE_BYTES = 32 * 1024;

const MAX_SIGNED_PRICE_UPDATE_BASE64_LENGTH =
    4 * Math.ceil(MAX_SIGNED_PRICE_UPDATE_BYTES / 3);
const CANONICAL_BASE64 =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Decode the `signedUpdate` returned by `getLatestPrice` without moving
 * base64 or Pyth wire handling into an application.
 */
export function decodeLatestPriceUpdate(signedUpdate: string): Uint8Array {
    if (
        typeof signedUpdate !== 'string' ||
        signedUpdate.length === 0 ||
        signedUpdate.length % 4 !== 0 ||
        !CANONICAL_BASE64.test(signedUpdate)
    ) {
        throw new TypeError(
            'signed price update must be nonempty canonical padded base64',
        );
    }
    if (signedUpdate.length > MAX_SIGNED_PRICE_UPDATE_BASE64_LENGTH) {
        throw new TypeError('signed price update exceeds the 32 KiB limit');
    }

    const decoded = Buffer.from(signedUpdate, 'base64');
    if (
        decoded.byteLength === 0 ||
        decoded.byteLength > MAX_SIGNED_PRICE_UPDATE_BYTES
    ) {
        throw new TypeError('signed price update exceeds the 32 KiB limit');
    }
    if (decoded.toString('base64') !== signedUpdate) {
        throw new TypeError('signed price update must use canonical base64');
    }
    return Uint8Array.from(decoded);
}
