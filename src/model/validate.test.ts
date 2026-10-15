import { describe, expect, it } from 'vitest';
import { createAppFunction, createExtension, createProject } from './factory';
import type { ActionStep, AppFunction, ComputedValue, DataSource, Extension, NodeTemplate, Project, StateVar } from './types';
import { countIssues, scanReferences, validateProject, type Issue } from './validate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StepInput = ActionStep extends infer U ? (U extends ActionStep ? Omit<U, 'id'> : never) : never;
let stepId = 0;
const step = (s: StepInput): ActionStep => ({ ...s, id: `a_t${++stepId}` }) as ActionStep;

interface DocOptions {
  state?: Array<Omit<StateVar, 'id'> & { id?: string }>;
  dataSources?: DataSource[];
  computed?: ComputedValue[];
  helpers?: string;
  kind?: Extension['kind'];
  location?: Extension['location'];
  objectTypes?: string[];
  functions?: AppFunction[];
}

function doc(content: NodeTemplate[], opts: DocOptions = {}): { project: Project; ext: Extension } {
  const ext = createExtension({ content, kind: opts.kind, location: opts.location, objectTypes: opts.objectTypes });
  ext.state = (opts.state ?? []).map((v, i) => ({ id: v.id ?? `s_${i}`, ...v }));
  ext.dataSources = opts.dataSources ?? [];
  if (opts.computed) ext.computed = opts.computed;
  if (opts.helpers !== undefined) ext.helpers = opts.helpers;
  const project = createProject('Test App', [ext]);
  project.functions = opts.functions ?? [];
  return { project, ext };
}

function named(ext: Extension, name: string): string {
  const node = Object.values(ext.nodes).find((n) => n.name === name);
  if (!node) throw new Error(`no node ${name}`);
  return node.id;
}

function rules(issues: Issue[]): string[] {
  return issues.map((i) => i.rule);
}

function only(project: Project, rule: string): Issue[] {
  return validateProject(project).filter((i) => i.rule === rule);
}

const fn = (id: string, uid: string, code?: string): AppFunction => ({
  ...createAppFunction([], 'fn'),
  id,
  uid,
  fileName: id,
  ...(code !== undefined ? { code } : {}),
});

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

describe('validateProject baseline', () => {
  it('reports nothing for the default project', () => {
    expect(validateProject(createProject())).toEqual([]);
  });

  it('never throws on malformed documents', () => {
    const { project, ext } = doc([{ type: 'Button', text: 'Hi' }]);
    const root = ext.nodes[ext.rootId];
    root.children.push('n_missing');
    const btn = ext.nodes[root.children[0]];
    (btn as unknown as { props: unknown }).props = null;
    (btn as unknown as { events: unknown }).events = { onClick: 'nope' };
    (ext as unknown as { state: unknown }).state = undefined;
    (project as unknown as { functions: unknown }).functions = null;
    expect(() => validateProject(project)).not.toThrow();
    expect(validateProject({} as Project)).toEqual(expect.any(Array));
  });

  it('gives every issue a unique id and counts severities', () => {
    const { project } = doc([{ type: 'Button', text: '' }, { type: 'Button', text: '' }, { type: 'Nope' }]);
    project.name = 'Bad Name';
    const issues = validateProject(project);
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
    const counts = countIssues(issues);
    expect(counts.error).toBeGreaterThanOrEqual(2);
    expect(counts.warning).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Identifier scanner
// ---------------------------------------------------------------------------

describe('scanReferences', () => {
  it('ignores property accesses, keys, strings, keywords and locals', () => {
    expect(scanReferences('record.email + " x " + count')).toEqual(['record', 'count']);
    expect(scanReferences('{ email: email, note, total: a ? b : c }').sort()).toEqual(['a', 'b', 'c', 'email', 'note']);
    expect(scanReferences('deals.filter((d) => d.amount > min).map(x => x.id)')).toEqual(['deals', 'min']);
    expect(scanReferences('`Hello ${user.name}, ${count + 1}`')).toEqual(['user', 'count']);
    expect(scanReferences("typeof x === 'string' && /a+b/.test(y)")).toEqual(['x', 'y']);
    expect(scanReferences('items?.length ?? 0')).toEqual(['items']);
    expect(scanReferences('[...list, extra]')).toEqual(['list', 'extra']);
    expect(scanReferences('a / b / c')).toEqual(['a', 'b', 'c']);
  });

  it('understands declarations in statements', () => {
    const code = `
      const total = items.length; // count items
      let { a, b: renamed } = obj, other = 2;
      for (const row of rows) { logger.info(row); }
      function fmt(v, digits) { return v.toFixed(digits); }
      try { await go(); } catch (err) { console.log(err); }
      /* comment with fake */ return total + renamed + other + fmt(a, 2);
    `;
    expect(scanReferences(code).sort()).toEqual(['console', 'go', 'items', 'logger', 'obj', 'rows']);
  });
});

// ---------------------------------------------------------------------------
// Project & app
// ---------------------------------------------------------------------------

describe('project and app rules', () => {
  it('checks the project slug, app name and uid', () => {
    const { project } = doc([{ type: 'Text', text: 'x' }]);
    expect(rules(validateProject(project))).toEqual([]);
    project.name = 'My Project';
    project.app.name = ' ';
    project.app.uid = 'My App';
    const issues = validateProject(project);
    expect(rules(issues)).toEqual(expect.arrayContaining(['project-name', 'app-name', 'invalid-uid']));
    expect(issues.find((i) => i.rule === 'project-name')?.field).toBe('project.name');
    expect(issues.find((i) => i.rule === 'invalid-uid')?.field).toBe('app.uid');
  });

  it('requires unique uids across app, extensions and functions', () => {
    const { project, ext } = doc([{ type: 'Text', text: 'x' }]);
    project.functions = [fn('f_1', 'other_fn')];
    expect(only(project, 'duplicate-uid')).toEqual([]);
    project.functions = [fn('f_1', ext.uid)];
    const second = createExtension({ name: 'Second', existing: project.extensions });
    second.uid = project.app.uid;
    project.extensions.push(second);
    const dup = only(project, 'duplicate-uid');
    expect(dup.map((i) => i.field).sort()).toEqual(['function:f_1', 'uid']);
  });

  it('requires unique PascalCase file names', () => {
    const { project } = doc([{ type: 'Text', text: 'x' }]);
    const second = createExtension({ name: 'Second', existing: project.extensions });
    project.extensions.push(second);
    expect(only(project, 'duplicate-file-name')).toEqual([]);
    second.fileName = project.extensions[0].fileName;
    expect(only(project, 'duplicate-file-name')).toHaveLength(1);
    second.fileName = 'second-card';
    expect(only(project, 'invalid-file-name')).toHaveLength(1);
  });

  it('allows at most one settings page and one app home', () => {
    const { project } = doc([{ type: 'Text', text: 'x' }]);
    const add = (kind: Extension['kind']) => {
      const e = createExtension({ kind, existing: project.extensions, content: [{ type: 'Text', text: 'x' }] });
      project.extensions.push(e);
    };
    add('settings');
    add('home');
    expect(rules(validateProject(project))).toEqual([]);
    add('settings');
    add('home');
    expect(rules(validateProject(project))).toEqual(expect.arrayContaining(['multiple-settings', 'multiple-home']));
  });

  it('checks auth, redirect URLs, support email and permitted URLs', () => {
    const { project } = doc([{ type: 'Text', text: 'x' }]);
    project.app.distribution = 'marketplace';
    project.app.authType = 'oauth';
    project.app.redirectUrls = ['https://example.com/oauth'];
    project.app.permittedUrls.fetch = ['https://api.example.com'];
    expect(rules(validateProject(project))).toEqual([]);

    project.app.authType = 'static';
    expect(rules(validateProject(project))).toContain('marketplace-auth');
    project.app.authType = 'oauth';
    project.app.redirectUrls = [];
    expect(only(project, 'oauth-redirect')[0].severity).toBe('warning');
    project.app.support.supportEmail = 'not an email';
    expect(only(project, 'support-email')).toHaveLength(1);
    project.app.permittedUrls.fetch = ['http://api.example.com', 'nope', 'https://api.example.com/v1/x', 'http://localhost:3000'];
    const urls = only(project, 'permitted-url');
    expect(urls.map((i) => i.severity)).toEqual(['error', 'error', 'warning', 'error']);
    expect(urls[0].field).toBe('app.permittedUrls.fetch');
  });
});

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

describe('extension rules', () => {
  it('needs a name, object types and a valid location', () => {
    const { project, ext } = doc([{ type: 'Text', text: 'x' }]);
    expect(rules(validateProject(project))).toEqual([]);
    ext.name = '';
    ext.objectTypes = [];
    (ext as { location: string }).location = 'crm.somewhere';
    expect(rules(validateProject(project))).toEqual(expect.arrayContaining(['extension-name', 'object-types', 'location']));
  });

  it('flags non-ticket help desk cards and empty extensions', () => {
    const { project, ext } = doc([], { location: 'helpdesk.sidebar', objectTypes: ['contacts'] });
    const issues = validateProject(project);
    expect(issues.find((i) => i.rule === 'helpdesk-object-type')?.severity).toBe('warning');
    expect(issues.find((i) => i.rule === 'empty-extension')?.severity).toBe('info');
    ext.objectTypes = ['tickets'];
    ext.nodes[ext.rootId].children = [];
    expect(only(project, 'helpdesk-object-type')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

describe('node rules', () => {
  it('flags unknown and unavailable components', () => {
    const ok = doc([{ type: 'CrmPropertyList', props: { properties: ['email'] } }]);
    expect(rules(validateProject(ok.project))).toEqual([]);
    const bad = doc([{ type: 'Bogus' }, { type: 'CrmPropertyList', props: { properties: ['email'] } }], { kind: 'settings' });
    expect(rules(validateProject(bad.project))).toEqual(expect.arrayContaining(['unknown-component', 'unavailable-component']));
  });

  it('re-checks placement of every child and slot', () => {
    const { project, ext } = doc([
      { type: 'Flex', name: 'flex', children: [{ type: 'Text', text: 'a' }] },
      { type: 'Button', name: 'btn', text: 'Open', slots: { overlay: [{ type: 'Tooltip', text: 'Tip' }] } },
    ]);
    expect(rules(validateProject(project))).toEqual([]);
    // Force illegal structures: a TableRow inside Flex, a second overlay and a Text in a slot.
    const flex = ext.nodes[named(ext, 'flex')];
    ext.nodes.n_row = { id: 'n_row', type: 'TableRow', props: {}, children: [] };
    flex.children.push('n_row');
    const btn = ext.nodes[named(ext, 'btn')];
    ext.nodes.n_tip2 = { id: 'n_tip2', type: 'Tooltip', props: {}, text: 'second', children: [] };
    ext.nodes.n_txt = { id: 'n_txt', type: 'Text', props: {}, text: 'x', children: [] };
    btn.slots!.overlay.push('n_tip2');
    btn.slots!.other = ['n_txt'];
    const placement = only(project, 'invalid-placement');
    expect(placement.map((i) => i.nodeId).sort()).toEqual(['n_row', 'n_tip2', 'n_txt'].sort());
  });

  it('requires required props unless bound or set by an expression', () => {
    const { project, ext } = doc(
      [
        { type: 'Input', name: 'a', props: { label: 'Email', name: 'email' } },
        { type: 'Input', name: 'b', props: { label: { $expr: 'labelText' }, name: 'b' } },
        { type: 'Input', name: 'c', props: { name: 'c' } },
        { type: 'Link', name: 'd', props: { href: '' }, text: 'Go' },
      ],
      { state: [{ name: 'labelText', type: 'string', initial: 'L' }] },
    );
    const req = only(project, 'required-prop');
    expect(req.map((i) => [i.nodeId, i.field])).toEqual([
      [named(ext, 'c'), 'label'],
      [named(ext, 'd'), 'href'],
    ]);
    expect(req[0].severity).toBe('error');
  });

  it('evaluates requiredWhen variants (Table pageCount when paginated)', () => {
    const table = (props: Record<string, unknown>): NodeTemplate => ({
      type: 'Table',
      props: props as NodeTemplate['props'],
      children: [{ type: 'TableBody', children: [{ type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Text', text: 'x' }] }] }] }],
    });
    expect(only(doc([table({ paginated: true, pageCount: 3 })]).project, 'required-prop')).toEqual([]);
    expect(only(doc([table({ paginated: true })]).project, 'required-prop').map((i) => i.field)).toEqual(['pageCount']);
    expect(only(doc([table({})]).project, 'required-prop')).toEqual([]);
  });

  it('warns about empty required children and label text', () => {
    const { project } = doc([{ type: 'Box', children: [] }, { type: 'Button', text: '  ' }, { type: 'Text', text: '' }]);
    expect(rules(validateProject(project)).sort()).toEqual(['empty-text', 'required-children']);
  });

  it('checks option lists and literal prop types', () => {
    const good = doc([
      { type: 'Select', props: { label: 'S', name: 's', options: [{ label: 'A', value: 'a' }] } },
      { type: 'ToggleGroup', props: { toggleType: 'checkboxList', label: 'T', name: 't', options: [{ label: 'A', value: 'a', initialIsChecked: true }] } },
    ]);
    expect(rules(validateProject(good.project))).toEqual([]);
    const bad = doc([
      { type: 'Select', props: { label: 'S', name: 's', options: [{ label: 'A' }, { label: 'B', value: 'b', description: 'x' }] } },
      { type: 'Flex', props: { gap: 'huge', direction: 'column' }, children: [{ type: 'Text', text: 'x' }] },
      { type: 'NumberInput', props: { label: 'N', name: 'n', min: '5' } },
      { type: 'Text', props: { inline: 'yes' }, text: 'x' },
    ]);
    const issues = validateProject(bad.project);
    expect(issues.filter((i) => i.rule === 'invalid-options')).toHaveLength(2);
    expect(issues.filter((i) => i.rule === 'invalid-prop-value').map((i) => [i.field, i.severity])).toEqual([
      ['gap', 'warning'],
      ['min', 'error'],
      ['inline', 'error'],
    ]);
  });

  it('checks expression syntax everywhere', () => {
    const ok = doc(
      [
        {
          type: 'Button',
          props: { disabled: { $expr: 'count > 2' } },
          text: 'Count {{ count }}',
          condition: 'count >= 0',
          events: { onClick: [step({ type: 'setState', state: 'count', value: 'count + 1' })] },
        },
      ],
      { state: [{ name: 'count', type: 'number', initial: 0 }] },
    );
    expect(rules(validateProject(ok.project))).toEqual([]);

    const bad = doc(
      [
        {
          type: 'Button',
          name: 'b',
          props: { disabled: { $expr: 'count >' }, href: 'https://x.com/{{ count + }}' },
          text: 'Count {{ count ) }}',
          condition: 'count ===',
          repeat: { items: '[1, 2', itemName: 'item', indexName: 'index', key: 'item.' },
          events: {
            onClick: [
              step({ type: 'setState', state: 'count', value: 'count +' }),
              step({ type: 'if', condition: '(', then: [], else: [step({ type: 'custom', code: 'if (x {' })] }),
              step({ type: 'addAlert', alertType: 'info', title: 'T', message: '{{ count * }}' }),
            ],
          },
        },
      ],
      { state: [{ name: 'count', type: 'number', initial: 0 }] },
    );
    const syntax = only(bad.project, 'expression-syntax');
    expect(syntax.every((i) => i.severity === 'error')).toBe(true);
    expect(syntax.map((i) => i.field).sort()).toEqual(
      ['condition', 'disabled', 'event:onClick', 'event:onClick', 'event:onClick', 'event:onClick', 'href', 'repeat', 'repeat', 'text'].sort(),
    );
  });

  it('warns about unclosed {{', () => {
    expect(only(doc([{ type: 'Text', text: 'Hi {{ name' }]).project, 'unclosed-template')).toHaveLength(1);
    expect(only(doc([{ type: 'Text', text: 'Hi {{ "x" }}' }]).project, 'unclosed-template')).toHaveLength(0);
  });

  it('validates repeat names', () => {
    const repeat = (itemName: string, indexName: string): NodeTemplate => ({
      type: 'Text',
      repeat: { items: 'list', itemName, indexName },
      text: '{{ list.length }}',
    });
    const state = [{ name: 'list', type: 'array' as const, initial: [] }];
    expect(rules(validateProject(doc([repeat('item', 'index')], { state }).project))).toEqual([]);
    const issues = validateProject(doc([repeat('1st', 'index'), repeat('row', 'row'), repeat('list', 'i')], { state }).project);
    expect(issues.filter((i) => i.rule === 'repeat-name').map((i) => i.severity)).toEqual(['error', 'error']);
    expect(issues.find((i) => i.rule === 'repeat-shadow')?.severity).toBe('warning');
    expect(rules(issues)).not.toContain('unknown-name');
  });

  it('checks bindings', () => {
    const state = [
      { name: 'email', type: 'string' as const, initial: '' },
      { name: 'qty', type: 'number' as const, initial: 0 },
    ];
    const ok = doc([{ type: 'Input', props: { label: 'E', name: 'e' }, binding: { state: 'email' } }], { state });
    expect(rules(validateProject(ok.project))).toEqual([]);
    const bad = doc(
      [
        { type: 'Input', props: { label: 'E', name: 'e' }, binding: { state: 'missing' } },
        { type: 'Input', props: { label: 'E', name: 'e2' }, binding: { state: 'qty' } },
        { type: 'Text', text: 'x', binding: { state: 'email' } },
      ],
      { state },
    );
    const issues = validateProject(bad.project);
    expect(issues.find((i) => i.rule === 'unknown-state')?.field).toBe('binding');
    expect(issues.find((i) => i.rule === 'binding-type')?.severity).toBe('warning');
    expect(issues.find((i) => i.rule === 'binding-unsupported')).toBeDefined();
  });

  it('checks overlays: unique ids and closeOverlay targets', () => {
    const modal = (id: string, closeRef: string): NodeTemplate => ({
      type: 'Button',
      text: 'Open',
      slots: {
        overlay: [
          {
            type: 'Modal',
            props: { id, title: 'M' },
            children: [
              { type: 'ModalBody', children: [{ type: 'Text', text: 'Body' }] },
              {
                type: 'ModalFooter',
                children: [{ type: 'Button', text: 'Close', events: { onClick: [step({ type: 'closeOverlay', overlayNodeId: closeRef })] } }],
              },
            ],
          },
        ],
      },
    });
    expect(rules(validateProject(doc([modal('a', '@a'), modal('b', '@b')]).project))).toEqual([]);
    const issues = validateProject(doc([modal('a', '@a'), modal('a', '@zzz')]).project);
    expect(rules(issues)).toEqual(expect.arrayContaining(['duplicate-overlay-id', 'missing-overlay']));
  });

  it('flags duplicate tab ids', () => {
    const tabs = (a: string, b: string): NodeTemplate => ({
      type: 'Tabs',
      children: [
        { type: 'Tab', props: { tabId: a, title: 'A' }, children: [{ type: 'Text', text: 'a' }] },
        { type: 'Tab', props: { tabId: b, title: 'B' }, children: [{ type: 'Text', text: 'b' }] },
      ],
    });
    expect(only(doc([tabs('a', 'b')]).project, 'duplicate-tab-id')).toEqual([]);
    expect(only(doc([tabs('a', 'a')]).project, 'duplicate-tab-id')).toHaveLength(1);
  });

  it('checks references from actions (state, data sources, functions)', () => {
    const dataSources: DataSource[] = [{ id: 'd_api', kind: 'fetch', name: 'api', url: 'https://api.example.com/x', method: 'GET', runOnMount: false }];
    const functions = [fn('f_quote', 'get_quote')];
    const state = [{ name: 'result', type: 'any' as const, initial: null }];
    const button = (steps: ActionStep[]): NodeTemplate => ({ type: 'Button', text: 'Go', events: { onClick: steps } });
    const good = doc(
      [
        button([
          step({ type: 'runDataSource', dataSourceId: 'd_api' }),
          step({ type: 'runFunction', functionId: 'f_quote', resultState: 'result', onSuccess: [step({ type: 'setState', state: 'result', value: 'response' })] }),
          step({ type: 'fetch', url: 'https://api.example.com/y', method: 'POST', body: '{ result }', onError: [step({ type: 'log', level: 'error', message: '{{ error.message }}' })] }),
        ]),
      ],
      { dataSources, functions, state },
    );
    const goodIssues = validateProject(good.project).filter((i) => i.severity !== 'info');
    expect(goodIssues).toEqual([]);
    const bad = doc(
      [
        button([
          step({ type: 'runDataSource', dataSourceId: 'd_gone' }),
          step({ type: 'runFunction', functionId: 'f_gone', resultState: 'nope' }),
          step({ type: 'setState', state: 'ghost', value: '1' }),
        ]),
      ],
      {
        dataSources: [...dataSources, { id: 'd_fn', kind: 'function', name: 'quote', functionId: 'f_missing', runOnMount: true }],
        functions,
        state,
      },
    );
    const issues = validateProject(bad.project);
    expect(rules(issues)).toEqual(expect.arrayContaining(['unknown-data-source', 'unknown-function', 'unknown-state']));
    expect(issues.filter((i) => i.rule === 'unknown-function')).toHaveLength(2);
    expect(issues.filter((i) => i.rule === 'unknown-state')).toHaveLength(2);
  });

  it('warns that refreshObjectProperties is skipped outside CRM cards', () => {
    const content: NodeTemplate[] = [{ type: 'Button', text: 'R', events: { onClick: [step({ type: 'refreshObjectProperties' })] } }];
    expect(only(doc(content).project, 'refresh-unsupported')).toEqual([]);
    expect(only(doc(content, { kind: 'settings' }).project, 'refresh-unsupported')).toHaveLength(1);
  });

  it('warns about events that do not exist in the current variant', () => {
    const table = (paginated: boolean): NodeTemplate => ({
      type: 'Table',
      props: paginated ? { paginated: true, pageCount: 2 } : {},
      events: { onPageChange: [step({ type: 'log', level: 'info', message: 'page {{ pageNumber }}' })] },
      children: [{ type: 'TableBody', children: [{ type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Text', text: 'x' }] }] }] }],
    });
    expect(rules(validateProject(doc([table(true)]).project))).toEqual([]);
    expect(only(doc([table(false)]).project, 'event-variant')).toHaveLength(1);
    expect(only(doc([{ type: 'Text', text: 'x', events: { onBogus: [step({ type: 'reloadPage' })] } }]).project, 'unknown-event')).toHaveLength(1);
  });

  it('reports unknown names with the right scope at each place', () => {
    const state = [{ name: 'count', type: 'number' as const, initial: 0 }];
    const dataSources: DataSource[] = [{ id: 'd_c', kind: 'crmProperties', name: 'record', properties: ['email'] }];
    const ok = doc(
      [
        {
          type: 'Flex',
          repeat: { items: 'record.tags ?? []', itemName: 'tag', indexName: 'i' },
          children: [
            { type: 'Text', text: '{{ tag }} #{{ i }} {{ recordLoading ? "…" : count }} {{ double }} {{ fmt(count) }} {{ context.user.email }}' },
            {
              type: 'Input',
              props: { label: 'L', name: 'n' },
              events: {
                onChange: [
                  step({ type: 'setState', state: 'count', value: 'Number(value) + i' }),
                  step({ type: 'custom', code: 'setCount(count + 1); actions.addAlert({ message: String(Math.max(1, 2)) }); logger.info(tag);' }),
                  step({ type: 'fetch', url: 'https://api.example.com/{{ tag }}', method: 'GET', onSuccess: [step({ type: 'log', level: 'info', message: '{{ response.ok }}' })] }),
                ],
              },
            },
          ],
        },
      ],
      { state, dataSources, computed: [{ id: 'c_1', name: 'double', expr: 'count * 2' }], helpers: 'function fmt(v) { return String(v); }' },
    );
    expect(only(ok.project, 'unknown-name')).toEqual([]);

    const bad = doc(
      [
        { type: 'Text', text: '{{ cuont }} {{ setCount }} {{ value }}' },
        {
          type: 'Button',
          text: 'x',
          events: {
            onClick: [
              step({ type: 'setState', state: 'count', value: 'actions' }),
              step({ type: 'fetch', url: 'https://api.example.com', method: 'GET', onSuccess: [step({ type: 'log', level: 'info', message: '{{ error }}' })] }),
            ],
          },
        },
      ],
      { state, dataSources },
    );
    const unknown = only(bad.project, 'unknown-name');
    expect(unknown.map((i) => i.message.match(/“(\w+)”/)?.[1])).toEqual(['cuont', 'setCount', 'value', 'actions', 'error']);
    expect(unknown.every((i) => i.severity === 'warning')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State, data, computed, helpers, functions
// ---------------------------------------------------------------------------

describe('state and data rules', () => {
  it('checks identifiers and duplicate (derived) names', () => {
    const ok = doc([{ type: 'Text', text: 'x' }], {
      state: [{ name: 'count', type: 'number', initial: 0 }],
      dataSources: [{ id: 'd1', kind: 'crmProperties', name: 'record', properties: ['email'] }],
      computed: [{ id: 'c1', name: 'total', expr: 'count + 1' }],
    });
    expect(rules(validateProject(ok.project))).toEqual([]);
    const bad = doc([{ type: 'Text', text: 'x' }], {
      state: [
        { name: 'count', type: 'number', initial: 0 },
        { name: 'recordLoading', type: 'boolean', initial: false },
        { name: '2fast', type: 'string', initial: '' },
        { name: 'setCount', type: 'any', initial: null },
      ],
      dataSources: [{ id: 'd1', kind: 'crmProperties', name: 'record', properties: ['email'] }],
      computed: [
        { id: 'c1', name: 'count', expr: '1' },
        { id: 'c2', name: 'context', expr: '1' },
      ],
    });
    const issues = validateProject(bad.project);
    expect(issues.filter((i) => i.rule === 'invalid-identifier').map((i) => i.field)).toEqual(['state:s_2', 'computed:c2']);
    expect(issues.filter((i) => i.rule === 'duplicate-name').map((i) => i.field).sort()).toEqual(['computed:c1', 'dataSource:d1', 'state:s_3'].sort());
  });

  it('rejects built-in names and clashes with helpers or loader setters', () => {
    const issues = validateProject(
      doc([{ type: 'Text', text: 'x' }], {
        state: [
          { name: 'Math', type: 'number', initial: 0 },
          { name: 'money', type: 'number', initial: 0 },
          { name: 'setApi', type: 'any', initial: null },
        ],
        dataSources: [{ id: 'd1', kind: 'fetch', name: 'api', url: 'https://api.example.com/x', method: 'GET', runOnMount: false }],
        helpers: 'function money(v) { return String(v); }',
      }).project,
    );
    expect(issues.find((i) => i.rule === 'invalid-identifier')?.message).toMatch(/built-in name/);
    expect(issues.filter((i) => i.rule === 'duplicate-name').map((i) => i.field)).toEqual(['state:s_1', 'dataSource:d1']);
  });

  it('checks initial values against state types', () => {
    expect(only(doc([], { state: [{ name: 'n', type: 'number', initial: 1 }] }).project, 'state-initial')).toEqual([]);
    expect(only(doc([], { state: [{ name: 'n', type: 'number', initial: 'one' }] }).project, 'state-initial')).toHaveLength(1);
  });

  it('checks data source configuration', () => {
    const issues = validateProject(
      doc([{ type: 'Text', text: 'x' }], {
        dataSources: [
          { id: 'd1', kind: 'crmProperties', name: 'record', properties: [] },
          { id: 'd2', kind: 'associations', name: 'deals', toObjectType: '', properties: ['dealname'], pageLength: 10 },
          { id: 'd3', kind: 'fetch', name: 'rel', url: '/api/x', method: 'GET', runOnMount: true },
          { id: 'd4', kind: 'fetch', name: 'dyn', url: 'https://{{ host }}/x', method: 'GET', runOnMount: true },
          { id: 'd5', kind: 'fetch', name: 'good', url: 'https://api.example.com/x?q={{ rel }}', method: 'POST', body: '{ q: rel }', runOnMount: false },
        ],
        state: [{ name: 'host', type: 'string', initial: 'x' }],
      }).project,
    );
    expect(issues.filter((i) => i.rule === 'data-source-properties').map((i) => i.field)).toEqual(['dataSource:d1']);
    expect(issues.filter((i) => i.rule === 'data-source-config').map((i) => i.field)).toEqual(['dataSource:d2']);
    expect(issues.filter((i) => i.rule === 'fetch-url').map((i) => [i.field, i.severity])).toEqual([
      ['dataSource:d3', 'warning'],
      ['dataSource:d4', 'warning'],
    ]);
  });

  it('warns about record data sources outside CRM cards', () => {
    const ds: DataSource[] = [{ id: 'd1', kind: 'crmProperties', name: 'record', properties: ['email'] }];
    expect(only(doc([], { dataSources: ds }).project, 'data-source-location')).toEqual([]);
    expect(only(doc([], { dataSources: ds, kind: 'home' }).project, 'data-source-location')).toHaveLength(1);
  });

  it('checks computed values (syntax and order)', () => {
    const state = [{ name: 'count', type: 'number' as const, initial: 0 }];
    expect(rules(validateProject(doc([], { state, computed: [{ id: 'c1', name: 'a', expr: 'count + 1' }, { id: 'c2', name: 'b', expr: 'a * 2' }] }).project))).toEqual(['empty-extension']);
    const issues = validateProject(
      doc([], { state, computed: [{ id: 'c1', name: 'a', expr: 'b + 1' }, { id: 'c2', name: 'b', expr: 'count *' }] }).project,
    );
    expect(issues.find((i) => i.rule === 'computed-order')?.field).toBe('computed:c1');
    expect(issues.find((i) => i.rule === 'computed-order')?.message).toMatch(/^The computed value/);
    expect(issues.find((i) => i.rule === 'expression-syntax')?.field).toBe('computed:c2');
  });

  it('rejects data source options that use computed values (declared later in the component)', () => {
    const state = [{ name: 'query', type: 'string' as const, initial: '' }];
    const computed = [{ id: 'c1', name: 'term', expr: 'query.trim()' }];
    const ok = doc([], {
      state,
      computed,
      dataSources: [{ id: 'd1', kind: 'fetch', name: 'results', url: 'https://api.example.com/s?q={{ query }}', method: 'GET', runOnMount: true }],
    });
    expect(only(ok.project, 'data-source-computed')).toEqual([]);
    const bad = doc([], {
      state,
      computed,
      dataSources: [{ id: 'd1', kind: 'fetch', name: 'results', url: 'https://api.example.com/s?q={{ term }}', method: 'GET', runOnMount: true }],
    });
    const issues = only(bad.project, 'data-source-computed');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].field).toBe('dataSource:d1');
    expect(issues[0].message).toMatch(/^The URL of the data source “results” uses the computed value “term”/);
    // Not also reported as an unknown name.
    expect(only(bad.project, 'unknown-name')).toEqual([]);
  });

  it('checks helper code syntax', () => {
    expect(only(doc([], { helpers: 'function money(v) { return `$${v}`; }' }).project, 'helpers-syntax')).toEqual([]);
    expect(only(doc([], { helpers: 'function money(v: number): string { return `$${v}`; }' }).project, 'helpers-syntax')).toEqual([]);
    expect(only(doc([], { helpers: 'function money(v { }' }).project, 'helpers-syntax')).toHaveLength(1);
  });

  it('checks app functions', () => {
    const good = doc([], { functions: [fn('f1', 'get_quote')] });
    expect(validateProject(good.project).filter((i) => i.field?.startsWith('function:'))).toEqual([]);
    const bad = doc([], {
      functions: [fn('f1', 'Get Quote', 'exports.main = async () => {'), fn('f2', 'ok_fn', 'const x = 1;'), { ...fn('f3', 'ok_fn2'), fileName: 'bad name' }],
    });
    const issues = validateProject(bad.project);
    expect(issues.find((i) => i.rule === 'invalid-uid')?.field).toBe('function:f1');
    expect(issues.find((i) => i.rule === 'function-syntax')?.field).toBe('function:f1');
    expect(issues.find((i) => i.rule === 'function-main')?.field).toBe('function:f2');
    expect(issues.find((i) => i.rule === 'invalid-file-name')?.field).toBe('function:f3');
  });
});

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

describe('requirements', () => {
  it('reports derived scopes and URLs that are not configured as info', () => {
    const dataSources: DataSource[] = [
      { id: 'd1', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname'], pageLength: 10 },
      { id: 'd2', kind: 'fetch', name: 'api', url: 'https://api.example.com/x', method: 'GET', runOnMount: true },
    ];
    const { project } = doc([{ type: 'Text', text: 'x' }], { dataSources });
    const issues = validateProject(project);
    expect(issues.map((i) => [i.rule, i.severity, i.field])).toEqual([
      ['missing-scope', 'info', 'app.requiredScopes'],
      ['missing-permitted-url', 'info', 'app.permittedUrls.fetch'],
    ]);
    expect(issues[0].message).toContain('added automatically on export');
    project.app.requiredScopes.push('crm.objects.deals.read');
    project.app.permittedUrls.fetch.push('https://api.example.com/');
    expect(validateProject(project)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe('performance', () => {
  it('validates a 500-node project quickly', () => {
    const rows: NodeTemplate[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push({
        type: 'Flex',
        props: { direction: 'row', gap: 'small' },
        condition: `count > ${i}`,
        children: [
          { type: 'Text', text: `Row ${i}: {{ count + ${i} }} {{ record.email }}` },
          { type: 'Input', props: { label: `Field ${i}`, name: `f${i}` }, binding: { state: 'name' } },
          {
            type: 'Button',
            props: { variant: 'secondary' },
            text: 'Add {{ name }}',
            events: { onClick: [step({ type: 'setState', state: 'count', value: `count + ${i}` }), step({ type: 'addAlert', alertType: 'success', title: 'Saved', message: 'Row {{ count }}' })] },
          },
          { type: 'Tag', repeat: { items: 'list', itemName: 'item', indexName: 'index' }, text: '{{ item.label }} {{ index }}' },
        ],
      });
    }
    const { project, ext } = doc(rows, {
      state: [
        { name: 'count', type: 'number', initial: 0 },
        { name: 'name', type: 'string', initial: '' },
        { name: 'list', type: 'array', initial: [] },
      ],
      dataSources: [{ id: 'd1', kind: 'crmProperties', name: 'record', properties: ['email'] }],
    });
    expect(Object.keys(ext.nodes).length).toBeGreaterThanOrEqual(500);
    // Warm-up (first run compiles the expression syntax checks), then measure.
    expect(validateProject(project)).toEqual([]);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      validateProject(project);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    // Target is < 20 ms; the bound is generous for slow CI machines.
    expect(runs[2]).toBeLessThan(100);
  });
});
