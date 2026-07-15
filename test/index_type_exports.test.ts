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
                AccountVaultOrderQuery,
                AccountLifecycleQuery,
                RankingDenomination,
                BuildPositionDecreaseIntentExecutionInput,
                BuildVaultActionExecutionInput,
                DeriveVaultMinimumOutputInput,
                ExactPositionDecreaseIntentQuote,
                ExactRatio,
                ExactVaultOrderCreationQuote,
                NormalizedPositionDecreaseIntent,
                PositionDecreaseCollateralReturnIntent,
                PositionDecreaseExecutionIntent,
                PositionDecreaseFillOrKillPolicy,
                PositionDecreaseIntentOutcome,
                PositionDecreasePartialSizeIntent,
                PositionDecreaseSizeIntent,
                PreparedVaultActionExecution,
                PreparedVaultRestingExecution,
                PreparedVaultRetiredImmediateRedeemExecution,
                VaultEstimatedOutputReference,
                VaultMinimumOutput,
                VaultRationalSlippageBound,
                QuotePositionDecreaseIntentInput,
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
});
