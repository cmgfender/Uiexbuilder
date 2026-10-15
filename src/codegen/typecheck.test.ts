// @vitest-environment node
/**
 * End-to-end checks of generated projects against the real toolchain:
 *  1. every generated .tsx type-checks (strict) against the installed @hubspot/ui-extensions,
 *     both with the spec'd bundler settings and with the project's own tsconfig.json (Node16);
 *  2. every card / settings / home entry bundles with esbuild;
 *  3. every generated .tsx / .js / .json file parses with prettier (and formatSource works).
 *
 * Projects are written under node_modules/.tmp so `@hubspot/ui-extensions` and `react` resolve
 * from the repository's node_modules.
 */
import path from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';
import * as prettier from 'prettier';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProject } from '../model/factory';
import { ALL_COMPONENTS } from '../registry';
import { formatDiagnostics, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import { createEdgeCaseProject, createFeatureProject, createKitchenSinkProject, createPowerProject } from './fixtures';
import { formatSource, generateProjectFiles, type GeneratedFile } from './index';

interface CaseOutput {
  name: string;
  dir: string;
  files: GeneratedFile[];
}

const cases: CaseOutput[] = [];
let outDir = '';

function writeCase(name: string, files: GeneratedFile[]): CaseOutput {
  const dir = path.join(outDir, name);
  writeFiles(dir, files);
  return { name, dir, files };
}

function tsxPaths(c: CaseOutput): string[] {
  return c.files.filter((f) => f.path.endsWith('.tsx')).map((f) => path.join(c.dir, f.path));
}

beforeAll(() => {
  outDir = scratchDir('codegen-check');
  cases.push(writeCase('default', generateProjectFiles(createProject())));
  cases.push(writeCase('features', generateProjectFiles(createFeatureProject())));
  cases.push(writeCase('kitchen-sink', generateProjectFiles(createKitchenSinkProject())));
  cases.push(writeCase('edge-cases', generateProjectFiles(createEdgeCaseProject())));
  cases.push(writeCase('power', generateProjectFiles(createPowerProject())));
});

describe('generated projects', () => {
  it('kitchen sink covers every registered component', () => {
    const sink = cases.find((c) => c.name === 'kitchen-sink')!;
    const sources = sink.files.filter((f) => f.path.endsWith('.tsx')).map((f) => f.contents).join('\n');
    const missing = ALL_COMPONENTS.filter((def) => !sources.includes(`<${def.type}`)).map((def) => def.type);
    expect(missing).toEqual([]);
  });

  it('type-check with zero diagnostics (strict, bundler resolution)', () => {
    expect(formatDiagnostics(typecheck(cases.flatMap(tsxPaths)))).toBe('');
  });

  it("type-check with each UI directory's generated tsconfig.json (Node16)", () => {
    for (const c of cases) {
      const configs = c.files.filter((f) => /^src\/app\/(cards|settings|pages)\/tsconfig\.json$/.test(f.path));
      expect(configs.length).toBeGreaterThan(0);
      for (const config of configs) {
        const configPath = path.join(c.dir, config.path);
        const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: (d) => {
            throw new Error(formatDiagnostics([d]));
          },
        });
        expect(parsed).toBeDefined();
        const diagnostics = typecheck(parsed!.fileNames, parsed!.options);
        expect(`${c.name}/${config.path}\n${formatDiagnostics(diagnostics)}`).toBe(
          `${c.name}/${config.path}\n`,
        );
      }
    }
  });

  it('bundles every extension entry with esbuild', async () => {
    for (const c of cases) {
      for (const entry of tsxPaths(c)) {
        const result = await build({
          entryPoints: [entry],
          bundle: true,
          write: false,
          format: 'esm',
          jsx: 'automatic',
          platform: 'neutral',
          logLevel: 'silent',
          external: ['react', 'react/*', '@hubspot/*'],
        });
        expect(result.errors).toEqual([]);
        // `hubspot` may be imported under an alias when the document shadows it.
        expect(result.outputFiles[0].text).toMatch(/\bhubspot(?:Api\d*)?\.extend\(/);
      }
    }
  });

  it('every generated source and JSON file parses with prettier', async () => {
    for (const c of cases) {
      for (const file of c.files) {
        const parser = file.path.endsWith('.tsx')
          ? 'typescript'
          : file.path.endsWith('.js')
            ? 'babel'
            : file.path.endsWith('.json')
              ? 'json'
              : null;
        if (!parser) continue;
        await expect(prettier.format(file.contents, { parser, singleQuote: true }), `${c.name}/${file.path}`).resolves.toBeTypeOf(
          'string',
        );
      }
    }
  });

  it('formatSource formats generated code with the standalone build', async () => {
    const features = cases.find((c) => c.name === 'features')!;
    const card = features.files.find((f) => f.path.endsWith('.tsx'))!;
    const formatted = await formatSource(card.contents, card.path);
    expect(formatted).toContain('hubspot.extend');
    // Prettier output is stable.
    expect(await formatSource(formatted, card.path)).toBe(formatted);
    const json = features.files.find((f) => f.path === 'src/app/app-hsmeta.json')!;
    expect(JSON.parse(await formatSource(json.contents, json.path))).toEqual(JSON.parse(json.contents));
    expect(await formatSource('not ( valid', 'x.tsx')).toBe('not ( valid');
    expect(await formatSource('# Title', 'README.md')).toBe('# Title');
  });
});
