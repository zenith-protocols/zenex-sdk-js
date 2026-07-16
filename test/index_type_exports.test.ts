import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('package root type exports', () => {
    it('exports every generated account query used by client signatures', () => {
        const consumerPath = fileURLToPath(
            new URL('./root-account-query-consumer.ts', import.meta.url),
        );
        const source = `
            import type {
                AccountOrderQuery,
                AccountFillQuery,
                AccountFillNetPnlInput,
                AccountFillNetPnlResult,
                AccountVaultOrderQuery,
                AccountLifecycleQuery,
                RankingDenomination,
                BuildPositionDecreaseIntentExecutionInput,
                BuildPositionIncreaseIntentExecutionInput,
                BuildVaultActionExecutionInput,
                DeriveVaultMinimumOutputInput,
                ExactPositionDecreaseIntentQuote,
                ExactPositionIncreaseIntentQuote,
                ExactRatio,
                ExactVaultOrderCreationQuote,
                NormalizedPositionDecreaseIntent,
                NormalizedPositionIncreaseIntent,
                PositionDecreaseCollateralReturnIntent,
                PositionDecreaseExecutionIntent,
                PositionDecreaseFillOrKillPolicy,
                PositionDecreaseIntentOutcome,
                PositionDecreasePartialSizeIntent,
                PositionDecreaseSizeIntent,
                PositionIncreaseExecutionIntent,
                PositionIncreaseFillOrKillPolicy,
                PositionIncreaseIntentOutcome,
                PreparedVaultActionExecution,
                PreparedVaultRestingExecution,
                PreparedVaultRetiredImmediateRedeemExecution,
                VaultEstimatedOutputReference,
                VaultMinimumOutput,
                VaultRationalSlippageBound,
                QuotePositionDecreaseIntentInput,
                QuotePositionIncreaseIntentInput,
            } from '../src/index.js';

            export type PositionDecreasePublicTypes = readonly [
                BuildPositionDecreaseIntentExecutionInput,
                ExactPositionDecreaseIntentQuote,
                ExactRatio,
                NormalizedPositionDecreaseIntent,
                PositionDecreaseCollateralReturnIntent,
                PositionDecreaseExecutionIntent,
                PositionDecreaseFillOrKillPolicy,
                PositionDecreaseIntentOutcome,
                PositionDecreasePartialSizeIntent,
                PositionDecreaseSizeIntent,
                QuotePositionDecreaseIntentInput,
            ];

            export type PositionIncreasePublicTypes = readonly [
                BuildPositionIncreaseIntentExecutionInput,
                ExactPositionIncreaseIntentQuote,
                NormalizedPositionIncreaseIntent,
                PositionIncreaseExecutionIntent,
                PositionIncreaseFillOrKillPolicy,
                PositionIncreaseIntentOutcome,
                QuotePositionIncreaseIntentInput,
            ];

            export const queries: readonly [
                AccountOrderQuery,
                AccountFillQuery,
                AccountVaultOrderQuery,
                AccountLifecycleQuery,
            ] = [{}, {}, {}, {}];

            export const denomination: RankingDenomination = {
                collateralAssetId: 'xlm',
                decimals: 7,
            };

            export const fillEconomicsInput: AccountFillNetPnlInput = {
                economicsCompleteness: 'complete',
                pnlAtomic: 50n,
                fees: {
                    baseAtomic: 5n,
                    impactAtomic: 2n,
                    fundingAtomic: -3n,
                    borrowingAtomic: 1n,
                    liquidationAtomic: 0n,
                    forfeitAtomic: 0n,
                    keeperExecutionAtomic: 11n,
                    relayAtomic: 13n,
                },
            };
            export const fillEconomicsResult: AccountFillNetPnlResult = {
                kind: 'exact',
                grossPnlAtomic: 50n,
                netPnlAtomic: 21n,
            };

            const reference: VaultEstimatedOutputReference = {
                kind: 'estimate',
                output: 100n,
            };
            const maximumSlippage: VaultRationalSlippageBound = {
                numerator: 1n,
                denominator: 100n,
            };
            export const minimumOutputInput: DeriveVaultMinimumOutputInput = {
                reference,
                maximumSlippage,
            };
            export const minimumOutput: VaultMinimumOutput = {
                reference,
                maximumSlippage,
                rounding: 'floor',
                minOut: 99n,
            };

            export const vaultQuote: ExactVaultOrderCreationQuote = {
                kind: 'exact',
                ledger: 1,
                priceTime: 2n,
                value: {
                    kind: 'retiredImmediateRedeem',
                    policy: 'direct',
                    action: 'redeem',
                    shares: 100n,
                    assets: 99n,
                    minOutApplied: false,
                    executionFee: 0n,
                },
            };
            export const retiredExecution: PreparedVaultRetiredImmediateRedeemExecution = {
                action: 'retiredImmediateRedeem',
                policy: 'retiredImmediateRedeem',
                transport: 'direct',
                operationXdr: 'AAAA',
            };
            export const restingExecution: PreparedVaultRestingExecution = {
                action: 'resting',
                vaultAction: 'redeem',
                policy: 'restOnly',
                transport: 'direct',
                operationXdr: 'AAAA',
            };
            export const executions: readonly PreparedVaultActionExecution[] = [
                restingExecution,
                retiredExecution,
            ];
            export const vaultBuildInput: BuildVaultActionExecutionInput = {
                tradingAddress: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                user: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                quote: vaultQuote,
            };
        `;
        const options: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.Node16,
            moduleResolution: ts.ModuleResolutionKind.Node16,
            strict: true,
            skipLibCheck: true,
            noEmit: true,
        };
        const host = ts.createCompilerHost(options);
        const readFile = host.readFile.bind(host);
        const fileExists = host.fileExists.bind(host);
        host.fileExists = (path) => path === consumerPath || fileExists(path);
        host.readFile = (path) =>
            path === consumerPath ? source : readFile(path);
        host.getSourceFile = (path, languageVersion) => {
            const contents = host.readFile(path);
            return contents === undefined
                ? undefined
                : ts.createSourceFile(path, contents, languageVersion, true);
        };

        const program = ts.createProgram([consumerPath], options, host);
        const diagnostics = ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) =>
                ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            );

        expect(diagnostics).toEqual([]);
    });

    it('exports subject-bound snapshots without requiring subjects on legacy fixtures', () => {
        const consumerPath = fileURLToPath(
            new URL('./root-snapshot-subject-consumer.ts', import.meta.url),
        );
        const source = `
            import type {
                TradingSnapshot,
                TradingSnapshotSubject,
                SubjectBoundTradingSnapshot,
                QuoteResult,
            } from '../src/index.js';
            import type {
                SubjectBoundTradingSnapshot as TradingEntryBoundSnapshot,
            } from '../src/trading/index.js';
            import { loadTradingSnapshot } from '../src/index.js';

            const legacyFields = {} as Omit<TradingSnapshot, 'subject'>;
            export const legacy: TradingSnapshot = legacyFields;
            export const subject: TradingSnapshotSubject = {
                user: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                isLong: true,
            };
            export const bound: SubjectBoundTradingSnapshot = {
                ...legacyFields,
                subject,
                adl: { long: false, short: false },
                collateralToken: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            };
            export const tradingEntryBound: TradingEntryBoundSnapshot = bound;
            export const loaded: Promise<QuoteResult<SubjectBoundTradingSnapshot>> =
                loadTradingSnapshot({} as Parameters<typeof loadTradingSnapshot>[0]);
        `;
        const options: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.Node16,
            moduleResolution: ts.ModuleResolutionKind.Node16,
            strict: true,
            skipLibCheck: true,
            noEmit: true,
        };
        const host = ts.createCompilerHost(options);
        const readFile = host.readFile.bind(host);
        const fileExists = host.fileExists.bind(host);
        host.fileExists = (path) => path === consumerPath || fileExists(path);
        host.readFile = (path) =>
            path === consumerPath ? source : readFile(path);
        host.getSourceFile = (path, languageVersion) => {
            const contents = host.readFile(path);
            return contents === undefined
                ? undefined
                : ts.createSourceFile(path, contents, languageVersion, true);
        };

        const program = ts.createProgram([consumerPath], options, host);
        const diagnostics = ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) =>
                ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            );

        expect(diagnostics).toEqual([]);
    });
});
