import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeTemplate, UINode } from '../../model/types';
import { renderPreview, templateFor } from '../../test/previewHarness';
import { ICON_NAMES, STANDARD_DOCS } from '../constants';
import type { ComponentDef, PreviewProps, PropDef } from '../types';
import { LOADING_RESULT_MS, buttonComponents, fitButtonRow } from './buttons';

// Vitest globals are off, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const EXPECTED_TYPES = ['Button', 'LoadingButton', 'ButtonRow', 'Dropdown', 'Dropdown.ButtonItem', 'Link'];
const DIST = resolve(process.cwd(), 'node_modules/@hubspot/ui-extensions/dist');

function def(type: string): ComponentDef {
  const d = buttonComponents.find((c) => c.type === type);
  if (!d) throw new Error(`missing ${type}`);
  return d;
}

function propDef(type: string, name: string): PropDef {
  const p = def(type).props.find((x) => x.name === name);
  if (!p) throw new Error(`missing ${type}.${name}`);
  return p;
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

/** Renders a registry preview as the NodeRenderer would (used to build children of containers). */
function node(
  type: string,
  id: string,
  opts: { props?: Record<string, unknown>; text?: string; mode?: 'design' | 'preview'; trigger?: PreviewProps['trigger']; children?: ReactNode } = {},
) {
  const d = def(type);
  const n: UINode = { id, type, props: {}, children: [] };
  return (
    <d.preview
      key={id}
      node={n}
      props={opts.props ?? {}}
      text={opts.text ?? ''}
      slots={{}}
      mode={opts.mode ?? 'preview'}
      rootProps={{ 'data-node-id': id, 'data-node-type': type }}
      trigger={opts.trigger ?? (() => {})}
    >
      {opts.children}
    </d.preview>
  );
}

/** Renders a single preview inside a card root, like the canvas. */
function renderInCard(element: ReactNode, mode: 'design' | 'preview' = 'preview') {
  return render(<div className={`hsp-root ${mode === 'preview' ? 'hsp-live' : 'hsp-design'}`}>{element}</div>);
}

const byId = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

describe('buttons registry definitions', () => {
  const known = new Set([...hubspotExports(), ...buttonComponents.map((c) => c.type)]);

  it('registers exactly the button & link components', () => {
    expect(buttonComponents.map((c) => c.type)).toEqual(EXPECTED_TYPES);
  });

  it.each(buttonComponents.map((c) => [c.type, c] as const))('%s: definition is consistent', (_type, d) => {
    expect(d.category).toBe('Buttons & links');
    expect(d.importFrom).toBe('@hubspot/ui-extensions');
    // The JSX tag's root identifier is a real export (Dropdown.ButtonItem -> Dropdown).
    expect(known.has(d.importName ?? d.type)).toBe(true);
    expect(d.icon).toBeTruthy();
    expect(d.docsUrl?.startsWith(`${STANDARD_DOCS}/`)).toBe(true);
    expect(d.description.length).toBeGreaterThan(10);
    expect(d.keywords?.length).toBeGreaterThan(0);

    // Prop names unique; testId in Advanced; no callback / children / overlay props declared as props.
    const names = d.props.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(d.props.find((p) => p.name === 'testId')?.group).toBe('Advanced');
    expect(names.filter((n) => /^on[A-Z]/.test(n))).toEqual([]);
    expect(names).not.toContain('children');
    expect(names).not.toContain('overlay');

    // Enum defaults (including object sub-fields) are among the options.
    const checkDefaults = (props: PropDef[]) => {
      for (const p of props) {
        if (p.type.kind === 'enum' && p.defaultValue !== undefined) {
          expect(p.type.options.map((o) => o.value), `${d.type}.${p.name}`).toContain(p.defaultValue);
        }
        if (p.type.kind === 'object') checkDefaults(p.type.fields);
      }
    };
    checkDefaults(d.props);

    // create(): every required prop is set; required children exist; text components have text.
    const tpl = templateFor(d);
    expect(tpl.type).toBe(d.type);
    for (const p of d.props.filter((x) => x.required)) {
      expect(tpl.props?.[p.name], `${d.type}.${p.name}`).not.toBeUndefined();
    }
    if (d.children.required) expect(tpl.children?.length ?? 0).toBeGreaterThan(0);
    if (d.children.mode !== 'nodes') expect(tpl.children ?? []).toEqual([]);
    if (d.children.mode === 'text') {
      expect(tpl.text?.length ?? 0).toBeGreaterThan(0);
      expect(d.children.defaultText?.length ?? 0).toBeGreaterThan(0);
    }

    // Structural references point at real component types.
    for (const t of [...(d.parents ?? []), ...(d.children.accepts ?? []), ...(d.slots ?? []).flatMap((s) => s.accepts)]) {
      expect(known.has(t), t).toBe(true);
    }
    for (const e of d.events ?? []) expect(Array.isArray(e.params)).toBe(true);
    expect(d.valueBinding).toBeUndefined();
  });

  it('create() templates respect structural rules within the group', () => {
    for (const d of buttonComponents) {
      walkTemplate(templateFor(d), (t, parent) => {
        const childDef = buttonComponents.find((c) => c.type === t.type);
        expect(childDef, t.type).toBeDefined();
        if (parent) {
          const parentDef = buttonComponents.find((c) => c.type === parent.type);
          if (parentDef?.children.accepts) expect(parentDef.children.accepts).toContain(t.type);
          if (childDef?.parents) expect(childDef.parents).toContain(parent.type);
        } else if (d.type !== 'Dropdown.ButtonItem') {
          expect(childDef?.parents).toBeUndefined();
        }
        for (const p of childDef?.props.filter((x) => x.required) ?? []) expect(t.props?.[p.name]).not.toBeUndefined();
        if (childDef?.children.mode === 'text') expect(t.text).toBeTruthy();
      });
    }
  });

  it('declares exactly the documented, non-deprecated props', () => {
    const props = (type: string) => def(type).props.map((p) => p.name).sort();
    expect(props('Button')).toEqual(['disabled', 'href', 'size', 'testId', 'truncate', 'type', 'variant']);
    expect(props('LoadingButton')).toEqual(
      ['disabled', 'href', 'loading', 'overlayOptions', 'resultIconName', 'size', 'testId', 'truncate', 'type', 'variant'],
    );
    expect(props('ButtonRow')).toEqual(['disableDropdown', 'dropDownButtonOptions', 'testId']);
    // Dropdown `options` is deprecated (and holds functions): Dropdown.ButtonItem children replace it.
    expect(props('Dropdown')).toEqual(['buttonSize', 'buttonText', 'disabled', 'testId', 'variant']);
    expect(props('Dropdown.ButtonItem')).toEqual(['testId']);
    expect(props('Link')).toEqual(['href', 'preventDefault', 'testId', 'variant']);
  });

  it('every declared prop exists in the HubSpot .d.ts files', () => {
    const read = (f: string) => readFileSync(resolve(DIST, 'shared.synced/types/components', f), 'utf8');
    const sources: Record<string, string> = {
      Button: read('button.synced.d.ts'),
      LoadingButton: read('button.synced.d.ts'),
      ButtonRow: read('button-row.synced.d.ts'),
      Dropdown: read('dropdown.synced.d.ts'),
      'Dropdown.ButtonItem': read('dropdown.synced.d.ts'),
      Link: read('link.synced.d.ts'),
    };
    for (const d of buttonComponents) {
      for (const p of d.props) {
        if (p.name === 'testId') continue; // from BaseComponentProps
        expect(sources[d.type], `${d.type}.${p.name}`).toMatch(new RegExp(`\\b${p.name}\\??:`));
        if (p.type.kind === 'object') {
          for (const f of p.type.fields) expect(sources[d.type], `${d.type}.${p.name}.${f.name}`).toMatch(new RegExp(`\\b${f.name}\\??:`));
        }
      }
    }
  });

  it('copies enum values, defaults and required-ness from the .d.ts', () => {
    const values = (type: string, name: string) => {
      const p = propDef(type, name);
      return p.type.kind === 'enum' ? p.type.options.map((o) => o.value) : [];
    };
    expect(values('Button', 'variant')).toEqual(['primary', 'secondary', 'destructive', 'transparent']);
    expect(values('LoadingButton', 'variant')).toEqual(['primary', 'secondary', 'destructive']);
    expect(values('Dropdown', 'variant')).toEqual(['primary', 'secondary', 'transparent']);
    expect(values('Link', 'variant')).toEqual(['primary', 'destructive', 'light', 'dark']);
    expect(values('Button', 'type')).toEqual(['button', 'submit', 'reset']);
    for (const [type, name] of [['Button', 'size'], ['LoadingButton', 'size'], ['Dropdown', 'buttonSize']]) {
      expect(values(type, name)).toEqual(['extra-small', 'small', 'medium']);
      expect(propDef(type, name).defaultValue).toBe('medium');
    }
    expect(propDef('Button', 'variant').defaultValue).toBe('secondary');
    expect(propDef('Link', 'variant').defaultValue).toBe('primary');
    expect(propDef('Dropdown', 'buttonText').defaultValue).toBe('More');
    expect(propDef('LoadingButton', 'resultIconName')).toMatchObject({ type: { kind: 'icon' }, defaultValue: 'success' });
    expect(ICON_NAMES).toContain('success');
    expect(propDef('Button', 'href').type.kind).toBe('href');
    expect(propDef('Link', 'href')).toMatchObject({ required: true, type: { kind: 'href' } });
    expect(buttonComponents.flatMap((d) => d.props.filter((p) => p.required).map((p) => `${d.type}.${p.name}`))).toEqual(['Link.href']);

    const overlayOptions = propDef('LoadingButton', 'overlayOptions');
    expect(overlayOptions.type).toMatchObject({
      kind: 'object',
      fields: [{ name: 'openBehavior', defaultValue: 'onClick', type: { kind: 'enum', options: [{ value: 'onClick' }, { value: 'onLoadingFinish' }] } }],
    });
    const more = propDef('ButtonRow', 'dropDownButtonOptions');
    expect(more.type.kind === 'object' && more.type.fields.map((f) => [f.name, f.defaultValue])).toEqual([
      ['text', 'More'],
      ['size', 'medium'],
      ['variant', 'secondary'],
    ]);
  });

  it('declares onClick events, overlay slots and structure', () => {
    const onClick = [expect.objectContaining({ name: 'onClick', params: [expect.objectContaining({ name: 'event' })] })];
    for (const type of ['Button', 'LoadingButton', 'Dropdown.ButtonItem', 'Link']) expect(def(type).events).toEqual(onClick);
    expect(def('ButtonRow').events ?? []).toEqual([]);
    expect(def('Dropdown').events ?? []).toEqual([]);

    for (const type of ['Button', 'LoadingButton', 'Link']) {
      expect(def(type).slots).toEqual([expect.objectContaining({ name: 'overlay', label: 'Overlay', accepts: ['Modal', 'Panel', 'Tooltip'], max: 1 })]);
    }
    expect(def('Dropdown.ButtonItem').slots).toEqual([
      expect.objectContaining({ name: 'overlay', label: 'Overlay', accepts: ['Modal', 'Panel'], max: 1 }),
    ]);
    expect(def('ButtonRow').slots).toBeUndefined();
    expect(def('Dropdown').slots).toBeUndefined();

    expect(def('Dropdown.ButtonItem')).toMatchObject({ importName: 'Dropdown', parents: ['Dropdown'], children: { mode: 'text' } });
    expect(def('Dropdown').children).toMatchObject({ mode: 'nodes', accepts: ['Dropdown.ButtonItem'] });
    expect(def('Dropdown').children.required).toBeFalsy();
    expect(def('ButtonRow').children).toMatchObject({ mode: 'nodes', required: true, accepts: ['Button', 'LoadingButton', 'Dropdown'] });
    for (const type of ['Button', 'LoadingButton', 'Link']) expect(def(type).children.mode).toBe('text');
  });

  it('Dropdown.create() has two menu items; ButtonRow.create() has two buttons', () => {
    const dropdown = def('Dropdown').create!();
    expect(dropdown.children?.map((c) => c.type)).toEqual(['Dropdown.ButtonItem', 'Dropdown.ButtonItem']);
    expect(dropdown.children?.every((c) => !!c.text)).toBe(true);
    const row = def('ButtonRow').create!();
    expect(row.children?.map((c) => c.type)).toEqual(['Button', 'Button']);
  });

  it('docs links come from remoteComponents JSDoc', () => {
    const jsdoc = readFileSync(resolve(DIST, 'shared.synced/remoteComponents.synced.d.ts'), 'utf8');
    for (const d of buttonComponents) {
      const slug = d.docsUrl!.slice(STANDARD_DOCS.length + 1);
      expect(jsdoc, d.type).toContain(`standard-components/${slug} Docs}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Rendering basics
// ---------------------------------------------------------------------------

describe('buttons previews render', () => {
  const cases = buttonComponents.flatMap((c) => (['design', 'preview'] as const).map((m) => [c.type, m, c] as const));

  it.each(cases)('%s (%s) renders its root as the outermost element', (_type, mode, d) => {
    const { container, root } = renderPreview(d, { mode });
    expectOutermost(container, root);
    expect(root?.getAttribute('data-node-type')).toBe(d.type);
  });

  it.each(cases)('%s (%s) tolerates empty and odd props', (_type, mode, d) => {
    expect(() => renderPreview(d, { mode, props: {}, text: '' }).unmount()).not.toThrow();
    const odd = {
      variant: 7,
      size: { a: 1 },
      buttonSize: [],
      type: 'weird',
      href: { url: 42 },
      disabled: 'nope',
      truncate: {},
      loading: [],
      resultIconName: 'constructor',
      overlayOptions: 'x',
      dropDownButtonOptions: [1, 2],
      disableDropdown: null,
      buttonText: { x: 1 },
      preventDefault: 3,
    };
    expect(() => renderPreview(d, { mode, props: odd, text: '' }).unmount()).not.toThrow();
    expect(() => renderPreview(d, { mode, props: { href: 'javascript:alert(1)', dropDownButtonOptions: { text: null, size: 'xl' } } }).unmount()).not.toThrow();
  });

  it('merges rootProps className and spreads hover handlers', () => {
    for (const d of buttonComponents) {
      for (const mode of ['design', 'preview'] as const) {
        const tpl = templateFor(d);
        const onMouseEnter = vi.fn();
        const { container, unmount } = render(
          <d.preview
            node={{ id: 'n_x', type: d.type, props: {}, children: [] }}
            props={(tpl.props ?? {}) as Record<string, unknown>}
            text={tpl.text ?? ''}
            slots={{}}
            mode={mode}
            rootProps={{ 'data-node-id': 'n_x', 'data-node-type': d.type, className: 'extra-class', title: 'Tip', onMouseEnter }}
            trigger={() => {}}
          />,
        );
        const root = container.querySelector('[data-node-id="n_x"]') as HTMLElement;
        expect(root?.classList.contains('extra-class'), d.type).toBe(true);
        expect(root?.className, d.type).toMatch(/hsp-/);
        expect(root.getAttribute('title'), d.type).toBe('Tip');
        fireEvent.mouseEnter(root);
        expect(onMouseEnter, d.type).toHaveBeenCalled();
        unmount();
      }
    }
  });

  it('design mode never renders native buttons or anchors as the root (so the canvas can select them)', () => {
    for (const d of buttonComponents) {
      const { root, unmount } = renderPreview(d, { mode: 'design' });
      expect(['BUTTON', 'A'], d.type).not.toContain(root?.tagName);
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

describe('Button preview', () => {
  it('fires onClick with an ExtensionEvent-like object in preview mode', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Button'), { mode: 'preview', trigger });
    expect(root?.tagName).toBe('BUTTON');
    expect(root).toHaveTextContent('Click me');
    await userEvent.click(root as HTMLElement);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      'onClick',
      expect.objectContaining({ type: 'click', bubbles: true, timeStamp: expect.any(Number), id: expect.any(String) }),
    );
  });

  it('applies HubSpot defaults, variants and sizes (with aliases)', () => {
    const { root: plain } = renderPreview(def('Button'), { mode: 'preview', props: {}, text: 'Go' });
    expect(plain).toHaveClass('hsp-button', 'hsp-button--secondary', 'hsp-button--medium', 'hsp-button--interactive');
    expect(plain).toHaveAttribute('type', 'button');
    cleanup();
    const { root } = renderPreview(def('Button'), { mode: 'preview', props: { variant: 'destructive', size: 'sm', type: 'submit' }, text: 'Go' });
    expect(root).toHaveClass('hsp-button--destructive', 'hsp-button--small');
    expect(root).toHaveAttribute('type', 'submit');
    cleanup();
    const { root: xs } = renderPreview(def('Button'), { mode: 'preview', props: { variant: 'transparent', size: 'extra-small' }, text: 'Go' });
    expect(xs).toHaveClass('hsp-button--transparent', 'hsp-button--extra-small');
    cleanup();
    const { root: bad } = renderPreview(def('Button'), { mode: 'preview', props: { variant: 'neon', size: 'xl', type: 'menu' }, text: 'Go' });
    expect(bad).toHaveClass('hsp-button--secondary', 'hsp-button--medium');
    expect(bad).toHaveAttribute('type', 'button');
  });

  it('disabled buttons look disabled, keep hover handlers and do not fire onClick', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Button'), { mode: 'preview', props: { disabled: true }, trigger, text: 'Nope' });
    expect(root).toHaveClass('hsp-button--disabled');
    expect(root).not.toHaveClass('hsp-button--interactive');
    expect(root).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(root as HTMLElement);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('submit/reset buttons drive a native form; disabled submit buttons do not submit', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const onReset = vi.fn();
    render(
      <form onSubmit={onSubmit} onReset={onReset}>
        {node('Button', 'n_submit', { props: { type: 'submit' }, text: 'Submit' })}
        {node('Button', 'n_reset', { props: { type: 'reset' }, text: 'Reset' })}
        {node('Button', 'n_off', { props: { type: 'submit', disabled: true }, text: 'Off' })}
      </form>,
    );
    fireEvent.click(byId('n_submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(byId('n_reset'));
    expect(onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(byId('n_off'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('href renders a new-tab anchor with the external icon for non-HubSpot URLs', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Button'), { mode: 'preview', props: { href: 'https://example.com/x' }, trigger, text: 'Open' });
    expect(root?.tagName).toBe('A');
    expect(root).toHaveAttribute('href', 'https://example.com/x');
    expect(root).toHaveAttribute('target', '_blank');
    expect(root).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(root as HTMLElement).getByLabelText('Opens in a new tab')).toBeInTheDocument();
    // Both href and onClick run (navigation itself is left to the browser).
    fireEvent.click(root as HTMLElement);
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click' }));
  });

  it('honours HrefOptions.external and HubSpot app URLs; never navigates unsafe URLs', () => {
    const external = (href: unknown) => {
      const { root, unmount } = renderPreview(def('Button'), { mode: 'preview', props: { href }, text: 'Go' });
      const result = { tag: root?.tagName, icon: !!root?.querySelector('[aria-label="Opens in a new tab"]'), href: root?.getAttribute('href') };
      unmount();
      return result;
    };
    expect(external('https://app.hubspot.com/contacts/1')).toEqual({ tag: 'A', icon: false, href: 'https://app.hubspot.com/contacts/1' });
    expect(external({ url: 'https://example.com', external: false })).toMatchObject({ icon: false });
    expect(external({ url: 'https://app.hubspot.com', external: true })).toMatchObject({ icon: true });
    expect(external('javascript:alert(1)')).toEqual({ tag: 'BUTTON', icon: false, href: null });
    expect(external('/contacts/1/record/0-1/2')).toEqual({ tag: 'BUTTON', icon: false, href: null });
  });

  it('a disabled href button is not a link', () => {
    const { root } = renderPreview(def('Button'), { mode: 'preview', props: { href: 'https://example.com', disabled: true }, text: 'Go' });
    expect(root?.tagName).toBe('BUTTON');
  });

  it('truncate shows the full text as a tooltip', () => {
    const text = 'A very long button label that will not fit';
    const { root } = renderPreview(def('Button'), { mode: 'preview', props: { truncate: true }, text });
    expect(root).toHaveClass('hsp-button--truncate');
    expect(root).toHaveAttribute('title', text);
  });

  it('design mode renders an inert face', () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Button'), { mode: 'design', trigger });
    expect(root?.tagName).toBe('SPAN');
    expect(root).toHaveClass('hsp-button', 'hsp-button--primary');
    expect(root).not.toHaveClass('hsp-button--interactive');
  });
});

// ---------------------------------------------------------------------------
// LoadingButton
// ---------------------------------------------------------------------------

describe('LoadingButton preview', () => {
  it('fires onClick when idle', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('LoadingButton'), { mode: 'preview', trigger });
    expect(root).toHaveTextContent('Save changes');
    await userEvent.click(root as HTMLElement);
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click' }));
  });

  it('shows a spinner and blocks clicks while loading, keeping its variant colours', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('LoadingButton'), { mode: 'preview', props: { loading: true, variant: 'primary' }, trigger });
    expect(root).toHaveAttribute('aria-busy', 'true');
    expect(root).toHaveAttribute('aria-disabled', 'true');
    expect(root).toHaveClass('hsp-button--loading', 'hsp-button--primary');
    expect(root).not.toHaveClass('hsp-button--disabled');
    expect(within(root as HTMLElement).getByRole('progressbar')).toBeInTheDocument();
    await userEvent.click(root as HTMLElement);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('shows the result icon briefly after loading finishes', () => {
    vi.useFakeTimers();
    const d = def('LoadingButton');
    const ui = (loading: boolean) => (
      <div className="hsp-root hsp-live">
        <d.preview
          node={{ id: 'n_lb', type: d.type, props: {}, children: [] }}
          props={{ loading, resultIconName: 'thumbsUp' }}
          text="Sync"
          slots={{}}
          mode="preview"
          rootProps={{ 'data-node-id': 'n_lb', 'data-node-type': d.type }}
          trigger={() => {}}
        />
      </div>
    );
    const { rerender } = render(ui(false));
    expect(screen.queryByLabelText('Done')).toBeNull();
    rerender(ui(true));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    rerender(ui(false));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByLabelText('Done')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(LOADING_RESULT_MS + 10);
    });
    expect(screen.queryByLabelText('Done')).toBeNull();
  });

  it('falls back to secondary for variants LoadingButton does not support', () => {
    const { root } = renderPreview(def('LoadingButton'), { mode: 'preview', props: { variant: 'transparent' } });
    expect(root).toHaveClass('hsp-button--secondary');
  });
});

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------

describe('Dropdown preview', () => {
  function renderDropdown(opts: { mode?: 'design' | 'preview'; props?: Record<string, unknown>; onItem?: PreviewProps['trigger'] } = {}) {
    const mode = opts.mode ?? 'preview';
    return renderInCard(
      <div>
        <div data-testid="outside">outside</div>
        {node('Dropdown', 'n_dd', {
          mode,
          props: opts.props ?? { buttonText: 'Actions' },
          children: [
            node('Dropdown.ButtonItem', 'n_edit', { mode, text: 'Edit record', trigger: opts.onItem }),
            node('Dropdown.ButtonItem', 'n_archive', { mode, text: 'Archive' }),
          ],
        })}
      </div>,
      mode,
    );
  }
  const menu = () => byId('n_dd').querySelector('[role="menu"]') as HTMLElement;
  const toggle = () => within(byId('n_dd')).getByRole('button', { name: /Actions/ });

  it('opens the menu below the button on click and closes after choosing an item', async () => {
    const onItem = vi.fn();
    renderDropdown({ onItem });
    expect(menu()).not.toBeVisible();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle());
    expect(menu()).toBeVisible();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu()).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit record', 'Archive']);
    await userEvent.click(within(menu()).getByRole('menuitem', { name: 'Edit record' }));
    expect(onItem).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click', id: expect.any(String) }));
    expect(menu()).not.toBeVisible();
  });

  it('closes on Escape, outside click and second toggle click', async () => {
    renderDropdown();
    await userEvent.click(toggle());
    expect(menu()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(menu()).not.toBeVisible();
    await userEvent.click(toggle());
    await userEvent.click(screen.getByTestId('outside'));
    expect(menu()).not.toBeVisible();
    await userEvent.click(toggle());
    await userEvent.click(toggle());
    expect(menu()).not.toBeVisible();
  });

  it('a disabled dropdown does not open', async () => {
    renderDropdown({ props: { buttonText: 'Actions', disabled: true } });
    expect(toggle()).toHaveClass('hsp-button--disabled');
    await userEvent.click(toggle());
    expect(menu()).not.toBeVisible();
  });

  it('uses HubSpot defaults and styles the button by variant / size', () => {
    renderInCard(node('Dropdown', 'n_dd', { props: {} }));
    const button = within(byId('n_dd')).getByRole('button');
    expect(button).toHaveTextContent('More');
    expect(button).toHaveClass('hsp-button--secondary', 'hsp-button--medium');
    cleanup();
    renderInCard(node('Dropdown', 'n_dd', { props: { variant: 'transparent', buttonSize: 'xs', buttonText: 'Options' } }));
    expect(within(byId('n_dd')).getByRole('button')).toHaveClass('hsp-button--transparent', 'hsp-button--extra-small');
  });

  it('design mode shows the menu items inline so they can be selected', () => {
    renderDropdown({ mode: 'design' });
    expect(byId('n_dd')).toHaveClass('hsp-dropdown--design');
    expect(menu()).toBeVisible();
    expect(menu()).toHaveClass('hsp-dropdown-menu--design');
    expect(byId('n_edit')).toBeVisible();
    expect(byId('n_edit').tagName).toBe('SPAN');
    // Clicking the face in design mode does not toggle anything.
    fireEvent.click(byId('n_dd').firstElementChild as HTMLElement);
    expect(menu()).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Dropdown.ButtonItem preview', () => {
  it('renders a menu item that fires onClick', async () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Dropdown.ButtonItem'), { mode: 'preview', trigger });
    expect(root).toHaveAttribute('role', 'menuitem');
    expect(root).toHaveTextContent('Menu item');
    await userEvent.click(root as HTMLElement);
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click' }));
  });

  it('shows a placeholder for empty text in design mode only', () => {
    const { root } = renderPreview(def('Dropdown.ButtonItem'), { mode: 'design', text: '' });
    expect(root).toHaveTextContent('Menu item');
    cleanup();
    const { root: live } = renderPreview(def('Dropdown.ButtonItem'), { mode: 'preview', text: '' });
    expect(live).toHaveTextContent('');
  });
});

// ---------------------------------------------------------------------------
// ButtonRow
// ---------------------------------------------------------------------------

describe('fitButtonRow', () => {
  it('keeps everything when it fits or when the row is not laid out', () => {
    expect(fitButtonRow([80, 80], 200, 8, 70)).toBe(2);
    expect(fitButtonRow([80, 80, 80], 0, 8, 70)).toBe(3);
    expect(fitButtonRow([], 100, 8, 70)).toBe(0);
  });

  it('reserves room for the overflow button', () => {
    // 3 x 80 + 2 x 8 = 256 > 200 -> More (70) + 8 + 80 = 158 fits, + 8 + 80 = 246 does not.
    expect(fitButtonRow([80, 80, 80], 200, 8, 70)).toBe(1);
    expect(fitButtonRow([300, 20], 200, 8, 70)).toBe(0);
  });
});

describe('ButtonRow preview', () => {
  const rowChildren = (mode: 'design' | 'preview', trigger?: PreviewProps['trigger']) => [
    node('Button', 'n_a', { mode, text: 'Save', props: { variant: 'primary' } }),
    node('Button', 'n_b', { mode, text: 'Duplicate', trigger }),
    node('Button', 'n_c', { mode, text: 'Delete', props: { variant: 'destructive' } }),
  ];

  /** Fakes layout: the row is `rowWidth` wide, every item 80px and the "More" button 70px. */
  function fakeLayout(rowWidth: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('hsp-button-row-item') ? 80 : this.classList.contains('hsp-button-row-more') ? 70 : 0;
      return { x: 0, y: 0, top: 0, left: 0, bottom: 30, right: width, width, height: 30, toJSON: () => ({}) } as DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('hsp-button-row') ? rowWidth : 0;
      },
    });
  }
  afterEach(() => {
    // Remove the override so the inherited Element.prototype getter applies again.
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  it('renders every button (wrapping) in design mode', () => {
    fakeLayout(200);
    renderInCard(node('ButtonRow', 'n_row', { mode: 'design', children: rowChildren('design') }), 'design');
    expect(byId('n_row')).toHaveClass('hsp-button-row', 'hsp-button-row--wrap');
    for (const id of ['n_a', 'n_b', 'n_c']) expect(byId('n_row').contains(byId(id))).toBe(true);
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  });

  it('keeps all buttons inline when they fit', () => {
    fakeLayout(400);
    renderInCard(node('ButtonRow', 'n_row', { children: rowChildren('preview') }));
    expect(byId('n_row').querySelectorAll('.hsp-button-row-item')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  });

  it('collapses overflowing buttons into a "More" dropdown', async () => {
    fakeLayout(200);
    const trigger = vi.fn();
    renderInCard(node('ButtonRow', 'n_row', { children: rowChildren('preview', trigger) }));
    const items = byId('n_row').querySelectorAll('.hsp-button-row-item');
    expect(Array.from(items).map((i) => i.textContent)).toEqual(['Save']);
    const more = screen.getByRole('button', { name: /More/ });
    const menu = byId('n_row').querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeVisible();
    await userEvent.click(more);
    expect(menu).toBeVisible();
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['Duplicate', 'Delete']);
    await userEvent.click(within(menu).getByRole('button', { name: 'Duplicate' }));
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click' }));
    expect(menu).not.toBeVisible();
  });

  it('customises the overflow button and honours disableDropdown', async () => {
    fakeLayout(200);
    renderInCard(
      node('ButtonRow', 'n_row', {
        props: { disableDropdown: true, dropDownButtonOptions: { text: '', variant: 'transparent', size: 'sm' } },
        children: rowChildren('preview'),
      }),
    );
    // Empty text shows a gear icon (labelled for accessibility).
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more).toHaveClass('hsp-button--transparent', 'hsp-button--small', 'hsp-button--disabled');
    expect(more.querySelector('svg')).not.toBeNull();
    await userEvent.click(more);
    expect(byId('n_row').querySelector('[role="menu"]')).not.toBeVisible();
  });

  it('a Dropdown collapsed into the overflow menu can still open its own menu', async () => {
    fakeLayout(200);
    const onItem = vi.fn();
    renderInCard(
      node('ButtonRow', 'n_row', {
        children: [
          node('Button', 'n_a', { text: 'Save' }),
          node('Button', 'n_b', { text: 'Cancel' }),
          node('Dropdown', 'n_dd', {
            props: { buttonText: 'Actions' },
            children: [node('Dropdown.ButtonItem', 'n_item', { text: 'Archive', trigger: onItem })],
          }),
        ],
      }),
    );
    const rowMenu = byId('n_row').querySelector('.hsp-button-row-menu') as HTMLElement;
    await userEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(rowMenu.contains(byId('n_dd'))).toBe(true);
    await userEvent.click(within(byId('n_dd')).getByRole('button', { name: /Actions/ }));
    expect(rowMenu).toBeVisible();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onItem).toHaveBeenCalledTimes(1);
    expect(rowMenu).not.toBeVisible();
  });

  it('accepts fragment-wrapped children (one item per child component)', () => {
    fakeLayout(200);
    renderInCard(node('ButtonRow', 'n_row', { children: <>{rowChildren('preview')}</> }));
    expect(byId('n_row').querySelectorAll('.hsp-button-row-item')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /More/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

describe('Link preview', () => {
  it('renders a new-tab anchor with the external icon for outside URLs and fires onClick', () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Link'), { mode: 'preview', trigger });
    expect(root?.tagName).toBe('A');
    expect(root).toHaveAttribute('href', 'https://developers.hubspot.com/docs');
    expect(root).toHaveAttribute('target', '_blank');
    expect(root).toHaveClass('hsp-link', 'hsp-link--primary', 'hsp-link--interactive');
    expect(root).toHaveTextContent('Learn more');
    // developers.hubspot.com is a HubSpot domain -> no external icon by default.
    expect(within(root as HTMLElement).queryByLabelText('Opens in a new tab')).toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    root?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click', id: expect.any(String) }));
  });

  it('preventDefault cancels navigation before onClick', () => {
    const trigger = vi.fn();
    const { root } = renderPreview(def('Link'), { mode: 'preview', props: { href: 'https://example.com', preventDefault: true }, trigger });
    expect(within(root as HTMLElement).getByLabelText('Opens in a new tab')).toBeInTheDocument();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    root?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('HubSpot-relative and unsafe URLs are not navigable but still clickable', async () => {
    for (const href of ['/contacts/123', 'javascript:alert(1)', { url: '/x', external: true }]) {
      const trigger = vi.fn();
      const { root, unmount } = renderPreview(def('Link'), { mode: 'preview', props: { href }, trigger, text: 'Go' });
      expect(root).not.toHaveAttribute('href');
      expect(root).toHaveAttribute('role', 'link');
      expect(root).toHaveAttribute('tabindex', '0');
      (root as HTMLElement).focus();
      await userEvent.keyboard('{Enter}');
      expect(trigger).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('maps variants and falls back to primary', () => {
    for (const variant of ['destructive', 'light', 'dark']) {
      const { root, unmount } = renderPreview(def('Link'), { mode: 'preview', props: { href: 'https://x.io', variant } });
      expect(root).toHaveClass(`hsp-link--${variant}`);
      unmount();
    }
    const { root } = renderPreview(def('Link'), { mode: 'preview', props: { href: 'https://x.io', variant: 'blue' } });
    expect(root).toHaveClass('hsp-link--primary');
  });

  it('design mode renders a selectable span with the URL as hint and a placeholder for empty text', () => {
    const { root } = renderPreview(def('Link'), { mode: 'design', text: '' });
    expect(root?.tagName).toBe('SPAN');
    expect(root).toHaveClass('hsp-link--design');
    expect(root).toHaveAttribute('title', 'https://developers.hubspot.com/docs');
    expect(root).toHaveTextContent('Link text');
  });
});
