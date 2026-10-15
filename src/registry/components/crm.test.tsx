import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeTemplate } from '../../model/types';
import { renderPreview, templateFor } from '../../test/previewHarness';
import { CRM_ACTION_DOCS, CRM_DOCS } from '../constants';
import type { ComponentDef, PropDef } from '../types';
import { CRM_ACTION_TYPES, actionContextIssues, crmComponents, humanizePropertyName } from './crm';

// Vitest globals are off, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DATA_TYPES = [
  'CrmPropertyList',
  'CrmAssociationTable',
  'CrmDataHighlight',
  'CrmReport',
  'CrmAssociationPivot',
  'CrmAssociationPropertyList',
  'CrmAssociationStageTracker',
  'CrmSimpleDeadline',
  'CrmStageTracker',
  'CrmStatistics',
];
const ACTION_TYPES = ['CrmActionButton', 'CrmActionLink', 'CrmCardActions'];
const ALL_TYPES = [...DATA_TYPES, ...ACTION_TYPES];

const DIST = resolve(process.cwd(), 'node_modules/@hubspot/ui-extensions/dist');
const CRM_DTS = readFileSync(resolve(DIST, 'shared.synced/types/crm.synced.d.ts'), 'utf8');

function def(type: string): ComponentDef {
  const d = crmComponents.find((c) => c.type === type);
  if (!d) throw new Error(`missing ${type}`);
  return d;
}

function propDef(type: string, name: string): PropDef {
  const p = def(type).props.find((x) => x.name === name);
  if (!p) throw new Error(`missing ${type}.${name}`);
  return p;
}

/** Names exported by @hubspot/ui-extensions/crm. */
function crmExports(): Set<string> {
  const src = readFileSync(resolve(DIST, 'crm/index.d.ts'), 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Top-level members of an interface / object type alias in crm.synced.d.ts, including inherited
 * members (`extends X` / `= X & {`). Maps member name -> optional.
 */
function members(name: string): Map<string, boolean> {
  const m = new RegExp(`(?:interface|type)\\s+${name}\\b([^{]*)\\{`).exec(CRM_DTS);
  if (!m) throw new Error(`no declaration for ${name}`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (depth > 0 && i < CRM_DTS.length) {
    if (CRM_DTS[i] === '{') depth++;
    else if (CRM_DTS[i] === '}') depth--;
    i++;
  }
  const out = new Map<string, boolean>();
  let level = 0;
  for (const line of CRM_DTS.slice(start, i - 1).split('\n')) {
    const member = /^\s*(\w+)(\?)?:/.exec(line);
    if (level === 0 && member) out.set(member[1], member[2] === '?');
    level += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  for (const base of m[1].match(/\b[A-Z]\w+/g) ?? []) {
    if (base === 'BaseComponentProps') out.set('testId', true);
    else for (const [k, v] of members(base)) out.set(k, v);
  }
  return out;
}

/** Root of the rendered preview must be the only/outermost element inside the overlay host. */
function expectOutermost(container: HTMLElement, root: Element | null) {
  const host = container.querySelector('.hsp-overlay-host');
  expect(root).not.toBeNull();
  expect(host?.children.length).toBe(1);
  expect(host?.firstElementChild).toBe(root);
}

function walkTemplate(tpl: NodeTemplate, visit: (t: NodeTemplate) => void) {
  visit(tpl);
  for (const c of tpl.children ?? []) walkTemplate(c, visit);
  for (const list of Object.values(tpl.slots ?? {})) for (const c of list) walkTemplate(c, visit);
}

const createProps = (type: string) => (templateFor(def(type)).props ?? {}) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

describe('crm registry definitions', () => {
  const exported = crmExports();

  it('registers exactly the CRM data & action components', () => {
    expect(crmComponents.map((c) => c.type)).toEqual(ALL_TYPES);
  });

  it.each(crmComponents.map((c) => [c.type, c] as const))('%s: definition is consistent', (type, d) => {
    expect(d.category).toBe(DATA_TYPES.includes(type) ? 'CRM data' : 'CRM actions');
    expect(d.importFrom).toBe('@hubspot/ui-extensions/crm');
    expect(exported.has(d.importName ?? d.type)).toBe(true);
    expect(d.icon).toBeTruthy();
    expect(d.docsUrl?.startsWith(DATA_TYPES.includes(type) ? `${CRM_DOCS}/` : `${CRM_ACTION_DOCS}/`)).toBe(true);
    expect(d.description.length).toBeGreaterThan(10);
    expect(d.keywords?.length).toBeGreaterThan(0);

    const names = d.props.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(d.props.find((p) => p.name === 'testId')?.group).toBe('Advanced');
    expect(names.filter((n) => /^on[A-Z]/.test(n))).toEqual([]);
    expect(names).not.toContain('children');

    // Enum defaults (including object sub-fields) are among the options.
    const checkDefaults = (props: PropDef[]) => {
      for (const p of props) {
        if (p.type.kind === 'enum' && p.defaultValue !== undefined) {
          expect(p.type.options.map((o) => o.value), `${type}.${p.name}`).toContain(p.defaultValue);
        }
        if (p.type.kind === 'object') checkDefaults(p.type.fields);
      }
    };
    checkDefaults(d.props);

    // create(): every required prop is set; text components get text; no nested children.
    const tpl = templateFor(d);
    expect(tpl.type).toBe(type);
    for (const p of d.props.filter((x) => x.required)) {
      expect(tpl.props?.[p.name], `${type}.${p.name}`).not.toBeUndefined();
      expect(tpl.props?.[p.name], `${type}.${p.name}`).not.toBe('');
    }
    expect(tpl.children ?? []).toEqual([]);
    if (d.children.mode === 'text') {
      expect(tpl.text?.length ?? 0).toBeGreaterThan(0);
      expect(d.children.defaultText?.length ?? 0).toBeGreaterThan(0);
    }
    // Structural references (none expected in this group) must point at real components.
    for (const t of [...(d.parents ?? []), ...(d.children.accepts ?? []), ...(d.slots ?? []).flatMap((s) => s.accepts)]) {
      expect(ALL_TYPES.includes(t) || exported.has(t), t).toBe(true);
    }
    walkTemplate(tpl, (t) => expect(ALL_TYPES).toContain(t.type));
    expect(d.valueBinding).toBeUndefined();
    expect(d.overlay).toBeUndefined();
  });

  it('declares the locations from extension-points.synced.d.ts', () => {
    for (const type of ['CrmActionButton', 'CrmActionLink']) {
      expect(def(type).locations).toEqual(['crm.record.tab', 'crm.record.sidebar', 'crm.preview', 'helpdesk.sidebar']);
    }
    for (const type of [...DATA_TYPES, 'CrmCardActions']) {
      expect(def(type).locations).toEqual(['crm.record.tab', 'crm.preview', 'helpdesk.sidebar']);
    }
    // The sidebar extension point only exposes the two action components.
    const ep = readFileSync(resolve(DIST, 'shared.synced/types/extension-points.synced.d.ts'), 'utf8');
    const sidebar = /interface CrmSidebarExtensionPoint[\s\S]*?customComponents: \{([\s\S]*?)\};/.exec(ep)?.[1] ?? '';
    expect([...sidebar.matchAll(/(\w+)\?:/g)].map((m) => m[1])).toEqual(['CrmActionButton', 'CrmActionLink']);
  });

  it.each(ALL_TYPES)('%s: props, events and required-ness match crm.synced.d.ts', (type) => {
    const d = def(type);
    const tsMembers = members(`${type}Props`);
    const callbacks = [...tsMembers.keys()].filter((n) => /^on[A-Z]/.test(n));
    const expectedProps = [...tsMembers.keys()].filter((n) => !callbacks.includes(n) && n !== 'children').sort();
    expect(d.props.map((p) => p.name).sort()).toEqual(expectedProps);
    for (const p of d.props) expect(Boolean(p.required), `${type}.${p.name} required`).toBe(tsMembers.get(p.name) === false);
    expect((d.events ?? []).map((e) => e.name).sort()).toEqual(callbacks.sort());
    if (tsMembers.has('children')) expect(d.children.mode).toBe('text');
    else expect(d.children.mode).toBe('none');
  });

  it('copies enum values and documented defaults exactly', () => {
    const values = (type: string, name: string) => {
      const p = propDef(type, name);
      return p.type.kind === 'enum' ? p.type.options.map((o) => o.value) : [];
    };
    const tsUnion = (name: string) =>
      [...(new RegExp(`type ${name} = ([^;]+);`).exec(CRM_DTS)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...CRM_ACTION_TYPES]).toEqual(tsUnion('ActionType'));
    expect(values('CrmActionButton', 'actionType')).toEqual(tsUnion('ActionType'));
    expect(values('CrmActionLink', 'actionType')).toEqual(tsUnion('ActionType'));
    expect(values('CrmActionButton', 'variant')).toEqual(['primary', 'secondary', 'destructive']);
    expect(values('CrmActionButton', 'type')).toEqual(['button', 'reset', 'submit']);
    expect(values('CrmActionButton', 'size')).toEqual(['extra-small', 'small', 'medium']);
    expect(values('CrmActionLink', 'variant')).toEqual(['primary', 'light', 'dark', 'destructive']);
    expect(values('CrmReport', 'use')).toEqual(['associations', 'subject', 'unfiltered']);
    expect(values('CrmPropertyList', 'direction')).toEqual(['column', 'row']);

    expect(propDef('CrmActionButton', 'variant').defaultValue).toBe('secondary');
    expect(propDef('CrmActionButton', 'type').defaultValue).toBe('button');
    expect(propDef('CrmActionButton', 'size').defaultValue).toBe('medium');
    expect(propDef('CrmActionLink', 'variant').defaultValue).toBe('primary');
    expect(propDef('CrmReport', 'use').defaultValue).toBe('associations');
    expect(propDef('CrmPropertyList', 'direction').defaultValue).toBe('column');

    // Value kinds follow the TS types.
    expect(propDef('CrmPropertyList', 'properties').type.kind).toBe('stringList');
    expect(propDef('CrmPropertyList', 'objectId').type).toMatchObject({ kind: 'number', integer: true });
    expect(propDef('CrmAssociationTable', 'pageSize').type.kind).toBe('number');
    for (const [type, name] of [
      ['CrmAssociationTable', 'preFilters'],
      ['CrmAssociationTable', 'sort'],
      ['CrmAssociationPivot', 'preFilters'],
      ['CrmAssociationPropertyList', 'filters'],
      ['CrmAssociationStageTracker', 'filters'],
      ['CrmStatistics', 'statistics'],
      ['CrmActionButton', 'actionContext'],
      ['CrmCardActions', 'actionConfigs'],
    ]) {
      const t = propDef(type, name).type;
      expect(t.kind, `${type}.${name}`).toBe('json');
      if (t.kind === 'json') {
        expect(t.template, `${type}.${name}`).toBeDefined();
        expect(t.hint?.length ?? 0, `${type}.${name}`).toBeGreaterThan(10);
      }
    }
    const theme = propDef('CrmSimpleDeadline', 'progressTheme').type;
    expect(theme.kind === 'object' && theme.fields.map((f) => f.name)).toEqual([
      ...members('ProgressTheme').keys(),
    ]);
  });

  it('declares HubSpot callback signatures as events', () => {
    for (const type of ['CrmActionButton', 'CrmActionLink']) {
      // onClick: () => void — HubSpot passes no arguments.
      expect(def(type).events).toEqual([
        expect.objectContaining({ name: 'onClick', params: [] }),
        expect.objectContaining({ name: 'onError', params: [expect.objectContaining({ name: 'errors' })] }),
      ]);
    }
    expect(def('CrmCardActions').events).toEqual([expect.objectContaining({ name: 'onError', params: [expect.objectContaining({ name: 'errors' })] })]);
    for (const type of DATA_TYPES) expect(def(type).events ?? []).toEqual([]);
  });

  it('creates action contexts that are valid for their action types', () => {
    for (const type of ['CrmActionButton', 'CrmActionLink']) {
      const props = createProps(type);
      expect(actionContextIssues(props.actionType, props.actionContext), type).toEqual([]);
    }
    const configs = createProps('CrmCardActions').actionConfigs as Array<Record<string, unknown>>;
    const buttons = configs.flatMap((c) => (c.type === 'dropdown' ? (c.options as Array<Record<string, unknown>>) : [c]));
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) {
      expect(b.type).toBe('action-library-button');
      expect(actionContextIssues(b.actionType, b.actionContext)).toEqual([]);
    }
    // Templates target the current record through the extension context.
    expect(createProps('CrmActionButton').actionContext).toEqual({
      objectTypeId: '{{ context.crm.objectTypeId }}',
      objectId: '{{ context.crm.objectId }}',
    });
  });

  it('uses filter / statistic values that fit the TS types', () => {
    const ops = [...(/operator: ([^;]+);/.exec(CRM_DTS)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const statTypes = [
      ...[...(/statisticType: ('SUM'[^;]+);/.exec(CRM_DTS)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
      'PERCENTILES',
    ];
    const checkFilter = (f: Record<string, unknown>) => {
      expect(ops).toContain(f.operator);
      expect(typeof f.property).toBe('string');
      for (const k of ['value', 'values', 'highValue']) {
        if (k in f) expect(['string', 'number']).toContain(typeof f[k]);
      }
    };
    for (const [type, name] of [
      ['CrmAssociationTable', 'preFilters'],
      ['CrmAssociationPivot', 'preFilters'],
      ['CrmAssociationPropertyList', 'filters'],
      ['CrmAssociationStageTracker', 'filters'],
    ]) {
      const t = propDef(type, name).type;
      if (t.kind === 'json') (t.template as Array<Record<string, unknown>>).forEach(checkFilter);
    }
    for (const stat of createProps('CrmStatistics').statistics as Array<Record<string, unknown>>) {
      expect(statTypes).toContain(stat.statisticType);
      for (const group of (stat.filterGroups as Array<{ filters: Array<Record<string, unknown>> }> | undefined) ?? []) {
        group.filters.forEach(checkFilter);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Previews: robustness
// ---------------------------------------------------------------------------

describe('crm previews render', () => {
  it.each(ALL_TYPES.flatMap((t) => [[t, 'design'] as const, [t, 'preview'] as const]))(
    '%s (%s): create() props render with rootProps on the outermost element',
    (type, mode) => {
      const { container, root } = renderPreview(def(type), { mode });
      expectOutermost(container, root);
      expect(root?.getAttribute('data-node-type')).toBe(type);
      expect(root?.textContent?.length ?? 0).toBeGreaterThan(0);
    },
  );

  it.each(ALL_TYPES.flatMap((t) => [[t, 'design'] as const, [t, 'preview'] as const]))(
    '%s (%s): empty props and text do not throw',
    (type, mode) => {
      const { container, root } = renderPreview(def(type), { mode, props: {}, text: '' });
      expectOutermost(container, root);
    },
  );

  it.each(ALL_TYPES)('%s: odd prop shapes degrade gracefully', (type) => {
    const odd = {
      properties: 'firstname, email',
      propertyColumns: 42,
      quickFilterProperties: [null, { a: 1 }, 'dealstage'],
      objectTypeId: { nested: true },
      objectId: 'abc',
      pageSize: -3,
      sort: 'amount',
      preFilters: {},
      statistics: [null, 'x', { statisticType: 'NOPE' }],
      actionType: 'NOT_AN_ACTION',
      actionContext: 'nope',
      actionConfigs: [null, { type: 'dropdown', options: 'x' }, 7],
      progressTheme: { height: {}, completedGradient: { startColor: 1 } },
      reportId: 123,
      use: 'everything',
      variant: ['primary'],
      size: 99,
      showProperties: 'false',
      associationLabels: 'CEO',
      maxAssociations: '2',
    };
    for (const mode of ['design', 'preview'] as const) {
      const { container, root } = renderPreview(def(type), { mode, props: odd, text: 'Go' });
      expectOutermost(container, root);
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Previews: content & interactions
// ---------------------------------------------------------------------------

describe('CrmPropertyList preview', () => {
  it('shows humanized labels with sample values and supports the row direction', () => {
    const { root } = renderPreview(def('CrmPropertyList'), {
      props: { properties: ['firstname', 'email', 'custom_renewal_date'], direction: 'row' },
    });
    expect(root).toHaveTextContent('First name');
    expect(root).toHaveTextContent('Ada');
    expect(root).toHaveTextContent('ada@analytical.example');
    expect(root).toHaveTextContent('Custom renewal date');
    expect(root?.querySelector('.hsp-crm-proplist--row')).not.toBeNull();
  });

  it('edits a value inline in preview mode only', async () => {
    const user = userEvent.setup();
    renderPreview(def('CrmPropertyList'), { mode: 'preview', props: { properties: ['firstname'] } });
    await user.click(screen.getByRole('button', { name: 'Edit First name' }));
    const input = screen.getByRole('textbox', { name: 'First name' });
    await user.clear(input);
    await user.type(input, 'Augusta{Enter}');
    expect(screen.getByRole('button', { name: 'Edit First name' })).toHaveTextContent('Augusta');
    cleanup();
    renderPreview(def('CrmPropertyList'), { mode: 'design', props: { properties: ['firstname'] } });
    expect(screen.queryByRole('button', { name: 'Edit First name' })).toBeNull();
  });

  it('notes HubSpot’s 24 property limit in design mode', () => {
    const properties = Array.from({ length: 26 }, (_, i) => `prop_${i}`);
    const { root } = renderPreview(def('CrmPropertyList'), { props: { properties } });
    expect(root?.querySelectorAll('.hsp-crm-prop').length).toBe(24);
    expect(root).toHaveTextContent('up to 24 properties');
  });
});

describe('CrmDataHighlight preview', () => {
  it('shows at most four properties', () => {
    const { root } = renderPreview(def('CrmDataHighlight'), {
      props: { properties: ['amount', 'closedate', 'dealstage', 'hs_priority', 'dealtype'] },
    });
    expect(root?.querySelectorAll('.hsp-crm-highlight-item').length).toBe(4);
    expect(root).toHaveTextContent('$125,000.00');
    expect(root).toHaveTextContent('up to 4 properties');
  });
});

describe('CrmAssociationTable preview', () => {
  const props = {
    objectTypeId: '0-3',
    propertyColumns: ['dealname', 'amount', 'dealstage'],
    quickFilterProperties: ['dealstage'],
  };

  it('renders columns from propertyColumns, three sample rows and toolbar', () => {
    const { root } = renderPreview(def('CrmAssociationTable'), { props });
    const headers = within(root as HTMLElement).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Deal name', 'Amount', 'Deal stage']);
    expect(within(root as HTMLElement).getAllByRole('row')).toHaveLength(4);
    expect(root).toHaveTextContent('Association label');
    expect(root?.querySelector('.hsp-crm-search-input')).not.toBeNull();
    expect(root?.querySelector('.hsp-crm-pagination')).not.toBeNull();
  });

  it('hides search, pagination and the association label filter when disabled', () => {
    const { root } = renderPreview(def('CrmAssociationTable'), {
      props: { ...props, searchable: false, pagination: false, associationLabelFilter: false },
    });
    expect(root?.querySelector('.hsp-crm-search-input')).toBeNull();
    expect(root?.querySelector('.hsp-crm-pagination')).toBeNull();
    expect(root).not.toHaveTextContent('Association label');
  });

  it('applies the sort descriptor', () => {
    const firstCell = (direction: number) => {
      const { root } = renderPreview(def('CrmAssociationTable'), { props: { ...props, sort: [{ columnName: 'amount', direction }] } });
      const cell = root?.querySelector('tbody tr td:nth-child(2)')?.textContent;
      cleanup();
      return cell;
    };
    expect(firstCell(1)).toBe('$12,000.00');
    expect(firstCell(-1)).toBe('$125,000.00');
  });

  it('searches and paginates sample rows in preview mode', async () => {
    const user = userEvent.setup();
    const { root } = renderPreview(def('CrmAssociationTable'), { mode: 'preview', props: { ...props, pageSize: 2 } });
    const body = () => (root as HTMLElement).querySelectorAll('tbody tr');
    expect(body()).toHaveLength(2);
    await user.click(within(root as HTMLElement).getByRole('button', { name: '2' }));
    expect(body()).toHaveLength(1);
    await user.type(within(root as HTMLElement).getByRole('textbox', { name: 'Search deals' }), 'pilot');
    expect(body()).toHaveLength(1);
    expect(body()[0]).toHaveTextContent('Compiler Pilot');
  });
});

describe('CrmAssociationPivot preview', () => {
  it('groups by association label and reveals more records in preview mode', async () => {
    const user = userEvent.setup();
    const { root } = renderPreview(def('CrmAssociationPivot'), {
      mode: 'preview',
      props: { objectTypeId: '0-1', associationLabels: ['CEO', 'Champion'], maxAssociations: 1 },
    });
    expect(root).toHaveTextContent('CEO');
    expect(root).toHaveTextContent('Champion');
    expect(root?.querySelectorAll('.hsp-crm-pivot-item').length).toBe(2);
    await user.click(within(root as HTMLElement).getByRole('button', { name: 'Show more' }));
    expect(root?.querySelectorAll('.hsp-crm-pivot-item').length).toBe(4);
  });
});

describe('stage trackers & deadline previews', () => {
  it('CrmStageTracker shows the current stage and hides properties when asked', () => {
    const { root } = renderPreview(def('CrmStageTracker'), { props: { properties: ['amount'], objectTypeId: '0-3' } });
    expect(root?.querySelector('[aria-current="step"]')).toHaveTextContent('Contract sent');
    expect(root).toHaveTextContent('$125,000.00');
    cleanup();
    const hidden = renderPreview(def('CrmStageTracker'), { props: { properties: ['amount'], showProperties: false } });
    expect(hidden.root).not.toHaveTextContent('$125,000.00');
  });

  it('CrmAssociationStageTracker pages through associated records in preview mode', async () => {
    const user = userEvent.setup();
    const { root } = renderPreview(def('CrmAssociationStageTracker'), { mode: 'preview' });
    expect(root).toHaveTextContent('Difference Engine Expansion');
    await user.click(within(root as HTMLElement).getByRole('button', { name: 'Next deal' }));
    expect(root).toHaveTextContent('Analytical Engine Renewal');
    expect(root?.querySelector('[aria-current="step"]')).toHaveTextContent('Presentation scheduled');
  });

  it('CrmSimpleDeadline applies the progress theme', () => {
    const { root } = renderPreview(def('CrmSimpleDeadline'), {
      props: {
        startDatePropertyName: 'createdate',
        endDatePropertyName: 'closedate',
        properties: [],
        progressTheme: { completedColor: 'rgb(1, 2, 3)', height: 12, upcomingGradient: { startColor: 'red', endColor: 'blue' } },
      },
    });
    expect(root).toHaveTextContent('Create date');
    expect(root).toHaveTextContent('Close date');
    const track = root?.querySelector('.hsp-crm-deadline-track') as HTMLElement;
    const fill = root?.querySelector('.hsp-crm-deadline-fill') as HTMLElement;
    expect(track.style.height).toBe('12px');
    expect(track.style.background).toContain('linear-gradient');
    expect(fill.style.background).toBe('rgb(1, 2, 3)');
  });
});

describe('CrmStatistics & CrmReport previews', () => {
  it('renders one statistic per definition with its label', () => {
    const { root } = renderPreview(def('CrmStatistics'));
    const stats = root?.querySelectorAll('.hsp-crm-stat') ?? [];
    expect(stats.length).toBe((createProps('CrmStatistics').statistics as unknown[]).length);
    expect(root).toHaveTextContent('Total pipeline');
    expect(stats[0].querySelector('.hsp-crm-stat-number')?.textContent).toMatch(/^\$[\d,]+$/);
  });

  it('shows the report id, or an empty state without one', () => {
    const { root } = renderPreview(def('CrmReport'), { props: { reportId: '987', use: 'subject' } });
    expect(root).toHaveTextContent('Report 987');
    expect(root).toHaveTextContent('This record only');
    cleanup();
    const empty = renderPreview(def('CrmReport'), { props: {} });
    expect(empty.root).toHaveTextContent('No report selected');
  });
});

describe('CRM action previews', () => {
  it('CrmActionButton fires onClick (no args) and describes the action in preview mode', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    renderPreview(def('CrmActionButton'), {
      mode: 'preview',
      trigger,
      props: { actionType: 'SEND_EMAIL', actionContext: { objectTypeId: '0-1', objectId: 51 }, variant: 'primary' },
      text: 'Email Ada',
    });
    const button = screen.getByRole('button', { name: 'Email Ada' });
    expect(button).toHaveClass('hsp-crm-btn--primary');
    await user.click(button);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('onClick');
    expect(screen.getByRole('status')).toHaveTextContent('Opens the email composer for contact 51.');
  });

  it('CrmActionButton reports missing context through onError', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    renderPreview(def('CrmActionButton'), {
      mode: 'preview',
      trigger,
      props: { actionType: 'PREVIEW_OBJECT', actionContext: { objectTypeId: '0-3' } },
      text: 'Preview',
    });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(trigger).toHaveBeenNthCalledWith(1, 'onClick');
    expect(trigger).toHaveBeenNthCalledWith(2, 'onError', ['actionContext.objectId is required for PREVIEW_OBJECT.']);
    expect(screen.getByRole('status')).toHaveClass('hsp-crm-feedback--error');
  });

  it('CrmActionButton is inert when disabled and in design mode', () => {
    const trigger = vi.fn();
    renderPreview(def('CrmActionButton'), { mode: 'preview', trigger, props: { ...createProps('CrmActionButton'), disabled: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
    expect(trigger).not.toHaveBeenCalled();
    cleanup();
    const { root } = renderPreview(def('CrmActionButton'), { mode: 'design', trigger });
    expect(root?.querySelector('button, a')).toBeNull();
    fireEvent.click(root as HTMLElement);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('CrmActionLink opens EXTERNAL_URL actions in a new tab and honours variants', () => {
    renderPreview(def('CrmActionLink'), {
      mode: 'preview',
      props: { actionType: 'EXTERNAL_URL', actionContext: { href: 'https://example.com/docs' }, variant: 'destructive' },
      text: 'Docs',
    });
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveClass('hsp-crm-link--destructive');
  });

  it('CrmCardActions runs buttons and dropdown options in preview mode', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { root } = renderPreview(def('CrmCardActions'), { mode: 'preview', trigger });
    await user.click(within(root as HTMLElement).getByRole('button', { name: 'Add note' }));
    expect(screen.getByRole('status')).toHaveTextContent('Opens the note editor');

    await user.click(within(root as HTMLElement).getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Send email', 'Create task', 'Schedule meeting']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Schedule meeting' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Opens the meeting scheduler');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('CrmCardActions fires onError for an invalid config and skips disabled ones', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    renderPreview(def('CrmCardActions'), {
      mode: 'preview',
      trigger,
      props: {
        actionConfigs: [
          { type: 'action-library-button', label: 'Open site', actionType: 'EXTERNAL_URL', actionContext: {} },
          { type: 'action-library-button', label: 'Locked', actionType: 'ADD_NOTE', actionContext: {}, disabled: true },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Locked' }));
    expect(trigger).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open site' }));
    expect(trigger).toHaveBeenCalledWith('onError', ['actionContext.href is required for EXTERNAL_URL.']);
  });
});

describe('helpers', () => {
  it('actionContextIssues validates per action type', () => {
    expect(actionContextIssues(undefined, {})).toEqual(['actionType is required.']);
    expect(actionContextIssues('COPY', {})).toEqual(['Unknown actionType "COPY".']);
    expect(actionContextIssues('ADD_TASK', null)).toEqual(['actionContext must be an object for ADD_TASK.']);
    expect(actionContextIssues('OPEN_RECORD_CREATOR_FORM', { objectTypeId: '0-3' })).toEqual([]);
    expect(actionContextIssues('OPEN_RECORD_ASSOCIATION_FORM', { objectTypeId: '0-3', association: { objectTypeId: '0-1' } })).toEqual([
      'actionContext.association.objectId is required for OPEN_RECORD_ASSOCIATION_FORM.',
    ]);
    expect(actionContextIssues('ENGAGEMENT_APP_LINK', { objectTypeId: '0-1', objectId: 1, engagementId: 9 })).toEqual([]);
    expect(actionContextIssues('PAGE_APP_LINK', { path: '/contacts' })).toEqual([]);
  });

  it('humanizes internal property names', () => {
    expect(humanizePropertyName('hs_lead_status')).toBe('Lead status');
    expect(humanizePropertyName('numberOfSeats')).toBe('Number of seats');
    expect(humanizePropertyName('renewal_date')).toBe('Renewal date');
  });
});
