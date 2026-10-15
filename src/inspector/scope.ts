/**
 * Scope listing (what identifiers/paths an expression can use at a node) and the live preview
 * scope used for "= value" previews in the inspector. Pure functions; React hooks live in
 * ./controls.tsx.
 */
import { buildParentIndex } from '../model/tree';
import type { DataSource, Extension, NodeId } from '../model/types';
import { helperNames } from '../power/helpers';
import { evaluate, objectTypeName, setterName, type EvalResult, type Scope } from '../runtime';

export type ScopeVariableKind =
  'state' | 'setter' | 'computed' | 'dataSource' | 'property' | 'helper' | 'context' | 'repeat' | 'param' | 'global';

export interface ScopeVariable {
  /** Text inserted into expressions, e.g. `record.firstname`, `count`, `context.user.email`. */
  name: string;
  kind: ScopeVariableKind;
  /** Short type or description shown in pickers. */
  detail?: string;
}

/** Group labels (VariablePicker) in display order. */
export const SCOPE_KIND_LABELS: Record<ScopeVariableKind, string> = {
  param: 'Event',
  repeat: 'Repeat',
  state: 'State',
  computed: 'Computed',
  dataSource: 'Data',
  property: 'Record properties',
  helper: 'Helpers',
  context: 'Context',
  setter: 'Setters',
  global: 'Custom code',
};

export const SCOPE_KIND_ORDER: ScopeVariableKind[] = [
  'param',
  'repeat',
  'state',
  'computed',
  'dataSource',
  'property',
  'helper',
  'context',
  'setter',
  'global',
];

export const CONTEXT_VARIABLES: ScopeVariable[] = [
  { name: 'context.user.firstName', kind: 'context', detail: 'string' },
  { name: 'context.user.lastName', kind: 'context', detail: 'string' },
  { name: 'context.user.email', kind: 'context', detail: 'string' },
  { name: 'context.user.id', kind: 'context', detail: 'number' },
  { name: 'context.user.locale', kind: 'context', detail: 'string' },
  { name: 'context.portal.id', kind: 'context', detail: 'number' },
  { name: 'context.portal.timezone', kind: 'context', detail: 'string' },
  { name: 'context.crm.objectId', kind: 'context', detail: 'number (current record)' },
  { name: 'context.crm.objectTypeId', kind: 'context', detail: "string, e.g. '0-1'" },
  { name: 'context.location', kind: 'context', detail: 'where the extension renders' },
];

/** Extra names available to custom code actions. */
export const CUSTOM_CODE_GLOBALS: ScopeVariable[] = [
  { name: 'actions.addAlert', kind: 'global', detail: '({ type, title, message })' },
  { name: 'actions.closeOverlay', kind: 'global', detail: '(overlayId)' },
  { name: 'actions.copyTextToClipboard', kind: 'global', detail: '(text)' },
  { name: 'actions.openIframeModal', kind: 'global', detail: '({ uri, title, width, height })' },
  { name: 'actions.refreshObjectProperties', kind: 'global', detail: '()' },
  { name: 'actions.reloadPage', kind: 'global', detail: '()' },
  { name: 'actions.fetchCrmObjectProperties', kind: 'global', detail: '(properties)' },
  { name: 'hubspot.fetch', kind: 'global', detail: '(url, { method, body })' },
  { name: 'hubspot.serverless', kind: 'global', detail: '(functionUid, { parameters })' },
  { name: 'logger.info', kind: 'global', detail: '(...args)' },
  { name: 'logger.warn', kind: 'global', detail: '(...args)' },
  { name: 'logger.error', kind: 'global', detail: '(...args)' },
  { name: 'logger.debug', kind: 'global', detail: '(...args)' },
];

function dataSourceDetail(ds: DataSource): string {
  switch (ds.kind) {
    case 'crmProperties':
      return 'record properties';
    case 'associations':
      return `array of associated ${objectTypeName(ds.toObjectType)}`;
    case 'crmSearch':
      return `array of ${objectTypeName(ds.objectType)} search results`;
    case 'fetch':
      return 'fetch response (JSON)';
    case 'function':
      return 'app function result';
    default:
      return 'data';
  }
}

/** Repeat configs that apply at a node: the node's own and its ancestors' (nearest first). */
export function repeatChain(ext: Extension, nodeId: NodeId | null | undefined): NodeId[] {
  if (!nodeId || !ext.nodes[nodeId]) return [];
  const index = buildParentIndex(ext);
  const out: NodeId[] = [];
  let cur: NodeId | undefined = nodeId;
  const seen = new Set<NodeId>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (ext.nodes[cur]?.repeat) out.push(cur);
    cur = index.get(cur)?.parentId;
  }
  return out;
}

/** Lists identifiers/paths in scope for a node (and optional event params). */
export function listScopeVariables(ext: Extension, nodeId?: NodeId | null, eventParams?: string[]): ScopeVariable[] {
  const vars: ScopeVariable[] = [];
  const seen = new Set<string>();
  const add = (v: ScopeVariable) => {
    if (!v.name || seen.has(v.name)) return;
    seen.add(v.name);
    vars.push(v);
  };
  for (const p of eventParams ?? []) add({ name: p, kind: 'param', detail: 'event parameter' });
  for (const rid of repeatChain(ext, nodeId)) {
    const r = ext.nodes[rid].repeat!;
    if (r.itemName) add({ name: r.itemName, kind: 'repeat', detail: `item of ${r.items || 'repeat'}` });
    if (r.indexName) add({ name: r.indexName, kind: 'repeat', detail: 'index (number)' });
  }
  for (const s of ext.state ?? []) add({ name: s.name, kind: 'state', detail: s.type });
  for (const c of ext.computed ?? []) add({ name: c.name, kind: 'computed', detail: c.description || 'computed value' });
  for (const ds of ext.dataSources ?? []) {
    add({ name: ds.name, kind: 'dataSource', detail: dataSourceDetail(ds) });
    if (ds.kind === 'associations' || ds.kind === 'crmSearch') {
      add({ name: `${ds.name}.length`, kind: 'dataSource', detail: 'number of results' });
    }
    add({ name: `${ds.name}Loading`, kind: 'dataSource', detail: 'boolean' });
    add({ name: `${ds.name}Error`, kind: 'dataSource', detail: 'error message or null' });
  }
  for (const ds of ext.dataSources ?? []) {
    if (ds.kind !== 'crmProperties') continue;
    for (const p of ds.properties ?? []) {
      if (/^[A-Za-z_$][\w$]*$/.test(p)) add({ name: `${ds.name}.${p}`, kind: 'property', detail: 'string | null' });
    }
  }
  for (const h of helperNames(ext.helpers)) add({ name: h, kind: 'helper', detail: 'helper function' });
  for (const c of CONTEXT_VARIABLES) add(c);
  for (const s of ext.state ?? []) add({ name: setterName(s.name), kind: 'setter', detail: `sets ${s.name}` });
  return vars;
}

// ---------------------------------------------------------------------------
// Live preview scope
// ---------------------------------------------------------------------------

const helperCache = new Map<string, Record<string, unknown>>();
const noop = () => undefined;

/** Evaluates helper code once per source text and returns its top-level declarations. */
export function evaluateHelpers(code: string | undefined): Record<string, unknown> {
  if (!code || !code.trim()) return {};
  const cached = helperCache.get(code);
  if (cached) return cached;
  let out: Record<string, unknown> = {};
  const names = helperNames(code);
  if (names.length) {
    try {
      const ret = `return { ${names.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      out = (new Function(`"use strict";\n${code}\n${ret}`)() as Record<string, unknown>) ?? {};
    } catch {
      out = {};
    }
  }
  if (helperCache.size > 50) helperCache.clear();
  helperCache.set(code, out);
  return out;
}

/**
 * The scope used for inspector previews at a node: the runtime base scope with setters
 * neutralised, plus helpers, computed values (when the runtime does not provide them) and the
 * first item of every repeat that applies to the node.
 */
export function buildPreviewScope(ext: Extension, base: Scope, nodeId?: NodeId | null): Scope {
  const scope: Scope = { ...base };
  for (const s of ext.state ?? []) scope[setterName(s.name)] = noop;
  const helpers = evaluateHelpers(ext.helpers);
  for (const [k, v] of Object.entries(helpers)) if (!(k in scope)) scope[k] = v;
  for (const c of ext.computed ?? []) {
    if (c.name in scope) continue;
    const r = safeEvaluate(c.expr, scope);
    scope[c.name] = r && r.ok ? r.value : undefined;
  }
  const chain = repeatChain(ext, nodeId).reverse();
  for (const rid of chain) {
    const r = ext.nodes[rid].repeat!;
    const res = safeEvaluate(r.items, scope);
    const arr = res && res.ok && Array.isArray(res.value) ? res.value : [];
    if (r.itemName) scope[r.itemName] = arr[0];
    if (r.indexName) scope[r.indexName] = 0;
  }
  return scope;
}

const UNSAFE_RES = [
  // Loops can hang the editor.
  /(?<![\w$.])(?:while|for|do)\b/,
  // Dialogs, network, timers, navigation.
  /(?<![\w$.])(?:alert|confirm|prompt|fetch|open|print|close|eval|setTimeout|setInterval|requestAnimationFrame|import)\s*\(/,
  /(?<![\w$.])(?:window|globalThis|self|document|navigator|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|Function)\b/,
  /(?<![\w$.])location\s*(?:\.\s*(?:href|assign|replace|reload)|=)/,
];

/**
 * Evaluates an expression for a live preview. Returns null (no preview) for code that could loop
 * or have side effects in the editor (loops, dialogs, network, navigation, storage).
 */
export function safeEvaluate(code: string, scope: Scope): EvalResult | null {
  const src = code.trim();
  if (!src) return null;
  const code0 = src.replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  if (UNSAFE_RES.some((re) => re.test(code0))) return null;
  return evaluate(src, scope);
}
