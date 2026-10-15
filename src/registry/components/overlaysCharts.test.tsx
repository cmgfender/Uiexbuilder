import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { instantiateTemplate } from '../../model/tree';
import type { CloseOverlayAction, NodeTemplate, UINode } from '../../model/types';
import { renderPreview, templateFor } from '../../test/previewHarness';
import { STANDARD_DOCS } from '../constants';
import type { ComponentDef, PreviewProps, PropDef } from '../types';
import {
  CHART_COLORS,
  OVERLAY_OPEN_MS,
  buildChartModel,
  formatCompact,
  niceTicks,
  overlayChartComponents,
} from './overlaysCharts';

// Vitest globals are off, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const OVERLAY_TYPES = ['Modal', 'ModalBody', 'ModalFooter', 'Panel', 'PanelBody', 'PanelSection', 'PanelFooter'];
const CHART_TYPES = ['BarChart', 'LineChart'];
const DIST = resolve(process.cwd(), 'node_modules/@hubspot/ui-extensions/dist');

function def(type: string): ComponentDef {
  const d = overlayChartComponents.find((c) => c.type === type);
  if (!d) throw new Error(`missing ${type}`);
  return d;
}

/** Component names exported by the installed @hubspot/ui-extensions (stable + crm entry points). */
function hubspotExports(): Set<string> {
  const names = new Set<string>();
  for (const file of ['index.d.ts', 'crm/index.d.ts']) {
    const src = readFileSync(resolve(DIST, file), 'utf8');
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Root of the rendered preview must be the only/outermost element inside the overlay host. */
function expectOutermost(container: HTMLElement, root: Element | null) {
  const host = container.querySelector('.hsp-overlay-host');
  expect(root).not.toBeNull();
  expect(host?.children.length).toBe(1);
  expect(host?.firstElementChild).toBe(root);
}

function walkTemplate(tpl: NodeTemplate, visit: (t: NodeTemplate, parent: NodeTemplate | null) => void, parent: NodeTemplate | null = null) {
  visit(tpl, parent);
  for (const c of tpl.children ?? []) walkTemplate(c, visit, tpl);
  for (const list of Object.values(tpl.slots ?? {})) for (const c of list) walkTemplate(c, visit, tpl);
}

/** Renders a preview with a full PreviewProps object (used for re-render / unmount scenarios). */
function previewElement(type: string, overrides: Partial<PreviewProps> = {}) {
  const d = def(type);
  const tpl = templateFor(d);
  const node: UINode = { id: 'n_test', type, props: (tpl.props ?? {}) as UINode['props'], children: [] };
  const Preview = d.preview;
  return (
    <div className={`hsp-root ${overrides.mode === 'design' ? 'hsp-design' : 'hsp-live'}`}>
      <div className="hsp-overlay-host" style={{ position: 'relative' }}>
        <Preview
          node={node}
          props={node.props}
          text=""
          slots={{}}
          mode="preview"
          rootProps={{ 'data-node-id': node.id, 'data-node-type': type }}
          trigger={() => {}}
          {...overrides}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

describe('overlay & chart registry definitions', () => {
  const exportsSet = hubspotExports();
  const known = new Set([...exportsSet, ...overlayChartComponents.map((c) => c.type)]);

  it('registers exactly the overlay and chart components', () => {
    expect(overlayChartComponents.map((c) => c.type)).toEqual([...OVERLAY_TYPES, ...CHART_TYPES]);
    for (const t of OVERLAY_TYPES) expect(def(t).category).toBe('Overlays');
    for (const t of CHART_TYPES) expect(def(t).category).toBe('Charts');
  });

  it.each(overlayChartComponents.map((c) => [c.type, c] as const))('%s: definition is consistent', (_type, d) => {
    expect(d.importFrom).toBe('@hubspot/ui-extensions');
    expect(exportsSet.has(d.importName ?? d.type)).toBe(true);
    expect(d.icon).toBeTruthy();
    expect(d.docsUrl?.startsWith(`${STANDARD_DOCS}/`)).toBe(true);
    expect(d.description.length).toBeGreaterThan(10);
    expect(d.keywords?.length).toBeGreaterThan(0);

    // Prop names unique; testId in Advanced; no callback / children props declared as props.
    const names = d.props.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(d.props.find((p) => p.name === 'testId')?.group).toBe('Advanced');
    expect(names.filter((n) => /^on[A-Z]/.test(n))).toEqual([]);
    expect(names).not.toContain('children');

    // Enum defaults (including nested object fields) are among the options.
    const checkDefaults = (props: PropDef[]) => {
      for (const p of props) {
        if (p.type.kind === 'enum' && p.defaultValue !== undefined) {
          expect(p.type.options.map((o) => o.value), `${d.type}.${p.name}`).toContain(p.defaultValue);
        }
        if (p.type.kind === 'object') checkDefaults(p.type.fields);
      }
    };
    checkDefaults(d.props);

    // create(): every required prop (and required nested object field) is set.
    const tpl = templateFor(d);
    expect(tpl.type).toBe(d.type);
    const checkRequired = (props: PropDef[], values: Record<string, unknown> | undefined, path: string) => {
      for (const p of props) {
        const v = values?.[p.name];
        if (p.required) expect(v, `${path}${p.name}`).not.toBeUndefined();
        if (p.type.kind === 'object' && v && typeof v === 'object') {
          checkRequired(p.type.fields, v as Record<string, unknown>, `${path}${p.name}.`);
        }
      }
    };
    checkRequired(d.props, tpl.props, `${d.type}.`);
    if (d.children.required) expect(tpl.children?.length ?? 0).toBeGreaterThan(0);

    // Structural references point at real component types.
    for (const t of d.parents ?? []) expect(known.has(t), `${d.type} parent ${t}`).toBe(true);
    for (const t of d.children.accepts ?? []) expect(known.has(t), `${d.type} accepts ${t}`).toBe(true);

    // Every template node is a known type and respects the structural rules declared here.
    walkTemplate(tpl, (t, parent) => {
      expect(known.has(t.type), `template type ${t.type}`).toBe(true);
      const childDef = overlayChartComponents.find((c) => c.type === t.type);
      if (parent && childDef?.parents) expect(childDef.parents).toContain(parent.type);
      const parentDef = parent && overlayChartComponents.find((c) => c.type === parent.type);
      if (parentDef?.children.accepts) expect(parentDef.children.accepts).toContain(t.type);
    });
  });

  it('declares Modal and Panel as overlays with lifecycle events and exact enum values', () => {
    for (const type of ['Modal', 'Panel']) {
      const d = def(type);
      expect(d.overlay).toEqual({ idProp: 'id' });
      expect(d.props.find((p) => p.name === 'id')?.required).toBe(true);
      expect(d.events?.map((e) => [e.name, e.params])).toEqual([
        ['onOpen', []],
        ['onClose', []],
      ]);
      const width = d.props.find((p) => p.name === 'width');
      expect(width?.type.kind === 'enum' && width.type.options.map((o) => o.value)).toEqual(['small', 'medium', 'large']);
      expect(width?.defaultValue).toBe('small');
      expect(d.props.map((p) => p.name)).toEqual(['id', 'title', 'variant', 'width', 'aria-label', 'testId']);
    }
    const variant = (type: string) => def(type).props.find((p) => p.name === 'variant');
    const values = (p: PropDef | undefined) => (p?.type.kind === 'enum' ? p.type.options.map((o) => o.value) : []);
    expect(values(variant('Modal'))).toEqual(['default', 'danger']);
    expect(values(variant('Panel'))).toEqual(['default', 'modal']);
    expect(def('PanelSection').props.find((p) => p.name === 'flush')).toMatchObject({ defaultValue: false });
  });

  it('nests the overlay building blocks only where HubSpot allows them', () => {
    expect(def('ModalBody').parents).toEqual(['Modal', 'Form']);
    expect(def('ModalFooter').parents).toEqual(['Modal', 'Form']);
    expect(def('PanelBody').parents).toEqual(['Panel', 'Form']);
    expect(def('PanelFooter').parents).toEqual(['Panel', 'Form']);
    expect(def('PanelSection').parents).toEqual(['PanelBody']);
    expect(def('Modal').children.accepts).toEqual(['ModalBody', 'ModalFooter', 'Form']);
    expect(def('Panel').children.accepts).toEqual(['PanelBody', 'PanelFooter', 'Form']);
  });

  it.each([
    ['Modal', 'ModalBody', 'ModalFooter', 'modal-'],
    ['Panel', 'PanelBody', 'PanelFooter', 'panel-'],
  ])('%s create(): unique id, body content and footer buttons that close it', (type, bodyType, footerType, prefix) => {
    const a = templateFor(def(type));
    const b = templateFor(def(type));
    expect(String(a.props?.id)).toMatch(new RegExp(`^${prefix}[a-z0-9]{4}$`));
    expect(a.props?.id).not.toBe(b.props?.id);
    expect(a.props?.title).toBeTruthy();
    expect(a.children?.map((c) => c.type)).toEqual([bodyType, footerType]);

    // Body ends in a Text (Panel: PanelBody > PanelSection > Text).
    let text: NodeTemplate | undefined;
    walkTemplate(a.children![0], (t) => {
      if (t.type === 'Text') text = t;
    });
    expect(text?.text).toBeTruthy();

    // Footer: primary Save first, then secondary Cancel; both close this overlay.
    const footer = a.children![1];
    expect(footer.children?.map((c) => [c.type, c.props?.variant, c.text])).toEqual([
      ['Button', 'primary', 'Save'],
      ['Button', 'secondary', 'Cancel'],
    ]);
    for (const button of footer.children ?? []) {
      expect(button.events?.onClick).toEqual([expect.objectContaining({ type: 'closeOverlay', overlayNodeId: `@${a.props?.id}` })]);
    }

    // Once instantiated, the "@id" references resolve to the overlay's concrete node id.
    const sub = instantiateTemplate(a);
    const closeSteps = Object.values(sub.nodes).flatMap((n) => n.events?.onClick ?? []) as CloseOverlayAction[];
    expect(closeSteps).toHaveLength(2);
    for (const step of closeSteps) expect(step.overlayNodeId).toBe(sub.rootId);
  });

  it('chart create() templates produce valid charts', () => {
    for (const type of CHART_TYPES) {
      const props = templateFor(def(type)).props ?? {};
      const result = buildChartModel(props.data, props.axes, props.options, type === 'BarChart' ? 'bar' : 'line');
      expect(result.ok, type).toBe(true);
    }
    const line = templateFor(def('LineChart')).props ?? {};
    const lineModel = buildChartModel(line.data, line.axes, line.options, 'line');
    expect(lineModel.ok && lineModel.model.series.map((s) => s.name)).toEqual(['This year', 'Last year']);
  });

  it('copies the chart prop structure from chart.synced.d.ts', () => {
    for (const type of CHART_TYPES) {
      const d = def(type);
      expect(d.props.map((p) => [p.name, Boolean(p.required)])).toEqual([
        ['data', true],
        ['axes', true],
        ['options', false],
        ['testId', false],
      ]);
      const axes = d.props.find((p) => p.name === 'axes');
      if (axes?.type.kind !== 'object') throw new Error('axes must be an object prop');
      expect(axes.type.fields.map((f) => f.name)).toEqual(['x', 'y', 'options']);
      const x = axes.type.fields[0];
      if (x.type.kind !== 'object') throw new Error('x must be an object field');
      expect(x.type.fields.map((f) => [f.name, Boolean(f.required)])).toEqual([
        ['field', true],
        ['fieldType', true],
        ['label', false],
      ]);
      const fieldType = x.type.fields[1];
      expect(fieldType.type.kind === 'enum' && fieldType.type.options.map((o) => o.value)).toEqual(['category', 'datetime', 'linear']);
      const axisOptions = axes.type.fields[2];
      expect(axisOptions.type.kind === 'object' && axisOptions.type.fields.map((f) => f.name)).toEqual([
        'groupFieldByColor',
        'stacking',
        'colors',
      ]);
      const options = d.props.find((p) => p.name === 'options');
      expect(options?.type.kind === 'object' && options.type.fields.map((f) => f.name)).toEqual([
        'title',
        'showLegend',
        'showDataLabels',
        'showTooltips',
        'colorList',
      ]);
      expect(d.events ?? []).toEqual([]);
      expect(d.children.mode).toBe('none');
    }
  });

  it('uses exactly the HubSpot ChartColor names', () => {
    const src = readFileSync(resolve(DIST, 'shared.synced/types/components/chart.synced.d.ts'), 'utf8');
    const union = /export type ChartColor = ([^;]+);/.exec(src)?.[1] ?? '';
    const names = [...union.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(Object.keys(CHART_COLORS)).toEqual(names);
  });
});

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------

describe('overlay & chart previews render', () => {
  it.each(overlayChartComponents.map((c) => [c.type, c] as const))('%s renders in design and preview modes', (_type, d) => {
    for (const mode of ['design', 'preview'] as const) {
      const { container, root, unmount } = renderPreview(d, { mode });
      expectOutermost(container, root);
      expect(root?.getAttribute('data-node-type')).toBe(d.type);
      unmount();
    }
  });

  it.each(overlayChartComponents.map((c) => [c.type, c] as const))('%s tolerates empty props', (_type, d) => {
    for (const mode of ['design', 'preview'] as const) {
      const { container, root, unmount } = renderPreview(d, { mode, props: {}, text: '' });
      expectOutermost(container, root);
      unmount();
    }
  });

  it.each(overlayChartComponents.map((c) => [c.type, c] as const))('%s tolerates odd prop shapes', (_type, d) => {
    const odd = {
      id: { nested: true },
      title: 42,
      width: ['lg'],
      variant: null,
      flush: 'yes',
      'aria-label': {},
      data: 'not json',
      axes: { x: 7, y: null, options: 'stack' },
      options: { title: { a: 1 }, colorList: 'orange', showLegend: 'true', showDataLabels: 1 },
    };
    const { container, root } = renderPreview(d, { mode: 'preview', props: odd });
    expectOutermost(container, root);
  });

  it('renders children where nested components go', () => {
    for (const type of OVERLAY_TYPES) {
      const { root, unmount } = renderPreview(def(type), { children: <span data-testid="child">child</span> });
      expect(root?.querySelector('[data-testid="child"]')).not.toBeNull();
      unmount();
    }
  });

  it('merges rootProps className', () => {
    for (const d of overlayChartComponents) {
      const tpl = templateFor(d);
      const node: UINode = { id: 'n_cls', type: d.type, props: (tpl.props ?? {}) as UINode['props'], children: [] };
      const Preview = d.preview;
      const { container, unmount } = render(
        <div className="hsp-root hsp-design">
          <Preview
            node={node}
            props={node.props}
            text=""
            slots={{}}
            mode="design"
            rootProps={{ 'data-node-id': 'n_cls', 'data-node-type': d.type, className: 'extra-class' }}
            trigger={() => {}}
          />
        </div>,
      );
      const root = container.querySelector('[data-node-id="n_cls"]');
      expect(root?.classList.contains('extra-class'), d.type).toBe(true);
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

describe('Modal & Panel previews', () => {
  it('Modal inline: static dialog chrome with title, width and variant', () => {
    const { root } = renderPreview(def('Modal'), {
      props: { id: 'm', title: 'Delete contact', variant: 'danger', width: 'lg' },
      overlay: { presentation: 'inline', close: () => {} },
    });
    expect(root).toHaveClass('hsp-modal', 'hsp-overlay-inline', 'hsp-modal-large', 'hsp-modal-danger');
    expect(root?.querySelector('.hsp-overlay-title')).toHaveTextContent('Delete contact');
    // The storyboard close icon is decorative only.
    expect(root?.querySelector('button')).toBeNull();
    expect(root?.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Modal without overlay info renders inline (designer default)', () => {
    const { root } = renderPreview(def('Modal'));
    expect(root).toHaveClass('hsp-overlay-inline', 'hsp-modal-small');
  });

  it('accepts both TShirtSizes spellings for width', () => {
    for (const [width, cls] of [
      ['sm', 'hsp-modal-small'],
      ['md', 'hsp-modal-medium'],
      ['medium', 'hsp-modal-medium'],
      ['bogus', 'hsp-modal-small'],
    ]) {
      const { root, unmount } = renderPreview(def('Modal'), { props: { id: 'm', width } });
      expect(root, width).toHaveClass(cls);
      unmount();
    }
  });

  it('Modal open: backdrop layer fills the host, dialog has a working close button and Escape', () => {
    const close = vi.fn();
    const { root } = renderPreview(def('Modal'), {
      mode: 'preview',
      props: { id: 'm', title: 'Edit details', 'aria-label': 'Edit the record' },
      overlay: { presentation: 'open', close },
    });
    expect(root).toHaveClass('hsp-overlay-layer', 'hsp-modal-layer', 'hsp-overlay-backdrop');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Edit the record');
    expect(dialog).toHaveClass('hsp-modal', 'hsp-overlay-open');
    expect(document.activeElement).toBe(dialog);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('Panel open: default variant docks right without blocking the page', () => {
    const close = vi.fn();
    const { root } = renderPreview(def('Panel'), {
      mode: 'preview',
      props: { id: 'p', title: 'Details', width: 'md' },
      overlay: { presentation: 'open', close },
    });
    expect(root).toHaveClass('hsp-overlay-layer', 'hsp-panel-layer');
    expect(root).not.toHaveClass('hsp-overlay-backdrop');
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveClass('hsp-panel', 'hsp-overlay-open', 'hsp-panel-medium');
    expect(sheet).not.toHaveAttribute('aria-modal');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('Panel open: modal variant dims the page and is aria-modal', () => {
    const { root } = renderPreview(def('Panel'), {
      mode: 'preview',
      props: { id: 'p', title: 'Details', variant: 'modal' },
      overlay: { presentation: 'open', close: () => {} },
    });
    expect(root).toHaveClass('hsp-overlay-backdrop');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveClass('hsp-panel-modal');
  });

  it.each(['Modal', 'Panel'])('%s fires onOpen after opening and onClose when it closes', (type) => {
    vi.useFakeTimers();
    const trigger = vi.fn();
    const { unmount } = render(previewElement(type, { trigger, overlay: { presentation: 'open', close: () => {} } }));
    expect(trigger).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(OVERLAY_OPEN_MS);
    });
    expect(trigger.mock.calls).toEqual([['onOpen']]);
    unmount();
    expect(trigger.mock.calls).toEqual([['onOpen'], ['onClose']]);
  });

  it.each(['Modal', 'Panel'])('%s does not fire lifecycle events inline or when closed before opening', (type) => {
    vi.useFakeTimers();
    const trigger = vi.fn();
    const inline = render(previewElement(type, { trigger, overlay: { presentation: 'inline', close: () => {} } }));
    act(() => {
      vi.advanceTimersByTime(OVERLAY_OPEN_MS * 2);
    });
    inline.unmount();
    const quick = render(previewElement(type, { trigger, overlay: { presentation: 'open', close: () => {} } }));
    quick.unmount();
    act(() => {
      vi.advanceTimersByTime(OVERLAY_OPEN_MS * 2);
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it('PanelSection flush removes the bottom margin class', () => {
    const { root } = renderPreview(def('PanelSection'), { props: { flush: true } });
    expect(root).toHaveClass('hsp-panel-section', 'hsp-panel-section-flush');
    const plain = renderPreview(def('PanelSection'), { props: {} });
    expect(plain.root).not.toHaveClass('hsp-panel-section-flush');
  });

  it('footers and bodies use the overlay chrome classes', () => {
    expect(renderPreview(def('ModalBody')).root).toHaveClass('hsp-modal-body');
    expect(renderPreview(def('ModalFooter')).root).toHaveClass('hsp-modal-footer', 'hsp-overlay-footer');
    expect(renderPreview(def('PanelBody')).root).toHaveClass('hsp-panel-body');
    expect(renderPreview(def('PanelFooter')).root).toHaveClass('hsp-panel-footer', 'hsp-overlay-footer');
  });
});

// ---------------------------------------------------------------------------
// Charts: model
// ---------------------------------------------------------------------------

const AXES = {
  x: { field: 'month', fieldType: 'category', label: 'Month' },
  y: { field: 'amount', fieldType: 'linear', label: 'Amount' },
};

describe('buildChartModel', () => {
  it('builds categories and a single series from an array of rows', () => {
    const r = buildChartModel(
      [
        { month: 'Jan', amount: 10 },
        { month: 'Feb', amount: '2,500' },
        { month: 'Jan', amount: 5 },
      ],
      AXES,
      undefined,
      'bar',
    );
    if (!r.ok) throw new Error(r.title);
    expect(r.model.categories.map((c) => c.label)).toEqual(['Jan', 'Feb']);
    expect(r.model.series).toHaveLength(1);
    expect(r.model.series[0]).toMatchObject({ name: 'Amount', color: CHART_COLORS.orange, values: [15, 2500] });
    expect(r.model.stacking).toBe(false);
  });

  it('groups by color, keeps order of appearance and fills gaps with null', () => {
    const r = buildChartModel(
      [
        { month: 'Jan', amount: 1, team: 'A' },
        { month: 'Jan', amount: 2, team: 'B' },
        { month: 'Feb', amount: 3, team: 'B' },
      ],
      { ...AXES, options: { groupFieldByColor: 'team', stacking: true } },
      { colorList: ['purple', 'not-a-color'] },
      'bar',
    );
    if (!r.ok) throw new Error(r.title);
    expect(r.model.series.map((s) => [s.name, s.color, s.values])).toEqual([
      ['A', CHART_COLORS.purple, [1, null]],
      ['B', CHART_COLORS.orange, [2, 3]],
    ]);
    expect(r.model.stacking).toBe(true);
  });

  it('applies axes.options.colors, the deprecated options.colors and propertyLabels', () => {
    const r = buildChartModel(
      {
        data: [
          { stage: 'appt', amount: 1, kind: 'new' },
          { stage: 'won', amount: 2, kind: 'renewal' },
        ],
        options: { propertyLabels: { stage: { appt: 'Appointment' }, kind: { new: 'New business' } } },
      },
      {
        x: { field: 'stage', fieldType: 'category' },
        y: { field: 'amount', fieldType: 'linear' },
        options: { groupFieldByColor: 'kind', colors: { renewal: 'darkGreen' } },
      },
      { colors: ['blue'] },
      'bar',
    );
    if (!r.ok) throw new Error(r.title);
    expect(r.model.categories.map((c) => c.label)).toEqual(['Appointment', 'won']);
    expect(r.model.series.map((s) => [s.name, s.color])).toEqual([
      ['New business', CHART_COLORS.blue],
      ['renewal', CHART_COLORS.darkGreen],
    ]);
    // Axis labels fall back to the field names.
    expect(r.model.x.label).toBe('stage');
    expect(r.model.y.label).toBe('amount');
    expect(r.model.stacking).toBe(false);
  });

  it('formats datetime categories and uses a continuous x scale for line charts', () => {
    const data = [
      { date: Date.UTC(2025, 0, 15), deals: 3 },
      { date: '2025-02-01', deals: 5 },
    ];
    const axes = { x: { field: 'date', fieldType: 'datetime' }, y: { field: 'deals', fieldType: 'linear' } };
    const line = buildChartModel(data, axes, {}, 'line');
    if (!line.ok) throw new Error(line.title);
    expect(line.model.continuousX).toBe(true);
    expect(line.model.categories.map((c) => c.label)).toEqual(['Jan 15, 2025', 'Feb 1, 2025']);
    const bar = buildChartModel(data, axes, {}, 'bar');
    expect(bar.ok && bar.model.continuousX).toBe(false);
  });

  it('explains invalid input instead of throwing', () => {
    const cases: Array<[unknown, unknown, string]> = [
      [42, AXES, 'Chart data is invalid'],
      ['{oops', AXES, 'Chart data is invalid'],
      [[], AXES, 'No data to display'],
      [[{ month: 'Jan', amount: 1 }], { x: { field: 'month' } }, 'Chart axes are not configured'],
      [[{ month: 'Jan', amount: 1 }], null, 'Chart axes are not configured'],
      [[{ month: 'Jan', amount: 'n/a' }], AXES, 'No numeric values in "amount"'],
      [[{ other: 'Jan', amount: 1 }], AXES, 'No values for "month"'],
      [[null, 'row', 3], AXES, 'No data to display'],
    ];
    for (const [data, axes, title] of cases) {
      const r = buildChartModel(data, axes, undefined, 'bar');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.title).toBe(title);
    }
  });

  it('accepts JSON text data', () => {
    const r = buildChartModel('[{"month":"Jan","amount":4}]', AXES, null, 'line');
    expect(r.ok && r.model.series[0].values).toEqual([4]);
  });

  it('ignores prototype keys in rows and label maps', () => {
    const r = buildChartModel(
      { data: [{ month: 'constructor', amount: 1 }], options: { propertyLabels: {} } },
      AXES,
      undefined,
      'bar',
    );
    expect(r.ok && r.model.categories[0].label).toBe('constructor');
  });
});

describe('chart scale helpers', () => {
  it('niceTicks covers the range with round steps', () => {
    expect(niceTicks(0, 63900)).toEqual([0, 20000, 40000, 60000, 80000]);
    expect(niceTicks(0, 0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-12, 30)).toEqual([-20, -10, 0, 10, 20, 30]);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    const t = niceTicks(5, 5);
    expect(t[0]).toBeLessThanOrEqual(5);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(5);
    expect(niceTicks(Number.NaN, Number.POSITIVE_INFINITY).length).toBeGreaterThan(1);
  });

  it('formatCompact abbreviates large numbers', () => {
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(2_000_000)).toBe('2M');
    expect(formatCompact(-42_000)).toBe('-42K');
    expect(formatCompact(12.345)).toBe('12.35');
  });
});

// ---------------------------------------------------------------------------
// Charts: rendering
// ---------------------------------------------------------------------------

describe('BarChart & LineChart previews', () => {
  it('BarChart draws one bar per data point with title and axis labels', () => {
    const { root } = renderPreview(def('BarChart'));
    expect(root?.querySelector('.hsp-chart-title')).toHaveTextContent('Closed won by month');
    expect(root?.querySelectorAll('rect.hsp-chart-bar')).toHaveLength(6);
    const svg = root?.querySelector('svg.hsp-chart-svg');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg?.textContent).toContain('Jan');
    expect(svg?.textContent).toContain('Closed won ($)');
    expect(svg?.textContent).toContain('Month');
    // Default options: no legend, no data labels.
    expect(root?.querySelector('.hsp-chart-legend')).toBeNull();
    expect(root?.querySelector('.hsp-chart-data-label')).toBeNull();
  });

  it('BarChart heights follow the data', () => {
    const { root } = renderPreview(def('BarChart'), {
      props: { data: [{ m: 'a', v: 10 }, { m: 'b', v: 20 }], axes: { x: { field: 'm', fieldType: 'category' }, y: { field: 'v', fieldType: 'linear' } } },
    });
    const [a, b] = Array.from(root?.querySelectorAll('rect.hsp-chart-bar') ?? []);
    const h = (el: Element) => Number(el.getAttribute('height'));
    expect(h(b)).toBeCloseTo(h(a) * 2, 5);
  });

  it('BarChart grouped and stacked bars, with legend and data labels', () => {
    const data = [
      { m: 'Jan', v: 10, g: 'A' },
      { m: 'Jan', v: 30, g: 'B' },
      { m: 'Feb', v: 20, g: 'A' },
    ];
    const axes = { x: { field: 'm', fieldType: 'category' }, y: { field: 'v', fieldType: 'linear' }, options: { groupFieldByColor: 'g' } };
    const grouped = renderPreview(def('BarChart'), { props: { data, axes, options: { showLegend: true, showDataLabels: true } } });
    expect(grouped.root?.querySelectorAll('rect.hsp-chart-bar')).toHaveLength(3);
    expect(grouped.root?.querySelectorAll('.hsp-chart-legend-item')).toHaveLength(2);
    expect(grouped.root?.querySelector('.hsp-chart-legend')).toHaveTextContent('AB');
    expect(grouped.root?.querySelectorAll('.hsp-chart-data-label').length).toBe(3);
    grouped.unmount();

    const stacked = renderPreview(def('BarChart'), {
      props: { data, axes: { ...axes, options: { groupFieldByColor: 'g', stacking: true } } },
    });
    const bars = Array.from(stacked.root?.querySelectorAll('rect.hsp-chart-bar') ?? []);
    expect(bars).toHaveLength(3);
    // Bars are emitted per category: Jan A, Jan B, Feb A. Jan's segments share an x and sit on
    // top of each other (B starts where A ends).
    expect(bars[0].getAttribute('x')).toBe(bars[1].getAttribute('x'));
    expect(Number(bars[1].getAttribute('y')) + Number(bars[1].getAttribute('height'))).toBeCloseTo(
      Number(bars[0].getAttribute('y')),
      5,
    );
    expect(bars[2].getAttribute('x')).not.toBe(bars[0].getAttribute('x'));
  });

  it('LineChart draws a line per series with point markers and a legend', () => {
    const { root } = renderPreview(def('LineChart'));
    expect(root?.querySelectorAll('path.hsp-chart-line')).toHaveLength(2);
    expect(root?.querySelectorAll('circle.hsp-chart-point')).toHaveLength(12);
    expect(root?.querySelector('.hsp-chart-legend')).toHaveTextContent('This yearLast year');
    const strokes = Array.from(root?.querySelectorAll('path.hsp-chart-line') ?? []).map((p) => p.getAttribute('stroke'));
    expect(strokes).toEqual([CHART_COLORS.orange, CHART_COLORS.aqua]);
  });

  it('LineChart stacking fills the area between series', () => {
    const props = templateFor(def('LineChart')).props ?? {};
    const axes = { ...(props.axes as object), options: { groupFieldByColor: 'period', stacking: true } };
    const { root } = renderPreview(def('LineChart'), { props: { ...props, axes } });
    expect(root?.querySelectorAll('polygon.hsp-chart-area')).toHaveLength(2);
  });

  it('shows tooltips on hover in preview mode only', () => {
    const live = renderPreview(def('BarChart'), { mode: 'preview' });
    const bar = live.root?.querySelector('rect.hsp-chart-bar');
    fireEvent.mouseEnter(bar!);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Jan');
    expect(tip).toHaveTextContent('Closed won ($):42,000');
    fireEvent.mouseLeave(live.root!.querySelector('.hsp-chart-plot')!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    live.unmount();

    const design = renderPreview(def('BarChart'), { mode: 'design' });
    fireEvent.mouseEnter(design.root!.querySelector('rect.hsp-chart-bar')!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    design.unmount();

    const off = renderPreview(def('LineChart'), { mode: 'preview', props: { ...templateFor(def('LineChart')).props, options: {} } });
    expect(off.root?.querySelector('.hsp-chart-hit')).toBeNull();
  });

  it('LineChart tooltip reports the hovered series value', () => {
    const { root } = renderPreview(def('LineChart'), { mode: 'preview' });
    const hits = root?.querySelectorAll('circle.hsp-chart-hit') ?? [];
    fireEvent.mouseEnter(hits[hits.length - 1]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Jun');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Last year:55,300');
  });

  it('rotates x labels when categories do not fit', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ name: `Very long category name ${i}`, v: i + 1 }));
    const { root } = renderPreview(def('BarChart'), {
      props: { data, axes: { x: { field: 'name', fieldType: 'category' }, y: { field: 'v', fieldType: 'linear' } } },
    });
    const rotated = root?.querySelectorAll('.hsp-chart-axis-labels text[transform]') ?? [];
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated[0].textContent?.endsWith('…')).toBe(true);
  });

  it('renders an empty state for invalid data and keeps the title', () => {
    const { root } = renderPreview(def('LineChart'), { props: { data: 'nope', axes: AXES, options: { title: 'Revenue' } } });
    expect(root?.querySelector('.hsp-chart-title')).toHaveTextContent('Revenue');
    expect(root?.querySelector('svg.hsp-chart-svg')).toBeNull();
    expect(root?.querySelector('.hsp-chart-empty')).toHaveTextContent('Chart data is invalid');
  });

  it('handles negative values and a continuous datetime x axis', () => {
    const neg = renderPreview(def('BarChart'), {
      props: { data: [{ m: 'a', v: -5 }, { m: 'b', v: 10 }], axes: { x: { field: 'm', fieldType: 'category' }, y: { field: 'v', fieldType: 'linear' } } },
    });
    const heights = Array.from(neg.root?.querySelectorAll('rect.hsp-chart-bar') ?? []).map((r) => Number(r.getAttribute('height')));
    expect(heights.every((h) => h > 0)).toBe(true);
    neg.unmount();

    const dt = renderPreview(def('LineChart'), {
      props: {
        data: [
          { d: '2025-01-01', v: 1 },
          { d: '2025-03-01', v: 4 },
          { d: '2025-02-01', v: 2 },
        ],
        axes: { x: { field: 'd', fieldType: 'datetime' }, y: { field: 'v', fieldType: 'linear' } },
      },
    });
    const xs = Array.from(dt.root?.querySelectorAll('circle.hsp-chart-point') ?? []).map((c) => Number(c.getAttribute('cx')));
    // Positions follow the dates (data order is kept): Jan < Feb < Mar.
    expect(xs[0]).toBeLessThan(xs[2]);
    expect(xs[2]).toBeLessThan(xs[1]);
    expect(dt.root?.querySelector('.hsp-chart-axis-labels')?.textContent).toContain('2025');
  });
});
