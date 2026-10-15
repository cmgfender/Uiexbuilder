// @vitest-environment node
/**
 * Exported-project fixes: requests (GET bodies, headers, timeouts, empty responses), strict
 * type-checking of set-state values and optional context members, comment sanitising and
 * permitted URLs found in code.
 */
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import type { ActionStep, DataSource, NodeTemplate, Project, StateVar } from '../model/types';
import { formatDiagnostics, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import { generateExtensionSource, generateProjectFiles } from './index';
import { deriveRequirements, fetchUrlsInCode, urlOriginHint } from './requirements';
import { inferValueType, optionalContextAccess } from './rewrite';

let n = 0;
type StepInput = ActionStep extends infer S ? (S extends ActionStep ? Omit<S, 'id'> : never) : never;
const step = (s: StepInput): ActionStep => ({ ...s, id: `a${n++}` }) as ActionStep;
const st = (name: string, type: StateVar['type'], initial: StateVar['initial']): StateVar => ({ id: `s_${name}`, name, type, initial });

function project(content: NodeTemplate[], opts: { state?: StateVar[]; dataSources?: DataSource[]; functions?: Project['functions'] } = {}): Project {
  const ext = createExtension({ name: 'Deploy', content });
  ext.state = opts.state ?? [];
  ext.dataSources = opts.dataSources ?? [];
  const p = createProject('Deploy test', [ext]);
  p.functions = opts.functions ?? [];
  return p;
}

function source(p: Project): string {
  return generateExtensionSource(p, p.extensions[0]);
}

/** Strict type-check of the project's generated extensions against the real package. */
function typeErrors(p: Project, name: string): string {
  const dir = scratchDir(`deploy-fixes-${name}`);
  const files = generateProjectFiles(p).filter((f) => f.path.endsWith('.tsx'));
  const paths = writeFiles(dir, files).map((f) => path.resolve(f));
  return formatDiagnostics(typecheck(paths));
}

describe('requests', () => {
  it('never sends a body with GET and passes headers / timeouts through', () => {
    const p = project(
      [
        {
          type: 'Button',
          text: 'Go',
          events: {
            onClick: [
              step({ type: 'fetch', url: 'https://api.example.com/a', method: 'GET', body: '{ stale: true }', headers: [{ key: 'X-API-Version', value: '2' }, { key: '', value: 'ignored' }], timeout: 5000, resultState: 'out' }),
              step({ type: 'fetch', url: 'https://api.example.com/b', method: 'DELETE', body: '{ id: 7 }', onSuccess: [step({ type: 'log', level: 'info', message: '{{ response }}' })] }),
            ],
          },
        },
        { type: 'Text', text: '{{ items?.length }}' },
      ],
      {
        state: [st('out', 'any', null), st('token', 'string', 'abc')],
        dataSources: [
          { id: 'd1', kind: 'fetch', name: 'items', url: 'https://api.example.com/items', method: 'GET', body: '{ id: context.crm.objectId }', headers: [{ key: 'Authorization', value: 'Bearer {{ token }}' }], timeout: 3000, runOnMount: true },
        ],
      },
    );
    const src = source(p);
    expect(src).not.toContain('stale');
    expect(src).not.toContain('objectId');
    expect(src).toMatch(/method: 'GET',\s+headers: \{ 'X-API-Version': '2' \},\s+timeout: 5000,/);
    expect(src).toContain("Authorization: `Bearer ${toText(token)}`");
    expect(src).toContain('timeout: 3000');
    expect(src).toMatch(/method: 'DELETE',\s+body: \{ id: 7 \}/);
    // Empty / 204 responses are null (like the designer), not a JSON parse error.
    expect(src).toContain('const response = await readJson(res);');
    expect(src).toContain('setItems(await readJson(response));');
    expect(src).not.toContain('.json()');
    // The loader re-creates when the header's state changes.
    expect(src).toContain('}, [token]);');
    expect(typeErrors(p, 'requests')).toBe('');
  });
});

describe('strict types of user values', () => {
  it('casts set-state values whose type differs from the state, and only those', () => {
    const p = project(
      [
        {
          type: 'Button',
          text: 'Set',
          events: {
            onClick: [
              step({ type: 'setState', state: 'count', value: 'name' }),
              step({ type: 'setState', state: 'name', value: 'count + 1' }),
              step({ type: 'setState', state: 'done', value: "'yes'" }),
              step({ type: 'setState', state: 'items', value: '{ a: 1 }' }),
              step({ type: 'setState', state: 'count', value: 'count + 1' }),
              step({ type: 'setState', state: 'name', value: "'Ada'" }),
              step({ type: 'setState', state: 'done', value: 'count > 2' }),
              step({ type: 'setState', state: 'items', value: '[...items, name]' }),
              step({ type: 'setState', state: 'maybe', value: 'null' }),
            ],
          },
        },
        { type: 'Text', text: '{{ count }} {{ name }} {{ done }} {{ items }} {{ maybe }}' },
      ],
      { state: [st('count', 'number', 0), st('name', 'string', ''), st('done', 'boolean', false), st('items', 'array', []), st('maybe', 'string', null)] },
    );
    const src = source(p);
    expect(src).toContain('setCount(name as any);');
    expect(src).toContain('setName((count + 1) as any);');
    expect(src).toContain("setDone('yes' as any);");
    expect(src).toContain('setItems(({ a: 1 }) as any);');
    expect(src).toContain('setCount(count + 1);');
    expect(src).toContain("setName('Ada');");
    expect(src).toContain('setDone(count > 2);');
    expect(src).toContain('setItems([...items, name]);');
    expect(src).toContain('setMaybe(null);');
    expect(typeErrors(p, 'setstate')).toBe('');
  });

  it('an If / else without a condition runs only its else branch and type-checks', () => {
    const p = project(
      [
        {
          type: 'Button',
          text: 'Go',
          events: {
            onClick: [
              step({ type: 'if', condition: '', then: [step({ type: 'setState', state: 'count', value: '1' })], else: [step({ type: 'setState', state: 'count', value: '2' })] }),
              step({ type: 'if', condition: '  ', then: [step({ type: 'setState', state: 'count', value: '3' })], else: [] }),
            ],
          },
        },
        { type: 'Text', text: '{{ count }}' },
      ],
      { state: [st('count', 'number', 0)] },
    );
    const src = source(p);
    expect(src).not.toContain('if (undefined)');
    expect(src).toContain('setCount(2);');
    expect(src).not.toContain('setCount(1)');
    expect(src).not.toContain('setCount(3)');
    expect(typeErrors(p, 'empty-if')).toBe('');
  });

  it('user expressions can call toText, the interpolation helper (fx toggle output)', () => {
    const p = project(
      [
        { type: 'Text', text: 'x', props: {} },
        { type: 'Image', props: { src: 'https://img.example.com/a.png', alt: { $expr: '`Owner: ${toText(owner)} (${toText(done)})`' } } },
      ],
      { state: [st('owner', 'any', null), st('done', 'boolean', false)] },
    );
    const src = source(p);
    expect(src).toContain('const toText = (value: unknown): string =>');
    expect(src).toContain('alt={`Owner: ${toText(owner)} (${toText(done)})`}');
    expect(typeErrors(p, 'to-text-expr')).toBe('');
  });

  it('reads optional context members with ?. so they type-check', () => {
    const p = project([
      { type: 'Text', text: 'App: {{ context.extension.appName }}' },
      { type: 'Text', text: 'Lang: {{ context.user.language.toUpperCase() }}' },
      { type: 'Text', text: "Var: {{ context.variables.apiBase }} {{ context.variables['x'] }}" },
      { type: 'Text', text: 'User: {{ context.user.firstName.toUpperCase() }}' },
    ]);
    const src = source(p);
    expect(src).toContain('context.extension?.appName');
    expect(src).toContain('context.user.language?.toUpperCase()');
    expect(src).toContain('context.variables?.apiBase');
    expect(src).toContain("context.variables?.['x']");
    expect(src).toContain('context.user.firstName.toUpperCase()');
    expect(typeErrors(p, 'context')).toBe('');
  });

  it('rewrites only real context references', () => {
    expect(optionalContextAccess("'context.extension.x' + context.extension.cardTitle.length")).toBe(
      "'context.extension.x' + context.extension?.cardTitle?.length",
    );
    expect(optionalContextAccess('a.context.extension.appName')).toBe('a.context.extension.appName');
    expect(optionalContextAccess('context.extension?.appName')).toBe('context.extension?.appName');
  });

  it('infers simple expression types conservatively', () => {
    const known = (name: string) => ({ count: 'number', name: 'string' })[name] ?? null;
    expect(inferValueType('count + 1', known)).toBe('number');
    expect(inferValueType("name + '!'", known)).toBe('string');
    expect(inferValueType('count > 1', known)).toBe('boolean');
    expect(inferValueType('`a${count}`', known)).toBe('string');
    expect(inferValueType('response.data', known)).toBeNull();
    expect(inferValueType('a ? 1 : 2', known)).toBeNull();
    expect(inferValueType('foo(count)', known)).toBeNull();
  });
});

describe('comments in generated code', () => {
  const payloads = ['a\r\npwnedJ()\r\n', 'a pwnedJ() b', 'x */ pwnedJ() /*'];
  for (const payload of payloads) {
    it(`keeps ${JSON.stringify(payload)} inside comments`, () => {
      const p = project([{ type: 'Text', text: '{{ assoc }} {{ found }} {{ fnres }} {{ api }}' }], {
        dataSources: [
          { id: 'd1', kind: 'associations', name: 'assoc', toObjectType: payload, properties: [], pageLength: 5 },
          { id: 'd2', kind: 'crmSearch', name: 'found', objectType: payload, properties: [], filters: [], sorts: [], pageLength: 5 },
          { id: 'd3', kind: 'function', name: 'fnres', functionId: 'f1', runOnMount: false },
          { id: 'd4', kind: 'fetch', name: 'api', url: 'https://a.example.com', method: payload as 'GET', runOnMount: false },
        ],
        functions: [{ id: 'f1', uid: payload, fileName: 'fn', code: 'exports.main = async () => 1;', secretKeys: [] }],
      });
      p.extensions[0].state = [{ id: 's1', name: 'x', type: 'string', initial: '', description: payload }];
      const src = source(p);
      const sf = ts.createSourceFile('x.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const calls: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === 'pwnedJ') calls.push(node.getText(sf));
        ts.forEachChild(node, visit);
      };
      visit(sf);
      expect(calls).toEqual([]);
      expect((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    });
  }
});

describe('project files', () => {
  it('README covers secrets, installing the app and placing each card', () => {
    const p = project([{ type: 'Text', text: 'x' }], {
      functions: [
        { id: 'f1', uid: 'quote_fn', fileName: 'quote', code: 'exports.main = async () => 1;', secretKeys: ['API_TOKEN'] },
        { id: 'f2', uid: 'public_status', fileName: 'status', code: 'exports.main = async () => 1;', secretKeys: ['API_TOKEN', 'OTHER'], endpoint: { path: 'status', methods: ['GET'] } },
      ],
    });
    p.extensions.push({ ...createExtension({ name: 'Side', location: 'crm.record.sidebar' }) });
    const readme = generateProjectFiles(p).find((f) => f.path === 'README.md')!.contents;
    expect(readme).toContain('hs secret add API_TOKEN\nhs secret add OTHER');
    expect(readme).toContain('hs project install-app');
    expect(readme.indexOf('hs project upload')).toBeLessThan(readme.indexOf('hs project install-app'));
    expect(readme).toContain('`public_status` — `GET /hs/serverless/status`');
    expect(readme).toContain('`quote_fn` — `src/app/functions/');
    expect(readme).toMatch(/- Deploy \(a tab in the middle column of the record page\): open a record, click \*\*Customize\*\*/);
    expect(readme).toMatch(/- Side \(the right sidebar of the record page\): open a record, click \*\*Customize\*\*, edit the right sidebar/);
    p.app.authType = 'oauth';
    const oauth = generateProjectFiles(p).find((f) => f.path === 'README.md')!.contents;
    expect(oauth).not.toContain('hs project install-app');
    expect(oauth).toContain('use the install link (OAuth)');
  });

  it('writes endpoint paths in the official leading-slash form', () => {
    const p = project([{ type: 'Text', text: 'x' }], {
      functions: [{ id: 'f2', uid: 'public_status', fileName: 'status', code: 'exports.main = async () => 1;', secretKeys: [], endpoint: { path: 'api/status', methods: [] } }],
    });
    const meta = JSON.parse(generateProjectFiles(p).find((f) => f.path === 'src/app/functions/status-hsmeta.json')!.contents) as {
      config: { endpoint: { path: string; methods: string[] } };
    };
    expect(meta.config.endpoint).toEqual({ path: '/api/status', methods: ['GET'] });
  });

  it('UI package.json meets the HubSpot CLI lint requirements', () => {
    const pkg = JSON.parse(generateProjectFiles(project([])).find((f) => f.path === 'src/app/cards/package.json')!.contents) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies['typescript-eslint']).toBe('^8.46.4');
    expect(pkg.devDependencies.jiti).toBe('^2.6.1');
  });
});

describe('permitted URLs found in code', () => {
  it('adds origins of hubspot.fetch literals in custom code, helpers and computed values', () => {
    const p = project([
      {
        type: 'Button',
        text: 'Sync',
        events: { onClick: [step({ type: 'custom', code: "await hubspot.fetch('https://other.example.net/sync', { method: 'POST' });" })] },
      },
    ]);
    p.extensions[0].helpers = 'async function load(id) { return hubspot.fetch(`https://helpers.example.org/items/${id}`); }';
    p.extensions[0].computed = [{ id: 'c1', name: 'req', expr: "() => hubspot.fetch(\"https://computed.example.com/x\")" }];
    expect(deriveRequirements(p).fetch).toEqual(['https://computed.example.com', 'https://helpers.example.org', 'https://other.example.net']);
  });

  it('ignores dynamic hosts and explains them', () => {
    expect(fetchUrlsInCode('hubspot.fetch(`https://${host}/x`); other.fetch("https://no.example.com")')).toEqual(['https://{{ dynamic }}']);
    expect(urlOriginHint('{{ apiBase }}/items', { state: [st('apiBase', 'string', 'https://api.acme.io')] })).toEqual({
      dynamic: true,
      suggestion: 'https://api.acme.io',
    });
    expect(urlOriginHint('https://api.example.com/{{ id }}', { state: [] })).toEqual({ dynamic: false, suggestion: 'https://api.example.com' });
  });
});
