/**
 * Where is a state variable / data source / computed value used? And renaming it everywhere.
 *
 * Usages are found in every place user code can live: prop expressions and `{{ }}` templates
 * (including nested literal arrays/objects), text, conditions, repeats, two-way bindings, event
 * action steps (recursively, including request headers), data source definitions and computed
 * values. A name also counts as used through the names it declares (`setX`, `xLoading`, `xError`, ...).
 *
 * Scope: code can only see a declaration when no local name hides it. Locals are the item / index
 * names of enclosing repeats (the node's own repeat for everything but its `items`), an event
 * handler's params (`value`, `event`, ...), `response` in fetch / run-function success steps and
 * `error` in their failure steps — exactly what the runtime and codegen bind. Usages and renames
 * skip shadowed names, and `renameConflicts` lists the places where a new name would be captured
 * by such a local (or by a name the code itself declares).
 */
import { nodeLabel } from '../model/tree';
import { getComponent } from '../registry';
import type { ActionStep, Extension, NodeId, PropValue, UINode } from '../model/types';
import { isExpr } from '../model/types';

export interface Usage {
  /** Node id when the usage is on a component. */
  nodeId?: string;
  /** Plain-language location, e.g. `Text: Hello · Text`, `Data source “deals”`. */
  location: string;
  /**
   * Machine-readable field: 'text', 'prop:<name>', 'condition', 'repeat', 'binding',
   * 'event:<name>', 'dataSource:<id>', 'computed:<id>'.
   */
  field: string;
}

/** `count` -> `setCount` (same rule as names.ts `setterOf`; kept local so names.ts can import this module). */
function setterOf(name: string): string {
  return `set${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** The identifiers a declaration named `name` can be referenced by. */
export function relatedIdentifiers(name: string): string[] {
  const base = [name, `${name}Loading`, `${name}Error`];
  return [...base, ...base.map(setterOf)];
}

const TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// ---------------------------------------------------------------------------
// Sites: every place that refers to declarations, with the local names in scope there
// ---------------------------------------------------------------------------

/** Names that hide extension-level declarations at a site. */
type Locals = ReadonlySet<string>;
const NO_LOCALS: Locals = new Set<string>();

function withLocals(locals: Locals, names: Iterable<string>): Locals {
  let out: Set<string> | null = null;
  for (const n of names) {
    if (!n || locals.has(n) || out?.has(n)) continue;
    out ??= new Set(locals);
    out.add(n);
  }
  return out ?? locals;
}

type Holder = Record<string, unknown>;

interface SiteBase {
  nodeId?: NodeId;
  field: string;
  location: string;
}

/** User code: a JavaScript fragment, a `{{ }}` template string or a prop value (literal or expression). */
interface CodeSite extends SiteBase {
  type: 'code';
  kind: 'code' | 'template' | 'value';
  locals: Locals;
  /** Name of the data source / computed value the site belongs to (a declaration does not use itself). */
  owner?: string;
  holder: Holder;
  key: string;
}

/** A reference by name that is not code: a value binding, a set-variable target, a result state. */
interface NameSite extends SiteBase {
  type: 'name';
  holder: Holder;
  key: string;
}

/** A "Refresh data source" step (refers to the data source by id). */
interface RunSite extends SiteBase {
  type: 'run';
  dataSourceId: string;
}

type Site = CodeSite | NameSite | RunSite;

/** Item / index names a repeat binds, as the exported code binds them (see codegen/jsx). */
export function repeatLocalNames(node: UINode): string[] {
  const r = node.repeat;
  if (!r || typeof r.items !== 'string' || r.items.trim() === '') return [];
  const itemName = typeof r.itemName === 'string' && IDENT_RE.test(r.itemName) ? r.itemName : 'item';
  let indexName = typeof r.indexName === 'string' && IDENT_RE.test(r.indexName) ? r.indexName : 'index';
  if (indexName === itemName) indexName = `${itemName}Index`;
  return [itemName, indexName];
}

/** Params of a component event handler (registry EventDef), e.g. `['value']` for an input's onChange. */
export function eventParamNames(node: UINode, event: string): string[] {
  const def = getComponent(node.type)?.events?.find((e) => e.name === event);
  return (def?.params ?? []).map((p) => p?.name).filter((n): n is string => typeof n === 'string' && n !== '');
}

function nodeTitle(node: UINode): string {
  return nodeLabel(node, getComponent(node.type)?.label);
}

function propLabel(node: UINode, prop: string): string {
  return getComponent(node.type)?.props.find((p) => p.name === prop)?.label ?? prop;
}

function eventLabel(node: UINode, event: string): string {
  return getComponent(node.type)?.events?.find((e) => e.name === event)?.label ?? event;
}

/**
 * Every site of the extension in document order: per node (tree order) binding, text, props,
 * condition, repeat, events; then data sources and computed values. With `includeDetached`,
 * nodes the tree does not reach are included too (with no locals).
 */
function collectSites(ext: Extension, includeDetached: boolean): Site[] {
  const sites: Site[] = [];

  const stepSites = (steps: ActionStep[] | undefined, locals: Locals, base: SiteBase) => {
    const code = (holder: object, key: string, kind: CodeSite['kind'], scope: Locals = locals) =>
      sites.push({ ...base, type: 'code', kind, locals: scope, holder: holder as Holder, key });
    const name = (holder: object, key: string) => sites.push({ ...base, type: 'name', holder: holder as Holder, key });
    for (const s of Array.isArray(steps) ? steps : []) {
      if (!s || typeof s !== 'object') continue;
      switch (s.type) {
        case 'setState':
          name(s, 'state');
          code(s, 'value', 'code');
          break;
        case 'addAlert':
          code(s, 'alertTypeExpr', 'code');
          code(s, 'title', 'template');
          code(s, 'message', 'template');
          break;
        case 'openIframeModal':
          code(s, 'uri', 'template');
          code(s, 'title', 'template');
          break;
        case 'copyToClipboard':
          code(s, 'text', 'template');
          break;
        case 'log':
          code(s, 'message', 'template');
          break;
        case 'runDataSource':
          if (typeof s.dataSourceId === 'string') sites.push({ ...base, type: 'run', dataSourceId: s.dataSourceId });
          break;
        case 'fetch':
          code(s, 'url', 'template');
          for (const h of Array.isArray(s.headers) ? s.headers : []) if (h && typeof h === 'object') code(h, 'value', 'template');
          code(s, 'body', 'code');
          name(s, 'resultState');
          stepSites(s.onSuccess, withLocals(locals, ['response']), base);
          stepSites(s.onError, withLocals(locals, ['error']), base);
          break;
        case 'runFunction':
          code(s, 'parameters', 'code');
          name(s, 'resultState');
          stepSites(s.onSuccess, withLocals(locals, ['response']), base);
          stepSites(s.onError, withLocals(locals, ['error']), base);
          break;
        case 'if':
          code(s, 'condition', 'code');
          stepSites(s.then, locals, base);
          stepSites(s.else, locals, base);
          break;
        case 'custom':
          code(s, 'code', 'code');
          break;
        default:
          break;
      }
    }
  };

  const nodeSites = (node: UINode, outer: Locals) => {
    const inner = withLocals(outer, repeatLocalNames(node));
    const title = nodeTitle(node);
    const at = (field: string, what: string): SiteBase => ({ nodeId: node.id, field, location: `${title} · ${what}` });
    const holder = node as unknown as Holder;
    if (node.binding && typeof node.binding === 'object') {
      sites.push({ ...at('binding', 'Value binding'), type: 'name', holder: node.binding as unknown as Holder, key: 'state' });
    }
    sites.push({ ...at('text', 'Text'), type: 'code', kind: 'template', locals: inner, holder, key: 'text' });
    const props = node.props && typeof node.props === 'object' ? (node.props as Holder) : null;
    for (const prop of Object.keys(props ?? {})) {
      sites.push({ ...at(`prop:${prop}`, propLabel(node, prop)), type: 'code', kind: 'value', locals: inner, holder: props!, key: prop });
    }
    sites.push({ ...at('condition', 'Show when'), type: 'code', kind: 'code', locals: inner, holder, key: 'condition' });
    if (node.repeat && typeof node.repeat === 'object') {
      const repeat = node.repeat as unknown as Holder;
      // The items are evaluated outside the repeat; the key once per item.
      sites.push({ ...at('repeat', 'Repeat'), type: 'code', kind: 'code', locals: outer, holder: repeat, key: 'items' });
      sites.push({ ...at('repeat', 'Repeat'), type: 'code', kind: 'code', locals: inner, holder: repeat, key: 'key' });
    }
    for (const [event, steps] of Object.entries(node.events ?? {})) {
      stepSites(steps, withLocals(inner, eventParamNames(node, event)), at(`event:${event}`, eventLabel(node, event)));
    }
  };

  const visited = new Set<NodeId>();
  const visit = (id: NodeId, outer: Locals) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = ext.nodes?.[id];
    if (!node) return;
    if (id !== ext.rootId) nodeSites(node, outer);
    const inner = withLocals(outer, repeatLocalNames(node));
    for (const c of Array.isArray(node.children) ? node.children : []) visit(c, inner);
    for (const ids of Object.values(node.slots ?? {})) for (const c of Array.isArray(ids) ? ids : []) visit(c, inner);
  };
  visit(ext.rootId, NO_LOCALS);
  if (includeDetached) for (const id of Object.keys(ext.nodes ?? {})) visit(id, NO_LOCALS);

  for (const ds of ext.dataSources ?? []) {
    if (!ds || typeof ds !== 'object') continue;
    const base = { field: `dataSource:${ds.id}`, location: `Data source “${ds.name}”`, owner: ds.name };
    const code = (holder: object, key: string, kind: CodeSite['kind']) =>
      sites.push({ ...base, type: 'code', kind, locals: NO_LOCALS, holder: holder as Holder, key });
    if (ds.kind === 'fetch') {
      code(ds, 'url', 'template');
      for (const h of Array.isArray(ds.headers) ? ds.headers : []) if (h && typeof h === 'object') code(h, 'value', 'template');
      code(ds, 'body', 'code');
    } else if (ds.kind === 'function') {
      code(ds, 'parameters', 'code');
    } else if (ds.kind === 'crmSearch') {
      code(ds, 'query', 'template');
      for (const f of Array.isArray(ds.filters) ? ds.filters : []) if (f && typeof f === 'object') code(f, 'value', 'template');
    }
  }
  for (const c of ext.computed ?? []) {
    if (!c || typeof c !== 'object') continue;
    sites.push({
      type: 'code',
      kind: 'code',
      field: `computed:${c.id}`,
      location: `Computed value “${c.name}”`,
      owner: c.name,
      locals: NO_LOCALS,
      holder: c as unknown as Holder,
      key: 'expr',
    });
  }
  return sites;
}

/** The JavaScript fragments of a code site's current value. */
function siteFragments(kind: CodeSite['kind'], value: unknown): string[] {
  if (kind === 'code') return typeof value === 'string' && value ? [value] : [];
  if (kind === 'template') return templateFragments(value);
  return propValueFragments(value as PropValue);
}

function templateFragments(value: unknown): string[] {
  if (typeof value !== 'string' || !value.includes('{{')) return [];
  return [...value.matchAll(TEMPLATE_RE)].map((m) => m[1]);
}

function propValueFragments(value: PropValue | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return templateFragments(value);
  if (isExpr(value)) return typeof value.$expr === 'string' ? [value.$expr] : [];
  if (Array.isArray(value)) return value.flatMap((v) => propValueFragments(v));
  if (typeof value === 'object') return Object.values(value).flatMap((v) => propValueFragments(v as PropValue));
  return [];
}

/** Whether the code references one of `names` that no local hides. */
function fragmentUses(code: string, names: ReadonlySet<string>, locals: Locals): boolean {
  for (const id of referencedIdentifiers(code)) if (names.has(id) && !locals.has(id)) return true;
  return false;
}

/**
 * Every place in `ext` that references `name` (or one of the names it declares). The search
 * covers components, data source definitions (other than the named one itself) and computed
 * values. Code where a local name (event param, repeat item, `response`, ...) hides `name` does
 * not count.
 */
export function findUsages(ext: Extension, name: string): Usage[] {
  if (!name) return [];
  const names = new Set(relatedIdentifiers(name));
  const dsIds = new Set((ext.dataSources ?? []).filter((d) => d?.name === name).map((d) => d.id));
  const out: Usage[] = [];
  const seen = new Set<string>();
  const add = (site: Site) => {
    const key = `${site.nodeId ?? ''}\n${site.field}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...(site.nodeId ? { nodeId: site.nodeId } : {}), field: site.field, location: site.location });
  };
  for (const site of collectSites(ext, false)) {
    if (site.type === 'run') {
      if (dsIds.has(site.dataSourceId)) add(site);
    } else if (site.type === 'name') {
      if (site.holder[site.key] === name) add(site);
    } else if (site.owner !== name && siteFragments(site.kind, site.holder[site.key]).some((f) => fragmentUses(f, names, site.locals))) {
      add(site);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renaming
// ---------------------------------------------------------------------------

/** An identifier occurrence in code. */
export interface IdentifierToken {
  word: string;
  start: number;
  end: number;
  /**
   * 'ref'       a reference (`count`, `...count`)
   * 'member'    a property name after `.` / `?.` (`record.count`)
   * 'key'       an object literal key (`{ count: 1 }`)
   * 'shorthand' a shorthand property (`{ count }`) — both a key and a reference
   */
  kind: 'ref' | 'member' | 'key' | 'shorthand';
}

const REGEX_AFTER_PUNCT = '(,=:[!&|?{};+-*%<>~^';
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/**
 * Lists identifier tokens of JavaScript code (expressions or statements) with a forgiving
 * tokenizer: strings, comments and regex literals are skipped and template literal `${ }` parts
 * are scanned.
 */
export function scanIdentifiers(code: string): IdentifierToken[] {
  const out: IdentifierToken[] = [];
  if (!code) return out;
  const n = code.length;
  let i = 0;
  /** Open brackets; '${' marks a template expression. */
  const stack: string[] = [];
  let prevSig = '';
  let prevWord = '';

  const skipTemplateText = () => {
    // i is just after a backtick or the `}` closing a `${`.
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        i++;
        prevSig = '`';
        return;
      }
      if (ch === '$' && code[i + 1] === '{') {
        i += 2;
        stack.push('${');
        prevSig = '{';
        return;
      }
      i++;
    }
  };

  const nextSignificant = (from: number): string => {
    let k = from;
    while (k < n && /\s/.test(code[k])) k++;
    return code[k] ?? '';
  };

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < n && code[i] !== ch && code[i] !== '\n') {
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      prevSig = ch;
      continue;
    }
    if (ch === '`') {
      i++;
      skipTemplateText();
      continue;
    }
    if (ch === '/' && (prevSig === '' || REGEX_AFTER_PUNCT.includes(prevSig) || (prevSig === 'a' && REGEX_AFTER_WORD.has(prevWord)))) {
      i++;
      let inClass = false;
      while (i < n && code[i] !== '\n') {
        const c = code[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(code[i])) i++;
      prevSig = '/';
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(code[i])) i++;
      const word = code.slice(start, i);
      let j = start - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      const isMember = j >= 0 && code[j] === '.' && !(j >= 2 && code[j - 1] === '.' && code[j - 2] === '.');
      let kind: IdentifierToken['kind'] = 'ref';
      if (isMember) kind = 'member';
      else if (stack[stack.length - 1] === '{' && (prevSig === '{' || prevSig === ',')) {
        const after = nextSignificant(i);
        if (after === ':') kind = 'key';
        else if (after === ',' || after === '}') kind = 'shorthand';
      }
      out.push({ word, start, end: i, kind });
      prevSig = 'a';
      prevWord = word;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      while (i < n && /[0-9A-Za-z_.]/.test(code[i])) i++;
      prevSig = '0';
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
      i++;
      prevSig = ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      i++;
      if (ch === '}' && top === '${') {
        skipTemplateText();
        continue;
      }
      prevSig = ch;
      continue;
    }
    i++;
    prevSig = ch;
  }
  return out;
}

/** Identifiers the code references (excluding property names and object keys). */
export function referencedIdentifiers(code: string): Set<string> {
  const out = new Set<string>();
  for (const t of scanIdentifiers(code)) if (t.kind === 'ref' || t.kind === 'shorthand') out.add(t.word);
  return out;
}

/**
 * Replaces references to identifiers in JavaScript code. Property names after `.` and object keys
 * are kept, and shorthand properties keep their key (`{ count }` -> `{ count: total }`).
 */
export function replaceIdentifiers(code: string, map: ReadonlyMap<string, string>): string {
  if (!code || map.size === 0) return code;
  let out = '';
  let last = 0;
  for (const t of scanIdentifiers(code)) {
    const replacement = map.get(t.word);
    if (!replacement || t.kind === 'member' || t.kind === 'key') continue;
    out += code.slice(last, t.start) + (t.kind === 'shorthand' ? `${t.word}: ${replacement}` : replacement);
    last = t.end;
  }
  return last === 0 ? code : out + code.slice(last);
}

function renameTemplate(str: string, map: ReadonlyMap<string, string>): string {
  if (!str.includes('{{')) return str;
  return str.replace(TEMPLATE_RE, (_m, code: string) => `{{${replaceIdentifiers(code, map)}}}`);
}

function renamePropValue(value: PropValue, map: ReadonlyMap<string, string>): PropValue {
  if (typeof value === 'string') return renameTemplate(value, map);
  if (isExpr(value)) return typeof value.$expr === 'string' ? { ...value, $expr: replaceIdentifiers(value.$expr, map) } : value;
  if (Array.isArray(value)) return value.map((v) => renamePropValue(v, map)) as PropValue;
  if (value && typeof value === 'object') {
    const out: Record<string, PropValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = renamePropValue(v as PropValue, map);
    return out as PropValue;
  }
  return value;
}

/** The renamed value of a code site, or `undefined` when nothing changes. */
function renameSiteValue(kind: CodeSite['kind'], value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (kind === 'code') {
    if (typeof value !== 'string' || !value) return undefined;
    const next = replaceIdentifiers(value, map);
    return next !== value ? next : undefined;
  }
  if (kind === 'template') {
    if (typeof value !== 'string') return undefined;
    const next = renameTemplate(value, map);
    return next !== value ? next : undefined;
  }
  if (value === null || value === undefined) return undefined;
  const next = renamePropValue(value as PropValue, map);
  return JSON.stringify(next) !== JSON.stringify(value) ? next : undefined;
}

/** `from`'s identifiers mapped to `to`'s (count -> total, setCount -> setTotal, ...). */
function renameMap(from: string, to: string): Map<string, string> {
  const toIds = relatedIdentifiers(to);
  return new Map(relatedIdentifiers(from).map((id, i) => [id, toIds[i]]));
}

/** The map without the names that locals hide at a site. */
function visibleMap(map: Map<string, string>, locals: Locals): Map<string, string> {
  if (locals.size === 0) return map;
  let out: Map<string, string> | null = null;
  for (const k of map.keys()) {
    if (!locals.has(k)) continue;
    out ??= new Map(map);
    out.delete(k);
  }
  return out ?? map;
}

/**
 * Renames every reference to `from` (and the names it declares: setFrom, fromLoading, ...) to
 * `to` across the extension. References hidden by a local name (an event param, a repeat item,
 * `response` / `error`) are left alone. Mutates `ext` in place (use inside a store commit). Does
 * not rename the declaration itself. Returns the number of changed fields.
 */
export function renameReferences(ext: Extension, from: string, to: string): number {
  if (!from || !to || from === to) return 0;
  const map = renameMap(from, to);
  let changed = 0;
  for (const site of collectSites(ext, true)) {
    if (site.type === 'run') continue;
    if (site.type === 'name') {
      if (site.holder[site.key] === from) {
        site.holder[site.key] = to;
        changed++;
      }
      continue;
    }
    const scoped = visibleMap(map, site.locals);
    if (scoped.size === 0) continue;
    const next = renameSiteValue(site.kind, site.holder[site.key], scoped);
    if (next !== undefined) {
      site.holder[site.key] = next;
      changed++;
    }
  }
  return changed;
}

/** A place where renaming would change what the code means. */
export interface RenameConflict extends Usage {
  /** The new name (or one it declares, e.g. `setTo`) that something else already uses there. */
  name: string;
}

/**
 * Places where renaming `from` to `to` would be captured: code that references `from` where `to`
 * (or `setTo`, `toLoading`, ...) is a local name — an event param, a repeat item / index,
 * `response` / `error`, or a name the code itself declares or uses. Renaming there would make
 * the reference point at that other value, so such a rename must be refused.
 */
export function renameConflicts(ext: Extension, from: string, to: string): RenameConflict[] {
  if (!from || !to || from === to) return [];
  const map = renameMap(from, to);
  const toIds = relatedIdentifiers(to);
  const out: RenameConflict[] = [];
  const seen = new Set<string>();
  for (const site of collectSites(ext, false)) {
    if (site.type !== 'code') continue;
    const scoped = visibleMap(map, site.locals);
    if (scoped.size === 0) continue;
    const localHit = toIds.find((id) => site.locals.has(id));
    for (const fragment of siteFragments(site.kind, site.holder[site.key])) {
      const words = scanIdentifiers(fragment)
        .filter((t) => t.kind === 'ref' || t.kind === 'shorthand')
        .map((t) => t.word);
      if (!words.some((w) => scoped.has(w))) continue;
      const hit = localHit ?? toIds.find((id) => words.includes(id));
      if (!hit) continue;
      const key = `${site.nodeId ?? ''}\n${site.field}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ ...(site.nodeId ? { nodeId: site.nodeId } : {}), field: site.field, location: site.location, name: hit });
      }
      break;
    }
  }
  return out;
}

/** Why `from` cannot be renamed to `to` (see renameConflicts), or null. */
export function renameConflictMessage(ext: Extension, from: string, to: string): string | null {
  const conflict = renameConflicts(ext, from, to.trim())[0];
  if (!conflict) return null;
  return `“${conflict.name}” already means something else in ${conflict.location} (where “${from}” is used) — choose another name`;
}
