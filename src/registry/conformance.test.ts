/**
 * Registry conformance: mechanically checks the component registry against the installed
 * `@hubspot/ui-extensions` package and the rest of the builder.
 *
 *  a. Coverage — every component exported by the package (standard and /crm entry points, plus
 *     compound members such as `Dropdown.ButtonItem`) is registered, except an explicit allowlist
 *     of intentionally skipped exports; every registration names a real export.
 *  b. Prop / type conformance — for each component, a card is generated with src/codegen holding
 *     the create() template with every event wired to a log action; a node with only the props
 *     flagged `required` (catches missing required flags); one variant per prop sample (every enum
 *     option, booleans, numbers, strings, URLs, icons, option lists, string lists, dates, times,
 *     JSON templates and objects); props set while hidden by `visibleWhen` (codegen must drop
 *     them); every slot filled with each overlay it accepts; and a value-bound node. All cards are
 *     type-checked (strict) against the real package; zero diagnostics are allowed.
 *  c. Runtime smoke — every create() template renders through RuntimeProvider + ExtensionRenderer
 *     in design and preview mode without errors, and every rendered data-node-id is a real node.
 *  d. Placement sanity — canAccept() agrees with the declared parents / slots / overlay rules.
 *
 * When a check fails, fix the registry (prop names, enum values, types, templates) or codegen —
 * the samples below are derived from the registry's own PropTypes and describe valid documents.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateExtensionSource } from '../codegen';
import { placeTemplate, templateFor } from '../codegen/fixtures';
import { createExtension, createProject } from '../model/factory';
import { canAccept, isAvailableIn } from '../model/rules';
import { collectSubtree } from '../model/tree';
import type { ActionStep, Extension, JsonValue, NodeId, NodeTemplate, PropValue, Project, StateVar } from '../model/types';
import { NodeRenderer } from '../runtime';
import { makeDoc, renderDoc } from '../runtime/testing';
import { formatDiagnostics, REPO_ROOT, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import { ALL_COMPONENTS, getComponent } from './index';
import { ICON_NAMES } from './constants';
import type { ComponentDef, EventDef, PropDef, PropType } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PACKAGE_DIST = path.join(REPO_ROOT, 'node_modules', '@hubspot', 'ui-extensions', 'dist');
const STANDARD_ENTRY = '@hubspot/ui-extensions';
const CRM_ENTRY = '@hubspot/ui-extensions/crm';

// ---------------------------------------------------------------------------
// a. Coverage
// ---------------------------------------------------------------------------

/**
 * Exports of the package that are intentionally not offered in the builder, with the reason.
 * Keep this list short: anything stable and documented belongs in the registry.
 */
const SKIPPED_EXPORTS: Record<string, string> = {
  Card: 'Deprecated legacy container; HubSpot renders every card in its own card chrome.',
  Stack: 'Deprecated in favour of Flex ("@deprecated use Flex instead").',
  Textarea: 'Deprecated alias of TextArea ("@deprecated use TextArea instead").',
};

/** Component names re-exported from remoteComponents by an entry point's index.d.ts. */
function remoteComponentExports(indexFile: string): string[] {
  const source = readFileSync(indexFile, 'utf8');
  const names: string[] = [];
  const re = /export\s*\{([^}]*)\}\s*from\s*['"][^'"]*remoteComponents\.synced(?:\.tsx|\.ts|\.js)?['"]/g;
  for (const match of source.matchAll(re)) {
    for (const entry of match[1].split(',')) {
      const spec = entry.trim();
      if (!spec) continue;
      // `Local as Exported` re-exports under the exported name.
      const parts = spec.split(/\s+as\s+/);
      names.push(parts[parts.length - 1].trim());
    }
  }
  return names;
}

/**
 * Compound members declared on an exported component (`export declare const Dropdown: ... & {
 * ButtonItem: HubSpotReactComponent<...> }`), as dotted names like 'Dropdown.ButtonItem'.
 */
function compoundMembers(remoteComponentsSource: string, exported: string[]): string[] {
  const out: string[] = [];
  const declarations = remoteComponentsSource.split(/(?=^export declare const )/m);
  for (const decl of declarations) {
    const head = /^export declare const (\w+):/.exec(decl);
    if (!head || !exported.includes(head[1])) continue;
    const body = decl.indexOf('& {');
    if (body === -1) continue;
    for (const member of decl.slice(body).matchAll(/^\s+(\w+):\s*import\([^)]*\)\.HubSpotReactComponent</gm)) {
      out.push(`${head[1]}.${member[1]}`);
    }
  }
  return out;
}

const standardExports = remoteComponentExports(path.join(PACKAGE_DIST, 'index.d.ts'));
const crmExports = remoteComponentExports(path.join(PACKAGE_DIST, 'crm', 'index.d.ts'));
const remoteSource = readFileSync(path.join(PACKAGE_DIST, 'shared.synced', 'remoteComponents.synced.d.ts'), 'utf8');
const compoundExports = compoundMembers(remoteSource, standardExports);

/** The identifier a registration imports (namespace for compound types). */
const importNameOf = (def: ComponentDef) => def.importName ?? def.type.split('.')[0];

describe('a. coverage of the package exports', () => {
  it('parses the export lists of both entry points', () => {
    expect(standardExports.length).toBeGreaterThan(50);
    expect(crmExports.length).toBeGreaterThan(10);
    expect(standardExports).toContain('Button');
    expect(crmExports).toContain('CrmActionButton');
    expect(compoundExports).toContain('Dropdown.ButtonItem');
  });

  it('registers every exported standard component (except the allowlist)', () => {
    const missing = standardExports.filter((name) => {
      if (SKIPPED_EXPORTS[name]) return false;
      const def = getComponent(name);
      return !def || def.importFrom !== STANDARD_ENTRY;
    });
    expect(missing).toEqual([]);
  });

  it('registers every exported CRM component from the /crm entry point', () => {
    const missing = crmExports.filter((name) => {
      if (SKIPPED_EXPORTS[name]) return false;
      const def = getComponent(name);
      return !def || def.importFrom !== CRM_ENTRY;
    });
    expect(missing).toEqual([]);
  });

  it('registers every compound member, imported through its namespace', () => {
    for (const type of compoundExports) {
      const def = getComponent(type);
      expect(def, `${type} is registered`).toBeDefined();
      expect(importNameOf(def!)).toBe(type.split('.')[0]);
    }
    const buttonItem = getComponent('Dropdown.ButtonItem');
    expect(buttonItem?.importName).toBe('Dropdown');
    expect(buttonItem?.importFrom).toBe(STANDARD_ENTRY);
  });

  it('keeps the allowlist honest: skipped names are real exports and are not registered', () => {
    for (const name of Object.keys(SKIPPED_EXPORTS)) {
      expect([...standardExports, ...crmExports], `${name} is exported`).toContain(name);
      expect(getComponent(name), `${name} is skipped`).toBeUndefined();
      expect(SKIPPED_EXPORTS[name].length).toBeGreaterThan(10);
    }
  });

  it('only registers real exports of the declared entry point', () => {
    const wrong = ALL_COMPONENTS.filter((def) => {
      const exports = def.importFrom === CRM_ENTRY ? crmExports : standardExports;
      if (!exports.includes(importNameOf(def))) return true;
      if (def.type.includes('.')) return !compoundExports.includes(def.type);
      return def.type !== importNameOf(def);
    }).map((def) => `${def.type} (${def.importFrom})`);
    expect(wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// b. Prop / type conformance of generated code
// ---------------------------------------------------------------------------

/** Sample values for a PropType, as described in the module comment. */
function samples(type: PropType): JsonValue[] {
  switch (type.kind) {
    case 'enum':
      return type.options.map((o) => o.value);
    case 'boolean':
      return [true];
    case 'number':
      return [type.min ?? 1];
    case 'string':
      return ['Sample'];
    case 'href':
      return ['https://example.com'];
    case 'url':
      return ['https://example.com/x.png'];
    case 'icon':
      return [ICON_NAMES[0]];
    case 'options':
      return [[{ label: 'A', value: 'a' }]];
    case 'stringList':
      // Restricted lists (e.g. ChartColor[]) take their allowed values.
      return [type.options ? type.options.slice(0, 2).map((o) => o.value) : ['a', 'b']];
    case 'date':
      return [{ year: 2026, month: 0, date: 15 }];
    case 'time':
      return [{ hours: 9, minutes: 30 }];
    case 'json':
      return type.template === undefined ? [] : [type.template];
    case 'object':
      return objectSamples(type.fields);
  }
}

/** An object with every field's first sample, plus one variant per further sample of each field. */
function objectSamples(fields: PropDef[]): JsonValue[] {
  const perField = fields.map((f) => [f.name, samples(f.type)] as const).filter(([, values]) => values.length > 0);
  const base: Record<string, JsonValue> = Object.fromEntries(perField.map(([name, values]) => [name, values[0]]));
  const out: JsonValue[] = [base];
  for (const [name, values] of perField) {
    for (const value of values.slice(1)) out.push({ ...base, [name]: value });
  }
  return out;
}

type Props = Record<string, PropValue>;

/**
 * Finds a single extra prop value (from the samples of the other props) that makes `predicate`
 * pass, e.g. `paginated: true` for Table `pageCount`. Returns null when none does.
 */
function satisfy(def: ComponentDef, props: Props, predicate: (p: Record<string, unknown>) => boolean, pinned: string[]): Props | null {
  if (predicate(props)) return props;
  for (const other of def.props) {
    if (pinned.includes(other.name)) continue;
    for (const value of samples(other.type)) {
      const candidate = { ...props, [other.name]: value };
      if (predicate(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Makes the props a consistent member of the component's discriminated union, as the inspector
 * would: props hidden by `visibleWhen` are dropped (unless pinned) and props the selected variant
 * requires (`requiredWhen`) get their first sample.
 */
function settle(def: ComponentDef, input: Props, pinned: string[]): Props {
  let props = { ...input };
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (const p of def.props) {
      const present = Object.prototype.hasOwnProperty.call(props, p.name);
      if (present && p.visibleWhen && !p.visibleWhen(props) && !pinned.includes(p.name)) {
        const { [p.name]: _dropped, ...rest } = props;
        props = rest;
        changed = true;
      } else if (!present && p.requiredWhen?.(props)) {
        const [value] = samples(p.type);
        if (value !== undefined) {
          props = { ...props, [p.name]: value };
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return props;
}

let stepCounter = 0;
/** A log step that reads every param of the event, so the generated handler declares them all. */
function logEvent(event: EventDef): ActionStep {
  stepCounter += 1;
  const message = event.params.length ? event.params.map((p) => `{{ ${p.name} }}`).join(' ') : `${event.name} fired`;
  return { id: `a_conf${stepCounter}`, type: 'log', level: 'info', message };
}

interface Variant {
  label: string;
  template: NodeTemplate;
}

/**
 * The create() template, a minimal node, one variant per prop sample / union-only event / slot
 * content, and a value-bound node (with the state variable it binds to).
 */
function conformanceVariants(def: ComponentDef): { variants: Variant[]; states: StateVar[]; problems: string[] } {
  const base = templateFor(def);
  const baseProps: Props = { ...(base.props ?? {}) };
  const variants: Variant[] = [];
  const states: StateVar[] = [];
  const problems: string[] = [];
  const events = (list: EventDef[]) =>
    list.length ? { events: { ...(base.events ?? {}), ...Object.fromEntries(list.map((e) => [e.name, [logEvent(e)]])) } } : {};

  // The template itself, with every event that its props allow.
  const baseEvents = (def.events ?? []).filter((e) => !e.requiredWhen || e.requiredWhen(baseProps));
  variants.push({ label: 'create()', template: { ...base, ...events(baseEvents) } });

  // Only what the registry says TypeScript requires: the props flagged `required` (plus those the
  // selected union variant requires) and children only when `children.required`. Fails when the
  // package requires something the registry does not flag.
  const isRequired = (name: string) => def.props.some((p) => p.name === name && p.required);
  const minimal: NodeTemplate = {
    type: base.type,
    props: settle(def, Object.fromEntries(Object.entries(baseProps).filter(([name]) => isRequired(name))), []),
  };
  if (def.children.mode === 'text') minimal.text = '';
  if (def.children.mode === 'nodes' && def.children.required && base.children) minimal.children = base.children;
  variants.push({ label: 'required props only', template: minimal });

  for (const prop of def.props) {
    const values = samples(prop.type);
    if (values.length === 0) problems.push(`${prop.name}: no sample value for a ${prop.type.kind} prop`);
    for (const value of values) {
      let props: Props | null = { ...baseProps, [prop.name]: value };
      if (prop.visibleWhen) props = satisfy(def, props, prop.visibleWhen, [prop.name]);
      if (!props) {
        problems.push(`${prop.name}: no single prop value makes it visible`);
        continue;
      }
      variants.push({
        label: `${prop.name}=${JSON.stringify(value)}`,
        template: { ...base, props: settle(def, props, [prop.name]) },
      });
    }
    // Set while hidden (it belongs to another union variant): codegen must leave it out.
    const hidden: Props = { ...baseProps, [prop.name]: values[0] };
    if (prop.visibleWhen && values.length > 0 && !prop.visibleWhen(hidden)) {
      variants.push({ label: `${prop.name} set while hidden`, template: { ...base, props: hidden } });
    }
  }

  // Events that only exist in some union variants get a node in such a variant.
  for (const event of (def.events ?? []).filter((e) => !baseEvents.includes(e))) {
    const props = satisfy(def, baseProps, event.requiredWhen!, []);
    if (!props) {
      problems.push(`${event.name}: no single prop value selects a variant that has it`);
      continue;
    }
    const settled = settle(def, props, []);
    variants.push({ label: `${event.name} handler`, template: { ...base, props: settled, ...events([event]) } });
  }

  for (const slot of def.slots ?? []) {
    for (const type of slot.accepts) {
      const content = getComponent(type);
      if (!content) {
        problems.push(`slot ${slot.name}: accepts unknown type ${type}`);
        continue;
      }
      variants.push({
        label: `${slot.name}=<${type}>`,
        template: { ...base, slots: { ...(base.slots ?? {}), [slot.name]: [templateFor(content)] } },
      });
    }
  }
  // Two-way binding: the bound prop is driven by state and the change event sets it.
  const vb = def.valueBinding;
  if (vb) {
    const bindingEvent = def.events?.find((e) => e.name === vb.event);
    // The binding supplies the prop (starting at the state's initial value).
    const withBound: Props = { ...baseProps, [vb.prop]: vb.initial };
    const props = bindingEvent?.requiredWhen ? satisfy(def, withBound, bindingEvent.requiredWhen, [vb.prop]) : withBound;
    if (!props) {
      problems.push(`valueBinding: no single prop value selects a variant with ${vb.event}`);
    } else {
      const { [vb.prop]: _bound, ...rest } = settle(def, props, [vb.prop]);
      states.push({ id: 's_bound', name: 'boundValue', type: vb.stateType, initial: vb.initial });
      variants.push({ label: `${vb.prop} bound to state`, template: { ...base, props: rest, binding: { state: 'boundValue' } } });
    }
  }
  return { variants, states, problems };
}

/** The first extension shape (CRM record tab card, sidebar card, settings, app home) offering `def`. */
function hostExtension(def: ComponentDef, content: NodeTemplate[]): Extension {
  const name = `${def.type.replace(/\W+/g, ' ')} Conformance`;
  const candidates: Extension[] = [
    createExtension({ name, location: 'crm.record.tab', content }),
    createExtension({ name, location: 'crm.record.sidebar', content }),
    createExtension({ name, kind: 'settings', content }),
    createExtension({ name, kind: 'home', content }),
  ];
  const ext = candidates.find((e) => isAvailableIn(def, e));
  if (!ext) throw new Error(`${def.type} is not available in any extension location`);
  return ext;
}

interface ConformanceCase {
  type: string;
  def: ComponentDef;
  file: string;
  source: string;
  variants: string[];
  problems: string[];
}

function buildCase(def: ComponentDef): ConformanceCase {
  const file = `${def.type.replace(/\W+/g, '_')}.tsx`;
  try {
    const { variants, states, problems } = conformanceVariants(def);
    const ext = hostExtension(
      def,
      variants.map((v) => placeTemplate(def, v.template)),
    );
    ext.state = states;
    const project = createProject('Registry Conformance', [ext]);
    const source = generateExtensionSource(project, ext);
    return { type: def.type, def, file, source, variants: variants.map((v) => v.label), problems };
  } catch (error) {
    return { type: def.type, def, file, source: '', variants: [], problems: [`generation failed: ${String(error)}`] };
  }
}

const CASES: ConformanceCase[] = ALL_COMPONENTS.map(buildCase);
const diagnosticsByFile = new Map<string, string>();

describe('b. generated code conforms to the package types', () => {
  beforeAll(() => {
    const dir = scratchDir('registry-conformance');
    const paths = writeFiles(
      dir,
      CASES.filter((c) => c.source).map((c) => ({ path: c.file, contents: c.source })),
    );
    const diagnostics = typecheck(paths);
    for (const c of CASES) {
      const target = path.join(dir, c.file);
      const own = diagnostics.filter((d) => !d.file || path.resolve(d.file.fileName) === target);
      diagnosticsByFile.set(c.file, formatDiagnostics(own));
    }
  }, 180_000);

  it('every json prop has a template value and every PropType yields samples', () => {
    const problems = CASES.flatMap((c) => c.problems.map((p) => `${c.type}.${p}`));
    expect(problems).toEqual([]);
  });

  it('declares value bindings against real props and events', () => {
    for (const def of ALL_COMPONENTS) {
      const vb = def.valueBinding;
      if (!vb) continue;
      expect(def.props.map((p) => p.name), `${def.type} binding prop`).toContain(vb.prop);
      const event = def.events?.find((e) => e.name === vb.event);
      expect(event, `${def.type} binding event ${vb.event}`).toBeDefined();
      expect(event!.params.length, `${def.type} ${vb.event} delivers the value`).toBeGreaterThan(0);
    }
  });

  it.each(CASES.map((c) => [c.type, c] as const))('%s: generated card type-checks with every prop, event and slot', (_type, c) => {
    expect(c.source, 'source generated').not.toBe('');
    expect(diagnosticsByFile.get(c.file), `variants of ${c.type}: ${c.variants.join(', ')}`).toBe('');
    // The generated JSX really carries every prop (codegen did not drop any).
    const tag = c.def.type.split('.').pop()!;
    expect(c.source).toContain(tag);
    const dropped = c.def.props
      .filter((p) => !new RegExp(`[\\s<]${p.name.replace(/[-.]/g, '\\$&')}(?:=|\\s|/?>)`).test(c.source))
      .map((p) => p.name);
    expect(dropped, `${c.type} props missing from the generated code`).toEqual([]);
    for (const event of c.def.events ?? []) expect(c.source, `${c.type}.${event.name}`).toContain(`${event.name}=`);
    for (const slot of c.def.slots ?? []) expect(c.source, `${c.type}.${slot.name}`).toContain(`${slot.name}=`);
  });
});

// ---------------------------------------------------------------------------
// c. Runtime smoke test
// ---------------------------------------------------------------------------

/** Nodes held in slots (overlays, tooltips) and everything below them. */
function slotSubtrees(ext: Extension): Set<NodeId> {
  const out = new Set<NodeId>();
  for (const node of Object.values(ext.nodes)) {
    for (const ids of Object.values(node.slots ?? {})) for (const id of ids) collectSubtree(ext, id).forEach((n) => out.add(n));
  }
  return out;
}

/** Ids referenced by rendered DOM (node elements and drop placeholders). */
function renderedIds(container: HTMLElement): { nodes: string[]; placeholders: string[] } {
  const nodes = Array.from(container.querySelectorAll('[data-node-id]')).map((el) => el.getAttribute('data-node-id')!);
  const placeholders = Array.from(container.querySelectorAll('[data-drop-placeholder-for]')).map(
    (el) => el.getAttribute('data-drop-placeholder-for')!,
  );
  return { nodes, placeholders };
}

function docFor(def: ComponentDef): { project: Project; ext: Extension } {
  const tpl = placeTemplate(def, templateFor(def));
  const { project, ext } = makeDoc([tpl]);
  if (!isAvailableIn(def, ext)) throw new Error(`${def.type} is not available in a record tab card`);
  return { project, ext };
}

describe('c. runtime renders every create() template', () => {
  it.each(ALL_COMPONENTS.map((def) => [def.type, def] as const))('%s renders in design and preview mode', (_type, def) => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    const { project, ext } = docFor(def);
    const inSlots = slotSubtrees(ext);
    const slotRoots = Object.values(ext.nodes).flatMap((n) => Object.values(n.slots ?? {}).flat());

    // Design mode: the card plus the overlay storyboard. Every node is drawn (and so selectable).
    const design = renderDoc(project, ext, {
      mode: 'design',
      extra: slotRoots.map((id) => createElement(NodeRenderer, { key: id, nodeId: id, overlayPresentation: 'inline' })),
    });
    expect(design.container.querySelectorAll('.hsp-rt-error')).toHaveLength(0);
    const designIds = renderedIds(design.container);
    expect(designIds.nodes.filter((id) => !ext.nodes[id])).toEqual([]);
    expect(designIds.placeholders.filter((id) => !ext.nodes[id])).toEqual([]);
    const notDrawn = Object.keys(ext.nodes).filter((id) => id !== ext.rootId && !designIds.nodes.includes(id));
    expect(notDrawn.map((id) => ext.nodes[id].type)).toEqual([]);
    cleanup();

    // Preview mode: the card, then each trigger's overlay opened (Modal / Panel) or hovered (Tooltip).
    const preview = renderDoc(project, ext, { mode: 'preview' });
    expect(preview.container.querySelectorAll('.hsp-rt-error')).toHaveLength(0);
    const previewIds = renderedIds(preview.container);
    expect(previewIds.nodes.filter((id) => !ext.nodes[id])).toEqual([]);
    expect(previewIds.placeholders).toEqual([]);
    const cardNodes = Object.keys(ext.nodes).filter((id) => id !== ext.rootId && !inSlots.has(id));
    expect(cardNodes.some((id) => previewIds.nodes.includes(id)), 'something is drawn').toBe(true);

    for (const trigger of Object.values(ext.nodes)) {
      const overlayIds = trigger.slots?.overlay ?? [];
      for (const overlayId of overlayIds) {
        const overlayDef = getComponent(ext.nodes[overlayId].type)!;
        if (overlayDef.overlay) {
          act(() => preview.api.fireEvent(trigger.id, 'onClick', [{ type: 'click' }]));
          expect(preview.api.openOverlays).toContain(overlayId);
          expect(preview.nodes(overlayId).length, `${overlayDef.type} opened`).toBeGreaterThan(0);
          act(() => preview.api.closeOverlay(overlayId));
        } else {
          const triggerEl = preview.nodes(trigger.id)[0];
          expect(triggerEl, 'tooltip trigger drawn').toBeDefined();
          act(() => {
            fireEvent.mouseEnter(triggerEl);
          });
          expect(preview.container.querySelector('.hsp-rt-tooltip'), `${overlayDef.type} shown on hover`).not.toBeNull();
          act(() => {
            fireEvent.mouseLeave(triggerEl);
          });
        }
      }
    }
    expect(preview.container.querySelectorAll('.hsp-rt-error')).toHaveLength(0);
    expect(renderedIds(preview.container).nodes.filter((id) => !ext.nodes[id])).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// d. Placement sanity
// ---------------------------------------------------------------------------

/** An extension holding `def`'s template (or `tpl`) in a valid position, and the id of that node. */
function extWith(def: ComponentDef, tpl: NodeTemplate = templateFor(def)): { ext: Extension; nodeId: NodeId } {
  const ext = createExtension({ name: 'Placement', content: [placeTemplate(def, { ...tpl, name: 'subject' })] });
  const node = Object.values(ext.nodes).find((n) => n.name === 'subject');
  if (!node) throw new Error(`${def.type} template was not instantiated`);
  return { ext, nodeId: node.id };
}

const overlayLike = ALL_COMPONENTS.filter((def) => def.overlay || def.slotOnly);
const withParents = ALL_COMPONENTS.filter((def) => def.parents && def.parents.length > 0);

describe('d. placement rules agree with the registry', () => {
  it('only references registered types in parents, accepts and slots', () => {
    const unknown: string[] = [];
    for (const def of ALL_COMPONENTS) {
      const refs = [...(def.parents ?? []), ...(def.children.accepts ?? []), ...(def.slots ?? []).flatMap((s) => s.accepts)];
      for (const ref of refs) if (!getComponent(ref)) unknown.push(`${def.type} -> ${ref}`);
    }
    expect(unknown).toEqual([]);
  });

  it.each(withParents.map((def) => [def.type, def] as const))('%s is accepted by each listed parent and rejected at root', (_type, def) => {
    for (const parentType of def.parents!) {
      const parentDef = getComponent(parentType)!;
      const { ext, nodeId } = extWith(parentDef);
      expect(canAccept(ext, nodeId, def.type), `${def.type} in ${parentType}`).toEqual({ ok: true });
      expect(canAccept(ext, ext.rootId, def.type).ok, `${def.type} at root`).toBe(false);
    }
  });

  it('accepts every component without parents at the root of a card where it is available', () => {
    const rejected: string[] = [];
    for (const def of ALL_COMPONENTS) {
      if (def.overlay || def.slotOnly || def.parents?.length) continue;
      const ext = createExtension({ name: 'Root', location: 'crm.record.tab' });
      const result = canAccept(ext, ext.rootId, def.type);
      if (!result.ok) rejected.push(`${def.type}: ${result.reason}`);
    }
    expect(rejected).toEqual([]);
  });

  it('lets every container accept the types it lists', () => {
    const rejected: string[] = [];
    for (const def of ALL_COMPONENTS) {
      for (const childType of def.children.accepts ?? []) {
        const { ext, nodeId } = extWith(def);
        const result = canAccept(ext, nodeId, childType);
        if (!result.ok) rejected.push(`${def.type} > ${childType}: ${result.reason}`);
      }
    }
    expect(rejected).toEqual([]);
  });

  it.each(overlayLike.map((def) => [def.type, def] as const))(
    '%s is rejected at root and in containers but accepted in a Button overlay slot',
    (_type, def) => {
      const ext = createExtension({
        name: 'Overlay host',
        content: [
          { type: 'Button', name: 'trigger', text: 'Open' },
          { type: 'Flex', name: 'container', children: [] },
        ],
      });
      const trigger = Object.values(ext.nodes).find((n) => n.name === 'trigger')!;
      const container = Object.values(ext.nodes).find((n) => n.name === 'container')!;
      expect(canAccept(ext, ext.rootId, def.type).ok).toBe(false);
      expect(canAccept(ext, container.id, def.type).ok).toBe(false);
      expect(canAccept(ext, trigger.id, def.type, 'overlay')).toEqual({ ok: true });
    },
  );

  it('fills a trigger overlay slot at most once', () => {
    for (const def of ALL_COMPONENTS) {
      const slot = def.slots?.find((s) => s.name === 'overlay');
      if (!slot) continue;
      const content = getComponent(slot.accepts[0])!;
      const empty = extWith(def);
      expect(canAccept(empty.ext, empty.nodeId, content.type, 'overlay'), `${def.type} empty slot`).toEqual({ ok: true });
      const full = extWith(def, { ...templateFor(def), slots: { overlay: [templateFor(content)] } });
      expect(canAccept(full.ext, full.nodeId, content.type, 'overlay').ok, `${def.type} full slot`).toBe(slot.max === undefined);
    }
  });
});
