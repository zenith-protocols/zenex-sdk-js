import { describe, it, expect } from 'vitest';
import { Address, StrKey, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { instanceStorage } from '../../src/contracts/instance.js';
import {
    parseTreasuryInstance,
    parseTreasuryRate,
} from '../../src/contracts/treasury/treasury_instance.js';
import { parseOracleInstance } from '../../src/contracts/oracle/oracle_instance.js';
import { parseFactoryInstance } from '../../src/contracts/factory/factory_instance.js';
import { parseGovernanceInstance } from '../../src/contracts/governance/governance_instance.js';
import {
    contractInstance,
    treasuryInstanceScVal,
    unitKey,
} from '../helpers/trading_state.js';

const OWNER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 5));
const addr = (id: string) => Address.fromString(id).toScVal();
const sym = (name: string) => xdr.ScVal.scvSymbol(name);
const u64 = (v: bigint) => nativeToScVal(v, { type: 'u64' });
const i128 = (v: bigint) => nativeToScVal(v, { type: 'i128' });

describe('instanceStorage', () => {
    it('indexes both key shapes a contract produces', () => {
        // A `#[contracttype]` enum variant is a ScVec[Symbol]; the treasury and
        // factory instead use a bare Symbol.
        const value = contractInstance([
            new xdr.ScMapEntry({ key: unitKey('Variant'), val: xdr.ScVal.scvU32(1) }),
            new xdr.ScMapEntry({ key: sym('Bare'), val: xdr.ScVal.scvU32(2) }),
        ]);
        expect(instanceStorage(value, 'test').keys().sort()).toEqual(['Bare', 'Variant']);
    });

    it('rejects a value that is not a contract instance', () => {
        expect(() => instanceStorage(xdr.ScVal.scvU32(1), 'test')).toThrow(
            /contract-instance/,
        );
    });

    it('ignores a key shape it does not understand rather than failing the read', () => {
        const value = contractInstance([
            new xdr.ScMapEntry({ key: xdr.ScVal.scvU32(9), val: xdr.ScVal.scvU32(1) }),
            new xdr.ScMapEntry({ key: sym('Kept'), val: xdr.ScVal.scvU32(2) }),
        ]);
        expect(instanceStorage(value, 'test').keys()).toEqual(['Kept']);
    });

    it('reads an optional address, undefined when the slot is unset', () => {
        const withOwner = contractInstance([
            new xdr.ScMapEntry({ key: unitKey('Owner'), val: addr(OWNER) }),
        ]);
        expect(instanceStorage(withOwner, 'test').optionalAddress('Owner')).toBe(OWNER);
        expect(
            instanceStorage(contractInstance([]), 'test').optionalAddress('Owner'),
        ).toBeUndefined();
    });

    it('names the contract in a missing-key error, so call sites need not', () => {
        expect(() => instanceStorage(contractInstance([]), 'oracle').require('Verifier'))
            .toThrow('oracle instance is missing Verifier');
        expect(() => instanceStorage(contractInstance([]), 'oracle').address('Verifier'))
            .toThrow('oracle instance is missing Verifier');
    });
});

describe('parseTreasuryInstance', () => {
    it('reads the bare Symbol("Rate") alongside the OZ Owner, from one entry', () => {
        const rate = 5n * 10n ** 16n;
        const state = parseTreasuryInstance(treasuryInstanceScVal(rate, OWNER));
        expect(state.rate).toBe(rate);
        expect(state.owner).toBe(OWNER);
    });

    it('defaults the rate to 0, matching the contract get_rate default', () => {
        expect(parseTreasuryInstance(treasuryInstanceScVal()).rate).toBe(0n);
        expect(parseTreasuryInstance(contractInstance([])).rate).toBe(0n);
    });

    it('keeps parseTreasuryRate as the rate-only view', () => {
        const rate = 42n * 10n ** 15n;
        expect(parseTreasuryRate(treasuryInstanceScVal(rate, OWNER))).toBe(rate);
    });
});

describe('parseOracleInstance', () => {
    const full = () =>
        contractInstance([
            new xdr.ScMapEntry({ key: unitKey('Verifier'), val: addr(VERIFIER) }),
            new xdr.ScMapEntry({ key: unitKey('TradeStaleness'), val: u64(10n) }),
            new xdr.ScMapEntry({ key: unitKey('CloseStaleness'), val: u64(60n) }),
            new xdr.ScMapEntry({
                key: unitKey('SpreadReductionFactor'),
                val: i128(10n ** 17n),
            }),
            new xdr.ScMapEntry({ key: unitKey('Owner'), val: addr(OWNER) }),
        ]);

    it('replaces four getter simulations with one entry read', () => {
        const state = parseOracleInstance(full());
        expect(state.verifier).toBe(VERIFIER);
        expect(state.tradeStaleness).toBe(10n);
        expect(state.closeStaleness).toBe(60n);
        expect(state.spreadReductionFactor).toBe(10n ** 17n);
        expect(state.owner).toBe(OWNER);
    });

    it('throws when a required key is absent', () => {
        expect(() => parseOracleInstance(contractInstance([]))).toThrow(
            /missing Verifier/,
        );
    });
});

describe('parseFactoryInstance', () => {
    it('reads InitMeta from its bare Symbol key, plus the owner', () => {
        const meta = xdr.ScVal.scvMap(
            [
                ['oracle', addr(VERIFIER)],
                ['token', addr(VERIFIER)],
                ['trading_hash', xdr.ScVal.scvBytes(Buffer.alloc(32, 1))],
                ['treasury', addr(VERIFIER)],
                ['vault_hash', xdr.ScVal.scvBytes(Buffer.alloc(32, 2))],
            ]
                .sort((a, b) => (a[0] as string).localeCompare(b[0] as string))
                .map(
                    ([k, v]) =>
                        new xdr.ScMapEntry({ key: sym(k as string), val: v as xdr.ScVal }),
                ),
        );
        const state = parseFactoryInstance(
            contractInstance([
                new xdr.ScMapEntry({ key: sym('InitMeta'), val: meta }),
                new xdr.ScMapEntry({ key: unitKey('Owner'), val: addr(OWNER) }),
            ]),
        );
        expect(state.owner).toBe(OWNER);
        expect(state.initMeta).toMatchObject({ oracle: VERIFIER, treasury: VERIFIER });
    });

    it('throws when InitMeta is absent', () => {
        expect(() => parseFactoryInstance(contractInstance([]))).toThrow(
            /missing InitMeta/,
        );
    });
});

describe('parseGovernanceInstance', () => {
    it('reads the timelock delay and next nonce, plus the owner', () => {
        const state = parseGovernanceInstance(
            contractInstance([
                new xdr.ScMapEntry({ key: unitKey('Delay'), val: u64(86_400n) }),
                new xdr.ScMapEntry({
                    key: unitKey('Nonce'),
                    val: nativeToScVal(4, { type: 'u32' }),
                }),
                new xdr.ScMapEntry({ key: unitKey('Owner'), val: addr(OWNER) }),
            ]),
        );
        expect(state.delay).toBe(86_400n);
        expect(state.nonce).toBe(4);
        expect(state.owner).toBe(OWNER);
    });

    it('defaults the nonce to 0, matching next_nonce unwrap_or(0)', () => {
        const state = parseGovernanceInstance(
            contractInstance([
                new xdr.ScMapEntry({ key: unitKey('Delay'), val: u64(60n) }),
            ]),
        );
        expect(state.nonce).toBe(0);
        expect(state.owner).toBeUndefined();
    });
});
