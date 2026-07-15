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
            } from '../src/index.js';

            export const queries: readonly [
                AccountOrderQuery,
                AccountFillQuery,
                AccountVaultOrderQuery,
                AccountLifecycleQuery,
            ] = [{}, {}, {}, {}];
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
