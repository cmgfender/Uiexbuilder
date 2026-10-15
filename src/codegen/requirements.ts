/**
 * Scopes and permitted URLs a project needs, derived from its extensions.
 *
 * Scopes — read access for every CRM object type the project touches:
 *   card objectTypes, association targets, CRM search object types and the literal
 *   `objectTypeId` props of CRM data components. Mapping (HubSpot scope names):
 *     contacts/companies/deals/line_items/quotes/... -> crm.objects.<type>.read
 *     tickets                                        -> tickets
 *     products                                       -> e-commerce
 *     custom objects (p_<name>, 2-<id>)              -> crm.objects.custom.read
 *   Engagement objects (calls, emails, meetings, notes, tasks) have no dedicated read scope and
 *   unknown types are skipped.
 *
 * Permitted URLs — origins (scheme + host) of statically known URLs:
 *   fetch:  fetch data sources, fetch actions, and `hubspot.fetch('https://…')` calls with a
 *           literal URL in custom code, helper code and computed values
 *   iframe: openIframeModal actions
 *   img:    Image `src` literals
 *   A URL only counts when its host is fixed text, e.g. "https://api.example.com/{{ path }}";
 *   "https://{{ host }}/x" or "https://api.example.com{{ suffix }}" are skipped (see
 *   `urlOriginHint`, which validation uses to explain them).
 */
import { CRM_OBJECT_TYPES } from '../registry/constants';
import { isPropertyName, nextSignificant, tokenize } from '../model/jsTokens';
import { singleExpression, parseTemplate } from '../model/template';
import type { ActionStep, Extension, Project, UINode } from '../model/types';

export interface ProjectRequirements {
  scopes: string[];
  fetch: string[];
  iframe: string[];
  img: string[];
}

/** Object type name (as used by scopes) for ids such as '0-1' and singular / upper-case names. */
const TYPE_ALIASES: Record<string, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  ticket: 'tickets',
  line_item: 'line_items',
  product: 'products',
  quote: 'quotes',
  call: 'calls',
  meeting: 'meetings',
  task: 'tasks',
  note: 'notes',
  email: 'emails',
  invoice: 'invoices',
  order: 'orders',
  cart: 'carts',
  subscription: 'subscriptions',
  lead: 'leads',
  appointment: 'appointments',
  course: 'courses',
  listing: 'listings',
  service: 'services',
  feedback_submission: 'feedback_submissions',
  communication: 'communications',
  postal_mail: 'postal_mail',
  commerce_payment: 'commercepayments',
};

const OBJECT_SCOPES: Record<string, string> = {
  contacts: 'crm.objects.contacts.read',
  companies: 'crm.objects.companies.read',
  deals: 'crm.objects.deals.read',
  tickets: 'tickets',
  line_items: 'crm.objects.line_items.read',
  products: 'e-commerce',
  quotes: 'crm.objects.quotes.read',
  invoices: 'crm.objects.invoices.read',
  orders: 'crm.objects.orders.read',
  carts: 'crm.objects.carts.read',
  subscriptions: 'crm.objects.subscriptions.read',
  leads: 'crm.objects.leads.read',
  appointments: 'crm.objects.appointments.read',
  courses: 'crm.objects.courses.read',
  listings: 'crm.objects.listings.read',
  services: 'crm.objects.services.read',
  feedback_submissions: 'crm.objects.feedback_submissions.read',
  commercepayments: 'crm.objects.commercepayments.read',
};

const TYPE_ID_TO_NAME = new Map(CRM_OBJECT_TYPES.map((t) => [t.typeId, t.value]));

/** The read scope needed for an object type (name, id or custom object), or null. */
export function scopeForObjectType(objectType: string): string | null {
  if (typeof objectType !== 'string') return null;
  const raw = objectType.trim();
  if (raw === '') return null;
  if (/^2-\d+$/.test(raw) || /^p_/i.test(raw)) return 'crm.objects.custom.read';
  let name = TYPE_ID_TO_NAME.get(raw) ?? raw.toLowerCase();
  name = TYPE_ALIASES[name] ?? name;
  return OBJECT_SCOPES[name] ?? null;
}

/**
 * Origin of a URL template when its scheme and host are static text, else null.
 * Only http(s) URLs are considered.
 */
export function staticOrigin(urlTemplate: string): string | null {
  if (typeof urlTemplate !== 'string') return null;
  const trimmed = urlTemplate.trim();
  const dynamicAt = trimmed.indexOf('{{');
  const prefix = dynamicAt === -1 ? trimmed : trimmed.slice(0, dynamicAt);
  const m = /^(https?):\/\/([^/?#]*)([/?#].*)?$/i.exec(prefix);
  if (!m) return null;
  const hostPart = m[2];
  // With a template right after the host, the host could continue (".evil.com", ":8080").
  if (dynamicAt !== -1 && m[3] === undefined) return null;
  if (hostPart === '' || hostPart.includes('@')) return null;
  try {
    const url = new URL(`${m[1]}://${hostPart}/`);
    return url.origin;
  } catch {
    return null;
  }
}

/** The text of a JS string literal token (quotes removed, simple escapes resolved). */
function unquote(literal: string): string {
  const body = literal.slice(1, literal.endsWith(literal[0]) && literal.length > 1 ? -1 : undefined);
  return body.replace(/\\(.)/g, (_, c: string) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c);
}

/**
 * URL templates (`{{ }}` marks the dynamic part) of `hubspot.fetch(<url>, ...)` calls in code
 * whose first argument starts with a string or template literal.
 */
export function fetchUrlsInCode(code: string): string[] {
  if (typeof code !== 'string' || !code.includes('fetch')) return [];
  const tokens = tokenize(code);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'ident' || t.text !== 'hubspot' || isPropertyName(tokens, i)) continue;
    const dot = nextSignificant(tokens, i + 1);
    const name = dot === -1 ? -1 : nextSignificant(tokens, dot + 1);
    const paren = name === -1 ? -1 : nextSignificant(tokens, name + 1);
    const arg = paren === -1 ? -1 : nextSignificant(tokens, paren + 1);
    if (arg === -1 || tokens[dot].text !== '.' || tokens[name].text !== 'fetch' || tokens[paren].text !== '(') continue;
    const a = tokens[arg];
    if (a.kind === 'string') out.push(unquote(a.text));
    else if (a.kind === 'template') out.push(a.text.slice(1, -1));
    else if (a.kind === 'templateHead') out.push(`${a.text.slice(1, -2)}{{ dynamic }}`);
  }
  return out;
}

/**
 * Explains a URL template whose origin is not static: `{ dynamic: true, suggestion }` where the
 * suggestion is the origin of the initial value of a state variable the URL starts with (e.g.
 * `{{ apiBase }}/items` with apiBase = 'https://api.acme.io'), else null. Static URLs return
 * `{ dynamic: false, suggestion: <origin> }`.
 */
export function urlOriginHint(url: string, ext: Pick<Extension, 'state'>): { dynamic: boolean; suggestion: string | null } {
  const origin = staticOrigin(url);
  if (origin) return { dynamic: false, suggestion: origin };
  const str = typeof url === 'string' ? url.trim() : '';
  if (!str.includes('{{')) return { dynamic: false, suggestion: null };
  const first = parseTemplate(str)[0];
  let suggestion: string | null = null;
  const name = first?.kind === 'expr' ? first.code.trim() : singleExpression(str);
  if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    const initial = (Array.isArray(ext.state) ? ext.state : []).find((v) => v?.name === name)?.initial;
    if (typeof initial === 'string') suggestion = staticOrigin(initial);
  }
  return { dynamic: true, suggestion };
}

function visitSteps(steps: ActionStep[] | undefined, visit: (s: ActionStep) => void): void {
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step || typeof step !== 'object') continue;
    visit(step);
    if (step.type === 'if') {
      visitSteps(step.then, visit);
      visitSteps(step.else, visit);
    }
    if (step.type === 'fetch' || step.type === 'runFunction') {
      visitSteps(step.onSuccess, visit);
      visitSteps(step.onError, visit);
    }
  }
}

function collectExtension(ext: Extension, out: { scopes: Set<string>; fetch: Set<string>; iframe: Set<string>; img: Set<string> }): void {
  const addScope = (objectType: string) => {
    const scope = scopeForObjectType(objectType);
    if (scope) out.scopes.add(scope);
  };
  const addOrigin = (set: Set<string>, url: string) => {
    const origin = staticOrigin(url);
    if (origin) set.add(origin);
  };
  if (ext.kind === 'card' && Array.isArray(ext.objectTypes)) ext.objectTypes.forEach(addScope);
  for (const ds of Array.isArray(ext.dataSources) ? ext.dataSources : []) {
    if (!ds) continue;
    if (ds.kind === 'associations') addScope(ds.toObjectType);
    else if (ds.kind === 'crmSearch') addScope(ds.objectType);
    else if (ds.kind === 'fetch') addOrigin(out.fetch, ds.url);
  }
  for (const node of reachableNodes(ext)) {
    const typeId = node.props?.objectTypeId;
    if (typeof typeId === 'string' && !typeId.includes('{{') && node.type.startsWith('Crm')) addScope(typeId);
    if (node.type === 'Image') {
      const src = node.props?.src;
      if (typeof src === 'string') addOrigin(out.img, src);
    }
    for (const steps of Object.values(node.events ?? {})) {
      visitSteps(steps, (step) => {
        if (step.type === 'fetch') addOrigin(out.fetch, step.url);
        if (step.type === 'openIframeModal') addOrigin(out.iframe, step.uri);
        if (step.type === 'custom') fetchUrlsInCode(step.code).forEach((url) => addOrigin(out.fetch, url));
      });
    }
  }
  // Module-level helper code and computed values may call hubspot.fetch too.
  fetchUrlsInCode(typeof ext.helpers === 'string' ? ext.helpers : '').forEach((url) => addOrigin(out.fetch, url));
  for (const c of Array.isArray(ext.computed) ? ext.computed : []) {
    fetchUrlsInCode(typeof c?.expr === 'string' ? c.expr : '').forEach((url) => addOrigin(out.fetch, url));
  }
}

/** Nodes reachable from the root (children and slots), each once even if the document has cycles. */
function reachableNodes(ext: Extension): UINode[] {
  const out: UINode[] = [];
  const seen = new Set<string>();
  const stack = [ext.rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const node = ext.nodes?.[id];
    if (!node || seen.has(id)) continue;
    seen.add(id);
    out.push(node);
    const childIds = [...(Array.isArray(node.children) ? node.children : [])];
    for (const ids of Object.values(node.slots ?? {})) if (Array.isArray(ids)) childIds.push(...ids);
    stack.push(...childIds.reverse());
  }
  return out;
}

/** Scopes and permitted URL origins the project's extensions need (sorted, deduplicated). */
export function deriveRequirements(project: Project): ProjectRequirements {
  const acc = { scopes: new Set<string>(), fetch: new Set<string>(), iframe: new Set<string>(), img: new Set<string>() };
  for (const ext of project.extensions) collectExtension(ext, acc);
  const sorted = (s: Set<string>) => [...s].sort();
  return { scopes: sorted(acc.scopes), fetch: sorted(acc.fetch), iframe: sorted(acc.iframe), img: sorted(acc.img) };
}

/** Normalised comparison key for URLs (`https://a.com/` equals `https://a.com`). */
function urlKey(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** Merges URL lists: user values first, then derived ones not already present. */
export function mergeUrls(user: string[], derived: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [...user, ...derived]) {
    const key = urlKey(url);
    if (url.trim() === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(url.trim());
  }
  return out;
}

/**
 * Required scopes for app-hsmeta.json: 'oauth' (always), the user's scopes, then derived scopes
 * the user has not already listed as required, optional or conditionally required.
 */
export function mergeRequiredScopes(
  user: { requiredScopes: string[]; optionalScopes: string[]; conditionallyRequiredScopes: string[] },
  derived: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (scope: string) => {
    const s = scope.trim();
    if (s === '' || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  if (!user.requiredScopes.some((s) => s.trim() === 'oauth')) add('oauth');
  user.requiredScopes.forEach(add);
  const elsewhere = new Set([...user.optionalScopes, ...user.conditionallyRequiredScopes].map((s) => s.trim()));
  derived.filter((s) => !elsewhere.has(s)).forEach(add);
  return out;
}
