import { StrKey } from '@stellar/stellar-sdk';
import { checkedI128 } from '../math/fixed.js';

export interface RelayFeeToken {
    collateralAssetId: string;
    contractId: string;
    decimals: number;
    pricing: { kind: 'usdPeg'; numerator: '1'; denominator: '1' };
    minForwardChargeAtomic: string;
    maxSignedFeeAtomic: string;
}

export interface ExactRelayFeeToken extends Omit<
    RelayFeeToken,
    'minForwardChargeAtomic' | 'maxSignedFeeAtomic'
> {
    minForwardChargeAtomic: bigint;
    maxSignedFeeAtomic: bigint;
}

/** @internal Validate the immutable exact fee-token configuration. */
export function exactRelayFeeTokenIssue(
    token: ExactRelayFeeToken,
): string | undefined {
    if (
        !token ||
        typeof token !== 'object' ||
        typeof token.collateralAssetId !== 'string' ||
        token.collateralAssetId.length === 0 ||
        !StrKey.isValidContract(token.contractId)
    ) {
        return 'relay fee token identity is invalid';
    }
    if (
        !Number.isSafeInteger(token.decimals) ||
        token.decimals < 0 ||
        token.decimals > 38
    ) {
        return 'relay fee token decimals must be an integer from 0 through 38';
    }
    if (
        token.pricing?.kind !== 'usdPeg' ||
        token.pricing.numerator !== '1' ||
        token.pricing.denominator !== '1'
    ) {
        return 'relay fee token must use exact one-to-one USD-peg pricing';
    }

    try {
        const minimum = checkedI128(token.minForwardChargeAtomic);
        const maximum = checkedI128(token.maxSignedFeeAtomic);
        if (minimum < 0n || maximum <= 0n || minimum > maximum) {
            return 'relay fee token bounds are invalid';
        }
    } catch (error) {
        return error instanceof Error
            ? error.message
            : 'relay fee values are invalid';
    }
    return undefined;
}

/** @internal Clone config so an exact quote cannot be changed by caller mutation. */
export function cloneExactRelayFeeToken(
    token: ExactRelayFeeToken,
): ExactRelayFeeToken {
    return {
        collateralAssetId: token.collateralAssetId,
        contractId: token.contractId,
        decimals: token.decimals,
        pricing: {
            kind: 'usdPeg',
            numerator: '1',
            denominator: '1',
        },
        minForwardChargeAtomic: token.minForwardChargeAtomic,
        maxSignedFeeAtomic: token.maxSignedFeeAtomic,
    };
}
