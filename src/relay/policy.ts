import {
    Address,
    Keypair,
    StrKey,
    Transaction,
    hash,
    nativeToScVal,
    xdr,
} from '@stellar/stellar-sdk';
import { MAX_SIGNED_PRICE_UPDATE_BYTES } from '../data/price.js';
import {
    decodeCreateOrderCall,
    validateFillOrKillCalls,
} from '../order/validation.js';
import {
    sessionConfigToScVal,
    type AddContextRuleArgs,
} from '../smart-account/smart_account_contract.js';
import { OrderKind } from '../trading/trading_types.js';
import type { Call } from '../trading-router/router_types.js';
import {
    RELAY_REQUEST_STATES,
    type RelayCallPolicy,
    type RelayContractIdentities,
    type RelayRequest,
    type PolicyBuildResult,
    type SingleMarketSessionInput,
    type SmartAccountDeploymentMetadata,
    type TrustedDeploymentRegistry,
    type VerifiedContractDeployment,
} from './types.js';
import {
    SMART_ACCOUNT_WASM_SHA256,
    trustedSmartAccountInstanceIssue,
} from './smart_account_evidence.js';

const U32_MAX = 4_294_967_295;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RULE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const P256_PRIME = BigInt(
    '0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff',
);
const P256_B = BigInt(
    '0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b',
);

/** Pinned smart-account-kit 0.3.0 account artifact. */
export const SMART_ACCOUNT_DEPLOYER =
    'GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N';
export { SMART_ACCOUNT_WASM_SHA256 };
export const SMART_ACCOUNT_SPEC_SHA256 =
    'd2a0c19c0d07dcd6e24542963e33d2127209f9175d3823ac9743600a8d3123bd';
/** Pinned smart-account-kit 0.3.0 WebAuthn verifier artifact. */
export const WEBAUTHN_VERIFIER_WASM_SHA256 =
    '938456a3c958139419ed65f773cb70f673a993cd2d4f9fd0f1eb26fdb8b38d1c';
export const WEBAUTHN_VERIFIER_SPEC_SHA256 =
    '78f193a23fd12368bb2f485b0ac5fb9579500a10e070a0f6ae2edbc4df705470';
/** Pinned smart-account-kit 0.3.0 Ed25519 verifier artifact. */
export const ED25519_VERIFIER_WASM_SHA256 =
    '6cf77cf89deb6c3aff1b25962d70e488c0fac2c2945f983d42732eb3dd975a95';
export const ED25519_VERIFIER_SPEC_SHA256 =
    'ba0d13ad987e431f7f2eea8eb0d3bde05036d4d15e8ce526b38b2177a8bd18f9';
export const SESSION_POLICY_WASM_SHA256 =
    'a98d1317f918b03af4e23f407eb99711eabda9c64629ae413427e7fa1c4f2135';
export const SESSION_POLICY_SPEC_SHA256 =
    '66bb3c60cb65f33fbc680b45133cb0154654dfb72c18a7990c0068a535a44bf1';
export const SMART_ACCOUNT_DEPLOYMENT_MAX_TIMEOUT_SECONDS = 30;

export { RELAY_REQUEST_STATES };

function requireUuid(value: string): void {
    if (typeof value !== 'string' || !UUID.test(value)) {
        throw new TypeError('requestId must be an RFC 4122 UUID');
    }
}

function validU32Number(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= U32_MAX
    );
}

function unsignedBigEndian(bytes: Uint8Array): bigint {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
}

function p256Modulo(value: bigint): bigint {
    const remainder = value % P256_PRIME;
    return remainder < 0n ? remainder + P256_PRIME : remainder;
}

/** smart-account-kit 0.3.0 encodes SEC1 P-256 bytes then credential ID. */
function validWebAuthnKeyData(keyData: Uint8Array): boolean {
    if (keyData.byteLength <= 65 || keyData[0] !== 0x04) return false;
    const x = unsignedBigEndian(keyData.subarray(1, 33));
    const y = unsignedBigEndian(keyData.subarray(33, 65));
    if (x >= P256_PRIME || y >= P256_PRIME) return false;
    const left = p256Modulo(y * y);
    const right = p256Modulo(x * x * x - 3n * x + P256_B);
    return left === right;
}

function canonicalHostFunction(value: string): xdr.HostFunction {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('func must contain canonical host-function XDR');
    }
    try {
        const decoded = xdr.HostFunction.fromXDR(value, 'base64');
        if (decoded.toXDR('base64') !== value) {
            throw new TypeError('func is not canonical host-function XDR');
        }
        return decoded;
    } catch (error) {
        if (
            error instanceof TypeError &&
            error.message.includes('host-function')
        ) {
            throw error;
        }
        throw new TypeError('func must contain canonical host-function XDR');
    }
}

function canonicalAuth(
    value: string,
    index: number,
): xdr.SorobanAuthorizationEntry {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(
            `auth[${index}] must contain authorization-entry XDR`,
        );
    }
    try {
        const decoded = xdr.SorobanAuthorizationEntry.fromXDR(value, 'base64');
        if (decoded.toXDR('base64') !== value) {
            throw new TypeError(
                `auth[${index}] is not canonical authorization-entry XDR`,
            );
        }
        return decoded;
    } catch (error) {
        if (
            error instanceof TypeError &&
            error.message.includes(`auth[${index}]`)
        ) {
            throw error;
        }
        throw new TypeError(
            `auth[${index}] must contain authorization-entry XDR`,
        );
    }
}

function exactScVal(left: xdr.ScVal, right: xdr.ScVal): boolean {
    return left.toXDR('raw').equals(right.toXDR('raw'));
}

function exactContractInvocation(
    invocation: xdr.SorobanAuthorizedInvocation,
    contractId: string,
    functionName: string,
    args: readonly xdr.ScVal[],
): boolean {
    const authorized = invocation.function();
    if (
        authorized.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn'
    ) {
        return false;
    }
    const contractFunction = authorized.contractFn();
    const actualArgs = contractFunction.args();
    return (
        Address.fromScAddress(contractFunction.contractAddress()).toString() ===
            contractId &&
        contractFunction.functionName().toString() === functionName &&
        actualArgs.length === args.length &&
        actualArgs.every((value, index) => exactScVal(value, args[index])) &&
        invocation.subInvocations().length === 0
    );
}

function validateRelayAuthorizations(
    entries: readonly xdr.SorobanAuthorizationEntry[],
    user: string,
    invoke: xdr.InvokeContractArgs,
): void {
    const signedPrefix = [
        invoke.args()[0],
        invoke.args()[2],
        invoke.args()[3],
        invoke.args()[4],
    ] as const;
    const router = Address.fromScAddress(invoke.contractAddress()).toString();
    const feeToken = Address.fromScVal(invoke.args()[2]).toString();
    const approvalPrefix = [
        invoke.args()[1],
        Address.fromString(router).toScVal(),
    ] as const;
    const maximumApproval = [
        ...approvalPrefix,
        invoke.args()[3],
        invoke.args()[4],
    ] as const;
    const zeroApproval = [
        ...approvalPrefix,
        nativeToScVal(0n, { type: 'i128' }),
        invoke.args()[4],
    ] as const;
    let exactSignedPrefixFound = false;
    let exactRouterRootFound = false;

    for (const entry of entries) {
        if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') {
            throw new TypeError(
                'relay auth entries must use address credentials',
            );
        }
        const credentials = entry.credentials().address();
        if (Address.fromScAddress(credentials.address()).toString() !== user) {
            throw new TypeError(
                'every relay authorization credential must belong to the outer user',
            );
        }
        if (credentials.signatureExpirationLedger() === 0) {
            throw new TypeError(
                'relay authorization expiration must be a positive ledger',
            );
        }

        const root = entry.rootInvocation().function();
        if (root.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') {
            continue;
        }
        const contractFunction = root.contractFn();
        const rootArgs = contractFunction.args();
        if (
            Address.fromScAddress(
                contractFunction.contractAddress(),
            ).toString() === router &&
            contractFunction.functionName().toString() ===
                invoke.functionName().toString() &&
            rootArgs.length === signedPrefix.length &&
            rootArgs.every((value, index) =>
                exactScVal(value, signedPrefix[index]),
            )
        ) {
            exactSignedPrefixFound = true;
            let maximumIndex = -1;
            let zeroIndex = -1;
            for (const [index, child] of entry
                .rootInvocation()
                .subInvocations()
                .entries()) {
                if (
                    exactContractInvocation(
                        child,
                        feeToken,
                        'approve',
                        maximumApproval,
                    )
                ) {
                    maximumIndex = index;
                }
                if (
                    exactContractInvocation(
                        child,
                        feeToken,
                        'approve',
                        zeroApproval,
                    )
                ) {
                    zeroIndex = index;
                }
            }
            if (
                maximumIndex !== -1 &&
                zeroIndex !== -1 &&
                maximumIndex < zeroIndex
            ) {
                exactRouterRootFound = true;
            }
        }
    }

    if (!exactSignedPrefixFound) {
        throw new TypeError(
            'relay auth is missing the exact Router signed prefix root',
        );
    }
    if (!exactRouterRootFound) {
        throw new TypeError(
            'relay auth is missing the exact fee-token approve maximum and wipe children',
        );
    }
}

function validateRelayContractIdentities(
    contracts: RelayContractIdentities,
): void {
    if (!contracts || typeof contracts !== 'object') {
        throw new TypeError('trusted relay contract identities are required');
    }
    if (!StrKey.isValidContract(contracts.router)) {
        throw new TypeError('trusted Router must be a valid contract ID');
    }
    if (
        !Array.isArray(contracts.trading) ||
        contracts.trading.length === 0 ||
        contracts.trading.some(
            (contractId) => !StrKey.isValidContract(contractId),
        ) ||
        new Set(contracts.trading).size !== contracts.trading.length
    ) {
        throw new TypeError(
            'trusted Trading identities must be unique contract IDs',
        );
    }
    if (
        !Array.isArray(contracts.feeTokens) ||
        contracts.feeTokens.length === 0 ||
        contracts.feeTokens.some(
            (contractId) => !StrKey.isValidContract(contractId),
        ) ||
        new Set(contracts.feeTokens).size !== contracts.feeTokens.length
    ) {
        throw new TypeError(
            'trusted fee-token identities must be unique contract IDs',
        );
    }
    if (
        contracts.referral !== undefined &&
        !StrKey.isValidContract(contracts.referral)
    ) {
        throw new TypeError('trusted Referral must be a valid contract ID');
    }
    if (contracts.markets !== undefined) {
        if (
            !Array.isArray(contracts.markets) ||
            contracts.markets.length !== contracts.trading.length ||
            contracts.markets.some(
                (market) =>
                    !StrKey.isValidContract(market.trading) ||
                    !StrKey.isValidContract(market.collateral) ||
                    !contracts.trading.includes(market.trading) ||
                    new Set([
                        market.trading,
                        contracts.router,
                        market.collateral,
                    ]).size !== 3,
            ) ||
            new Set(contracts.markets.map((market) => market.trading)).size !==
                contracts.markets.length
        ) {
            throw new TypeError(
                'trusted market-to-collateral identities are invalid',
            );
        }
    }
    if (contracts.sessionPolicy !== undefined) {
        if (
            !StrKey.isValidContract(contracts.sessionPolicy.contractId) ||
            !StrKey.isValidContract(contracts.sessionPolicy.ed25519Verifier) ||
            typeof contracts.sessionPolicy.ruleName !== 'string' ||
            !RULE_NAME.test(contracts.sessionPolicy.ruleName) ||
            typeof contracts.sessionPolicy.maximumDurationLedgers !==
                'bigint' ||
            contracts.sessionPolicy.maximumDurationLedgers <= 0n ||
            contracts.sessionPolicy.maximumDurationLedgers > BigInt(U32_MAX)
        ) {
            throw new TypeError(
                'trusted session-policy identities are invalid',
            );
        }
    }
}

function callFromScVal(value: xdr.ScVal): Call {
    if (value.switch().name !== 'scvMap') {
        throw new TypeError('Router call must be an encoded Call map');
    }
    const entries = value.map() ?? [];
    if (entries.length !== 3) {
        throw new TypeError(
            'Router Call map must contain exactly three fields',
        );
    }
    const fields = new Map<string, xdr.ScVal>();
    for (const entry of entries) {
        if (entry.key().switch().name !== 'scvSymbol') {
            throw new TypeError('Router Call keys must be symbols');
        }
        fields.set(entry.key().sym().toString(), entry.val());
    }
    const args = fields.get('args');
    const contract = fields.get('contract');
    const func = fields.get('func');
    if (
        fields.size !== 3 ||
        args?.switch().name !== 'scvVec' ||
        contract?.switch().name !== 'scvAddress' ||
        func?.switch().name !== 'scvSymbol'
    ) {
        throw new TypeError('Router Call fields do not match the exact ABI');
    }
    return {
        contract: Address.fromScVal(contract).toString(),
        func: func.sym().toString(),
        args: [...(args.vec() ?? [])],
    };
}

function callVector(value: xdr.ScVal): Call[] {
    if (value.switch().name !== 'scvVec') {
        throw new TypeError('Router calls must be an encoded vector');
    }
    const values = value.vec() ?? [];
    if (values.length === 0) {
        throw new TypeError('Router call batch must not be empty');
    }
    return values.map(callFromScVal);
}

function scAddress(value: xdr.ScVal, label: string): string {
    if (value.switch().name !== 'scvAddress') {
        throw new TypeError(`${label} must be an address`);
    }
    return Address.fromScVal(value).toString();
}

function scI128(value: xdr.ScVal, label: string): bigint {
    if (value.switch().name !== 'scvI128') {
        throw new TypeError(`${label} must be an i128`);
    }
    const parts = value.i128();
    return (
        (BigInt(parts.hi().toString()) << 64n) + BigInt(parts.lo().toString())
    );
}

function requireU32(value: xdr.ScVal, label: string): number {
    if (value.switch().name !== 'scvU32') {
        throw new TypeError(`${label} must be a u32`);
    }
    return value.u32();
}

function requireCreateOrderShape(call: Call): void {
    const expected = [
        'scvAddress',
        'scvBool',
        'scvU32',
        'scvI128',
        'scvI128',
        'scvI128',
        'scvI128',
        'scvU32',
    ];
    if (
        call.func !== 'create_order' ||
        call.args.length !== expected.length ||
        call.args.some(
            (value, index) => value.switch().name !== expected[index],
        )
    ) {
        throw new TypeError('create_order call does not match the exact ABI');
    }
    const decoded = decodeCreateOrderCall(call);
    if (
        decoded.kind < OrderKind.MarketIncrease ||
        decoded.kind > OrderKind.StopDecrease
    ) {
        throw new TypeError('create_order kind is unknown');
    }
    if (
        decoded.notional < 0n ||
        decoded.collateral < 0n ||
        decoded.triggerPrice < 0n ||
        decoded.priceBound < 0n ||
        (decoded.notional === 0n && decoded.collateral === 0n)
    ) {
        throw new TypeError('create_order call contains invalid atomic values');
    }
    const market =
        decoded.kind === OrderKind.MarketIncrease ||
        decoded.kind === OrderKind.MarketDecrease;
    if (
        (market && decoded.triggerPrice !== 0n) ||
        (!market && decoded.triggerPrice === 0n)
    ) {
        throw new TypeError(
            'create_order trigger does not match its order kind',
        );
    }
}

function validateFeeEnvelope(
    args: xdr.ScVal[],
    contracts: RelayContractIdentities,
): string {
    const user = scAddress(args[1], 'relay user');
    const feeToken = scAddress(args[2], 'relay fee token');
    if (!contracts.feeTokens.includes(feeToken)) {
        throw new TypeError(
            'relay fee token is not trusted for this deployment',
        );
    }
    const maximum = scI128(args[3], 'maximum relay fee');
    const expiration = requireU32(args[4], 'relay fee expiration');
    const amount = scI128(args[5], 'relay fee amount');
    const recipient = scAddress(args[6], 'relay fee recipient');
    if (maximum <= 0n || expiration === 0) {
        throw new TypeError('relay fee envelope values are invalid');
    }
    if (amount !== 1n || recipient !== user) {
        throw new TypeError(
            'relay unsigned fee tail must use the canonical SDK placeholders',
        );
    }
    return user;
}

function validateCancellationCall(
    call: Call,
    user: string,
    contracts: RelayContractIdentities,
): void {
    if (
        !contracts.trading.includes(call.contract) ||
        (call.func !== 'cancel_order' && call.func !== 'cancel_vault_order') ||
        call.args.length !== 2 ||
        call.args[0].switch().name !== 'scvAddress' ||
        call.args[1].switch().name !== 'scvU32' ||
        Address.fromScVal(call.args[0]).toString() !== user
    ) {
        throw new TypeError(
            'priceFree batches may contain only same-user Trading cancellations',
        );
    }
}

function validStellarAddress(value: string): boolean {
    return (
        StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)
    );
}

function requireCallShape(
    call: Call,
    expected: readonly string[],
    label: string,
): void {
    if (
        call.args.length !== expected.length ||
        call.args.some(
            (argument, index) => argument.switch().name !== expected[index],
        )
    ) {
        throw new TypeError(`${label} does not match its exact ABI`);
    }
}

function validatePriceFreeTransfer(
    call: Call,
    user: string,
    contracts: RelayContractIdentities,
): void {
    requireCallShape(call, ['scvAddress', 'scvAddress', 'scvI128'], 'transfer');
    const sender = scAddress(call.args[0], 'transfer sender');
    const recipient = scAddress(call.args[1], 'transfer recipient');
    if (
        !contracts.feeTokens.includes(call.contract) ||
        sender !== user ||
        !validStellarAddress(recipient) ||
        recipient === user ||
        scI128(call.args[2], 'transfer amount') <= 0n
    ) {
        throw new TypeError(
            'priceFree transfer must use configured collateral for a non-self recipient',
        );
    }
}

function validatePriceFreeReferral(
    call: Call,
    user: string,
    contracts: RelayContractIdentities,
): void {
    requireCallShape(call, ['scvAddress', 'scvAddress'], 'attribute');
    const caller = scAddress(call.args[0], 'referral caller');
    const referrer = scAddress(call.args[1], 'referrer');
    if (
        contracts.referral === undefined ||
        call.contract !== contracts.referral ||
        caller !== user ||
        !validStellarAddress(referrer) ||
        referrer === user
    ) {
        throw new TypeError(
            'priceFree referral attribution must use the configured contract and a non-self referrer',
        );
    }
}

function symbolMap(value: xdr.ScVal, label: string): Map<string, xdr.ScVal> {
    if (value.switch().name !== 'scvMap') {
        throw new TypeError(`${label} must be a map`);
    }
    const fields = new Map<string, xdr.ScVal>();
    for (const entry of value.map() ?? []) {
        if (entry.key().switch().name !== 'scvSymbol') {
            throw new TypeError(`${label} keys must be symbols`);
        }
        const key = entry.key().sym().toString();
        if (fields.has(key)) {
            throw new TypeError(`${label} keys must be unique`);
        }
        fields.set(key, entry.val());
    }
    return fields;
}

function validatePriceFreeSessionAdd(
    call: Call,
    user: string,
    contracts: RelayContractIdentities,
    currentLedger: number | undefined,
): void {
    const configured = contracts.sessionPolicy;
    if (
        call.contract !== user ||
        !StrKey.isValidContract(user) ||
        configured === undefined ||
        contracts.markets === undefined
    ) {
        throw new TypeError(
            'priceFree session rules require the configured user smart account capability',
        );
    }
    requireCallShape(
        call,
        ['scvVec', 'scvString', 'scvU32', 'scvVec', 'scvMap'],
        'add_context_rule',
    );
    const context = call.args[0].vec() ?? [];
    const validUntil = requireU32(call.args[2], 'session expiry');
    if (
        context.length !== 1 ||
        context[0]?.switch().name !== 'scvSymbol' ||
        context[0].sym().toString() !== 'Default' ||
        call.args[1].str().toString() !== configured.ruleName
    ) {
        throw new TypeError(
            'priceFree session context, name, or expiry is invalid',
        );
    }
    if (
        !validU32Number(currentLedger) ||
        validUntil <= currentLedger ||
        BigInt(validUntil - currentLedger) > configured.maximumDurationLedgers
    ) {
        throw new TypeError(
            'priceFree session expiry must be live and within the trusted duration',
        );
    }
    const signers = call.args[3].vec() ?? [];
    const signer =
        signers[0]?.switch().name === 'scvVec' ? (signers[0].vec() ?? []) : [];
    if (
        signers.length !== 1 ||
        signer.length !== 3 ||
        signer[0]?.switch().name !== 'scvSymbol' ||
        signer[0].sym().toString() !== 'External' ||
        signer[1]?.switch().name !== 'scvAddress' ||
        scAddress(signer[1], 'session signer verifier') !==
            configured.ed25519Verifier ||
        signer[2]?.switch().name !== 'scvBytes' ||
        signer[2].bytes().byteLength !== 32
    ) {
        throw new TypeError(
            'priceFree session signer must be the configured External Ed25519 signer',
        );
    }
    const policies = call.args[4].map() ?? [];
    if (
        policies.length !== 1 ||
        policies[0].key().switch().name !== 'scvAddress' ||
        scAddress(policies[0].key(), 'session policy') !== configured.contractId
    ) {
        throw new TypeError(
            'priceFree session rule must install exactly the configured policy',
        );
    }
    const session = symbolMap(policies[0].val(), 'SessionConfig');
    const allowed = session.get('allowed_contracts');
    const destination = session.get('allowed_transfer_to');
    const allowedContracts = allowed?.vec() ?? [];
    if (
        session.size !== 2 ||
        allowed?.switch().name !== 'scvVec' ||
        destination?.switch().name !== 'scvAddress' ||
        allowedContracts.length !== 3
    ) {
        throw new TypeError(
            'priceFree session policy parameters do not match SessionConfig',
        );
    }
    const identities = allowedContracts.map((value) =>
        scAddress(value, 'session allowed contract'),
    );
    const market = contracts.markets.find(
        (candidate) => candidate.trading === identities[0],
    );
    if (
        market === undefined ||
        identities[1] !== contracts.router ||
        identities[2] !== market.collateral ||
        scAddress(destination, 'session transfer destination') !==
            market.trading
    ) {
        throw new TypeError(
            'priceFree session rule must encode exactly one configured market capability',
        );
    }
}

function validateFillOrKillArguments(
    args: xdr.ScVal[],
    contracts: RelayContractIdentities,
): void {
    const calls = callVector(args[0]);
    for (const call of calls) {
        if (call.func === 'create_order') requireCreateOrderShape(call);
    }
    const primary = decodeCreateOrderCall(calls[0]);
    if (!contracts.trading.includes(primary.trading)) {
        throw new TypeError(
            'fillOrKill primary must target a trusted Trading contract',
        );
    }
    const user = validateFeeEnvelope(args, contracts);
    const grammarIssues = validateFillOrKillCalls(calls, {
        tradingAddress: primary.trading,
        user,
        isLong: primary.isLong,
    });
    if (grammarIssues.length > 0) {
        throw new TypeError(grammarIssues[0].reason);
    }
    const keeper = scAddress(args[7], 'fill keeper');
    if (keeper !== user) {
        throw new TypeError(
            'relay unsigned fill tail must use the canonical SDK placeholders',
        );
    }
    if (
        args[8].switch().name !== 'scvBytes' ||
        args[8].bytes().byteLength === 0 ||
        args[8].bytes().byteLength > MAX_SIGNED_PRICE_UPDATE_BYTES
    ) {
        throw new TypeError(
            'relay auth-discovery price update must contain 1 byte through 32 KiB',
        );
    }
}

function requireCreateVaultOrderShape(call: Call): string {
    const args = call.args;
    if (
        call.func !== 'create_vault_order' ||
        args.length !== 4 ||
        args[0].switch().name !== 'scvAddress' ||
        args[1].switch().name !== 'scvU32' ||
        args[2].switch().name !== 'scvI128' ||
        args[3].switch().name !== 'scvI128'
    ) {
        throw new TypeError('create_vault_order does not match the exact ABI');
    }
    const user = scAddress(args[0], 'vault order user');
    const kind = requireU32(args[1], 'vault order kind');
    const amount = scI128(args[2], 'vault order amount');
    const minOut = scI128(args[3], 'vault order minimum output');
    if ((kind !== 0 && kind !== 1) || amount <= 0n || minOut < 0n) {
        throw new TypeError('create_vault_order contains invalid values');
    }
    return user;
}

function validateRestOnlyArguments(
    args: xdr.ScVal[],
    contracts: RelayContractIdentities,
): void {
    const calls = callVector(args[0]);
    if (calls.length !== 1) {
        throw new TypeError('restOnly requires exactly one resting order call');
    }
    const user = validateFeeEnvelope(args, contracts);
    const call = calls[0];
    if (!contracts.trading.includes(call.contract)) {
        throw new TypeError(
            'restOnly order must target a trusted Trading contract',
        );
    }
    if (call.func === 'create_order') {
        requireCreateOrderShape(call);
        const order = decodeCreateOrderCall(call);
        if (order.user !== user) {
            throw new TypeError(
                'restOnly order user does not match the relay fee payer',
            );
        }
        if (
            order.kind === OrderKind.MarketIncrease ||
            order.kind === OrderKind.MarketDecrease
        ) {
            throw new TypeError(
                'restOnly requires a limit or stop resting order',
            );
        }
        return;
    }
    if (call.func === 'create_vault_order') {
        if (requireCreateVaultOrderShape(call) !== user) {
            throw new TypeError(
                'restOnly vault order user does not match the relay fee payer',
            );
        }
        return;
    }
    throw new TypeError(
        'restOnly permits only one Trading create_order or create_vault_order call',
    );
}

function validatePriceFreeArguments(
    args: xdr.ScVal[],
    contracts: RelayContractIdentities,
    currentLedger: number | undefined,
): void {
    const calls = callVector(args[0]);
    if (calls.length > 64) {
        throw new TypeError('priceFree supports at most 64 calls');
    }
    const user = validateFeeEnvelope(args, contracts);
    for (const call of calls) {
        if (
            call.func === 'cancel_order' ||
            call.func === 'cancel_vault_order'
        ) {
            validateCancellationCall(call, user, contracts);
        } else if (call.func === 'claim_funding') {
            requireCallShape(call, ['scvAddress'], 'claim_funding');
            if (
                !contracts.trading.includes(call.contract) ||
                scAddress(call.args[0], 'funding user') !== user
            ) {
                throw new TypeError(
                    'priceFree claim_funding must use a configured same-user market',
                );
            }
        } else if (call.func === 'transfer') {
            validatePriceFreeTransfer(call, user, contracts);
        } else if (call.func === 'attribute') {
            validatePriceFreeReferral(call, user, contracts);
        } else if (call.func === 'add_context_rule') {
            validatePriceFreeSessionAdd(call, user, contracts, currentLedger);
        } else if (call.func === 'remove_context_rule') {
            if (call.contract !== user || !StrKey.isValidContract(user)) {
                throw new TypeError(
                    'priceFree session removal must target the user smart account',
                );
            }
            requireCallShape(call, ['scvU32'], 'remove_context_rule');
            if (requireU32(call.args[0], 'context rule id') === 0) {
                throw new TypeError('context rule id must be positive');
            }
        } else {
            throw new TypeError(
                'priceFree function is outside the explicit allowlist',
            );
        }
    }
}

function validateRelayFunction(
    policy: RelayCallPolicy,
    hostFunction: xdr.HostFunction,
    contracts: RelayContractIdentities,
    currentLedger: number | undefined,
): xdr.InvokeContractArgs {
    if (hostFunction.switch().name !== 'hostFunctionTypeInvokeContract') {
        throw new TypeError(
            `${policy} requires an invoke-contract host function`,
        );
    }
    const invoke = hostFunction.invokeContract();
    if (invoke.contractAddress().switch().name !== 'scAddressTypeContract') {
        throw new TypeError(`${policy} must invoke a contract address`);
    }
    const target = Address.fromScAddress(invoke.contractAddress()).toString();
    if (target !== contracts.router) {
        throw new TypeError(
            `${policy} must target the trusted Router contract`,
        );
    }
    const functionName = invoke.functionName().toString();
    const argumentCount = invoke.args().length;

    if (
        policy === 'fillOrKill' &&
        (functionName !== 'create_and_fill_with_fee' || argumentCount !== 9)
    ) {
        throw new TypeError(
            'fillOrKill requires the nine-argument create_and_fill_with_fee function',
        );
    }
    if (
        policy === 'restOnly' &&
        (functionName !== 'multicall_with_fee' || argumentCount !== 7)
    ) {
        throw new TypeError(
            'restOnly requires the Router multicall_with_fee function',
        );
    }
    if (
        policy === 'priceFree' &&
        (functionName !== 'multicall_with_fee' || argumentCount !== 7)
    ) {
        throw new TypeError(
            'priceFree requires the Router multicall_with_fee function',
        );
    }
    if (policy === 'fillOrKill') {
        validateFillOrKillArguments(invoke.args(), contracts);
    } else if (policy === 'restOnly') {
        validateRestOnlyArguments(invoke.args(), contracts);
    } else {
        validatePriceFreeArguments(invoke.args(), contracts, currentLedger);
    }
    return invoke;
}

/** Validate and package a route-safe relay call without performing transport. */
export function buildRelayCallRequest(input: {
    requestId: string;
    policy: RelayCallPolicy;
    func: string;
    auth: string[];
    contracts: RelayContractIdentities;
    /** Trusted ledger snapshot, required when priceFree adds a session rule. */
    currentLedger?: number;
}): RelayRequest {
    requireUuid(input.requestId);
    if (
        input.policy !== 'fillOrKill' &&
        input.policy !== 'restOnly' &&
        input.policy !== 'priceFree'
    ) {
        throw new TypeError('relay call policy is unsupported');
    }
    validateRelayContractIdentities(input.contracts);
    const hostFunction = canonicalHostFunction(input.func);
    const invoke = validateRelayFunction(
        input.policy,
        hostFunction,
        input.contracts,
        input.currentLedger,
    );
    if (
        !Array.isArray(input.auth) ||
        input.auth.length === 0 ||
        input.auth.length > 64
    ) {
        throw new TypeError(
            'auth must contain between one and 64 ordered entries',
        );
    }
    const auth = input.auth.map(canonicalAuth);
    validateRelayAuthorizations(
        auth,
        scAddress(invoke.args()[1], 'relay user'),
        invoke,
    );
    return Object.freeze({
        requestId: input.requestId,
        policy: input.policy,
        func: input.func,
        auth: Object.freeze([...input.auth]),
    }) as RelayRequest;
}

function canonicalDeploymentEnvelope(value: string): xdr.TransactionEnvelope {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(
            'envelopeXdr must contain a signed deployment envelope',
        );
    }
    try {
        const decoded = xdr.TransactionEnvelope.fromXDR(value, 'base64');
        if (decoded.toXDR('base64') !== value) {
            throw new TypeError('deployment envelope XDR is not canonical');
        }
        return decoded;
    } catch (error) {
        if (
            error instanceof TypeError &&
            error.message.includes('deployment')
        ) {
            throw error;
        }
        throw new TypeError(
            'envelopeXdr must contain a signed deployment envelope',
        );
    }
}

function validateSmartAccountDeploymentMetadata(
    deployment: SmartAccountDeploymentMetadata,
): void {
    if (!deployment || typeof deployment !== 'object') {
        throw new TypeError('smart-account deployment metadata is required');
    }
    if (deployment.kitVersion !== '0.3.0') {
        throw new TypeError(
            'smart-account deployment requires kit version 0.3.0',
        );
    }
    if (deployment.deployer !== SMART_ACCOUNT_DEPLOYER) {
        throw new TypeError(
            'smart-account deployer does not match smart-account-kit 0.3.0',
        );
    }
    if (deployment.accountWasmSha256 !== SMART_ACCOUNT_WASM_SHA256) {
        throw new TypeError(
            'smart-account deployment metadata has an unpinned WASM',
        );
    }
    if (!StrKey.isValidContract(deployment.webauthnVerifier)) {
        throw new TypeError('WebAuthn verifier must be a trusted contract ID');
    }
    if (
        typeof deployment.networkPassphrase !== 'string' ||
        deployment.networkPassphrase.length === 0 ||
        deployment.networkPassphrase.length > 256
    ) {
        throw new TypeError('smart-account network passphrase is invalid');
    }
}

function validateDeploymentEnvelope(
    envelope: xdr.TransactionEnvelope,
    deployment: SmartAccountDeploymentMetadata,
): void {
    if (envelope.switch().name !== 'envelopeTypeTx') {
        throw new TypeError(
            'smart-account deployment must be a signed inner v1 envelope',
        );
    }
    const inner = envelope.v1();
    if (inner.signatures().length !== 1) {
        throw new TypeError(
            inner.signatures().length === 0
                ? 'smart-account deployment envelope must be signed'
                : 'smart-account deployment must contain exactly one signature',
        );
    }
    const deploymentSignature = inner.signatures()[0];
    const deployer = Keypair.fromPublicKey(deployment.deployer);
    const transaction = new Transaction(envelope, deployment.networkPassphrase);
    const timeBounds = transaction.timeBounds;
    if (timeBounds === undefined || timeBounds.maxTime === '0') {
        throw new TypeError(
            'smart-account deployment requires a bounded time bound',
        );
    }
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const minTime = BigInt(timeBounds.minTime);
    const maxTime = BigInt(timeBounds.maxTime);
    if (minTime > now || maxTime <= now) {
        throw new TypeError(
            'smart-account deployment time bound is not currently valid',
        );
    }
    if (maxTime - now > BigInt(SMART_ACCOUNT_DEPLOYMENT_MAX_TIMEOUT_SECONDS)) {
        throw new TypeError(
            `smart-account deployment must expire within ${SMART_ACCOUNT_DEPLOYMENT_MAX_TIMEOUT_SECONDS} seconds`,
        );
    }
    if (
        !deploymentSignature.hint().equals(deployer.signatureHint()) ||
        !deployer.verify(transaction.hash(), deploymentSignature.signature())
    ) {
        throw new TypeError(
            'smart-account deployment signature is not from the trusted deployer',
        );
    }
    const source = inner.tx().sourceAccount();
    if (
        source.switch().name !== 'keyTypeEd25519' ||
        StrKey.encodeEd25519PublicKey(source.ed25519()) !== deployment.deployer
    ) {
        throw new TypeError(
            'smart-account deployment source does not match the trusted deployer',
        );
    }
    const operations = inner.tx().operations();
    if (inner.tx().memo().switch().name !== 'memoNone') {
        throw new TypeError('smart-account deployment memo must be empty');
    }
    if (operations.length !== 1) {
        throw new TypeError(
            'smart-account deployment must contain exactly one operation',
        );
    }
    const operation = operations[0];
    if (operation.sourceAccount() != null) {
        throw new TypeError(
            'smart-account deployment operation must use the transaction source',
        );
    }
    if (operation.body().switch().name !== 'invokeHostFunction') {
        throw new TypeError(
            'smart-account deployment must invoke create-contract-v2',
        );
    }
    const invoke = operation.body().invokeHostFunctionOp();
    if (invoke.auth().length !== 0) {
        throw new TypeError(
            'smart-account deployment operation must not carry Soroban auth',
        );
    }
    const hostFunction = invoke.hostFunction();
    if (hostFunction.switch().name !== 'hostFunctionTypeCreateContractV2') {
        throw new TypeError(
            'smart-account deployment must invoke create-contract-v2',
        );
    }
    const create = hostFunction.createContractV2();
    if (
        create.contractIdPreimage().switch().name !==
        'contractIdPreimageFromAddress'
    ) {
        throw new TypeError(
            'smart-account deployment requires an address-derived contract ID',
        );
    }
    if (
        Address.fromScAddress(
            create.contractIdPreimage().fromAddress().address(),
        ).toString() !== deployment.deployer
    ) {
        throw new TypeError(
            'smart-account deployment preimage does not match the trusted deployer',
        );
    }
    const executable = create.executable();
    if (
        executable.switch().name !== 'contractExecutableWasm' ||
        executable.wasmHash().toString('hex') !== deployment.accountWasmSha256
    ) {
        throw new TypeError(
            'smart-account deployment WASM does not match the pinned artifact',
        );
    }
    if (create.constructorArgs().length !== 2) {
        throw new TypeError(
            'smart-account deployment constructor shape is incompatible',
        );
    }
    const [signersValue, policiesValue] = create.constructorArgs();
    if (
        signersValue.switch().name !== 'scvVec' ||
        (signersValue.vec()?.length ?? 0) !== 1
    ) {
        throw new TypeError(
            'smart-account deployment must install exactly one initial signer',
        );
    }
    const signer = signersValue.vec()![0];
    const signerFields =
        signer.switch().name === 'scvVec' ? signer.vec() : undefined;
    const signerKeyData =
        signerFields?.length === 3 &&
        signerFields[2].switch().name === 'scvBytes'
            ? signerFields[2].bytes()
            : undefined;
    if (
        signerFields?.length !== 3 ||
        signerFields[0].switch().name !== 'scvSymbol' ||
        signerFields[0].sym().toString() !== 'External' ||
        signerFields[1].switch().name !== 'scvAddress' ||
        signerFields[1].address().switch().name !== 'scAddressTypeContract' ||
        Address.fromScVal(signerFields[1]).toString() !==
            deployment.webauthnVerifier ||
        signerKeyData === undefined ||
        !validWebAuthnKeyData(signerKeyData)
    ) {
        throw new TypeError(
            'smart-account deployment initial signer is incompatible',
        );
    }
    const expectedSalt = hash(signerKeyData.subarray(65));
    if (
        !create.contractIdPreimage().fromAddress().salt().equals(expectedSalt)
    ) {
        throw new TypeError(
            'smart-account deployment salt does not match the WebAuthn credential ID',
        );
    }
    if (
        policiesValue.switch().name !== 'scvMap' ||
        (policiesValue.map()?.length ?? 0) !== 0
    ) {
        throw new TypeError(
            'smart-account deployment initial policies must be empty',
        );
    }
}

/** Package only the pinned kit deployment envelope route. */
export function buildSmartAccountDeploymentRequest(input: {
    requestId: string;
    envelopeXdr: string;
    deployment: SmartAccountDeploymentMetadata;
    deployments: TrustedDeploymentRegistry;
}): RelayRequest {
    requireUuid(input.requestId);
    validateSmartAccountDeploymentMetadata(input.deployment);
    const verifierIssue = trustedDeploymentIssue(
        input.deployments,
        input.deployment.webauthnVerifier,
        WEBAUTHN_VERIFIER_WASM_SHA256,
        WEBAUTHN_VERIFIER_SPEC_SHA256,
        'WebAuthn verifier',
    );
    if (verifierIssue !== undefined) throw new TypeError(verifierIssue);
    const envelope = canonicalDeploymentEnvelope(input.envelopeXdr);
    validateDeploymentEnvelope(envelope, input.deployment);
    return Object.freeze({
        requestId: input.requestId,
        policy: 'smartAccountDeployment',
        envelopeXdr: input.envelopeXdr,
    }) as RelayRequest;
}

function sessionUnavailable(
    reason: string,
): PolicyBuildResult<AddContextRuleArgs> {
    return { kind: 'unavailable', code: 'INVALID_INPUT', reason };
}

function verifiedDeploymentIssue(
    deployment: VerifiedContractDeployment,
    expectedWasmHash: string,
    expectedSpecHash: string,
    label: string,
): string | undefined {
    if (!deployment || typeof deployment !== 'object') {
        return `${label} deployment evidence is required`;
    }
    if (!StrKey.isValidContract(deployment.contractId)) {
        return `${label} identity must be a contract ID`;
    }
    if (deployment.wasmHash !== expectedWasmHash) {
        return `${label} deployment metadata does not match the pinned WASM`;
    }
    const evidence = deployment.evidence;
    if (
        !evidence ||
        typeof evidence !== 'object' ||
        evidence.state !== 'verified'
    ) {
        return `${label} instance evidence is not verified`;
    }
    if (
        !SHA256.test(evidence.deploymentTransactionHash) ||
        typeof evidence.ledger !== 'bigint' ||
        evidence.ledger <= 0n ||
        evidence.ledger > BigInt(U32_MAX) ||
        evidence.instanceExecutableHash !== expectedWasmHash ||
        evidence.uploadedWasmHash !== expectedWasmHash ||
        evidence.specHash !== expectedSpecHash
    ) {
        return `${label} instance evidence does not match the reviewed deployment`;
    }
    return undefined;
}

function trustedDeploymentIssue(
    deployments: TrustedDeploymentRegistry,
    contractId: string,
    expectedWasmHash: string,
    expectedSpecHash: string,
    label: string,
): string | undefined {
    if (!StrKey.isValidContract(contractId)) {
        return `${label} identity must be a contract ID`;
    }
    if (!deployments || typeof deployments.resolve !== 'function') {
        return `trusted ${label} deployment registry is required`;
    }
    let deployment: VerifiedContractDeployment | undefined;
    try {
        deployment = deployments.resolve(contractId);
    } catch {
        return `${label} deployment registry lookup failed`;
    }
    if (deployment === undefined) {
        return `${label} deployment is absent from the trusted registry`;
    }
    if (deployment.contractId !== contractId) {
        return `${label} deployment registry returned a different contract identity`;
    }
    return verifiedDeploymentIssue(
        deployment,
        expectedWasmHash,
        expectedSpecHash,
        label,
    );
}

/** Build the only session capability supported by the pinned policy ABI. */
export function buildSingleMarketSessionRule(
    input: SingleMarketSessionInput,
): PolicyBuildResult<AddContextRuleArgs> {
    if (!input || typeof input !== 'object') {
        return sessionUnavailable('session input must be an object');
    }
    if (input.capability !== 'single-transfer-destination-v1') {
        return sessionUnavailable('unsupported session capability');
    }
    const smartAccountIssue = trustedSmartAccountInstanceIssue(
        input.smartAccounts,
        input.smartAccount,
        input.currentLedger,
    );
    if (smartAccountIssue !== undefined) {
        return sessionUnavailable(smartAccountIssue);
    }
    const sessionPolicyIssue = trustedDeploymentIssue(
        input.deployments,
        input.sessionPolicy,
        SESSION_POLICY_WASM_SHA256,
        SESSION_POLICY_SPEC_SHA256,
        'session policy',
    );
    if (sessionPolicyIssue !== undefined) {
        return sessionUnavailable(sessionPolicyIssue);
    }
    if (!Array.isArray(input.markets) || input.markets.length !== 1) {
        return sessionUnavailable(
            'single-transfer-destination-v1 requires exactly one market',
        );
    }
    const market = input.markets[0];
    const marketContracts = [market.trading, market.router, market.collateral];
    if (
        marketContracts.some(
            (contractId) => !StrKey.isValidContract(contractId),
        ) ||
        new Set(marketContracts).size !== marketContracts.length
    ) {
        return sessionUnavailable(
            'market session contract identities are invalid',
        );
    }
    if (
        input.signer?.tag !== 'External' ||
        !StrKey.isValidContract(input.signer.verifier) ||
        !(input.signer.keyData instanceof Uint8Array) ||
        input.signer.keyData.byteLength !== 32
    ) {
        return sessionUnavailable(
            'session signer must be one External Ed25519 key',
        );
    }
    const signerVerifierIssue = trustedDeploymentIssue(
        input.deployments,
        input.signer.verifier,
        ED25519_VERIFIER_WASM_SHA256,
        ED25519_VERIFIER_SPEC_SHA256,
        'Ed25519 verifier',
    );
    if (signerVerifierIssue !== undefined) {
        return sessionUnavailable(signerVerifierIssue);
    }
    if (typeof input.name !== 'string' || !RULE_NAME.test(input.name)) {
        return sessionUnavailable('session rule name is invalid');
    }
    if (
        !Number.isSafeInteger(input.validUntil) ||
        input.validUntil <= 0 ||
        input.validUntil > U32_MAX
    ) {
        return sessionUnavailable(
            'session expiry must be a positive u32 ledger',
        );
    }
    if (
        !Number.isSafeInteger(input.currentLedger) ||
        input.currentLedger < 0 ||
        input.currentLedger > U32_MAX ||
        typeof input.maximumDurationLedgers !== 'bigint' ||
        input.maximumDurationLedgers <= 0n ||
        input.maximumDurationLedgers > BigInt(U32_MAX) ||
        input.validUntil <= input.currentLedger ||
        BigInt(input.validUntil - input.currentLedger) >
            input.maximumDurationLedgers
    ) {
        return sessionUnavailable(
            'session expiry must be live and within the configured duration',
        );
    }

    const rule: AddContextRuleArgs = {
        contextType: { tag: 'Default' },
        name: input.name,
        validUntil: input.validUntil,
        signers: [
            {
                tag: 'External',
                verifier: input.signer.verifier,
                keyData: Uint8Array.from(input.signer.keyData),
            },
        ],
        policies: new Map([
            [
                input.sessionPolicy,
                sessionConfigToScVal({
                    allowedContracts: [...marketContracts],
                    allowedTransferTo: market.trading,
                }),
            ],
        ]),
    };
    return { kind: 'ready', value: rule };
}
