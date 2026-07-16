import { checkedI128, subI128 } from '../math/fixed.js';
import type { AccountFill } from './generated.js';

/**
 * Economic components required to derive exact net PnL from an account fill.
 *
 * The API field `AccountFill.pnlAtomic` maps to `grossPnl`; despite its shorter
 * wire name, it is not net of any fee or settlement component.
 */
export const ACCOUNT_FILL_NET_PNL_COMPONENTS = [
    'grossPnl',
    'baseFee',
    'impactFee',
    'funding',
    'borrowing',
    'liquidationFee',
    'forfeit',
    'keeperExecutionFee',
    'relayFee',
] as const;

export type AccountFillNetPnlComponent =
    (typeof ACCOUNT_FILL_NET_PNL_COMPONENTS)[number];

export type AccountFillNetPnlInput = Pick<
    AccountFill,
    'economicsCompleteness' | 'pnlAtomic' | 'fees'
>;

export type AccountFillNetPnlResult =
    | {
          readonly kind: 'exact';
          /** Gross fill PnL as supplied by `AccountFill.pnlAtomic`. */
          readonly grossPnlAtomic: bigint;
          /** Gross PnL minus every exact fill economic component. */
          readonly netPnlAtomic: bigint;
      }
    | {
          readonly kind: 'unavailable';
          readonly economicsCompleteness: AccountFill['economicsCompleteness'];
          /** Missing atomics in deterministic formula order. */
          readonly missingComponents: readonly AccountFillNetPnlComponent[];
      };

function checkedOptional(
    value: bigint | null,
    label: string,
    nonnegative: boolean,
): bigint | null {
    if (value === null) return null;
    const checked = checkedI128(value);
    if (nonnegative && checked < 0n) {
        throw new RangeError(`${label} must be nonnegative`);
    }
    return checked;
}

/**
 * Derive exact net PnL from a decoded account fill without manufacturing zero
 * values for unavailable economics.
 *
 * `AccountFill.pnlAtomic` is gross PnL. Net PnL is available only when the API
 * marks the economics complete and every component is present. Funding and
 * impact are signed: subtracting negative funding or impact credits the trader.
 * Bad debt is deliberately not part of trader net PnL, matching lifecycle
 * aggregation semantics.
 *
 * Every present amount and each arithmetic step must fit a signed i128. Fee,
 * borrowing, liquidation, forfeit, keeper-execution, and relay debits must be
 * nonnegative; violations throw instead of producing misleading financial data.
 */
export function deriveAccountFillNetPnl(
    input: AccountFillNetPnlInput,
): AccountFillNetPnlResult {
    const grossPnl = checkedOptional(input.pnlAtomic, 'gross PnL', false);
    const baseFee = checkedOptional(input.fees.baseAtomic, 'base fee', true);
    const impactFee = checkedOptional(
        input.fees.impactAtomic,
        'impact fee',
        false,
    );
    const funding = checkedOptional(input.fees.fundingAtomic, 'funding', false);
    const borrowing = checkedOptional(
        input.fees.borrowingAtomic,
        'borrowing fee',
        true,
    );
    const liquidationFee = checkedOptional(
        input.fees.liquidationAtomic,
        'liquidation fee',
        true,
    );
    const forfeit = checkedOptional(input.fees.forfeitAtomic, 'forfeit', true);
    const keeperExecutionFee = checkedOptional(
        input.fees.keeperExecutionAtomic,
        'keeper execution fee',
        true,
    );
    const relayFee = checkedOptional(input.fees.relayAtomic, 'relay fee', true);

    const missingComponents: AccountFillNetPnlComponent[] = [];
    if (grossPnl === null) missingComponents.push('grossPnl');
    if (baseFee === null) missingComponents.push('baseFee');
    if (impactFee === null) missingComponents.push('impactFee');
    if (funding === null) missingComponents.push('funding');
    if (borrowing === null) missingComponents.push('borrowing');
    if (liquidationFee === null) missingComponents.push('liquidationFee');
    if (forfeit === null) missingComponents.push('forfeit');
    if (keeperExecutionFee === null) {
        missingComponents.push('keeperExecutionFee');
    }
    if (relayFee === null) missingComponents.push('relayFee');

    if (
        input.economicsCompleteness !== 'complete' ||
        grossPnl === null ||
        baseFee === null ||
        impactFee === null ||
        funding === null ||
        borrowing === null ||
        liquidationFee === null ||
        forfeit === null ||
        keeperExecutionFee === null ||
        relayFee === null
    ) {
        return {
            kind: 'unavailable',
            economicsCompleteness: input.economicsCompleteness,
            missingComponents,
        };
    }

    const netPnlAtomic = [
        baseFee,
        impactFee,
        funding,
        borrowing,
        liquidationFee,
        forfeit,
        keeperExecutionFee,
        relayFee,
    ].reduce(subI128, grossPnl);

    return { kind: 'exact', grossPnlAtomic: grossPnl, netPnlAtomic };
}
