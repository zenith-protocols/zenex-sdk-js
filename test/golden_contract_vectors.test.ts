import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    decodeGoldenInteger,
    loadGoldenCases,
    verifyGoldenFixture,
} from './helpers/golden.js';
import {
    assertApprovedContractsRoot,
    verifyVectorFile,
} from '../scripts/sync-contract-vectors.mjs';
import manifest from './fixtures/golden/manifest.json';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = '/home/robin/Zenith/Zenex/zenex-contracts-v2-platform';

const requiredCases = {
    fixed: [
        'fixed.factor_floor.exact',
        'fixed.factor_floor.positive_remainder',
        'fixed.factor_floor.negative_remainder',
        'fixed.factor_ceil.exact',
        'fixed.factor_ceil.positive_remainder',
        'fixed.factor_ceil.negative_remainder',
        'fixed.ratio_floor.one_third',
        'fixed.ratio_ceil.one_third',
        'fixed.factor_floor.i128_max_identity',
    ],
    capacity: [
        'capacity.reserve.long_ask_exact',
        'capacity.side.exact_boundary_pass',
        'capacity.side.one_atomic_over_reject',
    ],
    borrowing: [
        'borrowing.below_kink.linear',
        'borrowing.at_kink.linear',
        'borrowing.above_kink.ramp',
        'borrowing.full_utilization.cap',
        'borrowing.token_tie.both_sides',
    ],
    funding: [
        'funding.positive.longs_pay',
        'funding.negative.shorts_pay',
        'funding.growth.same_direction',
        'funding.direction.flip_to_longs',
    ],
    position: [
        'position.pnl.long_exit_floor',
        'position.pnl.short_exit_ceil',
        'position.increase.empty_book',
        'position.partial_decrease.flat',
        'position.full_close.flat',
        'position.full_close.underwater_forced',
        'position.full_close.underwater_voluntary_reject',
        'position.terminal_price.market_load',
    ],
    margin: [
        'margin.fixed_add.zero_notional',
        'margin.fixed_withdraw.below_accrued_debit',
        'margin.fixed_withdraw.equal_accrued_debit',
        'margin.fixed_withdraw.above_accrued_debit',
        'margin.max.initial_bound',
        'margin.max.maintenance_bound',
        'margin.max.both_bound',
        'margin.max.zero_withdrawable',
        'margin.max.accrued_fee',
        'margin.max.headroom_equals_debit',
        'margin.max.one_atomic_unit',
        'margin.max.dust_unorderable',
    ],
    vault: [
        'vault.deposit.one_to_one_mock',
        'vault.deposit.pnl_fee_settlement_success',
        'vault.deposit.min_out_one_atomic_over_reject',
        'vault.deposit.cap_one_atomic_over_reject',
        'vault.redeem.pnl_fee_settlement_success',
        'vault.utilization.exact_boundary_pass',
        'vault.utilization.one_atomic_over_reject',
        'vault.pending_pnl.exact_boundary_pass',
        'vault.pending_pnl.one_atomic_over_reject',
    ],
    shares: [
        'strategy_vault.deposit.bootstrap.offset_zero',
        'strategy_vault.deposit.bootstrap.offset_three',
        'strategy_vault.deposit.pending.profit',
        'strategy_vault.deposit.pending.loss',
        'strategy_vault.deposit.profit.equals_assets',
        'strategy_vault.deposit.profit.exceeds_assets',
        'strategy_vault.deposit.input.zero',
        'strategy_vault.deposit.input.negative',
        'strategy_vault.deposit.i128.widened_identity',
        'strategy_vault.deposit.i128.result_overflow',
        'strategy_vault.redeem.raw_price',
        'strategy_vault.redeem.pending.profit',
        'strategy_vault.redeem.pending_loss.one_atom_floor',
        'strategy_vault.redeem.pending_loss.remainder_one',
        'strategy_vault.redeem.input.zero',
        'strategy_vault.redeem.input.negative',
        'strategy_vault.redeem.profit.exceeds_assets',
    ],
} as const;

describe('contract-owned golden vectors', () => {
    it('vendors the exact contract-owned bytes and provenance', async () => {
        const result = await verifyGoldenFixture();

        expect(result).toEqual({
            contractsCommit: '4c631eb17af53ec5e6875f42bf71a43af295e521',
            artifacts: {
                trading: { groups: ['fixed', 'capacity', 'borrowing', 'funding', 'position', 'margin', 'vault'] },
                strategyVault: { groups: ['shares'] },
            },
        });
        for (const filename of ['trading-v2.json', 'strategy-vault-v2.json']) {
            expect(readFileSync(`${repoRoot}/test/fixtures/golden/${filename}`))
                .toEqual(readFileSync(`${sourceRoot}/test-vectors/${filename}`));
        }
    });

    it.each([
        ['trading', 'fixed'],
        ['trading', 'capacity'],
        ['trading', 'borrowing'],
        ['trading', 'funding'],
        ['trading', 'position'],
        ['trading', 'margin'],
        ['trading', 'vault'],
        ['strategyVault', 'shares'],
    ] as const)('contains the complete required %s/%s case set', (artifact, group) => {
        const cases = loadGoldenCases(artifact, group);

        expect(cases.map((entry) => entry.id)).toEqual(requiredCases[group]);
        expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
        expect(cases.every((entry) => entry.artifact === artifact && entry.group === group)).toBe(true);
    });

    it('decodes every canonical integer leaf to bigint without IEEE-754 loss', () => {
        const [boundary] = loadGoldenCases('trading', 'fixed').filter(
            (entry) => entry.id === 'fixed.factor_floor.i128_max_identity',
        );
        const inputs = boundary.inputs as Record<string, unknown>;
        const expected = boundary.expected as Record<string, unknown>;

        expect(inputs.amount).toBe(170141183460469231731687303715884105727n);
        expect(expected.value).toBe(170141183460469231731687303715884105727n);
        expect(decodeGoldenInteger('-9007199254740993')).toBe(-9007199254740993n);
        expect(() => decodeGoldenInteger('1.5')).toThrow(/canonical decimal integer/);
        expect(() => decodeGoldenInteger('01')).toThrow(/canonical decimal integer/);
    });

    it('rejects the obsolete contracts checkout as a vector source', () => {
        expect(() => assertApprovedContractsRoot('/home/robin/Zenith/Zenex/zenex-contracts'))
            .toThrow(/obsolete contracts checkout/);
    });

    it('detects any mutation of a copied vector byte', () => {
        const tempRoot = mkdtempSync(resolve(tmpdir(), 'zenex-vector-mutation-'));
        const vector = manifest.vectors.find((entry) => entry.path.endsWith('/trading-v2.json'));
        if (!vector) throw new Error('trading vector manifest entry is missing');
        const source = `${sourceRoot}/${vector.path}`;
        const copy = resolve(tempRoot, 'trading-v2.json');

        try {
            cpSync(source, copy);
            expect(() => verifyVectorFile(copy, vector)).not.toThrow();
            const bytes = readFileSync(copy);
            bytes[bytes.length - 2] ^= 1;
            writeFileSync(copy, bytes);
            expect(() => verifyVectorFile(copy, vector)).toThrow(/SHA-256/);
        } finally {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });
});
