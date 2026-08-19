import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('package root type exports', () => {
    it('exports the estimate and intent types a consumer builds against', () => {
        const consumerPath = fileURLToPath(
            new URL('./root-account-query-consumer.ts', import.meta.url),
        );
        const source = `
            import type {
                MarketContracts,
                MarketEstimate,
                OrderEstimate,
                PendingOrder,
                PositionEstimate,
                PriceInput,
                SideRatesEstimate,
            } from '../src/index.js';
            import { Price } from '../src/index.js';

            export const contracts: MarketContracts = {
                market: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                vault: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                token: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            };
            export const asBigint: PriceInput = 100n;
            export const asPrice: PriceInput = Price.from(100n);
            export const side: SideRatesEstimate = {} as SideRatesEstimate;
            export const market: MarketEstimate = {} as MarketEstimate;
            export const position: PositionEstimate = {} as PositionEstimate;
            export const order: OrderEstimate = {} as OrderEstimate;
            export const gateCode: number | undefined = order.gate?.code;
            export const pending: PendingOrder = {} as PendingOrder;
            // Estimates are plain data: spreading must type-check.
            export const spread = { ...market, ...position };
            // The resulting position rides inside the order estimate.
            export const after: PositionEstimate | undefined = order.position;
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

    it('types the loaded classes and the estimate functions end to end', () => {
        const consumerPath = fileURLToPath(
            new URL('./root-snapshot-subject-consumer.ts', import.meta.url),
        );
        const source = `
            import type {
                MarketContracts,
                MarketEstimate,
                OrderEstimate,
                PositionEstimate,
            } from '../src/index.js';
            import {
                Market,
                MarketPosition,
                MarketUser,
                OrderIntent,
                VaultOrderIntent,
                estimateMarket,
                estimatePosition,
                previewOrder,
            } from '../src/index.js';

            const contracts: MarketContracts = {
                market: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                vault: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                token: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            };
            export const loaded: Promise<Market> =
                Market.load({} as Parameters<typeof Market.load>[0], contracts);
            export const pair: Promise<{ market: Market; user: MarketUser }> =
                Market.loadWithUser(
                    {} as Parameters<typeof Market.load>[0],
                    contracts,
                    'G',
                );
            declare const market: Market;
            declare const user: MarketUser;
            export const est: MarketEstimate = estimateMarket(market, 100n);
            export const pos: PositionEstimate = estimatePosition(
                market,
                user.long,
                100n,
            );
            const intent = new OrderIntent(market, 'G', true);
            export const prev: OrderEstimate = previewOrder(
                market,
                user.long,
                intent.openMarket({ notional: 1n, margin: 1n }),
                100n,
            );
            export const prevViaMethod: OrderEstimate = user.long.preview(
                market,
                intent.closePosition(),
                100n,
            );
            export const row: MarketPosition = user.short;
            export const vaultOp: string = VaultOrderIntent.create(
                market,
                'G',
                0,
                100n,
            ).toOperation();
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
