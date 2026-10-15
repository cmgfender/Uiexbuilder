// @vitest-environment node
/**
 * Renders generated extensions with HubSpot's official test renderer
 * (`@hubspot/ui-extensions/testing`) the way HubSpot runs them on open: CRM hooks first return
 * their loading values (`properties: {}`, `results: []`, `isLoading: true`) and fetch / function
 * sources start out `null`. A card that renders in the designer must not crash on this first render.
 *
 * Each case is bundled with esbuild (generated component + the test renderer, one copy of React)
 * and imported from node_modules/.tmp so packages resolve from the repository.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { extensionLocation } from '../model/rules';
import type { DataSource, Extension, NodeTemplate, Project } from '../model/types';
import { REPO_ROOT, scratchDir } from '../test/typecheck';
import { createEdgeCaseProject, createFeatureProject, createKitchenSinkProject, createPowerProject } from './fixtures';
import { generateExtensionSource } from './index';

interface RunResult {
  problems: string[];
  calls: string[];
}

const HARNESS = `
const calls = [];
const problems = [];
let renderFn = null;
globalThis.self = globalThis;
Object.assign(globalThis, {
  __HUBSPOT_EXTENSION_WORKER__: true,
  extend_V2: (fn) => { renderFn = fn; },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  hsFetch: async (url, opts) => {
    calls.push('fetch ' + url + ' ' + JSON.stringify(opts ?? {}));
    return new Response(globalThis.__fetchBody ?? '{"ok":true}', { status: globalThis.__fetchStatus ?? 200 });
  },
  serverless: async (name, opts) => {
    calls.push('serverless ' + name + ' ' + JSON.stringify(opts ?? {}));
    return { ok: true };
  },
});
const { createRenderer } = await import('@hubspot/ui-extensions/testing');
await import('./entry.tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pagination = { hasNextPage: false, hasPreviousPage: false, currentPage: 1, pageSize: 10, nextPage() {}, previousPage() {}, reset() {} };

export async function run(location, { loading, properties }) {
  const r = createRenderer(location);
  if (loading) {
    let props = {};
    let isLoading = true;
    r.mocks.useCrmProperties.willCall(() => ({ properties: props, error: null, isLoading, isRefetching: false, refetch: async () => {} }));
    r.mocks.useAssociations.willCall(() => ({ results: [], error: null, isLoading: true, isRefetching: false, refetch: async () => {}, pagination }));
    r.mocks.useCrmSearch.willCall(() => ({ results: [], error: null, isLoading: true, isRefetching: false, refetch: async () => {}, pagination }));
    globalThis.__finishLoading = () => { props = properties ?? {}; isLoading = false; };
  }
  const origError = console.error;
  console.error = (...a) => {
    const s = a.map(String).join(' ');
    if (/Cannot update a component|Maximum update depth/.test(s)) problems.push('react: ' + s.slice(0, 200));
  };
  try {
    r.render(renderFn({ context: r.mocks.context, actions: r.mocks.actions }));
    await sleep(30);
    if (globalThis.__finishLoading) {
      globalThis.__finishLoading();
      // Re-render with the loaded record (the hook mock returns the new values).
      r.render(renderFn({ context: r.mocks.context, actions: r.mocks.actions }));
      await sleep(30);
    }
  } catch (e) {
    problems.push('render threw: ' + (e && e.message));
  } finally {
    console.error = origError;
  }
  return { problems, calls };
}
`;

let caseCounter = 0;

async function renderGenerated(project: Project, ext: Extension, opts: { loading: boolean; properties?: Record<string, string> }): Promise<RunResult> {
  const dir = scratchDir(`hubspot-render-${caseCounter++}`);
  writeFileSync(path.join(dir, 'entry.tsx'), generateExtensionSource(project, ext));
  writeFileSync(path.join(dir, 'harness.mjs'), HARNESS);
  const out = path.join(dir, 'bundle.mjs');
  await build({
    entryPoints: [path.join(dir, 'harness.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    outfile: out,
    logLevel: 'silent',
    nodePaths: [path.join(REPO_ROOT, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const mod = (await import(/* @vite-ignore */ pathToFileURL(out).href)) as {
    run: (location: string, o: { loading: boolean; properties?: Record<string, string> }) => Promise<RunResult>;
  };
  return mod.run(extensionLocation(ext), opts);
}

function card(content: NodeTemplate[], dataSources: DataSource[], functions: Project['functions'] = []): Project {
  const ext = createExtension({ name: 'Render', content });
  ext.dataSources = dataSources;
  const project = createProject('Render test', [ext]);
  project.functions = functions;
  return project;
}

describe('generated extensions on HubSpot (first render while data loads)', () => {
  const fixtures: Array<[string, () => Project]> = [
    ['default', () => createProject()],
    ['feature', createFeatureProject],
    ['kitchen sink', createKitchenSinkProject],
    ['edge cases', createEdgeCaseProject],
    ['power', createPowerProject],
  ];
  for (const [name, make] of fixtures) {
    it(`${name}: every extension renders while CRM hooks and fetches are still loading`, async () => {
      const project = make();
      for (const ext of project.extensions) {
        const res = await renderGenerated(project, ext, { loading: true });
        expect({ extension: ext.name, problems: res.problems }).toEqual({ extension: ext.name, problems: [] });
      }
    });
  }

  it('detects cards that crash on the first render (harness self-check)', async () => {
    const project = card(
      [{ type: 'Text', text: 'Temp: {{ weather.temperature }}' }],
      [{ id: 'd1', kind: 'fetch', name: 'weather', url: 'https://api.example.com/w', method: 'GET', runOnMount: true }],
    );
    const res = await renderGenerated(project, project.extensions[0], { loading: true });
    expect(res.problems.join('\n')).toMatch(/reading 'temperature'/);
  });

  it('waits for record properties before a "load on open" request reads them', async () => {
    const project = card(
      [{ type: 'Text', text: '{{ weather?.temp }} {{ quote?.total }}' }],
      [
        { id: 'd1', kind: 'crmProperties', name: 'contact', properties: ['email', 'amount'] },
        { id: 'd2', kind: 'fetch', name: 'weather', url: 'https://api.example.com/w?email={{ contact.email }}', method: 'GET', runOnMount: true },
        { id: 'd3', kind: 'function', name: 'quote', functionId: 'f1', parameters: '{ amount: contact.amount }', runOnMount: true },
      ],
      [{ id: 'f1', uid: 'get_quote', fileName: 'getQuote', code: 'exports.main = async () => ({});', secretKeys: [] }],
    );
    const res = await renderGenerated(project, project.extensions[0], { loading: true, properties: { email: 'ada@example.com', amount: '42' } });
    expect(res.problems).toEqual([]);
    expect(res.calls).toEqual([
      'fetch https://api.example.com/w?email=ada@example.com {"method":"GET"}',
      'serverless get_quote {"parameters":{"amount":"42"}}',
    ]);
  });
});
