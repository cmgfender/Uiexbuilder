/**
 * Import normaliser for builder documents (`.uiex.json`, autosaved projects).
 *
 * A document can come from anywhere — a newer builder version, a hand-edited file, a corrupted
 * save — so nothing is trusted to have the right shape. `normalizeProject` checks every field the
 * editor, runtime and code generator read:
 *  - repairs what can be repaired safely (missing optional lists, wrong primitive types, unknown
 *    enum values that have a sensible default, ids that differ from their map key, duplicate
 *    extension ids, unreachable nodes) and reports each repair in plain language;
 *  - rejects what cannot (wrong schema version, no extensions, a node graph that is not a tree:
 *    cycles, a node used twice, the root used as a child, missing children, absurd nesting).
 *
 * Valid documents come back unchanged (deep-equal to the input): no field is added or removed.
 */
import { defaultMockData } from './factory';
import { newId, toPascalCase, toUid } from './ids';
import {
  ROOT_TYPE,
  type ActionStep,
  type AppConfig,
  type AppFunction,
  type CardLocation,
  type ComputedValue,
  type DataSource,
  type Extension,
  type ExtensionKind,
  type HttpMethod,
  type PlatformVersion,
  type PreviewMockData,
  type Project,
  type StateVar,
  type StateVarType,
  type UINode,
} from './types';

/** Deepest node nesting accepted on import (real cards stay far below this). */
export const MAX_NODE_DEPTH = 200;

export type NormalizeResult =
  | { ok: true; project: Project; repairs: string[] }
  | { ok: false; error: string };

const PLATFORM_VERSIONS: PlatformVersion[] = ['2025.2', '2026.03', '2026.09'];
const KINDS: ExtensionKind[] = ['card', 'settings', 'home'];
const CARD_LOCATIONS: CardLocation[] = ['crm.record.tab', 'crm.record.sidebar', 'crm.preview', 'helpdesk.sidebar'];
const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const STATE_TYPES: StateVarType[] = ['string', 'number', 'boolean', 'array', 'object', 'any'];
const DATA_SOURCE_KINDS: Array<DataSource['kind']> = ['crmProperties', 'associations', 'crmSearch', 'fetch', 'function'];
const SIMULATIONS = ['ok', 'loading', 'empty', 'error'];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Rejected extends Error {}

/** Repairs collected while normalising (deduplicated, in order). */
class Repairs {
  readonly list: string[] = [];
  add(message: string): void {
    if (!this.list.includes(message)) this.list.push(message);
  }
}

function label(ext: Obj, index: number): string {
  return typeof ext.name === 'string' && ext.name.trim() ? `“${ext.name.trim()}”` : `#${index + 1}`;
}

/** A string field: kept when it is a string, numbers/booleans are converted, else `fallback`. */
function str(o: Obj, key: string, fallback: string, r: Repairs, where: string): string {
  const v = o[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') {
    r.add(`${where}: ${key} was converted to text.`);
    return String(v);
  }
  r.add(v === undefined ? `${where}: ${key} was missing.` : `${where}: ${key} had an invalid value and was reset.`);
  return fallback;
}

/** An optional string field: deleted when it has another type. */
function optStr(o: Obj, key: string, r: Repairs, where: string): void {
  const v = o[key];
  if (v === undefined || typeof v === 'string') return;
  if (typeof v === 'number' || typeof v === 'boolean') {
    o[key] = String(v);
    r.add(`${where}: ${key} was converted to text.`);
    return;
  }
  delete o[key];
  r.add(`${where}: an invalid ${key} was removed.`);
}

function optBool(o: Obj, key: string, r: Repairs, where: string): void {
  const v = o[key];
  if (v === undefined || typeof v === 'boolean') return;
  delete o[key];
  r.add(`${where}: an invalid ${key} was removed.`);
}

/** A list of strings (a single string becomes a one-item list; other items are dropped). */
function strList(v: unknown, r: Repairs, where: string, fallback: string[] = []): string[] {
  if (Array.isArray(v)) {
    const out = v.filter((x): x is string => typeof x === 'string');
    if (out.length !== v.length) r.add(`${where}: entries that are not text were removed.`);
    return out;
  }
  if (typeof v === 'string') {
    r.add(`${where}: a single value was turned into a list.`);
    return [v];
  }
  r.add(v === undefined ? `${where}: the list was missing.` : `${where}: an invalid list was reset.`);
  return [...fallback];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T, r: Repairs, message: string): T {
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  r.add(message);
  return fallback;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// App & functions
// ---------------------------------------------------------------------------

function normalizeApp(raw: unknown, r: Repairs): AppConfig {
  if (!isObj(raw)) throw new Rejected('Missing app configuration');
  const where = 'App settings';
  const name = str(raw, 'name', 'My UI Extensions App', r, where);
  const urls = isObj(raw.permittedUrls) ? raw.permittedUrls : {};
  if (!isObj(raw.permittedUrls)) r.add(`${where}: permitted URLs were missing and were reset.`);
  const support = isObj(raw.support) ? raw.support : {};
  if (raw.support !== undefined && !isObj(raw.support)) r.add(`${where}: support details were invalid and were reset.`);
  const supportStr = (key: string) => (typeof support[key] === 'string' ? (support[key] as string) : '');
  const app: AppConfig = {
    ...(raw as unknown as AppConfig),
    uid: str(raw, 'uid', toUid(name, 'my_app'), r, where),
    name,
    description: str(raw, 'description', '', r, where),
    distribution: oneOf(raw.distribution, ['private', 'marketplace'] as const, 'private', r, `${where}: distribution was reset to private.`),
    authType: oneOf(raw.authType, ['static', 'oauth'] as const, 'static', r, `${where}: auth type was reset to static.`),
    redirectUrls: strList(raw.redirectUrls, r, `${where} › redirect URLs`),
    requiredScopes: strList(raw.requiredScopes, r, `${where} › required scopes`, ['oauth']),
    optionalScopes: strList(raw.optionalScopes, r, `${where} › optional scopes`),
    conditionallyRequiredScopes: strList(raw.conditionallyRequiredScopes, r, `${where} › conditionally required scopes`),
    permittedUrls: {
      fetch: strList(urls.fetch, r, `${where} › permitted fetch URLs`),
      iframe: strList(urls.iframe, r, `${where} › permitted iframe URLs`),
      img: strList(urls.img, r, `${where} › permitted image URLs`),
    },
    support: {
      supportEmail: supportStr('supportEmail'),
      documentationUrl: supportStr('documentationUrl'),
      supportUrl: supportStr('supportUrl'),
      supportPhone: supportStr('supportPhone'),
    },
  };
  return app;
}

function normalizeFunctions(raw: unknown, r: Repairs): AppFunction[] {
  if (!Array.isArray(raw)) throw new Rejected('Missing functions array');
  const out: AppFunction[] = [];
  const ids = new Set<string>();
  raw.forEach((f, i) => {
    if (!isObj(f)) {
      r.add(`App function #${i + 1} was not valid and was removed.`);
      return;
    }
    const where = `App function ${typeof f.uid === 'string' ? `“${f.uid}”` : `#${i + 1}`}`;
    let id = typeof f.id === 'string' && f.id ? f.id : '';
    if (!id || ids.has(id)) {
      id = newId('f');
      r.add(`${where}: it was given a new id.`);
    }
    ids.add(id);
    const fileName = str(f, 'fileName', '', r, where);
    const fn: AppFunction = {
      ...(f as unknown as AppFunction),
      id,
      uid: str(f, 'uid', toUid(fileName || 'function', 'function'), r, where),
      fileName: fileName || `function${i + 1}`,
      code: str(f, 'code', '', r, where),
      secretKeys: strList(f.secretKeys, r, `${where} › secret keys`),
    };
    if (f.endpoint !== undefined) {
      if (isObj(f.endpoint) && typeof f.endpoint.path === 'string') {
        const methods = Array.isArray(f.endpoint.methods)
          ? f.endpoint.methods.filter((m): m is HttpMethod => HTTP_METHODS.includes(m as HttpMethod))
          : [];
        fn.endpoint = { path: f.endpoint.path, methods: methods.length ? methods : ['GET'] };
      } else {
        delete fn.endpoint;
        r.add(`${where}: an invalid endpoint was removed.`);
      }
    }
    out.push(fn);
  });
  return out;
}

// ---------------------------------------------------------------------------
// State, data sources, computed values, mock data
// ---------------------------------------------------------------------------

function normalizeState(raw: unknown, r: Repairs, where: string): StateVar[] {
  if (!Array.isArray(raw)) throw new Rejected(`${where} is missing its state variables`);
  const out: StateVar[] = [];
  raw.forEach((s, i) => {
    if (!isObj(s) || typeof s.name !== 'string') {
      r.add(`${where}: state variable #${i + 1} was not valid and was removed.`);
      return;
    }
    const v = { ...(s as unknown as StateVar) };
    if (typeof v.id !== 'string' || !v.id) v.id = newId('s');
    v.type = oneOf(s.type, STATE_TYPES, 'any', r, `${where}: state variable “${s.name}” had an unknown type and is now “any”.`);
    if (s.initial === undefined) v.initial = null;
    optStr(v as unknown as Obj, 'description', r, `${where} › ${s.name}`);
    out.push(v);
  });
  return out;
}

function normalizeHeaders(o: Obj, r: Repairs, where: string): void {
  if (o.headers === undefined) return;
  if (!Array.isArray(o.headers)) {
    delete o.headers;
    r.add(`${where}: invalid request headers were removed.`);
    return;
  }
  const list = o.headers.filter((h) => isObj(h) && typeof h.key === 'string' && typeof h.value === 'string');
  if (list.length !== o.headers.length) r.add(`${where}: invalid request headers were removed.`);
  o.headers = list.map((h) => ({ key: (h as Obj).key, value: (h as Obj).value }));
}

function normalizeTimeout(o: Obj, r: Repairs, where: string): void {
  if (o.timeout === undefined) return;
  if (typeof o.timeout !== 'number' || !Number.isFinite(o.timeout) || o.timeout <= 0) {
    delete o.timeout;
    r.add(`${where}: an invalid timeout was removed.`);
  }
}

function normalizeDataSources(raw: unknown, r: Repairs, where: string): DataSource[] {
  if (!Array.isArray(raw)) throw new Rejected(`${where} is missing its data sources`);
  const out: DataSource[] = [];
  raw.forEach((d, i) => {
    if (!isObj(d) || typeof d.name !== 'string' || !DATA_SOURCE_KINDS.includes(d.kind as DataSource['kind'])) {
      r.add(`${where}: data source #${i + 1} was not valid (or of an unknown kind) and was removed.`);
      return;
    }
    const at = `${where} › data source “${d.name}”`;
    const o: Obj = { ...d };
    if (typeof o.id !== 'string' || !o.id) o.id = newId('d');
    optBool(o, 'formatted', r, at);
    switch (d.kind) {
      case 'crmProperties':
        o.properties = strList(d.properties, r, `${at} › properties`);
        break;
      case 'associations':
        o.toObjectType = str(d, 'toObjectType', '0-1', r, at);
        o.properties = strList(d.properties, r, `${at} › properties`);
        o.pageLength = finiteOr(d.pageLength, 10);
        break;
      case 'crmSearch':
        o.objectType = str(d, 'objectType', '0-1', r, at);
        o.properties = strList(d.properties, r, `${at} › properties`);
        optStr(o, 'query', r, at);
        o.filters = (Array.isArray(d.filters) ? d.filters : [])
          .filter(isObj)
          .map((f) => ({ propertyName: str(f, 'propertyName', '', r, at), operator: str(f, 'operator', 'EQ', r, at), value: str(f, 'value', '', r, at) }));
        o.sorts = (Array.isArray(d.sorts) ? d.sorts : [])
          .filter(isObj)
          .map((s) => ({ propertyName: str(s, 'propertyName', '', r, at), direction: s.direction === 'DESCENDING' ? 'DESCENDING' : 'ASCENDING' }));
        o.pageLength = finiteOr(d.pageLength, 10);
        break;
      case 'fetch':
        o.url = str(d, 'url', '', r, at);
        o.method = oneOf(d.method, HTTP_METHODS, 'GET', r, `${at}: the method was reset to GET.`);
        optStr(o, 'body', r, at);
        o.runOnMount = d.runOnMount === true;
        normalizeHeaders(o, r, at);
        normalizeTimeout(o, r, at);
        break;
      case 'function':
        o.functionId = str(d, 'functionId', '', r, at);
        optStr(o, 'parameters', r, at);
        if (d.propertiesToSend !== undefined) o.propertiesToSend = strList(d.propertiesToSend, r, `${at} › properties to send`);
        o.runOnMount = d.runOnMount === true;
        break;
    }
    out.push(o as unknown as DataSource);
  });
  return out;
}

function normalizeComputed(ext: Obj, r: Repairs, where: string): void {
  if (ext.computed === undefined) return;
  if (!Array.isArray(ext.computed)) {
    delete ext.computed;
    r.add(`${where}: invalid computed values were removed.`);
    return;
  }
  const list: ComputedValue[] = [];
  ext.computed.forEach((c, i) => {
    if (!isObj(c) || typeof c.name !== 'string') {
      r.add(`${where}: computed value #${i + 1} was not valid and was removed.`);
      return;
    }
    const v: Obj = { ...c, id: typeof c.id === 'string' && c.id ? c.id : `c_${newId('n').slice(2)}`, expr: str(c, 'expr', '', r, where) };
    optStr(v, 'description', r, where);
    list.push(v as unknown as ComputedValue);
  });
  ext.computed = list;
}

function normalizeMock(raw: unknown, r: Repairs, where: string): PreviewMockData {
  if (!isObj(raw)) throw new Rejected(`${where} is missing its mock data`);
  const defaults = defaultMockData();
  const mock: Obj = { ...raw };
  const ctx = isObj(raw.context) ? raw.context : {};
  if (!isObj(raw.context)) r.add(`${where}: the mock context was missing and was reset.`);
  const part = <T extends Obj>(value: unknown, fallback: T, name: string): T => {
    if (!isObj(value)) {
      if (value !== undefined || isObj(raw.context)) r.add(`${where}: the mock ${name} was reset.`);
      return { ...fallback };
    }
    const out: Obj = { ...value };
    for (const [key, def] of Object.entries(fallback)) {
      if (typeof out[key] !== typeof def) {
        out[key] = def;
        r.add(`${where}: the mock ${name} ${key} was reset.`);
      }
    }
    return out as T;
  };
  mock.context = {
    ...ctx,
    user: part(ctx.user, defaults.context.user, 'user'),
    portal: part(ctx.portal, defaults.context.portal, 'portal'),
    crm: part(ctx.crm, defaults.context.crm, 'record'),
  };
  if (!isObj(raw.properties)) {
    mock.properties = {};
    if (raw.properties !== undefined) r.add(`${where}: invalid mock properties were reset.`);
    else r.add(`${where}: mock properties were missing.`);
  } else {
    const props: Obj = {};
    for (const [k, v] of Object.entries(raw.properties)) {
      if (typeof v === 'string') props[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') props[k] = String(v);
      else if (v !== null) r.add(`${where}: the mock value of property “${k}” was not text and was removed.`);
    }
    mock.properties = Object.keys(props).length === Object.keys(raw.properties).length ? raw.properties : props;
  }
  for (const key of ['dataSources', 'functions'] as const) {
    if (!isObj(raw[key])) {
      mock[key] = {};
      if (raw[key] !== undefined) r.add(`${where}: invalid mock ${key === 'dataSources' ? 'data' : 'function results'} were reset.`);
    }
  }
  if (mock.simulate !== undefined) {
    if (!isObj(mock.simulate)) {
      delete mock.simulate;
      r.add(`${where}: invalid data simulation settings were removed.`);
    } else {
      const sim: Obj = {};
      for (const [k, v] of Object.entries(mock.simulate)) if (SIMULATIONS.includes(v as string)) sim[k] = v;
      mock.simulate = sim;
    }
  }
  return mock as unknown as PreviewMockData;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function normalizeSteps(raw: unknown, r: Repairs, where: string): ActionStep[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ActionStep[] = [];
  for (const s of raw) {
    if (!isObj(s) || typeof s.type !== 'string') {
      r.add(`${where}: an invalid action step was removed.`);
      continue;
    }
    const step: Obj = { ...s };
    if (typeof step.id !== 'string' || !step.id) step.id = newId('a');
    const ensureStr = (key: string) => {
      if (typeof step[key] !== 'string') {
        if (step[key] !== undefined) r.add(`${where}: an invalid ${key} of a “${s.type}” step was reset.`);
        step[key] = typeof step[key] === 'number' || typeof step[key] === 'boolean' ? String(step[key]) : '';
      }
    };
    const nested = (key: string, required: boolean) => {
      const list = normalizeSteps(step[key], r, where);
      if (list) step[key] = list;
      else if (required) step[key] = [];
      else delete step[key];
    };
    switch (s.type) {
      case 'setState':
        ensureStr('state');
        ensureStr('value');
        break;
      case 'addAlert':
        ensureStr('title');
        ensureStr('message');
        break;
      case 'openIframeModal':
        ensureStr('uri');
        ensureStr('title');
        break;
      case 'closeOverlay':
        ensureStr('overlayNodeId');
        break;
      case 'copyToClipboard':
        ensureStr('text');
        break;
      case 'runDataSource':
        ensureStr('dataSourceId');
        break;
      case 'log':
        ensureStr('message');
        break;
      case 'custom':
        ensureStr('code');
        break;
      case 'if':
        ensureStr('condition');
        nested('then', true);
        nested('else', true);
        break;
      case 'fetch':
        ensureStr('url');
        if (!HTTP_METHODS.includes(step.method as HttpMethod)) step.method = 'GET';
        optStr(step, 'body', r, where);
        optStr(step, 'resultState', r, where);
        normalizeHeaders(step, r, where);
        normalizeTimeout(step, r, where);
        nested('onSuccess', false);
        nested('onError', false);
        break;
      case 'runFunction':
        ensureStr('functionId');
        optStr(step, 'parameters', r, where);
        optStr(step, 'resultState', r, where);
        if (step.propertiesToSend !== undefined) step.propertiesToSend = strList(step.propertiesToSend, r, where);
        nested('onSuccess', false);
        nested('onError', false);
        break;
      default:
        break;
    }
    out.push(step as unknown as ActionStep);
  }
  return out;
}

function normalizeNode(key: string, raw: unknown, r: Repairs, where: string): UINode {
  if (!isObj(raw)) throw new Rejected(`${where}: node ${key} is not an object`);
  if (typeof raw.type !== 'string' || raw.type === '') throw new Rejected(`${where}: node ${key} has no component type`);
  const node: Obj = { ...raw };
  const at = `${where} › ${typeof raw.name === 'string' && raw.name ? raw.name : raw.type}`;
  if (node.id !== key) {
    node.id = key;
    r.add(`${where}: node ${key} had a different id and was re-keyed.`);
  }
  if (!isObj(node.props)) {
    if (node.props !== undefined) r.add(`${at}: invalid props were reset.`);
    node.props = {};
  }
  if (node.children === undefined) node.children = [];
  if (!Array.isArray(node.children) || node.children.some((c) => typeof c !== 'string')) {
    throw new Rejected(`Node ${key} has invalid children`);
  }
  if (node.slots !== undefined) {
    if (!isObj(node.slots)) throw new Rejected(`Node ${key} has invalid slots`);
    for (const ids of Object.values(node.slots)) {
      if (!Array.isArray(ids) || ids.some((c) => typeof c !== 'string')) throw new Rejected(`Node ${key} has invalid slots`);
    }
  }
  optStr(node, 'text', r, at);
  optStr(node, 'name', r, at);
  optStr(node, 'condition', r, at);
  optBool(node, 'locked', r, at);
  optBool(node, 'hiddenInDesigner', r, at);
  if (node.binding !== undefined && !(isObj(node.binding) && typeof node.binding.state === 'string')) {
    delete node.binding;
    r.add(`${at}: an invalid input binding was removed.`);
  }
  if (node.repeat !== undefined) {
    const rep = node.repeat;
    if (isObj(rep) && typeof rep.items === 'string' && typeof rep.itemName === 'string' && typeof rep.indexName === 'string') {
      if (rep.key !== undefined && typeof rep.key !== 'string') {
        node.repeat = { ...rep };
        delete (node.repeat as Obj).key;
        r.add(`${at}: an invalid repeat key was removed.`);
      }
    } else {
      delete node.repeat;
      r.add(`${at}: an invalid repeat was removed.`);
    }
  }
  if (node.events !== undefined) {
    if (!isObj(node.events)) {
      delete node.events;
      r.add(`${at}: invalid event handlers were removed.`);
    } else {
      const events: Obj = {};
      for (const [name, steps] of Object.entries(node.events)) {
        const list = normalizeSteps(steps, r, at);
        if (list) events[name] = list;
        else r.add(`${at}: the invalid ${name} handler was removed.`);
      }
      node.events = events;
    }
  }
  return node as unknown as UINode;
}

/**
 * Enforces the tree invariant from the root: every child id exists, no node is reached twice
 * (cycles, shared nodes, the root used as a child) and nesting stays below MAX_NODE_DEPTH.
 * Returns the reachable node ids.
 */
function checkTree(nodes: Record<string, UINode>, rootId: string, where: string): Set<string> {
  const seen = new Set<string>([rootId]);
  const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (stack.length) {
    const { id, depth } = stack.pop()!;
    const node = nodes[id];
    if (depth > MAX_NODE_DEPTH) throw new Rejected(`${where}: components are nested more than ${MAX_NODE_DEPTH} levels deep`);
    const lists: Array<[string, string[]]> = [['children', node.children]];
    for (const [slot, ids] of Object.entries(node.slots ?? {})) lists.push([`slot ${slot}`, ids]);
    for (const [, ids] of lists) {
      for (const cid of ids) {
        if (!nodes[cid]) throw new Rejected(`Node ${id} references missing child ${cid}`);
        if (cid === rootId) throw new Rejected(`${where}: node ${id} lists the root as its child`);
        if (seen.has(cid)) throw new Rejected(`${where}: node ${cid} appears more than once in the tree (cycle or shared node)`);
        seen.add(cid);
        stack.push({ id: cid, depth: depth + 1 });
      }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Extensions & project
// ---------------------------------------------------------------------------

function normalizeExtension(raw: unknown, index: number, takenIds: Set<string>, r: Repairs): Extension {
  if (!isObj(raw)) throw new Rejected('Invalid extension');
  const where = `Extension ${label(raw, index)}`;
  const ext: Obj = { ...raw };
  let id = typeof ext.id === 'string' && ext.id ? ext.id : '';
  if (!id || takenIds.has(id)) {
    id = newId('e');
    r.add(`${where}: it was given a new id (the old one was missing or used twice).`);
  }
  takenIds.add(id);
  ext.id = id;
  if (ext.kind === undefined) {
    ext.kind = 'card';
    r.add(`${where}: the extension type was missing; it is treated as an app card.`);
  } else if (!KINDS.includes(ext.kind as ExtensionKind)) {
    throw new Rejected(`${where} has an unknown type “${String(ext.kind)}” (expected card, settings or home)`);
  }
  ext.name = str(raw, 'name', ext.kind === 'settings' ? 'Settings' : ext.kind === 'home' ? 'App Home' : 'New Card', r, where);
  ext.uid = str(raw, 'uid', toUid(String(ext.name), String(ext.kind)), r, where);
  ext.fileName = str(raw, 'fileName', toPascalCase(String(ext.name)), r, where);
  if (ext.description !== undefined) optStr(ext, 'description', r, where);
  if (!CARD_LOCATIONS.includes(ext.location as CardLocation)) {
    if (ext.kind === 'card') r.add(`${where}: the card location was missing or unknown and is now the record tab.`);
    ext.location = 'crm.record.tab';
  }
  ext.objectTypes = strList(raw.objectTypes, r, `${where} › object types`, ext.kind === 'card' && raw.objectTypes === undefined ? ['contacts'] : []);
  ext.state = normalizeState(raw.state, r, where);
  ext.dataSources = normalizeDataSources(raw.dataSources, r, where);
  normalizeComputed(ext, r, where);
  optStr(ext, 'helpers', r, where);
  ext.mock = normalizeMock(raw.mock, r, where);

  if (!isObj(raw.nodes)) throw new Rejected(`Extension ${label(raw, index)} has no nodes`);
  const rootId = typeof raw.rootId === 'string' ? raw.rootId : '';
  const nodes: Record<string, UINode> = {};
  for (const [key, node] of Object.entries(raw.nodes)) nodes[key] = normalizeNode(key, node, r, where);
  const root = nodes[rootId];
  if (!root || root.type !== ROOT_TYPE) throw new Rejected(`Extension ${label(raw, index)} has an invalid root`);
  for (const node of Object.values(nodes)) {
    if (node.id !== rootId && node.type === ROOT_TYPE) throw new Rejected(`${where}: node ${node.id} uses the reserved root type`);
  }
  const reachable = checkTree(nodes, rootId, where);
  const unreachable = Object.keys(nodes).filter((k) => !reachable.has(k));
  if (unreachable.length) {
    for (const k of unreachable) delete nodes[k];
    r.add(`${where}: ${unreachable.length} component${unreachable.length === 1 ? ' that was' : 's that were'} not part of the tree ${unreachable.length === 1 ? 'was' : 'were'} removed.`);
  }
  ext.nodes = nodes;
  return ext as unknown as Extension;
}

/**
 * Checks and repairs a parsed builder document (see module comment). The input is not mutated.
 */
export function normalizeProject(data: unknown): NormalizeResult {
  if (!isObj(data)) return { ok: false, error: 'Document is not an object' };
  let copy: Obj;
  try {
    copy = JSON.parse(JSON.stringify(data)) as Obj;
  } catch (e) {
    return { ok: false, error: `Document cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = new Repairs();
  try {
    if (copy.schemaVersion !== 1) throw new Rejected('Unsupported or missing schemaVersion (expected 1)');
    if (typeof copy.id !== 'string' || !copy.id || typeof copy.name !== 'string') throw new Rejected('Missing project id or name');
    const project: Obj = { ...copy };
    if (!PLATFORM_VERSIONS.includes(copy.platformVersion as PlatformVersion)) {
      project.platformVersion = '2026.03';
      r.add('The platform version was missing or unknown and is now 2026.03.');
    }
    const now = new Date().toISOString();
    for (const key of ['createdAt', 'updatedAt'] as const) {
      if (typeof copy[key] !== 'string' || Number.isNaN(Date.parse(copy[key] as string))) {
        project[key] = now;
        if (copy[key] !== undefined) r.add(`The ${key === 'createdAt' ? 'creation' : 'last-modified'} date was invalid and was reset.`);
      }
    }
    project.app = normalizeApp(copy.app, r);
    if (!Array.isArray(copy.extensions) || copy.extensions.length === 0) throw new Rejected('Project has no extensions');
    project.functions = normalizeFunctions(copy.functions, r);
    const takenIds = new Set<string>();
    project.extensions = copy.extensions.map((ext, i) => normalizeExtension(ext, i, takenIds, r));
    return { ok: true, project: project as unknown as Project, repairs: r.list };
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, error: e.message };
    return { ok: false, error: `Document cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}
