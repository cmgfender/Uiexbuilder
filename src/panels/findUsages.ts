/**
 * Where is a state variable / data source used? And renaming it everywhere.
 *
 * Usages are found in every place user code can live: prop expressions and `{{ }}` templates
 * (including nested literal arrays/objects), text, conditions, repeats, two-way bindings, event
 * action steps (recursively), data source definitions and computed values. A name also counts as
 * used through the names it declares (`setX`, `xLoading`, `xError`, ...).
 */
import { nodeLabel, walk } from '../model/tree';
import { getComponent } from '../registry';
import type { ActionStep, DataSource, Extension, PropValue, UINode } from '../model/types';
import { isExpr } from '../model/types';
import { setterOf } from './names';

export interface Usage {
  /** Node id when the usage is on a component. */
  nodeId?: string;
  /** Plain-language location, e.g. `Text: Hello · Text`, `Data source “deals” · URL`. */
  location: string;
  /**
   * Machine-readable field: 'text', 'prop:<name>', 'condition', 'repeat', 'binding',
   * 'event:<name>', 'dataSource:<id>', 'computed:<id>'.
   */
  field: string;
}

/** The identifiers a declaration named `name` can be referenced by. */
export function relatedIdentifiers(name: string): string[] {
  const base = [name, `${name}Loading`, `${name}Error`];
  return [...base, ...base.map(setterOf)];
}

const TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;

function codeUses(code: string | undefined, names: Set<string>): boolean {
  if (!code || typeof code !== 'string') return false;
  const ids = referencedIdentifiers(code);
  for (const n of names) if (ids.has(n)) return true;
  return false;
}

function templateUses(str: string | undefined, names: Set<string>): boolean {
  if (!str || typeof str !== 'string' || !str.includes('{{')) return false;
  for (const m of str.matchAll(TEMPLATE_RE)) if (codeUses(m[1], names)) return true;
  return false;
}

function propValueUses(value: PropValue | undefined, names: Set<string>): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return templateUses(value, names);
  if (isExpr(value)) return codeUses(value.$expr, names);
  if (Array.isArray(value)) return value.some((v) => propValueUses(v, names));
  if (typeof value === 'object') return Object.values(value).some((v) => propValueUses(v, names));
  return false;
}

function stepsUse(steps: ActionStep[] | undefined, names: Set<string>, name: string, dsIds: Set<string>): boolean {
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || typeof s !== 'object') continue;
    switch (s.type) {
      case 'setState':
        if (s.state === name || codeUses(s.value, names)) return true;
        break;
      case 'addAlert':
        if (templateUses(s.title, names) || templateUses(s.message, names)) return true;
        break;
      case 'openIframeModal':
        if (templateUses(s.uri, names) || templateUses(s.title, names)) return true;
        break;
      case 'copyToClipboard':
        if (templateUses(s.text, names)) return true;
        break;
      case 'runDataSource':
        if (dsIds.has(s.dataSourceId)) return true;
        break;
      case 'fetch':
        if (templateUses(s.url, names) || codeUses(s.body, names) || s.resultState === name) return true;
        if (stepsUse(s.onSuccess, names, name, dsIds) || stepsUse(s.onError, names, name, dsIds)) return true;
        break;
      case 'runFunction':
        if (codeUses(s.parameters, names) || s.resultState === name) return true;
        if (stepsUse(s.onSuccess, names, name, dsIds) || stepsUse(s.onError, names, name, dsIds)) return true;
        break;
      case 'log':
        if (templateUses(s.message, names)) return true;
        break;
      case 'if':
        if (codeUses(s.condition, names) || stepsUse(s.then, names, name, dsIds) || stepsUse(s.else, names, name, dsIds)) return true;
        break;
      case 'custom':
        if (codeUses(s.code, names)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

function dataSourceUses(ds: DataSource, names: Set<string>): boolean {
  switch (ds.kind) {
    case 'fetch':
      return templateUses(ds.url, names) || codeUses(ds.body, names);
    case 'function':
      return codeUses(ds.parameters, names);
    case 'crmSearch':
      return templateUses(ds.query, names) || (ds.filters ?? []).some((f) => templateUses(f?.value, names));
    default:
      return false;
  }
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
 * Every place in `ext` that references `name` (or one of the names it declares). The search
 * covers components, data source definitions (other than the named one itself) and computed values.
 */
export function findUsages(ext: Extension, name: string): Usage[] {
  if (!name) return [];
  const names = new Set(relatedIdentifiers(name));
  const self = (ext.dataSources ?? []).filter((d) => d.name === name);
  const dsIds = new Set(self.map((d) => d.id));
  const out: Usage[] = [];
  walk(ext, (node) => {
    if (node.id === ext.rootId) return;
    const title = nodeTitle(node);
    const add = (field: string, what: string) => out.push({ nodeId: node.id, field, location: `${title} · ${what}` });
    if (node.binding?.state === name) add('binding', 'Value binding');
    if (templateUses(node.text, names)) add('text', 'Text');
    for (const [prop, value] of Object.entries(node.props ?? {})) {
      if (propValueUses(value, names)) add(`prop:${prop}`, propLabel(node, prop));
    }
    if (codeUses(node.condition, names)) add('condition', 'Show when');
    if (node.repeat && (codeUses(node.repeat.items, names) || codeUses(node.repeat.key, names))) add('repeat', 'Repeat');
    for (const [event, steps] of Object.entries(node.events ?? {})) {
      if (stepsUse(steps, names, name, dsIds)) add(`event:${event}`, eventLabel(node, event));
    }
  });
  for (const ds of ext.dataSources ?? []) {
    if (ds.name === name) continue;
    if (dataSourceUses(ds, names)) out.push({ field: `dataSource:${ds.id}`, location: `Data source “${ds.name}”` });
  }
  for (const c of ext.computed ?? []) {
    if (c.name === name) continue;
    if (codeUses(c.expr, names)) out.push({ field: `computed:${c.id}`, location: `Computed value “${c.name}”` });
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
export function replaceIdentifiers(code: string, map: Map<string, string>): string {
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

function renameTemplate(str: string, map: Map<string, string>): string {
  if (!str.includes('{{')) return str;
  return str.replace(TEMPLATE_RE, (_m, code: string) => `{{${replaceIdentifiers(code, map)}}}`);
}

function renamePropValue(value: PropValue, map: Map<string, string>): PropValue {
  if (typeof value === 'string') return renameTemplate(value, map);
  if (isExpr(value)) return { $expr: replaceIdentifiers(value.$expr, map) };
  if (Array.isArray(value)) return value.map((v) => renamePropValue(v, map)) as PropValue;
  if (value && typeof value === 'object') {
    const out: Record<string, PropValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = renamePropValue(v, map);
    return out as PropValue;
  }
  return value;
}

/** Renames in place (works on immer drafts). Returns the number of changed fields. */
function renameSteps(steps: ActionStep[] | undefined, map: Map<string, string>, from: string, to: string): number {
  let changed = 0;
  const set = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]) => {
    if (obj[key] !== value) {
      obj[key] = value;
      changed++;
    }
  };
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || typeof s !== 'object') continue;
    switch (s.type) {
      case 'setState':
        if (s.state === from) set(s, 'state', to);
        set(s, 'value', replaceIdentifiers(s.value, map));
        break;
      case 'addAlert':
        set(s, 'title', renameTemplate(s.title ?? '', map));
        set(s, 'message', renameTemplate(s.message ?? '', map));
        break;
      case 'openIframeModal':
        set(s, 'uri', renameTemplate(s.uri ?? '', map));
        set(s, 'title', renameTemplate(s.title ?? '', map));
        break;
      case 'copyToClipboard':
        set(s, 'text', renameTemplate(s.text ?? '', map));
        break;
      case 'fetch':
        set(s, 'url', renameTemplate(s.url ?? '', map));
        if (s.body !== undefined) set(s, 'body', replaceIdentifiers(s.body, map));
        if (s.resultState === from) set(s, 'resultState', to);
        changed += renameSteps(s.onSuccess, map, from, to) + renameSteps(s.onError, map, from, to);
        break;
      case 'runFunction':
        if (s.parameters !== undefined) set(s, 'parameters', replaceIdentifiers(s.parameters, map));
        if (s.resultState === from) set(s, 'resultState', to);
        changed += renameSteps(s.onSuccess, map, from, to) + renameSteps(s.onError, map, from, to);
        break;
      case 'log':
        set(s, 'message', renameTemplate(s.message ?? '', map));
        break;
      case 'if':
        set(s, 'condition', replaceIdentifiers(s.condition, map));
        changed += renameSteps(s.then, map, from, to) + renameSteps(s.else, map, from, to);
        break;
      case 'custom':
        set(s, 'code', replaceIdentifiers(s.code, map));
        break;
      default:
        break;
    }
  }
  return changed;
}

/**
 * Renames every reference to `from` (and the names it declares: setFrom, fromLoading, ...) to
 * `to` across the extension. Mutates `ext` in place (use inside a store commit). Does not rename
 * the declaration itself. Returns the number of changed fields.
 */
export function renameReferences(ext: Extension, from: string, to: string): number {
  if (!from || !to || from === to) return 0;
  const fromIds = relatedIdentifiers(from);
  const toIds = relatedIdentifiers(to);
  const map = new Map(fromIds.map((id, i) => [id, toIds[i]]));
  let changed = 0;
  for (const node of Object.values(ext.nodes)) {
    if (node.binding?.state === from) {
      node.binding.state = to;
      changed++;
    }
    if (typeof node.text === 'string') {
      const next = renameTemplate(node.text, map);
      if (next !== node.text) {
        node.text = next;
        changed++;
      }
    }
    for (const [prop, value] of Object.entries(node.props ?? {})) {
      const next = renamePropValue(value, map);
      if (JSON.stringify(next) !== JSON.stringify(value)) {
        node.props[prop] = next;
        changed++;
      }
    }
    if (typeof node.condition === 'string') {
      const next = replaceIdentifiers(node.condition, map);
      if (next !== node.condition) {
        node.condition = next;
        changed++;
      }
    }
    if (node.repeat) {
      const items = replaceIdentifiers(node.repeat.items, map);
      const key = node.repeat.key !== undefined ? replaceIdentifiers(node.repeat.key, map) : undefined;
      if (items !== node.repeat.items) {
        node.repeat.items = items;
        changed++;
      }
      if (key !== node.repeat.key) {
        node.repeat.key = key;
        changed++;
      }
    }
    for (const steps of Object.values(node.events ?? {})) changed += renameSteps(steps, map, from, to);
  }
  for (const ds of ext.dataSources ?? []) {
    if (ds.kind === 'fetch') {
      const url = renameTemplate(ds.url ?? '', map);
      if (url !== ds.url) {
        ds.url = url;
        changed++;
      }
      if (ds.body !== undefined) {
        const body = replaceIdentifiers(ds.body, map);
        if (body !== ds.body) {
          ds.body = body;
          changed++;
        }
      }
    } else if (ds.kind === 'function' && ds.parameters !== undefined) {
      const params = replaceIdentifiers(ds.parameters, map);
      if (params !== ds.parameters) {
        ds.parameters = params;
        changed++;
      }
    } else if (ds.kind === 'crmSearch') {
      if (ds.query !== undefined) {
        const q = renameTemplate(ds.query, map);
        if (q !== ds.query) {
          ds.query = q;
          changed++;
        }
      }
      for (const f of ds.filters ?? []) {
        const v = renameTemplate(f.value ?? '', map);
        if (v !== f.value) {
          f.value = v;
          changed++;
        }
      }
    }
  }
  for (const c of ext.computed ?? []) {
    const expr = replaceIdentifiers(c.expr, map);
    if (expr !== c.expr) {
      c.expr = expr;
      changed++;
    }
  }
  return changed;
}
