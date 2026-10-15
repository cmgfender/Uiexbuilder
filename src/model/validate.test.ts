import { describe, expect, it } from 'vitest';
import { createAppFunction, createExtension, createProject } from './factory';
import type { ActionStep, AppFunction, ComputedValue, DataSource, Extension, NodeTemplate, Project, StateVar } from './types';
import { appFunctionsUnsupported, closestName, countIssues, editDistance, scanReferences, validateProject, type Issue } from './validate';

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

  it('warns about a “Set variable” action without a new value', () => {
    const state = [
      { name: 'value', type: 'string' as const, initial: 'hello' },
      { name: 'items', type: 'array' as const, initial: [] },
    ];
    const button = (steps: ActionStep[]): NodeTemplate => ({ type: 'Button', text: 'Go', events: { onClick: steps } });
    const ok = doc([button([step({ type: 'setState', state: 'value', value: "''" }), step({ type: 'setState', state: 'items', value: 'undefined' })])], { state });
    expect(only(ok.project, 'set-state-value')).toEqual([]);
    const bad = doc(
      [
        button([
          step({ type: 'setState', state: 'value', value: '' }),
          step({ type: 'if', condition: 'true', then: [step({ type: 'setState', state: 'items', value: '  ' })], else: [] }),
          // A missing variable is reported as unknown-state only.
          step({ type: 'setState', state: '', value: '' }),
        ]),
      ],
      { state },
    );
    const issues = only(bad.project, 'set-state-value');
    expect(issues.map((i) => [i.severity, i.field, i.subject])).toEqual([
      ['warning', 'event:onClick', 'value'],
      ['warning', 'event:onClick', 'items'],
    ]);
    expect(issues[0].message).toContain("''");
    expect(issues[1].message).toContain('[]');
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

  it('suggests the closest name in scope for a misspelt name (did you mean)', () => {
    const state = [
      { name: 'count', type: 'number' as const, initial: 0 },
      { name: 'total', type: 'number' as const, initial: 0 },
    ];
    const dataSources: DataSource[] = [{ id: 'd_c', kind: 'crmProperties', name: 'record', properties: ['email'] }];
    const { project } = doc(
      [
        { type: 'Text', text: 'Email: {{ recrd.email }} {{ cuont }} {{ Record }} {{ Mth.max(1, 2) }} {{ ture }} {{ setCuont }} {{ zzzzzz }}' },
        {
          type: 'Flex',
          repeat: { items: 'record.tags ?? []', itemName: 'tag', indexName: 'i' },
          children: [{ type: 'Text', text: '{{ tga }}' }],
        },
        {
          type: 'Button',
          text: 'x',
          events: { onClick: [step({ type: 'custom', code: 'setCuont(1); actoins.addAlert({ message: "x" });' })] },
        },
      ],
      { state, dataSources },
    );
    const unknown = only(project, 'unknown-name');
    const byName = new Map(unknown.map((i) => [i.subject, i]));
    expect(byName.get('recrd')?.suggestion).toBe('record');
    expect(byName.get('recrd')?.message).toBe('Unknown name “recrd” in the text. Did you mean “record”?');
    expect(byName.get('cuont')?.suggestion).toBe('count'); // transposition counts as one edit
    expect(byName.get('Record')?.suggestion).toBe('record'); // case-only difference
    expect(byName.get('Mth')?.suggestion).toBe('Math'); // globals
    expect(byName.get('ture')?.suggestion).toBe('true');
    expect(byName.get('tga')?.suggestion).toBe('tag'); // repeat item in scope
    expect(byName.get('actoins')?.suggestion).toBe('actions'); // custom-code names
    // Setters are only in scope in handlers: no suggestion in render text, one in custom code.
    const setters = unknown.filter((i) => i.subject === 'setCuont');
    expect(setters.map((i) => i.suggestion ?? null).sort()).toEqual(['setCount', null].sort());
    const far = byName.get('zzzzzz');
    expect(far?.suggestion).toBeUndefined();
    expect(far?.message).toContain('Check the spelling');
  });

  it('does not suggest names that are out of scope where the name is used', () => {
    const dataSources: DataSource[] = [
      { id: 'd_f', kind: 'fetch', name: 'api', url: 'https://api.example.com/{{ totl }}', method: 'GET', runOnMount: true },
    ];
    const { project } = doc([{ type: 'Text', text: '{{ totl }}' }], { dataSources, computed: [{ id: 'c_1', name: 'total', expr: '1 + 1' }] });
    const issues = validateProject(project);
    // Data sources load before computed values: the computed `total` is no candidate there.
    const inSource = issues.find((i) => i.rule === 'unknown-name' && i.field === 'dataSource:d_f');
    expect(inSource?.suggestion).toBeUndefined();
    const inText = issues.find((i) => i.rule === 'unknown-name' && i.field === 'text');
    expect(inText?.suggestion).toBe('total');
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
    expect(issues.filter((i) => i.rule === 'fetch-url').map((i) => [i.field, i.severity])).toEqual([['dataSource:d3', 'warning']]);
    // A host built from an expression can't be permitted automatically.
    expect(issues.filter((i) => i.rule === 'dynamic-url-origin').map((i) => [i.field, i.severity])).toEqual([['dataSource:d4', 'warning']]);
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

  it('only allows app functions in private apps with static auth (HubSpot component catalog)', () => {
    const { project } = doc([{ type: 'Text', text: 'x' }], { functions: [fn('f1', 'get_quote'), fn('f2', 'get_tax')] });
    project.app.redirectUrls = ['https://example.com/oauth'];
    expect(only(project, 'function-app-type')).toEqual([]);
    expect(appFunctionsUnsupported(project)).toBeNull();

    project.app.authType = 'oauth';
    let issues = only(project, 'function-app-type');
    expect(issues.map((i) => [i.severity, i.field])).toEqual([
      ['error', 'function:f1'],
      ['error', 'function:f2'],
    ]);
    expect(issues[0].message).toMatch(/static token auth/);

    project.app.distribution = 'marketplace';
    issues = only(project, 'function-app-type');
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toMatch(/marketplace apps/);
    expect(rules(validateProject(project))).not.toContain('marketplace-auth');

    // Platform 2025.2 offered (endpoint) functions to OAuth private apps too.
    project.app.distribution = 'private';
    project.platformVersion = '2025.2';
    expect(only(project, 'function-app-type')).toEqual([]);
    project.functions = [];
    project.app.authType = 'oauth';
    project.platformVersion = '2026.03';
    expect(only(project, 'function-app-type')).toEqual([]);
  });

  it('warns that platform 2025.2 only has endpoint functions and no hubspot.serverless', () => {
    const withEndpoint = (f: AppFunction): AppFunction => ({ ...f, endpoint: { path: '/api/quote', methods: ['GET'] } });
    const { project } = doc(
      [{ type: 'Button', text: 'Go', events: { onClick: [step({ type: 'runFunction', functionId: 'f_called' })] } }],
      { functions: [fn('f_private', 'private_fn'), withEndpoint(fn('f_endpoint', 'endpoint_fn')), withEndpoint(fn('f_called', 'called_fn'))] },
    );
    expect(only(project, 'function-platform')).toEqual([]);
    project.platformVersion = '2025.2';
    const issues = only(project, 'function-platform');
    expect(issues.map((i) => [i.severity, i.field])).toEqual([
      ['warning', 'function:f_private'],
      ['warning', 'function:f_called'],
    ]);
    expect(issues[0].message).toMatch(/no endpoint/);
    expect(issues[1].message).toMatch(/hubspot\.serverless/);
    // A function data source counts as running it from a card too.
    project.extensions[0].dataSources = [{ id: 'd_fn', kind: 'function', name: 'quote', functionId: 'f_endpoint', runOnMount: true }];
    expect(only(project, 'function-platform').map((i) => i.field)).toContain('function:f_endpoint');
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
// Suggestions
// ---------------------------------------------------------------------------

describe('closestName / editDistance', () => {
  it('measures optimal string alignment distance with a cutoff', () => {
    expect(editDistance('record', 'record')).toBe(0);
    expect(editDistance('recrd', 'record')).toBe(1);
    expect(editDistance('cuont', 'count')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('a', 'abcdef', 2)).toBe(3);
    expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2);
  });

  it('picks one unambiguous close name', () => {
    expect(closestName('recrd', ['count', 'record', 'recordLoading'])).toBe('record');
    expect(closestName('COUNT', ['count'])).toBe('count');
    // Short names only match case-insensitively; 3–5 characters allow one edit, longer two.
    expect(closestName('ab', ['abc'])).toBeUndefined();
    expect(closestName('Id', ['id'])).toBe('id');
    expect(closestName('cnt', ['count'])).toBeUndefined();
    expect(closestName('amonut', ['amount'])).toBe('amount');
    expect(closestName('dealAmont', ['dealAmount'])).toBe('dealAmount');
    // Case is an edit unless it is the only difference.
    expect(closestName('data', ['Date'])).toBeUndefined();
    // Ties are ambiguous: no guess.
    expect(closestName('cout', ['cost', 'coat'])).toBeUndefined();
    // Sharing the first letter breaks a tie.
    expect(closestName('cout', ['count', 'bout'])).toBe('count');
    expect(closestName('', ['a'])).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Integration rules (deploy / UX review)
// ---------------------------------------------------------------------------

describe('deploy safety rules', () => {
  it('reports context.crm on settings and app home pages only', () => {
    const content: NodeTemplate[] = [{ type: 'Text', text: 'Record {{ context.crm.objectId }}' }];
    expect(only(doc(content).project, 'context-location')).toEqual([]);
    for (const kind of ['settings', 'home'] as const) {
      const issues = only(doc(content, { kind }).project, 'context-location');
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('only exists on app cards');
    }
    // Custom code and computed values are checked too; other context members are fine.
    const custom = doc([{ type: 'Button', text: 'Go', events: { onClick: [step({ type: 'custom', code: 'const id = context?.crm.objectId;' })] } }], {
      kind: 'settings',
      computed: [{ id: 'c1', name: 'who', expr: 'context.user.email' }],
    });
    expect(only(custom.project, 'context-location')).toHaveLength(1);
  });

  it('warns about reading fetch / function data before it has loaded', () => {
    const ds: DataSource[] = [{ id: 'd1', kind: 'fetch', name: 'weather', url: 'https://api.example.com/w', method: 'GET', runOnMount: true }];
    const unguarded = doc([{ type: 'Text', text: 'Now {{ weather.temperature }}' }], { dataSources: ds });
    const issues = only(unguarded.project, 'unguarded-async-data');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('weather?.temperature');
    // Optional chaining, an in-expression check or a guarding condition are fine.
    expect(only(doc([{ type: 'Text', text: 'Now {{ weather?.temperature }}' }], { dataSources: ds }).project, 'unguarded-async-data')).toEqual([]);
    expect(only(doc([{ type: 'Text', text: '{{ weather && weather.temperature }}' }], { dataSources: ds }).project, 'unguarded-async-data')).toEqual([]);
    expect(
      only(doc([{ type: 'Flex', condition: '!weatherLoading && weather', children: [{ type: 'Text', text: '{{ weather.temperature }}' }] }], { dataSources: ds }).project, 'unguarded-async-data'),
    ).toEqual([]);
    // Computed values render first too; handlers run later and are not flagged.
    expect(only(doc([], { dataSources: ds, computed: [{ id: 'c1', name: 't', expr: 'weather.temperature * 2' }] }).project, 'unguarded-async-data')).toHaveLength(1);
    const handler = doc([{ type: 'Button', text: 'Go', events: { onClick: [step({ type: 'log', level: 'info', message: '{{ weather.temperature }}' })] } }], { dataSources: ds });
    expect(only(handler.project, 'unguarded-async-data')).toEqual([]);
    // CRM record properties are {} while loading, so reading a property is safe.
    const crm: DataSource[] = [{ id: 'd1', kind: 'crmProperties', name: 'record', properties: ['email'] }];
    expect(only(doc([{ type: 'Text', text: '{{ record.email }}' }], { dataSources: crm }).project, 'unguarded-async-data')).toEqual([]);
  });

  it('suggests the origin of a request whose host comes from a variable', () => {
    const base = doc([{ type: 'Button', text: 'Go', events: { onClick: [step({ type: 'fetch', url: '{{ apiBase }}/items', method: 'GET' })] } }], {
      state: [{ name: 'apiBase', type: 'string', initial: 'https://api.acme.io' }],
    });
    const issues = only(base.project, 'dynamic-url-origin');
    expect(issues).toHaveLength(1);
    expect(issues[0].subject).toBe('https://api.acme.io');
    expect(issues[0].id.split('|').slice(4).join('|')).toMatch(/^fetch:/);
    expect(only(base.project, 'fetch-url')).toEqual([]);
    base.project.app.permittedUrls.fetch = ['https://api.acme.io'];
    expect(only(base.project, 'dynamic-url-origin')).toEqual([]);
    // Images report the img kind.
    const img = doc([{ type: 'Image', props: { src: '{{ logo }}', alt: 'Logo' } }], { state: [{ name: 'logo', type: 'string', initial: 'https://cdn.acme.io/logo.png' }] });
    const imgIssues = only(img.project, 'dynamic-url-origin');
    expect(imgIssues.map((i) => [i.field, i.subject])).toEqual([['src', 'https://cdn.acme.io']]);
    expect(imgIssues[0].id).toContain('|img:');
  });

  it('flags likely typos of standard CRM properties but not custom ones', () => {
    const ds = (properties: string[]): DataSource[] => [{ id: 'd1', kind: 'crmProperties', name: 'record', properties }];
    const typo = only(doc([], { dataSources: ds(['email', 'lifecyclestag']) }).project, 'data-source-properties');
    expect(typo.map((i) => [i.subject, i.suggestion])).toEqual([['lifecyclestag', 'lifecyclestage']]);
    expect(only(doc([], { dataSources: ds(['email', 'my_custom_score']) }).project, 'data-source-properties')).toEqual([]);
  });

  it('checks endpoint paths of app functions', () => {
    const withPath = (path: string, methods: AppFunction['endpoint'] extends infer E ? (E extends { methods: infer M } ? M : never) : never = ['GET']) => {
      const f = fn('f1', 'status_fn', 'exports.main = async () => ({ statusCode: 200 });');
      f.endpoint = { path, methods };
      return doc([], { functions: [f] }).project;
    };
    expect(only(withPath('/api/status'), 'endpoint-path')).toEqual([]);
    expect(only(withPath('api/status'), 'endpoint-path')).toEqual([]);
    expect(only(withPath('/api/'), 'endpoint-path').map((i) => i.severity)).toEqual(['error']);
    expect(only(withPath(''), 'endpoint-path').map((i) => i.severity)).toEqual(['error']);
    expect(only(withPath('/ok', []), 'endpoint-path').map((i) => i.severity)).toEqual(['warning']);
  });

  it('warns when “Copy to clipboard” has nothing to copy', () => {
    const p = doc([{ type: 'Button', text: 'Copy', events: { onClick: [step({ type: 'copyToClipboard', text: '' })] } }]).project;
    expect(only(p, 'empty-copy').map((i) => i.severity)).toEqual(['warning']);
  });

  it('warns when “Set variable” stores a value of another type', () => {
    const state: DocOptions['state'] = [
      { name: 'name', type: 'string', initial: '' },
      { name: 'count', type: 'number', initial: 0 },
    ];
    const set = (value: string, target = 'name') =>
      only(doc([{ type: 'Button', text: 'Go', events: { onClick: [step({ type: 'setState', state: target, value })] } }], { state }).project, 'set-state-type');
    expect(set('count + 1')).toHaveLength(1);
    expect(set('count + 1')[0].message).toContain('String(');
    expect(set("'Ada'")).toEqual([]);
    expect(set('String(count)')).toEqual([]);
    expect(set('count + 1', 'count')).toEqual([]);
    expect(set('null')).toEqual([]);
    // The event param `value` of an input shadows a state variable of that name.
    const shadow = doc([{ type: 'Input', props: { label: 'N', name: 'n' }, events: { onChange: [step({ type: 'setState', state: 'name', value: 'value' })] } }], {
      state: [...state, { name: 'value', type: 'number', initial: 0 }],
    });
    expect(only(shadow.project, 'set-state-type')).toEqual([]);
  });
});
