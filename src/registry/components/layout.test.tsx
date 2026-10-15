import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeTemplate, UINode } from '../../model/types';
import { renderPreview, templateFor } from '../../test/previewHarness';
import { STANDARD_DOCS } from '../constants';
import type { ComponentDef, PreviewProps } from '../types';
import { UIEX_REVEAL_EVENT, layoutComponents } from './layout';

// Vitest globals are off, so Testing Library cannot register its automatic cleanup.
afterEach(cleanup);

const EXPECTED_TYPES = ['Flex', 'Box', 'Inline', 'AutoGrid', 'Tile', 'Divider', 'Spacer', 'Accordion', 'Tabs', 'Tab'];

function def(type: string): ComponentDef {
  const d = layoutComponents.find((c) => c.type === type);
  if (!d) throw new Error(`missing ${type}`);
  return d;
}

/** Component names exported by the installed @hubspot/ui-extensions (stable + crm entry points). */
function hubspotExports(): Set<string> {
  const names = new Set<string>();
  for (const file of ['dist/index.d.ts', 'dist/crm/index.d.ts']) {
    const src = readFileSync(resolve(process.cwd(), 'node_modules/@hubspot/ui-extensions', file), 'utf8');
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

// ---------------------------------------------------------------------------
// Helpers to render Tabs with real Tab previews as children (as the NodeRenderer would)
// ---------------------------------------------------------------------------

const TabPreview = def('Tab').preview;
const TabsPreview = def('Tabs').preview;

function tab(
  nodeId: string,
  props: Record<string, unknown>,
  content: ReactNode,
  opts: { mode?: 'design' | 'preview'; clone?: string } = {},
) {
  const node: UINode = { id: nodeId, type: 'Tab', props: {}, children: [] };
  return (
    <TabPreview
      key={`${nodeId}:${opts.clone ?? ''}`}
      node={node}
      props={props}
      text=""
      slots={{}}
      mode={opts.mode ?? 'preview'}
      rootProps={{
        'data-node-id': nodeId,
        'data-node-type': 'Tab',
        ...(opts.clone ? { 'data-uiex-clone': opts.clone } : {}),
      }}
      trigger={() => {}}
    >
      {content}
    </TabPreview>
  );
}

function renderTabs(opts: {
  mode?: 'design' | 'preview';
  props?: Record<string, unknown>;
  childOrder?: string[];
  trigger?: PreviewProps['trigger'];
  tabs: ReactNode;
}) {
  const mode = opts.mode ?? 'preview';
  const node: UINode = { id: 'n_tabs', type: 'Tabs', props: {}, children: opts.childOrder ?? [] };
  const ui = (props: Record<string, unknown>, tabs: ReactNode) => (
    <div className={`hsp-root ${mode === 'preview' ? 'hsp-live' : 'hsp-design'}`}>
      <TabsPreview
        node={node}
        props={props}
        text=""
        slots={{}}
        mode={mode}
        rootProps={{ 'data-node-id': 'n_tabs', 'data-node-type': 'Tabs' }}
        trigger={opts.trigger ?? (() => {})}
      >
        {tabs}
      </TabsPreview>
    </div>
  );
  const result = render(ui(opts.props ?? {}, opts.tabs));
  return { ...result, rerenderWith: (props: Record<string, unknown>, tabs: ReactNode = opts.tabs) => result.rerender(ui(props, tabs)) };
}

const headerNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const panel = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

// ---------------------------------------------------------------------------

describe('layout registry definitions', () => {
  const known = new Set([...hubspotExports(), ...layoutComponents.map((c) => c.type)]);

  it('registers exactly the layout components', () => {
    expect(layoutComponents.map((c) => c.type)).toEqual(EXPECTED_TYPES);
    expect(new Set(layoutComponents.map((c) => c.type)).size).toBe(layoutComponents.length);
  });

  it.each(layoutComponents.map((c) => [c.type, c] as const))('%s: definition is consistent', (_type, d) => {
    expect(d.category).toBe('Layout');
    expect(d.importFrom).toBe('@hubspot/ui-extensions');
    expect(known.has(d.type)).toBe(true);
    expect(d.icon).toBeTruthy();
    expect(d.docsUrl?.startsWith(STANDARD_DOCS)).toBe(true);
    expect(d.description.length).toBeGreaterThan(10);

    // Prop names unique; testId in Advanced; no callback props declared as props.
    const names = d.props.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(d.props.find((p) => p.name === 'testId')?.group).toBe('Advanced');
    expect(names.filter((n) => /^on[A-Z]/.test(n))).toEqual([]);

    // Enum defaults are among the options.
    for (const p of d.props) {
      if (p.type.kind === 'enum' && p.defaultValue !== undefined) {
        expect(p.type.options.map((o) => o.value)).toContain(p.defaultValue);
      }
    }

    // create(): every required prop is set; required children exist.
    const tpl = templateFor(d);
    expect(tpl.type).toBe(d.type);
    for (const p of d.props.filter((x) => x.required)) {
      expect(tpl.props?.[p.name], `${d.type}.${p.name}`).not.toBeUndefined();
    }
    if (d.children.required) expect(tpl.children?.length ?? 0).toBeGreaterThan(0);
    if (d.children.mode !== 'nodes') expect(tpl.children ?? []).toEqual([]);

    // Structural references point at real component types.
    for (const t of [...(d.parents ?? []), ...(d.children.accepts ?? [])]) expect(known.has(t), t).toBe(true);

    // Events have positional params arrays.
    for (const e of d.events ?? []) expect(Array.isArray(e.params)).toBe(true);
  });

  it('create() templates respect structural rules within the group', () => {
    for (const d of layoutComponents) {
      walkTemplate(templateFor(d), (t, parent) => {
        expect(known.has(t.type), t.type).toBe(true);
        const childDef = layoutComponents.find((c) => c.type === t.type);
        if (parent) {
          const parentDef = layoutComponents.find((c) => c.type === parent.type);
          if (parentDef?.children.accepts) expect(parentDef.children.accepts).toContain(t.type);
          if (childDef?.parents) expect(childDef.parents).toContain(parent.type);
        } else if (d.type !== 'Tab') {
          expect(childDef?.parents).toBeUndefined();
        }
        // Required props of nested group components are set too.
        for (const p of childDef?.props.filter((x) => x.required) ?? []) expect(t.props?.[p.name]).not.toBeUndefined();
      });
    }
  });

  it('Tabs.create() has two Tabs with unique ids and a matching default', () => {
    const tpl = def('Tabs').create!();
    const tabs = tpl.children ?? [];
    expect(tabs).toHaveLength(2);
    expect(tabs.every((t) => t.type === 'Tab' && typeof t.props?.title === 'string')).toBe(true);
    const ids = tabs.map((t) => t.props?.tabId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(tpl.props?.defaultSelected);
    expect(def('Tabs').valueBinding).toEqual({ prop: 'selected', event: 'onSelectedChange', stateType: 'string', initial: ids[0] });
  });

  it('Tab.create() produces distinct tab ids and Tab may only live in Tabs', () => {
    const a = def('Tab').create!();
    const b = def('Tab').create!();
    expect(a.props?.tabId).not.toBe(b.props?.tabId);
    expect(def('Tab').parents).toEqual(['Tabs']);
    expect(def('Tabs').children.accepts).toEqual(['Tab']);
  });

  it('declares events with HubSpot signatures', () => {
    expect(def('Accordion').events).toEqual([expect.objectContaining({ name: 'onClick', params: [] })]);
    expect(def('Tabs').events).toEqual([
      expect.objectContaining({ name: 'onSelectedChange', params: [expect.objectContaining({ name: 'selectedId' })] }),
    ]);
    expect(def('AutoGrid').props.find((p) => p.name === 'columnWidth')).toMatchObject({ required: true, type: { kind: 'number' } });
    expect(def('Accordion').props.find((p) => p.name === 'title')).toMatchObject({ required: true });
    // Deprecated Divider `distance` is not offered.
    expect(def('Divider').props.map((p) => p.name)).not.toContain('distance');
  });
});

describe('layout previews render', () => {
  it.each(layoutComponents.flatMap((c) => (['design', 'preview'] as const).map((m) => [c.type, m, c] as const)))(
    '%s (%s) renders its root as the outermost element',
    (_type, mode, d) => {
      const { container, root } = renderPreview(d, { mode });
      expectOutermost(container, root);
      expect(root?.getAttribute('data-node-type')).toBe(d.type);
    },
  );

  it.each(layoutComponents.flatMap((c) => (['design', 'preview'] as const).map((m) => [c.type, m, c] as const)))(
    '%s (%s) tolerates empty and odd props',
    (_type, mode, d) => {
      expect(() => renderPreview(d, { mode, props: {}, text: '' }).unmount()).not.toThrow();
      const odd = { gap: 42, direction: {}, justify: null, align: [], columnWidth: 'abc', flex: { a: 1 }, size: true, title: { x: 1 }, tabId: [], selected: {}, defaultSelected: null, open: 'yes', variant: 7, tooltipPlacement: 'diagonal' };
      expect(() => renderPreview(d, { mode, props: odd, text: '' }).unmount()).not.toThrow();
    },
  );

  it('merges rootProps className', () => {
    for (const d of layoutComponents) {
      const tpl = templateFor(d);
      const { container, unmount } = render(
        <d.preview
          node={{ id: 'n_x', type: d.type, props: {}, children: [] }}
          props={(tpl.props ?? {}) as Record<string, unknown>}
          text=""
          slots={{}}
          mode="design"
          rootProps={{ 'data-node-id': 'n_x', 'data-node-type': d.type, className: 'extra-class' }}
          trigger={() => {}}
        />,
      );
      const root = container.querySelector('[data-node-id="n_x"]');
      expect(root?.classList.contains('extra-class'), d.type).toBe(true);
      expect(root?.className, d.type).toMatch(/hsp-/);
      unmount();
    }
  });
});

describe('Flex / Box / Inline / AutoGrid / Tile / Divider / Spacer previews', () => {
  it('Flex maps direction, gap, justify, align and wrap', () => {
    const { root } = renderPreview(def('Flex'), {
      props: { direction: 'column', gap: 'medium', justify: 'between', align: 'center', wrap: true, alignSelf: 'end' },
      children: <span>child</span>,
    });
    const s = (root as HTMLElement).style;
    expect(s.flexDirection).toBe('column');
    expect(s.gap).toBe('var(--hsp-space-md)');
    expect(s.justifyContent).toBe('space-between');
    expect(s.alignItems).toBe('center');
    expect(s.flexWrap).toBe('wrap');
    expect(s.alignSelf).toBe('flex-end');
    expect(root).toHaveTextContent('child');
  });

  it('Box maps flex keywords and numbers', () => {
    const flexOf = (flex: unknown) => {
      const { root, unmount } = renderPreview(def('Box'), { props: { flex, alignSelf: 'center' } });
      const style = (root as HTMLElement).style;
      const out = { grow: style.flexGrow, shrink: style.flexShrink, alignSelf: style.alignSelf };
      unmount();
      return out;
    };
    expect(flexOf(undefined)).toMatchObject({ grow: '1', shrink: '1', alignSelf: 'center' });
    expect(flexOf('none')).toMatchObject({ grow: '0', shrink: '0' });
    expect(flexOf('initial')).toMatchObject({ grow: '0', shrink: '1' });
    expect(flexOf(3).grow).toBe('3');
    expect(flexOf('2').grow).toBe('2');
  });

  it('Inline lays out a wrapping row without clashing with the Text inline modifier', () => {
    const { root } = renderPreview(def('Inline'), { props: { gap: 'small', justify: 'end', align: 'center' } });
    expect(root).toHaveClass('hsp-inline-row');
    expect(root).not.toHaveClass('hsp-inline');
    expect((root as HTMLElement).style.justifyContent).toBe('flex-end');
    expect((root as HTMLElement).style.gap).toBe('var(--hsp-space-sm)');
  });

  it('AutoGrid builds fixed or flexible column tracks from columnWidth', () => {
    const cols = (props: Record<string, unknown>) => {
      const { root, unmount } = renderPreview(def('AutoGrid'), { props });
      const v = (root as HTMLElement).getAttribute('style') ?? '';
      unmount();
      return v;
    };
    expect(cols({ columnWidth: 150 })).toContain('repeat(auto-fill, min(150px, 100%))');
    expect(cols({ columnWidth: 150, flexible: true })).toContain('minmax(min(150px, 100%), 1fr)');
    expect(cols({})).toContain('200px');
  });

  it('Tile applies compact and flush modifiers', () => {
    const { root } = renderPreview(def('Tile'), { props: { compact: true, flush: true } });
    expect(root).toHaveClass('hsp-tile', 'hsp-tile--compact', 'hsp-tile--flush');
  });

  it('Divider spacing follows size (and the deprecated distance alias)', () => {
    const pad = (props: Record<string, unknown>) => {
      const { root, unmount } = renderPreview(def('Divider'), { props });
      const v = (root as HTMLElement).style.paddingTop;
      unmount();
      return v;
    };
    expect(pad({})).toBe('var(--hsp-space-sm)');
    expect(pad({ size: 'large' })).toBe('var(--hsp-space-lg)');
    expect(pad({ size: 'flush' })).toBe('var(--hsp-space-flush)');
    expect(pad({ distance: 'xl' })).toBe('var(--hsp-space-xl)');
  });

  it('Spacer height follows size and is only hatched in design mode', () => {
    const d = renderPreview(def('Spacer'), { props: { size: 'lg' }, mode: 'design' });
    expect((d.root as HTMLElement).style.height).toBe('var(--hsp-space-lg)');
    expect(d.root).toHaveClass('hsp-spacer--design');
    d.unmount();
    const p = renderPreview(def('Spacer'), { props: {}, mode: 'preview' });
    expect((p.root as HTMLElement).style.height).toBe('var(--hsp-space-sm)');
    expect(p.root).not.toHaveClass('hsp-spacer--design');
  });
});

describe('Accordion preview', () => {
  const body = (root: Element | null) => root?.querySelector('.hsp-accordion-body') as HTMLElement;
  const header = (root: Element | null) => root?.querySelector('[role="button"]') as HTMLElement;

  it('toggles and fires onClick (no arguments) in preview mode', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Accordion'), {
      mode: 'preview',
      props: { title: 'Details' },
      trigger,
      children: <span>secret</span>,
    });
    expect(header(root)).toHaveTextContent('Details');
    expect(body(root)).not.toBeVisible();
    await userEvent.click(header(root));
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('onClick');
    expect(body(root)).toBeVisible();
    expect(header(root)).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(header(root), { key: 'Enter' });
    expect(body(root)).not.toBeVisible();
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it('honours defaultOpen, controlled open and disabled', async () => {
    const trigger = vi.fn();
    const open = renderPreview(def('Accordion'), { mode: 'preview', props: { title: 'A', defaultOpen: true }, trigger });
    expect(body(open.root)).toBeVisible();
    open.unmount();

    const controlled = renderPreview(def('Accordion'), { mode: 'preview', props: { title: 'A', open: false, defaultOpen: true }, trigger });
    expect(body(controlled.root)).not.toBeVisible();
    await userEvent.click(header(controlled.root));
    expect(trigger).toHaveBeenCalledWith('onClick');
    expect(body(controlled.root)).not.toBeVisible();
    controlled.unmount();

    trigger.mockClear();
    const disabled = renderPreview(def('Accordion'), { mode: 'preview', props: { title: 'A', disabled: true }, trigger });
    await userEvent.click(header(disabled.root));
    expect(trigger).not.toHaveBeenCalled();
    expect(body(disabled.root)).not.toBeVisible();
    expect(disabled.root).toHaveClass('hsp-accordion--disabled');
  });

  it('applies size classes (including aliases)', () => {
    expect(renderPreview(def('Accordion'), { props: { title: 'A', size: 'xs' } }).root).toHaveClass('hsp-accordion--extra-small');
    expect(renderPreview(def('Accordion'), { props: { title: 'A', size: 'medium' } }).root).toHaveClass('hsp-accordion--medium');
    expect(renderPreview(def('Accordion'), { props: { title: 'A' } }).root).toHaveClass('hsp-accordion--small');
  });

  it('design mode: title click does not toggle, caret click and reveal events do', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Accordion'), {
      mode: 'design',
      props: { title: 'A' },
      trigger,
      children: <span data-node-id="n_child">child</span>,
    });
    expect(body(root)).not.toBeVisible();
    await userEvent.click(root!.querySelector('.hsp-accordion-title') as HTMLElement);
    expect(body(root)).not.toBeVisible();
    await userEvent.click(root!.querySelector('.hsp-accordion-caret') as HTMLElement);
    expect(body(root)).toBeVisible();
    await userEvent.click(root!.querySelector('.hsp-accordion-caret') as HTMLElement);
    expect(body(root)).not.toBeVisible();
    act(() => {
      root!.querySelector('[data-node-id="n_child"]')!.dispatchEvent(new CustomEvent(UIEX_REVEAL_EVENT, { bubbles: true }));
    });
    expect(body(root)).toBeVisible();
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe('Tabs & Tab previews', () => {
  const twoTabs = (mode: 'design' | 'preview' = 'preview', extra: Record<string, Record<string, unknown>> = {}) => [
    tab('t1', { tabId: 'overview', title: 'Overview', ...extra.t1 }, <span>Overview body</span>, { mode }),
    tab('t2', { tabId: 'activity', title: 'Activity', ...extra.t2 }, <span>Activity body</span>, { mode }),
  ];

  it('shows the default tab and switches on click, firing onSelectedChange(tabId)', async () => {
    const trigger = vi.fn();
    renderTabs({ props: { defaultSelected: 'activity' }, trigger, tabs: twoTabs() });
    expect(headerNames()).toEqual(['Overview', 'Activity']);
    expect(panel('t2')).toBeVisible();
    expect(panel('t1')).not.toBeVisible();
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(trigger).toHaveBeenCalledWith('onSelectedChange', 'overview');
    expect(panel('t1')).toBeVisible();
    expect(panel('t2')).not.toBeVisible();

    // Re-clicking the selected tab is not a change.
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('defaults to the first enabled tab and supports keyboard navigation', async () => {
    const trigger = vi.fn();
    renderTabs({ trigger, tabs: twoTabs('preview', { t1: { disabled: true } }) });
    expect(panel('t2')).toBeVisible();
    const activity = screen.getByRole('tab', { name: 'Activity' });
    expect(activity).toHaveAttribute('tabindex', '0');
    // Disabled tabs cannot be selected in preview mode.
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(trigger).not.toHaveBeenCalled();
    expect(panel('t2')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('arrow keys move between tabs', () => {
    const trigger = vi.fn();
    renderTabs({ trigger, tabs: twoTabs() });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
    expect(trigger).toHaveBeenCalledWith('onSelectedChange', 'activity');
    expect(panel('t2')).toBeVisible();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Activity' }));
  });

  it('is controlled by `selected` in preview mode', async () => {
    const trigger = vi.fn();
    const r = renderTabs({ props: { selected: 'activity', defaultSelected: 'overview' }, trigger, tabs: twoTabs() });
    expect(panel('t2')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(trigger).toHaveBeenCalledWith('onSelectedChange', 'overview');
    expect(panel('t2')).toBeVisible(); // still controlled
    r.rerenderWith({ selected: 'overview' });
    expect(panel('t1')).toBeVisible();
    expect(panel('t2')).not.toBeVisible();
  });

  it('matches numeric and string tab ids leniently and falls back to the index', async () => {
    const trigger = vi.fn();
    renderTabs({
      props: { defaultSelected: '2' },
      trigger,
      tabs: [
        tab('a', { title: 'No id' }, 'A'),
        tab('b', { tabId: 2, title: 'Two' }, 'B'),
      ],
    });
    expect(panel('b')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'No id' }));
    expect(trigger).toHaveBeenCalledWith('onSelectedChange', 0);
  });

  it('orders headers by the Tabs node children and supports repeat clones', () => {
    renderTabs({
      childOrder: ['t2', 't1'],
      tabs: [
        tab('t1', { tabId: 'x', title: 'First' }, 'x'),
        tab('t2', { tabId: 'y', title: 'Second' }, 'y'),
        tab('t2', { tabId: 'z', title: 'Second clone' }, 'z', { clone: '1' }),
      ],
    });
    expect(headerNames()).toEqual(['Second', 'Second clone', 'First']);
  });

  it('updates headers when a Tab changes or is removed', () => {
    const r = renderTabs({ tabs: twoTabs() });
    r.rerenderWith({}, [
      tab('t1', { tabId: 'overview', title: 'Summary' }, 'x'),
    ]);
    expect(headerNames()).toEqual(['Summary']);
    expect(panel('t1')).toBeVisible();
  });

  it('applies variant, fill and tooltip placement', () => {
    const { container } = renderTabs({
      props: { variant: 'enclosed', fill: true },
      tabs: [tab('t1', { tabId: 'a', title: 'A', tooltip: 'Helpful', tooltipPlacement: 'bottom' }, 'x')],
    });
    const root = container.querySelector('[data-node-id="n_tabs"]');
    expect(root).toHaveClass('hsp-tabs', 'hsp-tabs--enclosed', 'hsp-tabs--fill');
    const tip = container.querySelector('.hsp-tabs-tip');
    expect(tip).toHaveTextContent('Helpful');
    expect(tip).toHaveClass('hsp-tabs-tip--bottom');
    // The tooltip does not pollute the tab's accessible name.
    expect(screen.getByRole('tab', { name: 'A' })).toBeInTheDocument();
  });

  it('design mode: header clicks switch the shown tab locally without firing events', async () => {
    const trigger = vi.fn();
    const r = renderTabs({
      mode: 'design',
      props: { defaultSelected: 'overview' },
      trigger,
      tabs: twoTabs('design', { t2: { disabled: true } }),
    });
    expect(panel('t1')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Activity' })); // disabled tabs are still editable
    expect(panel('t2')).toBeVisible();
    expect(trigger).not.toHaveBeenCalled();
    // Changing the default in the inspector discards the local choice.
    r.rerenderWith({ defaultSelected: 'activity' });
    r.rerenderWith({ defaultSelected: 'overview' });
    expect(panel('t1')).toBeVisible();
  });

  it('design mode: reveal events switch to the tab containing the element (nested Tabs too)', () => {
    const inner = (
      <TabsPreview
        key="inner"
        node={{ id: 'n_inner', type: 'Tabs', props: {}, children: [] }}
        props={{}}
        text=""
        slots={{}}
        mode="design"
        rootProps={{ 'data-node-id': 'n_inner', 'data-node-type': 'Tabs' }}
        trigger={() => {}}
      >
        {tab('i1', { tabId: 'i1', title: 'Inner one' }, 'inner one', { mode: 'design' })}
        {tab('i2', { tabId: 'i2', title: 'Inner two' }, <span data-node-id="deep">deep</span>, { mode: 'design' })}
      </TabsPreview>
    );
    renderTabs({
      mode: 'design',
      tabs: [
        tab('o1', { tabId: 'o1', title: 'Outer one' }, 'outer one', { mode: 'design' }),
        tab('o2', { tabId: 'o2', title: 'Outer two' }, inner, { mode: 'design' }),
      ],
    });
    expect(panel('o1')).toBeVisible();
    expect(panel('i2')).not.toBeVisible();
    act(() => {
      panel('deep').dispatchEvent(new CustomEvent(UIEX_REVEAL_EVENT, { bubbles: true }));
    });
    expect(panel('o2')).toBeVisible();
    expect(panel('i2')).toBeVisible();
    expect(panel('deep')).toBeVisible();
    expect(within(panel('n_inner')).getByRole('tab', { name: 'Inner two' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a Tab rendered outside Tabs is simply visible', () => {
    const { root } = renderPreview(def('Tab'), { mode: 'preview', children: <span>content</span> });
    expect(root).toBeVisible();
    expect(root).toHaveTextContent('content');
  });
});
