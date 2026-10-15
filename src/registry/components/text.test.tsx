import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { textComponents } from './text';
import { renderPreview, templateFor } from '../../test/previewHarness';
import { ICON_NAMES, STANDARD_DOCS } from '../constants';
import type { ComponentDef, PreviewProps, PropDef } from '../types';
import type { UINode } from '../../model/types';

afterEach(cleanup);

const byType = (type: string): ComponentDef => {
  const def = textComponents.find((d) => d.type === type);
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

const LOG_STEP = { id: 'a1', type: 'log', level: 'info', message: 'clicked' } as const;

/**
 * Renders a preview for a hand-built node (e.g. one with events/slots) in preview mode, with extra
 * rootProps (the harness only passes the data attributes).
 */
function renderWithNode(
  def: ComponentDef,
  node: UINode,
  trigger: PreviewProps['trigger'],
  extraRootProps: Partial<PreviewProps['rootProps']> = {},
): HTMLElement {
  const Preview = def.preview;
  const tpl = templateFor(def);
  const { container } = render(
    <div className="hsp-root hsp-live">
      <Preview
        node={node}
        props={(tpl.props ?? {}) as Record<string, unknown>}
        text={tpl.text ?? 'Clickable'}
        slots={{}}
        mode="preview"
        rootProps={{ 'data-node-id': node.id, 'data-node-type': node.type, ...extraRootProps }}
        trigger={trigger}
      />
    </div>,
  );
  return container.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement;
}

// ---------------------------------------------------------------------------
// Parse the installed @hubspot/ui-extensions declarations (source of truth).
// ---------------------------------------------------------------------------

const DTS_FILES: Record<string, string> = {
  Text: 'text',
  Heading: 'heading',
  Image: 'image',
  Icon: 'icon',
  Illustration: 'illustration',
  List: 'list',
  Tag: 'tag',
  StatusTag: 'status-tag',
  Tooltip: 'tooltip',
};

/** Vitest runs from the project root (where vite.config.ts lives). */
const COMPONENT_TYPES_DIR = resolve(process.cwd(), 'node_modules/@hubspot/ui-extensions/dist/shared.synced/types/components');

function readDts(type: string): string {
  return readFileSync(resolve(COMPONENT_TYPES_DIR, `${DTS_FILES[type]}.synced.d.ts`), 'utf8');
}

interface DeclaredProp {
  optional: boolean;
  tsType: string;
  defaultValue?: string | boolean;
}

/** Extracts `<Type>Props` members: name, optionality, TS type and JSDoc default. */
function declaredProps(type: string): { props: Map<string, DeclaredProp>; source: string } {
  const source = readDts(type);
  const start = source.search(new RegExp(`export (interface|type) ${type}Props\\b`));
  expect(start).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = source.slice(open + 1, end);
  const props = new Map<string, DeclaredProp>();
  const member = /(?:\/\*\*([\s\S]*?)\*\/\s*)?^\s*(\w+)(\??):\s*([^;]+);/gm;
  for (const m of body.matchAll(member)) {
    const doc = m[1] ?? '';
    const dm = doc.match(/@defaultValue\s+`([^`]+)`/) ?? doc.match(/@default\s+(\S+)/);
    let defaultValue: string | boolean | undefined;
    if (dm) {
      const raw = dm[1].trim();
      defaultValue = raw === 'true' ? true : raw === 'false' ? false : raw.replace(/^["']|["']$/g, '');
    }
    // Inline same-file literal aliases (e.g. `export type IconColor = 'alert' | ...;`).
    const raw = m[4].trim();
    const alias = /^\w+$/.test(raw) ? source.match(new RegExp(`export type ${raw} = ([^;]+);`)) : null;
    props.set(m[2], { optional: m[3] === '?', tsType: alias ? alias[1].trim() : raw, defaultValue });
  }
  return { props, source };
}

/** TShirtSizes['sm'] is 'small' | 'sm'; the registry offers the long names (see constants.ts). */
const TSHIRT_LONG: Record<string, string> = { xs: 'extra-small', sm: 'small', md: 'medium', lg: 'large', xl: 'extra-large' };
const literals = (tsType: string): string[] =>
  [...tsType.replace(/TShirtSizes\['(\w+)'\]/g, (_, k: string) => `'${TSHIRT_LONG[k]}'`).matchAll(/'([^']*)'/g)].map((m) => m[1]);
const enumValues = (p: PropDef): unknown[] => (p.type.kind === 'enum' ? p.type.options.map((o) => o.value) : []);
const isCallback = (tsType: string) => tsType.includes('=>') || tsType.startsWith('ReactionsHandler');

// Types that may legitimately be referenced by parents/accepts/slots of this group.
const KNOWN_TYPES = new Set([...textComponents.map((d) => d.type), 'Modal', 'Panel', 'Tooltip']);

describe('text group registry', () => {
  it('registers the expected components in the Text & content category', () => {
    expect(textComponents.map((d) => d.type)).toEqual([
      'Text',
      'Heading',
      'Image',
      'Icon',
      'Illustration',
      'List',
      'Tag',
      'StatusTag',
      'Tooltip',
    ]);
    for (const def of textComponents) {
      expect(def.category).toBe('Text & content');
      expect(def.importFrom).toBe('@hubspot/ui-extensions');
    }
  });
});

describe.each(textComponents.map((def) => [def.type, def] as const))('%s', (type, def) => {
  it.each(['design', 'preview'] as const)('renders its create() template in %s mode with the root outermost', (mode) => {
    const { root } = renderRoot(def, { mode });
    expect(root.getAttribute('data-node-type')).toBe(type);
  });

  it('renders with empty props and text without throwing', () => {
    for (const mode of ['design', 'preview'] as const) {
      renderRoot(def, { mode, props: {}, text: '' });
      cleanup();
    }
  });

  it('degrades gracefully on odd prop shapes', () => {
    const odd = {
      name: { not: 'a name' },
      variant: 42,
      format: 'bold',
      truncate: { maxWidth: 'wide', tooltipText: 7 },
      src: 12,
      href: { nope: true },
      width: 'wide',
      height: -10,
      size: [],
      color: null,
      placement: {},
      alt: { a: 1 },
      inline: 'yes',
      hollow: 1,
      showRemoveIcon: 'true',
      screenReaderText: 5,
    };
    renderRoot(def, { mode: 'preview', props: odd, text: '' });
    cleanup();
    renderRoot(def, { mode: 'design', props: { name: 'constructor', variant: 'toString' } });
  });

  it('merges rootProps.className and forwards runtime hover handlers', () => {
    const onMouseEnter = vi.fn();
    const root = renderWithNode(def, { id: 'n_rp', type, props: {}, children: [] }, vi.fn(), {
      className: 'runtime-hook',
      onMouseEnter,
    });
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

    const names = def.props.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(def.props.find((p) => p.name === 'testId')?.group).toBe('Advanced');

    for (const p of def.props) {
      if (p.required) expect(tpl.props?.[p.name], `${type}.${p.name} required`).toBeDefined();
      if (p.type.kind === 'enum') {
        const values = enumValues(p);
        expect(new Set(values).size).toBe(values.length);
        if (p.defaultValue !== undefined) expect(values).toContain(p.defaultValue);
        const v = tpl.props?.[p.name];
        if (v !== undefined) expect(values).toContain(v);
      }
      if (p.type.kind === 'object') {
        for (const f of p.type.fields) {
          if (f.type.kind === 'enum' && f.defaultValue !== undefined) expect(enumValues(f)).toContain(f.defaultValue);
        }
      }
    }

    if (def.children.mode === 'text') expect(def.children.defaultText).toBeTruthy();
    if (def.children.mode === 'nodes' && def.children.required) expect(tpl.children?.length ?? 0).toBeGreaterThan(0);
    for (const t of def.children.accepts ?? []) expect(KNOWN_TYPES.has(t)).toBe(true);
    for (const t of def.parents ?? []) expect(KNOWN_TYPES.has(t)).toBe(true);
    for (const slot of def.slots ?? []) for (const t of slot.accepts) expect(KNOWN_TYPES.has(t)).toBe(true);
    for (const ev of def.events ?? []) expect(Array.isArray(ev.params)).toBe(true);
    // Every child type in the default template must exist (Text lives in this group).
    for (const child of tpl.children ?? []) expect(KNOWN_TYPES.has(child.type)).toBe(true);
  });

  it('matches the @hubspot/ui-extensions declaration', () => {
    const { props: declared, source } = declaredProps(type);
    expect(declared.size).toBeGreaterThan(0);
    const propDefs = new Map(def.props.map((p) => [p.name, p]));
    const eventNames = new Set((def.events ?? []).map((e) => e.name));

    for (const [name, decl] of declared) {
      if (name === 'children') {
        expect(def.children.mode).not.toBe('none');
        continue;
      }
      if (isCallback(decl.tsType)) {
        expect(eventNames.has(name), `${type}.${name} should be an event`).toBe(true);
        continue;
      }
      const p = propDefs.get(name);
      expect(p, `${type}.${name} missing from registry`).toBeDefined();
      if (!p) continue;
      expect(Boolean(p.required), `${type}.${name} required-ness`).toBe(!decl.optional);
      const lits = literals(decl.tsType);
      if (p.type.kind === 'enum' && lits.length > 0) expect(new Set(enumValues(p))).toEqual(new Set(lits));
      if (decl.tsType === 'boolean') expect(p.type.kind).toBe('boolean');
      if (decl.tsType === 'number') expect(p.type.kind).toBe('number');
      if (decl.defaultValue !== undefined) expect(p.defaultValue, `${type}.${name} default`).toEqual(decl.defaultValue);
    }
    // Nothing invented: every registry prop (except BaseComponentProps.testId) is declared.
    for (const name of propDefs.keys()) if (name !== 'testId') expect(declared.has(name), `${type}.${name} declared`).toBe(true);
    for (const name of eventNames) expect(declared.has(name), `${type}.${name} event declared`).toBe(true);
    if (!declared.has('children')) expect(def.children.mode).toBe('none');
    // Overlay triggers extend OverlayComponentProps and expose an `overlay` slot.
    const isTrigger = /extends[^{]*OverlayComponentProps/.test(source);
    expect(Boolean(def.slots?.some((s) => s.name === 'overlay'))).toBe(isTrigger);
  });
});

// ---------------------------------------------------------------------------
// Component-specific behaviour
// ---------------------------------------------------------------------------

describe('Text preview', () => {
  const def = byType('Text');

  it('applies format, variant and inline', () => {
    const { root } = renderRoot(def, {
      props: { format: { fontWeight: 'bold', italic: true, lineDecoration: 'strikethrough' }, variant: 'microcopy', inline: true },
      text: 'Hello',
    });
    expect(root.tagName).toBe('SPAN');
    expect(root).toHaveClass('hsp-text', 'hsp-microcopy', 'hsp-inline');
    expect(root.style.fontWeight).toBe('700');
    expect(root.style.fontStyle).toBe('italic');
    expect(root.style.textDecoration).toBe('line-through');
  });

  it('sentence-cases text', () => {
    const { root } = renderRoot(def, { props: { format: { textTransform: 'sentenceCase' } }, text: 'hELLO wORLD' });
    expect(root.textContent).toBe('Hello world');
  });

  it('supports boolean and object truncate forms', () => {
    const a = renderRoot(def, { props: { truncate: true }, text: 'A long sentence' });
    expect(a.root).toHaveClass('hsp-truncate');
    expect(a.root.title).toBe('A long sentence');
    cleanup();
    const b = renderRoot(def, { props: { truncate: { maxWidth: 120, tooltipText: 'Full text' } }, text: 'A long sentence' });
    expect(b.root).toHaveClass('hsp-truncate');
    expect(b.root.style.maxWidth).toBe('120px');
    expect(b.root.title).toBe('Full text');
  });
});

describe('Heading preview', () => {
  const def = byType('Heading');
  it('renders a block heading or an inline span', () => {
    expect(renderRoot(def, { text: 'Deals' }).root.tagName).toBe('H2');
    cleanup();
    const { root } = renderRoot(def, { props: { inline: true }, text: 'Deals' });
    expect(root.tagName).toBe('SPAN');
    expect(root).toHaveTextContent('Deals');
  });
});

describe('Image preview', () => {
  const def = byType('Image');

  it('fires onClick with an ExtensionEvent-like object in preview mode', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(def, { mode: 'preview', trigger });
    fireEvent.click(root);
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click', id: 'n_test' }));
  });

  it('renders a new-tab anchor for href only in preview mode', () => {
    const live = renderRoot(def, { mode: 'preview', props: { src: 'https://x.test/a.png', href: { url: 'https://hubspot.com', external: true } } });
    expect(live.root.tagName).toBe('A');
    expect(live.root.getAttribute('href')).toBe('https://hubspot.com');
    expect(live.root.getAttribute('target')).toBe('_blank');
    cleanup();
    const design = renderRoot(def, { mode: 'design', props: { src: 'https://x.test/a.png', href: 'https://hubspot.com' } });
    expect(design.root.tagName).toBe('SPAN');
  });

  it('applies width/height and falls back to a placeholder when the image fails', () => {
    const { root } = renderRoot(def, { props: { src: 'https://x.test/missing.png', alt: 'Logo', width: 150, height: 90 } });
    const img = root.querySelector('img') as HTMLImageElement;
    expect(img.style.width).toBe('150px');
    expect(img.style.height).toBe('90px');
    fireEvent.error(img);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[role="img"]')).toHaveAttribute('aria-label', 'Logo');
  });

  it('shows a placeholder when no src is set', () => {
    const { root } = renderRoot(def, { props: {} });
    expect(root).toHaveTextContent('Set an image source');
  });
});

describe('Icon preview', () => {
  const def = byType('Icon');

  it('renders a glyph for every HubSpot icon name', () => {
    for (const name of ICON_NAMES) {
      const { root } = renderRoot(def, { props: { name } });
      expect(root.querySelector('svg'), name).not.toBeNull();
      cleanup();
    }
  });

  it('renders a fallback glyph for unknown names', () => {
    const { root } = renderRoot(def, { props: { name: 'notAnIcon' } });
    expect(root.querySelector('svg')).not.toBeNull();
  });

  it('applies size, color and screen reader text', () => {
    const { root } = renderRoot(def, { props: { name: 'warning', size: 'lg', color: 'alert', screenReaderText: 'Warning' } });
    expect(root.style.fontSize).toBe('24px');
    expect(root).toHaveClass('hsp-icon-alert');
    expect(root).toHaveAttribute('role', 'img');
    expect(root).toHaveAttribute('aria-label', 'Warning');
  });
});

describe('Illustration preview', () => {
  const def = byType('Illustration');
  const nameProp = def.props.find((p) => p.name === 'name') as PropDef;

  it('offers exactly the IllustrationNames keys', () => {
    const source = readDts('Illustration');
    const block = source.slice(source.indexOf('export declare const illustrationNames'));
    const keys = [...block.slice(0, block.indexOf('};')).matchAll(/readonly (\w+):/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(30);
    expect(enumValues(nameProp)).toEqual(keys);
  });

  it('draws every illustration with its alt text', () => {
    for (const name of enumValues(nameProp)) {
      const { root } = renderRoot(def, { props: { name, alt: `Alt ${String(name)}` } });
      expect(root).toHaveAttribute('aria-label', `Alt ${String(name)}`);
      // Background (5 shapes) plus the motif itself.
      expect(root.querySelectorAll('svg *').length, String(name)).toBeGreaterThan(6);
      cleanup();
    }
  });

  it('sizes the artwork from width/height', () => {
    const svg = (props: Record<string, unknown>) => {
      const { root } = renderRoot(def, { props: { name: 'lock', alt: 'Lock', ...props } });
      const el = root.querySelector('svg') as SVGElement;
      const size = [el.getAttribute('width'), el.getAttribute('height')];
      cleanup();
      return size;
    };
    expect(svg({ width: 200 })).toEqual(['200', '150']);
    expect(svg({ height: 90 })).toEqual(['120', '90']);
    expect(svg({ width: 100, height: 100 })).toEqual(['100', '100']);
  });
});

describe('List preview', () => {
  const def = byType('List');

  it('renders children as items and reflects the variant', () => {
    const { root } = renderRoot(def, {
      props: { variant: 'ordered-styled' },
      children: (
        <>
          <p data-testid="a">One</p>
          <p data-testid="b">Two</p>
        </>
      ),
    });
    expect(root).toHaveClass('hsp-list', 'hsp-list-ordered-styled');
    expect(root.children).toHaveLength(2);
    expect(root).toHaveTextContent('OneTwo');
  });

  it('defaults to the plain unordered variant', () => {
    const { root } = renderRoot(def, { props: {} });
    expect(root).toHaveClass('hsp-list-unordered');
  });
});

describe('Tag preview', () => {
  const def = byType('Tag');

  it('fires onClick and reflects variant/inline', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(def, { mode: 'preview', props: { variant: 'success', inline: true }, text: 'Customer', trigger });
    expect(root).toHaveClass('hsp-tag-success', 'hsp-tag-inline');
    expect(root).toHaveTextContent('Customer');
    fireEvent.click(root);
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ type: 'click', id: 'n_test' }));
  });

  it('is a keyboard-activatable button when it has a click handler', () => {
    const trigger = vi.fn();
    const root = renderWithNode(def, { id: 'n_tag', type: 'Tag', props: {}, children: [], events: { onClick: [LOG_STEP] } }, trigger);
    expect(root).toHaveAttribute('role', 'button');
    expect(root).toHaveClass('hsp-clickable');
    fireEvent.keyDown(root, { key: 'Enter' });
    expect(trigger).toHaveBeenCalledWith('onClick', expect.objectContaining({ id: 'n_tag' }));
  });

  it('is clickable-styled when an overlay is attached', () => {
    const root = renderWithNode(def, { id: 'n_tag', type: 'Tag', props: {}, children: [], slots: { overlay: ['n_modal'] } }, vi.fn());
    expect(root).toHaveClass('hsp-clickable');
  });
});

describe('StatusTag preview', () => {
  const def = byType('StatusTag');

  it('fires onClick without arguments', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(def, { mode: 'preview', trigger });
    fireEvent.click(root);
    expect(trigger).toHaveBeenCalledWith('onClick');
  });

  it('fires only onRemoveClick from the remove icon', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(def, { mode: 'preview', props: { showRemoveIcon: true, hollow: true, variant: 'danger' }, trigger });
    expect(root).toHaveClass('hsp-status-hollow', 'hsp-status-danger');
    fireEvent.click(root.querySelector('button') as HTMLButtonElement);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('onRemoveClick');
  });
});

describe('Tooltip preview', () => {
  const def = byType('Tooltip');

  it('is slot-only text content with a placement', () => {
    expect(def.slotOnly).toBe(true);
    expect(def.children.mode).toBe('text');
    const { root } = renderRoot(def, { props: { placement: 'left' }, text: 'More info' });
    expect(root).toHaveClass('hsp-tooltip-left');
    expect(root).toHaveTextContent('More info');
    cleanup();
    expect(renderRoot(def, { props: {} }).root).toHaveClass('hsp-tooltip-top');
  });
});
