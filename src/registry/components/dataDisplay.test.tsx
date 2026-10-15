import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { dataDisplayComponents } from './dataDisplay';
import { renderPreview, templateFor } from '../../test/previewHarness';
import { STANDARD_DOCS } from '../constants';
import type { ComponentDef, PreviewProps, PropDef } from '../types';
import type { NodeTemplate, UINode } from '../../model/types';

afterEach(cleanup);

const byType = (type: string): ComponentDef => {
  const def = dataDisplayComponents.find((d) => d.type === type);
  if (!def) throw new Error(`missing ${type}`);
  return def;
};

/** Renders and asserts the root exists and is the single outermost element of the preview. */
function renderRoot(def: ComponentDef, opts: Parameters<typeof renderPreview>[1] = {}) {
  const result = renderPreview(def, opts);
  const host = result.container.querySelector('.hsp-overlay-host');
  expect(result.root).not.toBeNull();
  expect(host?.childElementCount).toBe(1);
  expect(host?.firstElementChild).toBe(result.root);
  return { ...result, root: result.root as HTMLElement };
}

const noop = () => {};

/**
 * Renders a whole NodeTemplate subtree the way the runtime would: each node of this group renders
 * with its registry preview and receives its rendered children; other types (Text, Button) render
 * as simple stubs carrying the DOM contract attributes. In design mode an empty container gets a
 * drop placeholder like the runtime's DropPlaceholder. Node ids are tree paths ("root", "root.0"...).
 */
function renderTree(
  tpl: NodeTemplate,
  opts: { mode?: 'design' | 'preview'; trigger?: PreviewProps['trigger']; events?: UINode['events'] } = {},
) {
  const mode = opts.mode ?? 'design';
  const build = (t: NodeTemplate, id: string): ReactNode => {
    const def = dataDisplayComponents.find((d) => d.type === t.type);
    const kids = (t.children ?? []).map((c, i) => build(c, `${id}.${i}`));
    if (!def) {
      return (
        <span key={id} data-node-id={id} data-node-type={t.type}>
          {t.text}
          {kids}
        </span>
      );
    }
    const node: UINode = {
      id,
      type: t.type,
      props: t.props ?? {},
      text: t.text,
      children: (t.children ?? []).map((_, i) => `${id}.${i}`),
      events: id === 'root' ? opts.events : undefined,
    };
    const placeholder =
      mode === 'design' && def.children.mode === 'nodes' && kids.length === 0 ? (
        <div data-drop-placeholder-for={id}>Drop here</div>
      ) : undefined;
    const Preview = def.preview;
    return (
      <Preview
        key={id}
        node={node}
        props={(t.props ?? {}) as Record<string, unknown>}
        text={t.text ?? ''}
        slots={{}}
        mode={mode}
        rootProps={{ 'data-node-id': id, 'data-node-type': t.type }}
        trigger={id === 'root' ? (opts.trigger ?? noop) : noop}
      >
        {kids.length > 0 ? kids : placeholder}
      </Preview>
    );
  };
  const result = render(
    <div className={`hsp-root ${mode === 'preview' ? 'hsp-live' : 'hsp-design'}`}>
      <div className="hsp-overlay-host">{build(tpl, 'root')}</div>
    </div>,
  );
  const byId = (id: string) => result.container.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
  return { ...result, byId, root: byId('root') as HTMLElement };
}

/** Renders a preview for a hand-built node (events, bindings, children ids) with extra rootProps. */
function renderWithNode(
  def: ComponentDef,
  node: UINode,
  opts: { props?: Record<string, unknown>; trigger?: PreviewProps['trigger']; rootProps?: Partial<PreviewProps['rootProps']>; text?: string } = {},
): HTMLElement {
  const Preview = def.preview;
  const tpl = templateFor(def);
  const { container } = render(
    <div className="hsp-root hsp-live">
      <Preview
        node={node}
        props={opts.props ?? ((tpl.props ?? {}) as Record<string, unknown>)}
        text={opts.text ?? tpl.text ?? ''}
        slots={{}}
        mode="preview"
        rootProps={{ 'data-node-id': node.id, 'data-node-type': node.type, ...opts.rootProps }}
        trigger={opts.trigger ?? noop}
      />
    </div>,
  );
  return container.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement;
}

const nodeOf = (type: string, extra: Partial<UINode> = {}): UINode => ({ id: 'n_node', type, props: {}, children: [], ...extra });
const LOG_STEP = { id: 'a1', type: 'log', level: 'info', message: 'clicked' } as const;

/** Walks a template tree depth-first. */
function walk(tpl: NodeTemplate, visit: (t: NodeTemplate, parent: NodeTemplate | null) => void, parent: NodeTemplate | null = null) {
  visit(tpl, parent);
  for (const c of tpl.children ?? []) walk(c, visit, tpl);
}

// ---------------------------------------------------------------------------
// Parse the installed @hubspot/ui-extensions declarations (source of truth).
// ---------------------------------------------------------------------------

/**
 * Where each component's props are declared. `all` blocks are intersected; `anyOf` lists the
 * variants of a discriminated union (a member is required only if every variant requires it, and
 * "conditionally required" when only some do).
 */
interface DeclSpec {
  file: string;
  all: string[];
  anyOf?: string[][];
}

const TABLE_ELEMENT: DeclSpec = { file: 'table', all: ['TableElementProps'] };
const DECLS: Record<string, DeclSpec> = {
  Table: { file: 'table', all: ['BaseTableProps'], anyOf: [['TableNoPaginatedProps'], ['TablePaginatedProps']] },
  TableHead: TABLE_ELEMENT,
  TableBody: TABLE_ELEMENT,
  TableFooter: TABLE_ELEMENT,
  TableRow: TABLE_ELEMENT,
  TableHeader: {
    file: 'table',
    all: ['TableElementProps', 'AlignmentProps', 'WidthProps'],
    anyOf: [['UnSortedTableHeaderProps'], ['SortedTableHeaderProps']],
  },
  TableCell: { file: 'table', all: ['TableElementProps', 'AlignmentProps', 'WidthProps', 'TableCellProps'] },
  DescriptionList: { file: 'description-list', all: ['DescriptionListProps'] },
  DescriptionListItem: { file: 'description-list', all: ['DescriptionListItemProps'] },
  Statistics: { file: 'statistics', all: ['StatisticsProps'] },
  StatisticsItem: { file: 'statistics', all: ['StatisticsItemProps'] },
  StatisticsTrend: { file: 'statistics', all: ['StatisticsTrendProps'] },
  ProgressBar: { file: 'progress-bar', all: ['ProgressBarProps'] },
  ScoreCircle: { file: 'score', all: ['ScoreProps'] },
  StepIndicator: { file: 'step-indicator', all: ['StepIndicatorProps'] },
  Alert: { file: 'alert', all: ['AlertProps'] },
  EmptyState: { file: 'empty-state', all: ['EmptyStateProps'] },
  ErrorState: { file: 'error-state', all: ['ErrorStateProps'] },
  LoadingSpinner: { file: 'loading-spinner', all: ['LoadingSpinnerProps'] },
};

/** Vitest runs from the project root (where vite.config.ts lives). */
const PKG_DIR = resolve(process.cwd(), 'node_modules/@hubspot/ui-extensions/dist');
const COMPONENT_TYPES_DIR = resolve(PKG_DIR, 'shared.synced/types/components');
const readDts = (file: string) => readFileSync(resolve(COMPONENT_TYPES_DIR, `${file}.synced.d.ts`), 'utf8');

interface DeclaredMember {
  required: boolean;
  tsType: string;
  defaultValue?: string | number | boolean;
}

/** The `{ ... }` body of an interface / type literal named `name`. */
function blockBody(source: string, name: string): string {
  const start = source.search(new RegExp(`(?:export\\s+)?(?:interface|type)\\s+${name}\\b`));
  expect(start, `declaration ${name}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced ${name}`);
}

/** Non-deprecated members of a block: name -> optionality, TS type, JSDoc default. */
function members(source: string, name: string): Map<string, DeclaredMember> {
  const out = new Map<string, DeclaredMember>();
  const re = /(\/\*\*[\s\S]*?\*\/)?\s*['"]?([\w-]+)['"]?(\?)?:\s*([^;]+);/g;
  for (const m of blockBody(source, name).matchAll(re)) {
    const doc = m[1] ?? '';
    if (doc.includes('@deprecated')) continue;
    const dm = doc.match(/@defaultValue\s+`([^`]+)`/) ?? doc.match(/@default\s+(\S+)/);
    let defaultValue: string | number | boolean | undefined;
    if (dm) {
      const raw = dm[1].trim().replace(/^["']|["']$/g, '');
      defaultValue = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    }
    // Inline same-file literal aliases (e.g. `export type TableDensity = 'default' | ...;`).
    let tsType = m[4].trim();
    const alias = /^\w+$/.test(tsType) ? source.match(new RegExp(`export type ${tsType} = ([^;]+);`)) : null;
    if (alias) tsType = alias[1].trim();
    out.set(m[2], { required: m[3] !== '?', tsType, defaultValue });
  }
  return out;
}

/** Merged declaration of a component: members plus whether they're conditionally required. */
function declaredProps(type: string) {
  const spec = DECLS[type];
  const source = readDts(spec.file);
  const merged = new Map<string, DeclaredMember & { conditional: boolean }>();
  const add = (name: string, m: DeclaredMember, required: boolean, conditional: boolean) => {
    const prev = merged.get(name);
    merged.set(name, {
      required: (prev?.required ?? false) || required,
      conditional: (prev?.conditional ?? false) || conditional,
      tsType: prev ? `${prev.tsType} | ${m.tsType}` : m.tsType,
      defaultValue: prev?.defaultValue ?? m.defaultValue,
    });
  };
  for (const block of spec.all) for (const [name, m] of members(source, block)) add(name, m, m.required, false);
  if (spec.anyOf) {
    const variants = spec.anyOf.map((blocks) => {
      const v = new Map<string, DeclaredMember>();
      for (const block of blocks) for (const [name, m] of members(source, block)) v.set(name, m);
      return v;
    });
    const names = new Set(variants.flatMap((v) => [...v.keys()]));
    for (const name of names) {
      const present = variants.map((v) => v.get(name));
      const requiredInAll = present.every((m) => m?.required === true);
      const requiredInSome = present.some((m) => m?.required === true);
      // Members declared in every variant are the union's discriminants (e.g. `paginated`); members
      // only some variants declare *and* require are conditionally required (e.g. `pageCount`).
      const inAll = present.every((m) => m !== undefined);
      for (const m of present) if (m) add(name, m, requiredInAll, requiredInSome && !inAll);
    }
  }
  return { props: merged, source };
}

/** TShirtSizes / AllSizes resolve to the long names the registry offers (see constants.ts). */
const TSHIRT_LONG: Record<string, string> = { xs: 'extra-small', sm: 'small', md: 'medium', lg: 'large', xl: 'extra-large' };
function literals(tsType: string): string[] {
  const expanded = tsType
    .replace(/\bAllSizes\b/g, Object.values(TSHIRT_LONG).map((v) => `'${v}'`).join(' | '))
    .replace(/TShirtSizes\['(\w+)'\]/g, (_, k: string) => `'${TSHIRT_LONG[k]}'`);
  return [...new Set([...expanded.matchAll(/'([^']*)'/g)].map((m) => m[1]))];
}
const enumValues = (p: PropDef): unknown[] => (p.type.kind === 'enum' ? p.type.options.map((o) => o.value) : []);
const isCallback = (tsType: string) => tsType.includes('=>') || tsType.startsWith('ReactionsHandler');
const isBooleanType = (tsType: string) => /^(boolean|true|false)( \| (boolean|true|false))*$/.test(tsType);
const normalizeDefault = (v: unknown) => (typeof v === 'string' && v in TSHIRT_LONG ? TSHIRT_LONG[v] : v);

/**
 * Deliberate, documented deviations from JSDoc defaults:
 * - TableHeader.sortDirection: `"none"` is documented on the *sorted* union variant, where the prop
 *   is required; when the prop is omitted HubSpot renders an unsortable header ('never').
 */
const DEFAULT_OVERRIDES: Record<string, unknown> = { 'TableHeader.sortDirection': 'never' };

const OWN_TYPES = new Set(dataDisplayComponents.map((d) => d.type));
// Types that may legitimately be referenced by parents/accepts/templates of this group.
const KNOWN_TYPES = new Set([...OWN_TYPES, 'Text', 'Button']);

// ---------------------------------------------------------------------------
// Registry-wide checks
// ---------------------------------------------------------------------------

describe('dataDisplay group registry', () => {
  it('registers the expected components in their categories', () => {
    const byCategory = (category: string) => dataDisplayComponents.filter((d) => d.category === category).map((d) => d.type);
    expect(byCategory('Tables')).toEqual(['Table', 'TableHead', 'TableBody', 'TableFooter', 'TableRow', 'TableHeader', 'TableCell']);
    expect(byCategory('Data display')).toEqual([
      'DescriptionList',
      'DescriptionListItem',
      'Statistics',
      'StatisticsItem',
      'StatisticsTrend',
      'ProgressBar',
      'ScoreCircle',
      'StepIndicator',
    ]);
    expect(byCategory('Feedback & status')).toEqual(['Alert', 'EmptyState', 'ErrorState', 'LoadingSpinner']);
    expect(dataDisplayComponents).toHaveLength(19);
    for (const def of dataDisplayComponents) expect(def.importFrom).toBe('@hubspot/ui-extensions');
  });

  it('parses the discriminated unions of Table and TableHeader', () => {
    const table = declaredProps('Table').props;
    expect(table.get('pageCount')).toMatchObject({ required: false, conditional: true });
    expect(table.get('onPageChange')).toMatchObject({ required: false, conditional: true });
    expect(table.get('paginated')).toMatchObject({ required: false, conditional: false, defaultValue: false });
    expect(table.get('children')).toMatchObject({ required: true });
    expect(literals(table.get('density')?.tsType ?? '')).toEqual(['default', 'condensed', 'compact']);
    const header = declaredProps('TableHeader').props;
    expect(header.get('onSortChange')).toMatchObject({ required: false, conditional: true });
    expect(new Set(literals(header.get('sortDirection')?.tsType ?? ''))).toEqual(new Set(['never', 'ascending', 'descending', 'none']));
    expect(declaredProps('ProgressBar').props.has('valueMax')).toBe(false); // deprecated
    expect(declaredProps('ProgressBar').props.has('aria-label')).toBe(true);
    expect(literals(declaredProps('StepIndicator').props.get('circleSize')?.tsType ?? '')).toHaveLength(5);
  });

  it('only registers components exported by @hubspot/ui-extensions', () => {
    const index = readFileSync(resolve(PKG_DIR, 'index.d.ts'), 'utf8');
    for (const def of dataDisplayComponents) expect(index, def.type).toMatch(new RegExp(`[{ ,]${def.type}[ ,}]`));
  });
});

describe.each(dataDisplayComponents.map((def) => [def.type, def] as const))('%s', (type, def) => {
  it.each(['design', 'preview'] as const)('renders its create() template in %s mode with the root outermost', (mode) => {
    const { root } = renderRoot(def, { mode });
    expect(root.getAttribute('data-node-type')).toBe(type);
    expect(root.className).toMatch(/\bhsp-/);
  });

  it('renders with empty props and text without throwing', () => {
    for (const mode of ['design', 'preview'] as const) {
      renderRoot(def, { mode, props: {}, text: '' });
      cleanup();
    }
  });

  it('degrades gracefully on odd prop shapes', () => {
    const odd = {
      density: 5,
      bordered: 'maybe',
      flush: {},
      paginated: 'true',
      pageCount: 'many',
      page: { n: 1 },
      maxVisiblePageButtons: -3,
      showButtonLabels: null,
      sortDirection: [],
      disabled: 'nope',
      align: 7,
      width: { px: 3 },
      colSpan: 'x',
      direction: null,
      label: { a: 1 },
      number: [1, 2],
      value: {},
      color: 'blue',
      maxValue: 'big',
      variant: 9,
      score: 'high',
      stepNames: [{}, 3, null],
      currentStep: 'two',
      circleSize: {},
      title: 5,
      imageName: 'constructor',
      imageWidth: -5,
      layout: [],
      type: 'toString',
      size: {},
      showLabel: 'yes',
      reverseOrder: 1,
    };
    renderRoot(def, { mode: 'preview', props: odd, text: '' });
    cleanup();
    renderRoot(def, { mode: 'design', props: { stepNames: 'a,b', imageName: 'toString', size: 'constructor', circleSize: '__proto__' } });
  });

  it('merges rootProps.className and forwards runtime hover handlers', () => {
    const onMouseEnter = vi.fn();
    const root = renderWithNode(def, nodeOf(type, { id: 'n_rp' }), { rootProps: { className: 'runtime-hook', onMouseEnter } });
    expect(root).toHaveClass('runtime-hook');
    expect(root.className).toMatch(/\bhsp-/);
    fireEvent.mouseEnter(root);
    expect(onMouseEnter).toHaveBeenCalled();
  });

  it('has a sane definition', () => {
    const tpl = templateFor(def);
    expect(tpl.type).toBe(type);
    expect(def.docsUrl?.startsWith(STANDARD_DOCS)).toBe(true);
    expect(def.description.length).toBeGreaterThan(10);
    expect(def.keywords?.length ?? 0).toBeGreaterThan(0);
    expect(def.icon).toBeTruthy();

    const names = def.props.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(def.props.find((p) => p.name === 'testId')?.group).toBe('Advanced');

    for (const p of def.props) {
      if (p.type.kind === 'enum') {
        const values = enumValues(p);
        expect(new Set(values).size).toBe(values.length);
        if (p.defaultValue !== undefined) expect(values, `${type}.${p.name} default`).toContain(p.defaultValue);
      }
      expect(p.required && p.requiredWhen, `${type}.${p.name}: required and requiredWhen are exclusive`).toBeFalsy();
    }
    if (def.children.mode === 'text') expect(def.children.defaultText).toBeTruthy();
    for (const t of def.children.accepts ?? []) expect(KNOWN_TYPES.has(t), t).toBe(true);
    for (const t of def.parents ?? []) expect(KNOWN_TYPES.has(t), t).toBe(true);
    for (const ev of def.events ?? []) {
      expect(Array.isArray(ev.params)).toBe(true);
      expect(ev.name).toMatch(/^on[A-Z]/);
    }
    if (def.valueBinding) {
      expect(names).toContain(def.valueBinding.prop);
      expect((def.events ?? []).map((e) => e.name)).toContain(def.valueBinding.event);
    }
  });

  it('create() yields a complete, structurally valid subtree', () => {
    walk(templateFor(def), (t, parent) => {
      expect(KNOWN_TYPES.has(t.type), t.type).toBe(true);
      const d = dataDisplayComponents.find((c) => c.type === t.type);
      if (parent) {
        const pd = dataDisplayComponents.find((c) => c.type === parent.type);
        if (pd?.children.accepts) expect(pd.children.accepts, `${parent.type} > ${t.type}`).toContain(t.type);
        if (d?.parents) expect(d.parents, `${parent.type} > ${t.type}`).toContain(parent.type);
      }
      if (!d) return;
      for (const p of d.props) {
        if (p.required) expect(t.props?.[p.name], `${t.type}.${p.name} required`).toBeDefined();
        if (p.requiredWhen?.(t.props ?? {})) expect(t.props?.[p.name], `${t.type}.${p.name} required`).toBeDefined();
        const v = t.props?.[p.name];
        if (p.type.kind === 'enum' && v !== undefined) expect(enumValues(p)).toContain(v);
      }
      if (d.children.mode === 'nodes' && d.children.required) expect(t.children?.length ?? 0, `${t.type} children`).toBeGreaterThan(0);
      if (d.children.mode === 'text') expect(t.text, `${t.type} text`).toBeTruthy();
      if (d.children.mode !== 'nodes') expect(t.children ?? []).toHaveLength(0);
    });
  });

  it('matches the @hubspot/ui-extensions declaration', () => {
    const { props: declared } = declaredProps(type);
    expect(declared.size).toBeGreaterThan(0);
    const propDefs = new Map(def.props.map((p) => [p.name, p]));
    const events = new Map((def.events ?? []).map((e) => [e.name, e]));

    for (const [name, decl] of declared) {
      if (name === 'children') {
        expect(def.children.mode).not.toBe('none');
        if (def.children.mode === 'nodes') expect(Boolean(def.children.required), `${type} children required`).toBe(decl.required);
        continue;
      }
      if (isCallback(decl.tsType)) {
        const ev = events.get(name);
        expect(ev, `${type}.${name} should be an event`).toBeDefined();
        if (decl.conditional) expect(ev?.requiredWhen, `${type}.${name} requiredWhen`).toBeTypeOf('function');
        continue;
      }
      const p = propDefs.get(name);
      expect(p, `${type}.${name} missing from registry`).toBeDefined();
      if (!p) continue;
      expect(Boolean(p.required), `${type}.${name} required-ness`).toBe(decl.required);
      if (decl.conditional) expect(p.requiredWhen, `${type}.${name} requiredWhen`).toBeTypeOf('function');
      const lits = literals(decl.tsType);
      if (p.type.kind === 'enum' && lits.length > 0) expect(new Set(enumValues(p)), `${type}.${name} options`).toEqual(new Set(lits));
      if (isBooleanType(decl.tsType)) expect(p.type.kind).toBe('boolean');
      if (decl.tsType === 'number') expect(p.type.kind).toBe('number');
      const key = `${type}.${name}`;
      const expected = key in DEFAULT_OVERRIDES ? DEFAULT_OVERRIDES[key] : normalizeDefault(decl.defaultValue);
      if (expected !== undefined) expect(p.defaultValue, `${key} default`).toEqual(expected);
    }
    // Nothing invented: every registry prop (except BaseComponentProps.testId) and event is declared.
    for (const name of propDefs.keys()) if (name !== 'testId') expect(declared.has(name), `${type}.${name} declared`).toBe(true);
    for (const name of events.keys()) expect(declared.has(name), `${type}.${name} event declared`).toBe(true);
    if (!declared.has('children')) expect(def.children.mode).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('Table structure', () => {
  it('renders the create() tree as real table elements with rootProps on each part', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { root, byId, container } = renderTree(byType('Table').create!());
      expect(root.tagName).toBe('DIV');
      expect(root).toHaveClass('hsp-table-container');
      const table = root.querySelector('table') as HTMLTableElement;
      expect(table).toHaveClass('hsp-table', 'hsp-table-bordered');
      expect(byId('root.0')?.tagName).toBe('THEAD');
      expect(byId('root.1')?.tagName).toBe('TBODY');
      expect(byId('root.0.0')?.tagName).toBe('TR');
      expect(byId('root.0.0.2')?.tagName).toBe('TH');
      expect(byId('root.1.1.0')?.tagName).toBe('TD');
      expect(byId('root.1.1.0.0')?.textContent).toBe('Globex Inc.');
      expect(table.querySelectorAll('th')).toHaveLength(3);
      expect(table.querySelectorAll('tbody td')).toHaveLength(6);
      expect(within(table).getByText('Amount').closest('th')?.style.textAlign).toBe('right');
      // Parts sit directly in their proper parents (no wrappers when placed correctly).
      expect(byId('root.0')?.parentElement).toBe(table);
      expect(byId('root.1.0')?.parentElement).toBe(byId('root.1'));
      expect(container.querySelector('.hsp-table-standalone')).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('wraps design-mode drop placeholders of empty table parts in valid cells', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const empty = renderTree({ type: 'Table' });
      const ph = empty.container.querySelector('[data-drop-placeholder-for="root"]') as HTMLElement;
      expect(ph.parentElement?.tagName).toBe('TD');
      expect(ph.closest('tbody')?.parentElement?.tagName).toBe('TABLE');
      cleanup();

      const emptyRow = renderTree({ type: 'Table', children: [{ type: 'TableBody', children: [{ type: 'TableRow' }] }] });
      const rowPh = emptyRow.container.querySelector('[data-drop-placeholder-for="root.0.0"]') as HTMLElement;
      expect(rowPh.parentElement?.tagName).toBe('TD');
      expect(rowPh.parentElement?.parentElement).toBe(emptyRow.byId('root.0.0'));
      cleanup();

      const emptySection = renderTree({ type: 'Table', children: [{ type: 'TableHead' }] });
      const sectionPh = emptySection.container.querySelector('[data-drop-placeholder-for="root.0"]') as HTMLElement;
      expect(sectionPh.closest('tr')?.parentElement).toBe(emptySection.byId('root.0'));
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('renders an empty table without placeholder rows in preview mode', () => {
    const { root } = renderTree({ type: 'Table' }, { mode: 'preview' });
    expect(root.querySelectorAll('td')).toHaveLength(0);
  });

  it('keeps out-of-place parts valid by wrapping them, with rootProps on the outermost wrapper', () => {
    const row = renderRoot(byType('TableRow'));
    expect(row.root.tagName).toBe('TABLE');
    expect(row.root).toHaveClass('hsp-table-standalone');
    expect(row.root.querySelector('tbody > tr')).not.toBeNull();
    cleanup();
    const cell = renderRoot(byType('TableCell'));
    expect(cell.root.tagName).toBe('TABLE');
    expect(cell.root.querySelector('tbody > tr > td')).not.toBeNull();
    cleanup();
    const head = renderRoot(byType('TableHead'));
    expect(head.root.tagName).toBe('TABLE');
    expect(head.root.querySelector(':scope > thead')).not.toBeNull();
    cleanup();
    // A Table nested inside a cell is regular flow content again.
    const nested = renderTree({
      type: 'Table',
      children: [{ type: 'TableBody', children: [{ type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Table' }] }] }] }],
    });
    expect(nested.byId('root.0.0.0.0')?.tagName).toBe('DIV');
    expect(nested.byId('root.0.0.0.0')?.parentElement?.tagName).toBe('TD');
  });

  it('applies density, borders and footer styling to cells through context', () => {
    const tpl: NodeTemplate = {
      type: 'Table',
      props: { density: 'compact', bordered: false, flush: true },
      children: [
        { type: 'TableBody', children: [{ type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Text', text: 'a' }] }] }] },
        { type: 'TableFooter', children: [{ type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Text', text: 'b' }] }] }] },
      ],
    };
    const { root, byId } = renderTree(tpl);
    expect(root).toHaveClass('hsp-table-flush');
    expect(root.querySelector('table')).not.toHaveClass('hsp-table-bordered');
    const bodyCell = byId('root.0.0.0') as HTMLElement;
    expect(bodyCell).toHaveClass('hsp-tcell', 'hsp-tcell-compact');
    expect(bodyCell).not.toHaveClass('hsp-tcell-bordered');
    expect(bodyCell).not.toHaveClass('hsp-tfoot-cell');
    expect(byId('root.1.0.0')).toHaveClass('hsp-tfoot-cell');
    expect(byId('root.1')?.tagName).toBe('TFOOT');
  });

  it('applies TableCell align, width and colSpan', () => {
    const cell = byType('TableCell');
    const a = renderRoot(cell, { props: { align: 'center', width: 120, colSpan: 3 } });
    const td = a.root.querySelector('td') as HTMLTableCellElement;
    expect(td.colSpan).toBe(3);
    expect(td.style.textAlign).toBe('center');
    expect(td.style.width).toBe('120px');
    cleanup();
    const b = renderRoot(cell, { props: { width: 'min' } });
    expect(b.root.querySelector('td')).toHaveClass('hsp-tcell-min');
    cleanup();
    const c = renderRoot(cell, { props: { width: 'max' } });
    expect(c.root.querySelector('td')).toHaveClass('hsp-tcell-max');
  });
});

describe('Table pagination', () => {
  const table = byType('Table');
  const paginated = { paginated: true, pageCount: 5 };

  it('is only shown when paginated', () => {
    expect(renderRoot(table).root.querySelector('nav')).toBeNull();
    cleanup();
    const { root } = renderRoot(table, { props: paginated });
    const nav = root.querySelector('nav.hsp-table-pagination') as HTMLElement;
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Prev', '1', '2', '3', '4', '5', 'Next']);
    expect(within(nav).getByText('1')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('Prev').closest('button')).toBeDisabled();
  });

  it('fires onPageChange(pageNumber) and tracks the page locally when uncontrolled', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(table, { mode: 'preview', props: paginated, trigger });
    const nav = within(root.querySelector('nav') as HTMLElement);
    fireEvent.click(nav.getByText('3'));
    expect(trigger).toHaveBeenLastCalledWith('onPageChange', 3);
    expect(nav.getByText('3')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(nav.getByText('Next'));
    expect(trigger).toHaveBeenLastCalledWith('onPageChange', 4);
    fireEvent.click(nav.getByText('4'));
    expect(trigger).toHaveBeenCalledTimes(2); // clicking the current page is a no-op
  });

  it('honours a controlled page, first/last buttons, hidden labels and the button window', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(table, {
      mode: 'preview',
      props: { paginated: true, pageCount: 10, page: 5, maxVisiblePageButtons: 3, showFirstLastButtons: true, showButtonLabels: false },
      trigger,
    });
    const nav = within(root.querySelector('nav') as HTMLElement);
    const buttons = nav.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['', '', '4', '5', '6', '', '']);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['First', 'Prev', null, null, null, 'Next', 'Last']);
    expect(nav.getByText('5')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(nav.getByLabelText('Last'));
    expect(trigger).toHaveBeenLastCalledWith('onPageChange', 10);
    // Controlled: the displayed page follows the prop, not the click.
    expect(nav.getByText('5')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(nav.getByLabelText('First'));
    expect(trigger).toHaveBeenLastCalledWith('onPageChange', 1);
  });

  it('declares pagination requirements conditionally', () => {
    const pageCount = table.props.find((p) => p.name === 'pageCount') as PropDef;
    expect(pageCount.requiredWhen?.({ paginated: true })).toBe(true);
    expect(pageCount.requiredWhen?.({})).toBe(false);
    expect(pageCount.visibleWhen?.({})).toBe(false);
    expect(pageCount.visibleWhen?.({ paginated: { $expr: 'many' } })).toBe(true);
    const onPageChange = table.events?.find((e) => e.name === 'onPageChange');
    expect(onPageChange?.params.map((p) => p.name)).toEqual(['pageNumber']);
    expect(onPageChange?.requiredWhen?.({ paginated: true })).toBe(true);
    expect(onPageChange?.requiredWhen?.({ paginated: false })).toBe(false);
    expect(table.valueBinding).toEqual({ prop: 'page', event: 'onPageChange', stateType: 'number', initial: 1 });
  });
});

describe('TableHeader sorting', () => {
  const header = byType('TableHeader');
  const th = (root: HTMLElement) => root.querySelector('th') as HTMLTableCellElement;

  it('is a plain label when not sortable', () => {
    const { root } = renderRoot(header, { text: 'Name' });
    expect(th(root).querySelector('button')).toBeNull();
    expect(th(root)).toHaveTextContent('Name');
    expect(th(root)).not.toHaveAttribute('aria-sort');
  });

  it.each([
    ['none', 'ascending'],
    ['ascending', 'descending'],
    ['descending', 'none'],
  ])('cycles %s -> %s through onSortChange', (current, next) => {
    const trigger = vi.fn();
    const { root } = renderRoot(header, { mode: 'preview', props: { sortDirection: current }, text: 'Name', trigger });
    expect(th(root)).toHaveAttribute('aria-sort', current);
    fireEvent.click(th(root).querySelector('button') as HTMLButtonElement);
    expect(trigger).toHaveBeenCalledWith('onSortChange', next);
  });

  it('cannot be re-sorted when disabled', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(header, { mode: 'preview', props: { sortDirection: 'ascending', disabled: true }, trigger });
    const button = th(root).querySelector('button') as HTMLButtonElement;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('requires onSortChange only for sortable headers', () => {
    const ev = header.events?.find((e) => e.name === 'onSortChange');
    expect(ev?.requiredWhen?.({ sortDirection: 'none' })).toBe(true);
    expect(ev?.requiredWhen?.({ sortDirection: 'never' })).toBe(false);
    expect(ev?.requiredWhen?.({})).toBe(false);
    const disabled = header.props.find((p) => p.name === 'disabled');
    expect(disabled?.visibleWhen?.({})).toBe(false);
    expect(disabled?.visibleWhen?.({ sortDirection: 'descending' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------

describe('DescriptionList', () => {
  it('renders label/value pairs and passes the direction to its items', () => {
    const tpl = byType('DescriptionList').create!();
    const column = renderTree(tpl);
    expect(column.root.tagName).toBe('DL');
    expect(column.root).toHaveClass('hsp-dl-column');
    const item = column.byId('root.0') as HTMLElement;
    expect(item).toHaveClass('hsp-dl-item-column');
    expect(item.querySelector('dt')).toHaveTextContent('Email');
    expect(item.querySelector('dd')).toHaveTextContent('alex.morgan@acme.com');
    cleanup();
    const row = renderTree({ ...tpl, props: { direction: 'row' } });
    expect(row.root).toHaveClass('hsp-dl-row');
    expect(row.byId('root.2')).toHaveClass('hsp-dl-item-row');
  });
});

describe('Statistics', () => {
  it('renders items with label, number and trend', () => {
    const { root, byId } = renderTree(byType('Statistics').create!());
    expect(root).toHaveClass('hsp-stats');
    const item = byId('root.1') as HTMLElement;
    expect(item.querySelector('.hsp-stat-label')).toHaveTextContent('Pipeline value');
    expect(item.querySelector('.hsp-stat-number')).toHaveTextContent('$48,200');
    expect(byId('root.1.0')).toHaveTextContent('2.1%');
  });

  it('colors trend arrows by direction unless a color is set', () => {
    const trend = byType('StatisticsTrend');
    const arrow = (root: HTMLElement) => root.querySelector('.hsp-stat-trend-arrow');
    expect(arrow(renderRoot(trend, { props: { value: '5%', direction: 'increase' } }).root)).toHaveClass('hsp-stat-trend-green');
    cleanup();
    const down = renderRoot(trend, { props: { value: '5%', direction: 'decrease' } }).root;
    expect(arrow(down)).toHaveClass('hsp-stat-trend-red');
    expect(down).toHaveTextContent('Decreased by5%');
    cleanup();
    expect(arrow(renderRoot(trend, { props: { value: '5%', direction: 'decrease', color: 'green' } }).root)).toHaveClass(
      'hsp-stat-trend-green',
    );
  });
});

describe('ProgressBar', () => {
  const def = byType('ProgressBar');
  const fill = (root: HTMLElement) => root.querySelector('.hsp-progress-fill') as HTMLElement;

  it('renders the create() bar at 60% with title, description and percentage', () => {
    const { root } = renderRoot(def);
    expect(fill(root).style.width).toBe('60%');
    expect(fill(root)).toHaveClass('hsp-progress-success');
    expect(root).toHaveTextContent('Onboarding progress');
    expect(root).toHaveTextContent('3 of 5 steps complete');
    expect(root.querySelector('.hsp-progress-percent')).toHaveTextContent('60%');
    const bar = root.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-label', 'Onboarding progress');
  });

  it('uses HubSpot defaults (0 of 100) and clamps', () => {
    expect(fill(renderRoot(def, { props: {} }).root).style.width).toBe('0%');
    cleanup();
    expect(fill(renderRoot(def, { props: { value: 150, maxValue: 100, variant: 'danger' } }).root).style.width).toBe('100%');
    cleanup();
    const { root } = renderRoot(def, { props: { value: '25', 'aria-label': 'Quota' } });
    expect(fill(root).style.width).toBe('25%');
    expect(root.querySelector('.hsp-progress-percent')).toBeNull();
    expect(root.querySelector('[role="progressbar"]')).toHaveAttribute('aria-label', 'Quota');
  });
});

describe('ScoreCircle', () => {
  const def = byType('ScoreCircle');
  it.each([
    [20, 'alert', '20'],
    [33, 'warning', '33'],
    [65.4, 'warning', '65'],
    [75.6, 'success', '76'],
    [150, 'success', '100'],
    [-4, 'alert', '0'],
  ])('score %s -> %s band showing %s', (score, band, shown) => {
    const { root } = renderRoot(def, { props: { score } });
    expect(root).toHaveClass(`hsp-score-circle-${band}`);
    expect(root.querySelector('.hsp-score-circle-value')).toHaveTextContent(shown);
    expect(root).toHaveAttribute('aria-label', `Score: ${shown} out of 100`);
  });

  it('shows a dash without a score', () => {
    expect(renderRoot(def, { props: {} }).root.querySelector('.hsp-score-circle-value')).toHaveTextContent('–');
  });
});

describe('StepIndicator', () => {
  const def = byType('StepIndicator');
  const dots = (root: HTMLElement) => [...root.querySelectorAll('.hsp-steps-dot')].map((d) => d.className.replace(/.*hsp-steps-dot-/, ''));

  it('renders steps with complete/current/upcoming states and labels', () => {
    const { root } = renderRoot(def);
    expect(root).toHaveClass('hsp-steps-horizontal', 'hsp-steps-columns');
    expect(dots(root)).toEqual(['complete', 'current', 'upcoming', 'upcoming']);
    expect([...root.querySelectorAll('.hsp-steps-label')].map((l) => l.textContent)).toEqual(['Qualify', 'Propose', 'Negotiate', 'Close']);
    expect(within(root).getByText('Propose').closest('button')).toHaveAttribute('aria-current', 'step');
  });

  it('fires onClick(stepIndex) in preview mode', () => {
    const trigger = vi.fn();
    const root = renderWithNode(def, nodeOf('StepIndicator', { events: { onClick: [LOG_STEP] } }), { trigger });
    const buttons = root.querySelectorAll('button');
    expect(buttons[2]).toHaveClass('hsp-steps-clickable');
    fireEvent.click(buttons[2]);
    expect(trigger).toHaveBeenCalledWith('onClick', 2);
    expect(def.valueBinding).toEqual({ prop: 'currentStep', event: 'onClick', stateType: 'number', initial: 0 });
  });

  it('shows only the active title for compact and flush variants', () => {
    const names = ['One', 'Two', 'Three'];
    const compact = renderRoot(def, { props: { stepNames: names, currentStep: 2, variant: 'compact' } }).root;
    expect(compact.querySelectorAll('.hsp-steps-label')).toHaveLength(0);
    expect(compact.querySelector('.hsp-steps-caption')).toHaveTextContent('Three');
    expect(within(compact).getByLabelText('One')).toBeInTheDocument();
    cleanup();
    const flush = renderRoot(def, { props: { stepNames: names, currentStep: 0, variant: 'flush', circleSize: 'lg' } }).root;
    expect(flush).toHaveClass('hsp-steps-rail');
    expect(flush.querySelector('.hsp-steps-caption')).toHaveTextContent('One');
    expect((flush.querySelector('.hsp-steps-dot') as HTMLElement).style.width).toBe('26px');
  });

  it('has no active step when currentStep is omitted', () => {
    const { root } = renderRoot(def, { props: { stepNames: ['A', 'B', 'C'] } });
    expect(dots(root)).toEqual(['upcoming', 'upcoming', 'upcoming']);
    expect(root.querySelector('[aria-current]')).toBeNull();
  });

  it('renders vertically with the rail on the left', () => {
    const { root } = renderRoot(def, { props: { stepNames: ['A', 'B'], currentStep: 5, direction: 'vertical' } });
    expect(root).toHaveClass('hsp-steps-vertical');
    expect(root.querySelectorAll('.hsp-steps-vrail')).toHaveLength(2);
    expect(dots(root)).toEqual(['complete', 'complete']);
  });

  it('hints at missing step names in design mode only', () => {
    expect(renderRoot(def, { props: {} }).root).toHaveTextContent('Add step names');
    cleanup();
    expect(renderRoot(def, { mode: 'preview', props: {} }).root).toHaveTextContent('');
  });
});

// ---------------------------------------------------------------------------
// Feedback & status
// ---------------------------------------------------------------------------

describe('Alert', () => {
  const def = byType('Alert');
  it('renders title and body with the variant colors', () => {
    const { root } = renderRoot(def);
    expect(root).toHaveClass('hsp-alert-box', 'hsp-alert-box-info');
    expect(root).toHaveAttribute('role', 'status');
    expect(root.querySelector('.hsp-alert-box-title')).toHaveTextContent('Heads up');
    expect(root.querySelector('.hsp-alert-box-body')).toHaveTextContent('This contact has an open support ticket.');
    cleanup();
    const danger = renderRoot(def, { props: { title: 'Failed', variant: 'danger' }, text: '' }).root;
    expect(danger).toHaveClass('hsp-alert-box-danger');
    expect(danger).toHaveAttribute('role', 'alert');
    expect(danger.querySelector('.hsp-alert-box-body')).toBeNull();
  });
});

describe('EmptyState', () => {
  const def = byType('EmptyState');
  it('renders image then content, swapping with reverseOrder', () => {
    const { root, byId } = renderTree(def.create!());
    expect(root).toHaveClass('hsp-empty-state-horizontal');
    expect(root.firstElementChild).toHaveClass('hsp-empty-state-image');
    expect(root.querySelector('.hsp-empty-state-title')).toHaveTextContent('No deals yet');
    expect(byId('root.0')?.closest('.hsp-empty-state-body')).not.toBeNull();
    cleanup();
    const reversed = renderRoot(def, { props: { layout: 'vertical', reverseOrder: true, imageWidth: 120, flush: true } }).root;
    expect(reversed).toHaveClass('hsp-empty-state-vertical', 'hsp-empty-state-flush');
    expect(reversed.firstElementChild).toHaveClass('hsp-empty-state-content');
    expect((reversed.querySelector('.hsp-empty-state-image') as HTMLElement).style.maxWidth).toBe('120px');
  });

  it('draws an inline illustration for every image name (no external assets)', () => {
    const imageName = def.props.find((p) => p.name === 'imageName') as PropDef;
    for (const value of enumValues(imageName)) {
      const { root } = renderRoot(def, { props: { imageName: value } });
      const svg = root.querySelector('svg.hsp-spot') as SVGElement;
      expect(svg, String(value)).not.toBeNull();
      expect(svg.querySelector('svg.hsp-spot-icon'), String(value)).not.toBeNull();
      expect(root.querySelector('img')).toBeNull();
      cleanup();
    }
  });
});

describe('ErrorState', () => {
  it.each(['error', 'support', 'lock'])('renders the %s illustration with title and content', (type) => {
    const { root } = renderRoot(byType('ErrorState'), { props: { type, title: 'Unable to load' } });
    expect(root).toHaveClass(`hsp-error-state-${type}`);
    expect(root.querySelector('svg.hsp-spot')).not.toBeNull();
    expect(root.querySelector('.hsp-error-state-title')).toHaveTextContent('Unable to load');
  });
});

describe('LoadingSpinner', () => {
  const def = byType('LoadingSpinner');
  it('shows the label when showLabel is set, otherwise keeps it for screen readers', () => {
    const shown = renderRoot(def).root;
    expect(shown.tagName).toBe('SPAN');
    expect(shown).toHaveAttribute('role', 'status');
    expect(shown.querySelector('.hsp-loading-spinner-label')).toHaveTextContent('Loading...');
    expect(shown.querySelector('svg')).toHaveAttribute('width', '24');
    cleanup();
    const hidden = renderRoot(def, { props: { label: 'Fetching deals', layout: 'centered', size: 'xs' } }).root;
    expect(hidden.tagName).toBe('DIV');
    expect(hidden).toHaveClass('hsp-loading-spinner-centered');
    expect(hidden.querySelector('.hsp-loading-spinner-label')).toBeNull();
    expect(hidden.querySelector('.hsp-dd-sr-only')).toHaveTextContent('Fetching deals');
    expect(hidden.querySelector('svg')).toHaveAttribute('width', '16');
  });
});
