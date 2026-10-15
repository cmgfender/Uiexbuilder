/**
 * Test helper: type-checks generated code against the real `@hubspot/ui-extensions` package with
 * the TypeScript compiler API. Shared by the codegen type-check test and the registry conformance
 * test so both check generated sources the same way.
 *
 * Generated files are written under `node_modules/.tmp/<name>` so `@hubspot/ui-extensions` and
 * `react` resolve from the repository's node_modules.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const REPO_ROOT = process.cwd();

/** Strict settings of the spec'd build (bundler resolution, like Vite / esbuild projects). */
export const STRICT_BUNDLER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  allowImportingTsExtensions: true,
  isolatedModules: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

/** A fresh, empty output directory under node_modules/.tmp. */
export function scratchDir(name: string): string {
  const dir = path.join(REPO_ROOT, 'node_modules', '.tmp', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes `files` (paths relative to `dir`) and returns their absolute paths in the same order. */
export function writeFiles(dir: string, files: ReadonlyArray<{ path: string; contents: string }>): string[] {
  return files.map((file) => {
    const target = path.join(dir, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.contents);
    return target;
  });
}

/** Pre-emit diagnostics (syntax, semantic, options) of a program over `rootNames`. */
export function typecheck(rootNames: string[], options: ts.CompilerOptions = STRICT_BUNDLER_OPTIONS): readonly ts.Diagnostic[] {
  const program = ts.createProgram({ rootNames, options });
  return ts.getPreEmitDiagnostics(program);
}

/** Human-readable diagnostics (file:line:col - error TSxxxx: message), '' when there are none. */
export function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => REPO_ROOT,
    getNewLine: () => '\n',
  });
}
