import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('package root type exports', () => {
    it('exports every intent and vault type used by execution builders', () => {
        const consumerPath = fileURLToPath(
            new URL('./root-account-query-consumer.ts', import.meta.url),
        );
        const source = `
            import type {
                ApplyOrderOptions,
                BuildVaultActionExecutionInput,
                DeriveVaultMinimumOutputInput,
                ExactVaultOrderCreationQuote,
                FeeBreakdown,
                MarginState,
                OrderApplication,
                PositionActionOutcome,
                PreparedVaultActionExecution,
                PreparedVaultRestingExecution,
                PreparedVaultRetiredImmediateRedeemExecution,
                VaultEstimatedOutputReference,
                VaultMinimumOutput,
            } from '../src/index.js';

            export type PositionPublicTypes = readonly [
                ApplyOrderOptions,
                FeeBreakdown,
                MarginState,
                OrderApplication,
                PositionActionOutcome,
            ];

            const reference: VaultEstimatedOutputReference = {
                kind: 'estimate',
                output: 100n,
            };
            const maximumSlippageBps = 100n;
            export const minimumOutputInput: DeriveVaultMinimumOutputInput = {
                reference,
                maximumSlippageBps,
            };
            export const minimumOutput: VaultMinimumOutput = {
                reference,
                maximumSlippageBps,
                rounding: 'floor',
                minOut: 99n,
            };

            export const vaultQuote: ExactVaultOrderCreationQuote = {
                kind: 'exact',
                ledger: 1,
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
    }, 15_000);

    it('exports a subject-bound market context whose subject stays optional on bare fixtures', () => {
        const consumerPath = fileURLToPath(
            new URL('./root-snapshot-subject-consumer.ts', import.meta.url),
        );
        const source = `
            import type {
                MarketContext,
                MarketSubject,
                SubjectBoundMarketContext,
                MarketContracts,
                MarketStateData,
            } from '../src/index.js';
            import { Market, MarketUser, marketContext } from '../src/index.js';

            const bareFields = {} as Omit<MarketContext, 'subject'>;
            export const bare: MarketContext = bareFields;
            export const subject: MarketSubject = {
                user: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                isLong: true,
            };
            export const bound: SubjectBoundMarketContext = {
                ...bareFields,
                subject,
                adl: { long: false, short: false },
                collateralToken: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            };
            export const contracts: MarketContracts = {
                market: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                vault: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                token: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            };
            export const loaded: Promise<Market> =
                Market.load({} as Parameters<typeof Market.load>[0], contracts);
            export const rebuilt: Market =
                Market.fromData({} as Parameters<typeof Market.load>[0], {} as MarketStateData);
            export const composed: MarketContext = marketContext(
                rebuilt,
                {} as MarketUser,
                { isLong: true, price: bare.price },
            );
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
    }, 15_000);
});
