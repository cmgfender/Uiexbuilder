/**
 * Project validation (problems panel, inspector warnings, export gate).
 *
 * CONTRACT: validateProject is pure and fast (runs on every change, debounced by callers). It walks
 * every extension's node tree once and never throws on malformed documents (imports may contain
 * anything). Each issue names a stable rule id, a severity, a plain-language message and where to
 * fix it (extension / node / field).
 *
 * Rule families
 *  - project & app:   project-name, app-name, invalid-uid, duplicate-uid, invalid-file-name,
 *                     duplicate-file-name, multiple-settings, multiple-home, marketplace-auth,
 *                     oauth-redirect, redirect-url, support-email, permitted-url
 *  - extensions:      extension-name, object-types, location, helpdesk-object-type, empty-extension
 *  - nodes:           unknown-component, unavailable-component, invalid-placement, required-prop,
 *                     required-children, empty-text, invalid-prop-value, invalid-options,
 *                     expression-syntax, unclosed-template, repeat-items, repeat-name, repeat-shadow,
 *                     unknown-state, binding-type, binding-unsupported, duplicate-overlay-id,
 *                     duplicate-tab-id, missing-overlay, unknown-data-source, unknown-function,
 *                     refresh-unsupported, event-variant, unknown-event, unknown-name, empty-alert
 *  - state & data:    invalid-identifier, duplicate-name, state-initial, data-source-properties,
 *                     data-source-config, data-source-location, data-source-computed, fetch-url,
 *                     iframe-url, computed-order, helpers-syntax, function-syntax, function-main
 *  - requirements:    missing-scope, missing-permitted-url (info: added automatically on export)
 */
import { getComponent } from '../registry';
import type { ComponentDef, PropDef } from '../registry/types';
import { deriveRequirements, staticOrigin } from '../codegen/requirements';
import { checkExpressionSyntax, checkStatementsSyntax } from '../runtime/expr';
import { checkHelpersSyntax, helperNames } from '../power/helpers';
import { isValidIdentifier, uidProblem } from './ids';
import { canAccept, isAvailableIn } from './rules';
import { parseTemplate } from './template';
import type { ActionStep, DataSource, Extension, JsonValue, NodeId, Project, PropValue, UINode } from './types';
import { isExpr } from './types';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  /** Stable id (rule + location) so UIs can key lists. */
  id: string;
  severity: IssueSeverity;
  message: string;
  /** Rule identifier, e.g. 'required-prop', 'unknown-state', 'invalid-identifier'. */
  rule: string;
  extensionId?: string;
  nodeId?: string;
  /**
   * What the issue is about, e.g. a prop name, 'text', 'event:onClick', 'condition', 'repeat',
   * 'binding', 'state:<id>', 'dataSource:<id>', 'function:<id>', 'app.requiredScopes'.
   */
  field?: string;
  /**
   * The value the issue is about, when one-click fixes need it (additive): the scope of
   * missing-scope, the origin of missing-permitted-url, the state name of an unknown binding.
   */
  subject?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILE_NAME_RE = /^[A-Z][A-Za-z0-9_]*$/;
const FUNCTION_FILE_RE = /^[A-Za-z0-9_-]+$/;
const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENT_SYNTAX_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const CARD_LOCATIONS = new Set(['crm.record.tab', 'crm.record.sidebar', 'crm.preview', 'helpdesk.sidebar']);
const LOCATION_LABELS: Record<string, string> = {
  'crm.record.tab': 'record tab',
  'crm.record.sidebar': 'record sidebar',
  'crm.preview': 'preview panel',
  'helpdesk.sidebar': 'help desk sidebar',
  settings: 'settings page',
  home: 'app home page',
};
/** Text components whose text is their visible label (empty text renders an empty control). */
const LABEL_TEXT_TYPES = new Set([
  'Button',
  'LoadingButton',
  'Link',
  'Heading',
  'Tag',
  'StatusTag',
  'Dropdown.ButtonItem',
  'CrmActionButton',
  'CrmActionLink',
]);

/** JavaScript keywords and literal names never reported as unknown. */
const JS_KEYWORDS = new Set(
  (
    'break case catch class const continue debugger default delete do else export extends finally for function if ' +
    'import in instanceof new return super switch this throw try typeof var void while with yield let static enum ' +
    'await async of implements package protected interface private public get set arguments eval true false null ' +
    'undefined NaN Infinity as from target'
  ).split(' '),
);

/** Globals available to expressions in generated code and in the preview. */
const JS_GLOBALS = new Set(
  (
    'Math JSON Number String Date Array Object Boolean parseInt parseFloat isNaN isFinite encodeURIComponent ' +
    'decodeURIComponent encodeURI decodeURI console Intl RegExp Promise Map Set WeakMap WeakSet Symbol Error ' +
    'TypeError RangeError BigInt setTimeout clearTimeout setInterval clearInterval structuredClone globalThis ' +
    'queueMicrotask'
  ).split(' '),
);

/** Globals and generated helpers a state / data / computed name must not shadow. */
const BUILT_IN_NAMES = new Set(
  (
    'Math JSON Date Object Array String Number Boolean Promise Error Intl RegExp Map Set Symbol parseInt parseFloat ' +
    'isNaN isFinite console window document hubspot logger React toText asArray'
  ).split(' '),
);

/** Names custom code actions get in addition to the handler scope. */
const CUSTOM_CODE_NAMES = ['actions', 'hubspot', 'logger'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function asArray<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function setterName(name: string): string {
  return `set${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Runs a registry predicate without letting a buggy predicate break validation. */
function safePredicate(fn: ((props: Record<string, unknown>) => boolean) | undefined, props: Record<string, unknown>): boolean {
  if (!fn) return false;
  try {
    return !!fn(props);
  } catch {
    return false;
  }
}

function quote(s: string): string {
  return `“${s}”`;
}

/** Why an identifier is not usable, or null when it is fine. */
function identifierProblem(name: string): string | null {
  if (!name) return 'is empty';
  if (!IDENT_SYNTAX_RE.test(name)) return 'is not a valid name — use letters, digits, _ or $, and don’t start with a digit';
  if (!isValidIdentifier(name)) return 'is a reserved word';
  return null;
}

/** identifierProblem plus built-in names a declaration would hide from expressions. */
function declarationProblem(name: string): string | null {
  const problem = identifierProblem(name);
  if (problem) return problem;
  if (BUILT_IN_NAMES.has(name)) return 'is a built-in name — expressions would lose access to it';
  return null;
}

// Syntax checks are memoised: validation re-runs on every edit and most code is unchanged.
const syntaxCache = new Map<string, string | null>();
function cachedSyntax(kind: 'e' | 's' | 'h' | 'f', code: string, check: (code: string) => string | null): string | null {
  const key = `${kind}\u0000${code}`;
  const hit = syntaxCache.get(key);
  if (hit !== undefined) return hit;
  const result = check(code);
  if (syntaxCache.size > 4000) syntaxCache.clear();
  syntaxCache.set(key, result);
  return result;
}

const exprSyntax = (code: string) => cachedSyntax('e', code, checkExpressionSyntax);
const stmtSyntax = (code: string) => cachedSyntax('s', code, checkStatementsSyntax);
/** Helper code may use TypeScript annotations (stripped before parsing, like the preview does). */
const helperSyntax = (code: string) => cachedSyntax('h', code, (c) => checkHelpersSyntax(c));
const functionSyntax = (code: string) =>
  cachedSyntax('f', code, (c) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('exports', 'require', 'module', '__filename', '__dirname', c);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });

// ---------------------------------------------------------------------------
// Identifier scanner (best-effort unknown-name detection)
// ---------------------------------------------------------------------------

interface Token {
  kind: 'id' | 'punct' | 'num' | 'str';
  value: string;
  /** Identifier preceded by `.` / `?.` (a property access). */
  member?: boolean;
}

const MULTI_PUNCT = ['...', '?.', '=>', '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/='];
const REGEX_AFTER_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'instanceof', 'await', 'yield', 'else', 'do']);
const ID_START = /[A-Za-z_$\u00C0-\uFFFF]/;
const ID_PART = /[A-Za-z0-9_$\u00C0-\uFFFF]/;

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  const n = code.length;
  const tplStack: number[] = [];
  let depth = 0;
  let i = 0;

  const last = () => tokens[tokens.length - 1];
  const regexAllowed = () => {
    const t = last();
    if (!t) return true;
    if (t.kind === 'num' || t.kind === 'str') return false;
    if (t.kind === 'id') return REGEX_AFTER_KEYWORDS.has(t.value);
    return !(t.value === ')' || t.value === ']' || t.value === '}');
  };
  /** Reads template literal text from `j` up to the closing backtick or a `${`. */
  const readTemplate = (j: number): number => {
    while (j < n) {
      const ch = code[j];
      if (ch === '\\') j += 2;
      else if (ch === '`') return j + 1;
      else if (ch === '$' && code[j + 1] === '{') {
        tplStack.push(depth);
        depth += 1;
        return j + 2;
      } else j += 1;
    }
    return n;
  };

  while (i < n) {
    const c = code[i];
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      i = j + 1;
      tokens.push({ kind: 'str', value: '' });
      continue;
    }
    if (c === '`') {
      i = readTemplate(i + 1);
      tokens.push({ kind: 'str', value: '' });
      continue;
    }
    if (c === '}' && tplStack.length && tplStack[tplStack.length - 1] === depth - 1) {
      tplStack.pop();
      depth -= 1;
      i = readTemplate(i + 1);
      tokens.push({ kind: 'str', value: '' });
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const ch = code[j];
        if (ch === '\\') j += 2;
        else if (ch === '\n') break;
        else {
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
          j += 1;
        }
      }
      j += 1;
      while (j < n && /[a-z]/i.test(code[j])) j += 1;
      i = j;
      tokens.push({ kind: 'str', value: '' });
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && code[i + 1] >= '0' && code[i + 1] <= '9')) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(code[j])) j += 1;
      tokens.push({ kind: 'num', value: code.slice(i, j) });
      i = j;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(code[j])) j += 1;
      const prev = last();
      tokens.push({
        kind: 'id',
        value: code.slice(i, j),
        member: !!prev && prev.kind === 'punct' && (prev.value === '.' || prev.value === '?.'),
      });
      i = j;
      continue;
    }
    const multi = MULTI_PUNCT.find((p) => code.startsWith(p, i) && !(p === '?.' && /[0-9]/.test(code[i + 2] ?? '')));
    const value = multi ?? c;
    if (value === '{' || value === '(' || value === '[') depth += 1;
    if (value === '}' || value === ')' || value === ']') depth -= 1;
    tokens.push({ kind: 'punct', value });
    i += value.length;
  }
  return tokens;
}

const OPEN: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** Names declared inside the code (variables, parameters, functions, classes, catch bindings). */
function declaredNames(tokens: Token[]): Set<string> {
  const declared = new Set<string>();
  const isP = (t: Token | undefined, v: string) => !!t && t.kind === 'punct' && t.value === v;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'id' && !t.member && (t.value === 'const' || t.value === 'let' || t.value === 'var')) {
      let depth = 0;
      let skipping = false;
      for (let j = i + 1; j < tokens.length; j++) {
        const u = tokens[j];
        if (u.kind === 'punct') {
          if (u.value === '(' || u.value === '[' || u.value === '{') depth += 1;
          else if (u.value === ')' || u.value === ']' || u.value === '}') {
            depth -= 1;
            if (depth < 0) break;
          } else if (depth === 0 && u.value === '=') skipping = true;
          else if (depth === 0 && u.value === ',') skipping = false;
          else if (depth === 0 && u.value === ';') break;
          continue;
        }
        if (u.kind !== 'id') continue;
        if (depth === 0 && (u.value === 'of' || u.value === 'in')) break;
        if (depth === 0 && ['const', 'let', 'var', 'if', 'return', 'for', 'while', 'await'].includes(u.value) && skipping) break;
        if (!skipping && !u.member && !JS_KEYWORDS.has(u.value)) declared.add(u.value);
      }
    } else if (t.kind === 'id' && !t.member && (t.value === 'function' || t.value === 'class')) {
      const next = tokens[i + 1];
      if (next?.kind === 'id') declared.add(next.value);
      if (t.value === 'function') {
        const open = next?.kind === 'id' ? i + 2 : i + 1;
        if (isP(tokens[open], '(')) {
          let depth = 0;
          for (let j = open; j < tokens.length; j++) {
            const u = tokens[j];
            if (isP(u, '(') || isP(u, '[') || isP(u, '{')) depth += 1;
            else if (isP(u, ')') || isP(u, ']') || isP(u, '}')) {
              depth -= 1;
              if (depth === 0) break;
            } else if (u.kind === 'id' && !u.member) declared.add(u.value);
          }
        }
      }
    } else if (t.kind === 'id' && t.value === 'catch' && isP(tokens[i + 1], '(') && tokens[i + 2]?.kind === 'id') {
      declared.add(tokens[i + 2].value);
    } else if (isP(t, '=>')) {
      const prev = tokens[i - 1];
      if (prev?.kind === 'id') declared.add(prev.value);
      else if (isP(prev, ')')) {
        const stack: string[] = [];
        for (let j = i - 1; j >= 0; j--) {
          const u = tokens[j];
          if (u.kind === 'punct' && OPEN[u.value]) stack.push(u.value);
          else if (u.kind === 'punct' && (u.value === '(' || u.value === '[' || u.value === '{')) {
            stack.pop();
            if (stack.length === 0) break;
          } else if (u.kind === 'id' && !u.member) declared.add(u.value);
        }
      }
    }
  }
  return declared;
}

const scanCache = new Map<string, string[]>();

/**
 * Free identifiers referenced by a piece of JavaScript (expression or statements): identifiers that
 * are not property accesses, object-literal keys, keywords or names declared inside the code.
 * Best-effort (no full parser) — used for "unknown name" warnings.
 */
export function scanReferences(code: string): string[] {
  const hit = scanCache.get(code);
  if (hit) return hit;
  const tokens = tokenize(code);
  const declared = declaredNames(tokens);
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'id' || t.member || JS_KEYWORDS.has(t.value) || declared.has(t.value)) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    // Object literal key: `{ key: value }` / `, key: value`.
    if (next?.kind === 'punct' && next.value === ':' && prev?.kind === 'punct' && (prev.value === '{' || prev.value === ',')) continue;
    out.add(t.value);
  }
  const result = [...out];
  if (scanCache.size > 4000) scanCache.clear();
  scanCache.set(code, result);
  return result;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

interface Loc {
  extensionId?: string;
  nodeId?: string;
  field?: string;
}

class Collector {
  readonly issues: Issue[] = [];
  private readonly seen = new Set<string>();

  add(rule: string, severity: IssueSeverity, message: string, loc: Loc = {}, key = '', subject?: string): void {
    const id = [rule, loc.extensionId ?? '', loc.nodeId ?? '', loc.field ?? '', key].join('|');
    if (this.seen.has(id)) return;
    this.seen.add(id);
    const issue: Issue = { id, severity, message, rule };
    if (loc.extensionId) issue.extensionId = loc.extensionId;
    if (loc.nodeId) issue.nodeId = loc.nodeId;
    if (loc.field) issue.field = loc.field;
    if (subject) issue.subject = subject;
    this.issues.push(issue);
  }
}

/** Identifiers in scope at some point of an extension. */
type NameScope = (name: string) => boolean;

function scopeWith(parent: NameScope, names: Iterable<string>): NameScope {
  const set = new Set(names);
  if (set.size === 0) return parent;
  return (name) => set.has(name) || parent(name);
}

interface CodeChecker {
  c: Collector;
  /** Names of later computed values (only set while checking computed values). */
  laterComputed?: Set<string>;
  /**
   * Computed value names (only set while checking data source options: data hooks and loaders are
   * declared before the computed values, so they cannot read them).
   */
  computedInDataSource?: Set<string>;
}

function reportUnknownNames(chk: CodeChecker, code: string, scope: NameScope, loc: Loc, what: string): void {
  for (const name of scanReferences(code)) {
    if (scope(name) || JS_GLOBALS.has(name)) continue;
    if (chk.computedInDataSource?.has(name)) {
      chk.c.add(
        'data-source-computed',
        'error',
        `${capitalize(what)} uses the computed value ${quote(name)}. Data sources load before computed values are calculated — use the state or data ${quote(name)} is based on instead.`,
        loc,
        name,
      );
      continue;
    }
    if (chk.laterComputed?.has(name)) {
      chk.c.add(
        'computed-order',
        'warning',
        `${capitalize(what)} uses ${quote(name)}, which is defined further down. Move ${quote(name)} above it in the computed list.`,
        loc,
        name,
      );
      continue;
    }
    chk.c.add(
      'unknown-name',
      'warning',
      `Unknown name ${quote(name)} in ${what}. Check the spelling, or add a state variable, data source or computed value with this name.`,
      loc,
      name,
    );
  }
}

/** Checks a JavaScript expression: syntax (error) then unknown names (warning). */
function checkExpression(chk: CodeChecker, code: unknown, scope: NameScope, loc: Loc, what: string): void {
  if (typeof code !== 'string' || !code.trim()) return;
  const err = exprSyntax(code);
  if (err) {
    chk.c.add('expression-syntax', 'error', `${capitalize(what)} has a syntax error: ${err}.`, loc, `expr:${code}`);
    return;
  }
  reportUnknownNames(chk, code, scope, loc, what);
}

/** Checks a block of statements (custom code). */
function checkStatements(chk: CodeChecker, code: unknown, scope: NameScope, loc: Loc, what: string): void {
  if (typeof code !== 'string' || !code.trim()) return;
  const err = stmtSyntax(code);
  if (err) {
    chk.c.add('expression-syntax', 'error', `${capitalize(what)} has a syntax error: ${err}.`, loc, `stmts:${code}`);
    return;
  }
  reportUnknownNames(chk, code, scope, loc, what);
}

/** Checks every `{{ }}` segment of a template string. */
function checkTemplate(chk: CodeChecker, value: unknown, scope: NameScope, loc: Loc, what: string): void {
  if (typeof value !== 'string' || !value.includes('{{')) return;
  for (const part of parseTemplate(value)) {
    if (part.kind === 'expr') checkExpression(chk, part.code, scope, loc, what);
  }
  const rest = value.replace(/\{\{[\s\S]*?\}\}/g, '');
  if (rest.includes('{{')) {
    chk.c.add('unclosed-template', 'warning', `${capitalize(what)} has a “{{” without a closing “}}”, so it shows as plain text.`, loc, `tpl:${value}`);
  }
}

/** Template strings anywhere inside a literal JSON value (rule 4). */
function checkLiteralTemplates(chk: CodeChecker, value: JsonValue, scope: NameScope, loc: Loc, what: string): void {
  if (typeof value === 'string') checkTemplate(chk, value, scope, loc, what);
  else if (Array.isArray(value)) value.forEach((v) => checkLiteralTemplates(chk, v, scope, loc, what));
  else if (isRecord(value)) Object.values(value).forEach((v) => checkLiteralTemplates(chk, v as JsonValue, scope, loc, what));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Project & app
// ---------------------------------------------------------------------------

function checkUrl(url: string): { ok: boolean; https: boolean; local: boolean; parsed: URL | null } {
  try {
    const parsed = new URL(url.trim());
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return { ok: !!parsed.hostname, https: parsed.protocol === 'https:', local, parsed };
  } catch {
    return { ok: false, https: false, local: false, parsed: null };
  }
}

function validateApp(project: Project, c: Collector): void {
  const name = str(project.name);
  if (!name.trim()) {
    c.add('project-name', 'error', 'The project needs a name (used in hsproject.json), e.g. “my-hubspot-app”.', { field: 'project.name' });
  } else if (!PROJECT_SLUG_RE.test(name) || name.length > 64) {
    c.add(
      'project-name',
      'error',
      `Project name ${quote(name)} must use lowercase letters, digits and dashes only (max 64 characters), e.g. “my-hubspot-app”.`,
      { field: 'project.name' },
    );
  }

  const app = isRecord(project.app) ? project.app : ({} as Project['app']);
  if (!str(app.name).trim()) {
    c.add('app-name', 'error', 'The app needs a name. It is shown to users when they install the app.', { field: 'app.name' });
  }
  const appUid = str(app.uid);
  if (!appUid.trim()) c.add('invalid-uid', 'error', 'The app needs a uid (an internal id such as “my_app”).', { field: 'app.uid' });
  else if (uidProblem(appUid)) {
    c.add('invalid-uid', 'error', `App uid ${quote(appUid)} ${uidProblem(appUid)}.`, { field: 'app.uid' });
  }

  if (app.distribution === 'marketplace' && app.authType !== 'oauth') {
    c.add(
      'marketplace-auth',
      'error',
      'Marketplace apps must use OAuth authentication. Switch the auth type to OAuth or the distribution to private.',
      { field: 'app.authType' },
    );
  }
  const redirects = asArray(app.redirectUrls).filter((u) => typeof u === 'string' && u.trim());
  if (app.authType === 'oauth' && redirects.length === 0) {
    c.add('oauth-redirect', 'warning', 'OAuth apps need at least one redirect URL so HubSpot can send users back after installing.', {
      field: 'app.redirectUrls',
    });
  }
  for (const url of redirects) {
    const r = checkUrl(url);
    if (!r.ok || (!r.https && !r.local)) {
      c.add('redirect-url', 'warning', `Redirect URL ${quote(url)} should be a full https:// URL.`, { field: 'app.redirectUrls' }, url);
    }
  }

  const email = str(app.support?.supportEmail).trim();
  if (email && !EMAIL_RE.test(email)) {
    c.add('support-email', 'warning', `Support email ${quote(email)} doesn’t look like an email address.`, { field: 'app.support.supportEmail' });
  }

  const permitted = isRecord(app.permittedUrls) ? app.permittedUrls : { fetch: [], iframe: [], img: [] };
  for (const kind of ['fetch', 'iframe', 'img'] as const) {
    for (const url of asArray(permitted[kind])) {
      if (typeof url !== 'string' || !url.trim()) continue;
      const loc = { field: `app.permittedUrls.${kind}` };
      const r = checkUrl(url);
      if (!r.ok) {
        c.add('permitted-url', 'error', `Permitted ${kind} URL ${quote(url)} is not a valid URL. Use an origin such as https://api.example.com.`, loc, url);
      } else if (!r.https) {
        c.add(
          'permitted-url',
          'error',
          r.local
            ? `Permitted ${kind} URL ${quote(url)} points to localhost, which HubSpot does not allow. Use an https:// URL (proxy local servers with local.json).`
            : `Permitted ${kind} URL ${quote(url)} must use https://.`,
          loc,
          url,
        );
      } else if (r.parsed && ((r.parsed.pathname && r.parsed.pathname !== '/') || r.parsed.search || r.parsed.hash)) {
        c.add(
          'permitted-url',
          'warning',
          `Permitted ${kind} URL ${quote(url)} should be just an origin (${r.parsed.origin}), without a path.`,
          loc,
          url,
        );
      }
    }
  }
}

function validateUniqueness(project: Project, c: Collector): void {
  const uids = new Map<string, string>();
  const claimUid = (uid: string, owner: string, loc: Loc) => {
    if (!uid) return;
    const prev = uids.get(uid);
    if (prev) c.add('duplicate-uid', 'error', `uid ${quote(uid)} is already used by ${prev}. Every uid in a project must be unique.`, loc);
    else uids.set(uid, owner);
  };
  if (isRecord(project.app)) claimUid(str(project.app.uid), 'the app', { field: 'app.uid' });
  const files = new Map<string, string>();
  let settings = 0;
  let home = 0;
  for (const ext of asArray(project.extensions)) {
    if (!ext) continue;
    const label = `${ext.kind === 'settings' ? 'the settings page' : ext.kind === 'home' ? 'the app home page' : 'card'} ${quote(str(ext.name) || str(ext.uid))}`;
    claimUid(str(ext.uid), label, { extensionId: ext.id, field: 'uid' });
    const fileName = str(ext.fileName);
    if (!fileName) {
      c.add('invalid-file-name', 'error', 'This extension needs a file name such as “ContactSummaryCard”.', { extensionId: ext.id, field: 'fileName' });
    } else if (!FILE_NAME_RE.test(fileName)) {
      c.add(
        'invalid-file-name',
        'error',
        `File name ${quote(fileName)} must be PascalCase: start with a capital letter, then letters and digits (e.g. “ContactSummaryCard”).`,
        { extensionId: ext.id, field: 'fileName' },
      );
    } else {
      const key = fileName.toLowerCase();
      const prev = files.get(key);
      if (prev) {
        c.add('duplicate-file-name', 'error', `File name ${quote(fileName)} is already used by ${prev}. Give each extension its own file name.`, {
          extensionId: ext.id,
          field: 'fileName',
        });
      } else files.set(key, label);
    }
    if (ext.kind === 'settings' && ++settings > 1) {
      c.add('multiple-settings', 'error', 'An app can have only one settings page. Remove this one or turn it into a card.', {
        extensionId: ext.id,
        field: 'kind',
      });
    }
    if (ext.kind === 'home' && ++home > 1) {
      c.add('multiple-home', 'error', 'An app can have only one app home page. Remove this one or turn it into a card.', {
        extensionId: ext.id,
        field: 'kind',
      });
    }
  }
  for (const fn of asArray(project.functions)) {
    if (!fn) continue;
    claimUid(str(fn.uid), `the app function ${quote(str(fn.fileName) || str(fn.uid))}`, { field: `function:${fn.id}` });
  }
}

// ---------------------------------------------------------------------------
// App functions
// ---------------------------------------------------------------------------

function validateFunctions(project: Project, c: Collector): void {
  const files = new Map<string, string>();
  for (const fn of asArray(project.functions)) {
    if (!fn) continue;
    const loc = { field: `function:${fn.id}` };
    const label = quote(str(fn.fileName) || str(fn.uid) || 'function');
    const uid = str(fn.uid);
    if (!uid.trim()) c.add('invalid-uid', 'error', `App function ${label} needs a uid (the name cards call it by).`, loc, 'uid');
    else if (uidProblem(uid)) {
      c.add('invalid-uid', 'error', `App function uid ${quote(uid)} ${uidProblem(uid)}.`, loc, 'uid');
    }
    const fileName = str(fn.fileName);
    if (!FUNCTION_FILE_RE.test(fileName) || fileName.toLowerCase() === 'package') {
      c.add('invalid-file-name', 'error', `App function file name ${quote(fileName)} may only use letters, digits, _ and - (no extension).`, loc, 'file');
    } else {
      const prev = files.get(fileName.toLowerCase());
      if (prev) c.add('duplicate-file-name', 'error', `File name ${quote(fileName)} is used by two app functions.`, loc, 'file');
      else files.set(fileName.toLowerCase(), fileName);
    }
    const code = str(fn.code);
    if (!code.trim()) {
      c.add('function-main', 'warning', `App function ${label} has no code. It must export a main function.`, loc, 'main');
      continue;
    }
    const err = functionSyntax(code);
    if (err) {
      c.add('function-syntax', 'error', `App function ${label} has a syntax error: ${err}.`, loc);
    } else if (!/\bexports\s*\.\s*main\s*=|\bexports\s*\[\s*['"]main['"]\s*\]\s*=|module\s*\.\s*exports\s*=/.test(code)) {
      c.add('function-main', 'warning', `App function ${label} doesn’t export a main function (exports.main = async (context) => { … }).`, loc, 'main');
    }
  }
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

function originKey(url: string): string {
  const r = checkUrl(url);
  return r.parsed ? r.parsed.origin.toLowerCase() : url.trim().replace(/\/+$/, '').toLowerCase();
}

function validateRequirements(project: Project, c: Collector): void {
  let req;
  try {
    req = deriveRequirements(project);
  } catch {
    return;
  }
  const app = isRecord(project.app) ? project.app : null;
  if (!app) return;
  const configured = new Set(
    [...asArray(app.requiredScopes), ...asArray(app.optionalScopes), ...asArray(app.conditionallyRequiredScopes)].map((s) => str(s).trim()),
  );
  for (const scope of req.scopes) {
    if (configured.has(scope)) continue;
    c.add('missing-scope', 'info', `Scope ${quote(scope)} is needed by your extensions and will be added automatically on export.`, { field: 'app.requiredScopes' }, scope, scope);
  }
  const permitted = isRecord(app.permittedUrls) ? app.permittedUrls : { fetch: [], iframe: [], img: [] };
  for (const kind of ['fetch', 'iframe', 'img'] as const) {
    const have = new Set(asArray(permitted[kind]).map((u) => originKey(str(u))));
    for (const origin of req[kind]) {
      if (have.has(origin.toLowerCase())) continue;
      c.add(
        'missing-permitted-url',
        'info',
        `${origin} is used by ${kind === 'img' ? 'an image' : kind === 'iframe' ? 'an iframe modal' : 'a fetch request'} and will be added to the permitted URLs automatically on export.`,
        { field: `app.permittedUrls.${kind}` },
        origin,
        origin,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

interface ExtContext {
  project: Project;
  ext: Extension;
  c: Collector;
  chk: CodeChecker;
  /** Names in scope everywhere in render code (state, computed, helpers, data, context). */
  base: NameScope;
  /** Names data source options may use: the base scope without computed values. */
  dataScope: NameScope;
  /** Handler scope additions: state setters. */
  setters: string[];
  stateByName: Map<string, Extension['state'][number]>;
  /** Names that a repeat variable would shadow. */
  shadowable: Set<string>;
  dataSourceIds: Set<string>;
  functionIds: Set<string>;
  /** Modal / Panel nodes of the extension. */
  overlayNodes: Set<NodeId>;
  overlayIds: Map<string, NodeId>;
  isCrm: boolean;
}

function nodeSubject(def: ComponentDef, node: UINode): string {
  return node.name ? `${def.label} ${quote(node.name)}` : def.label;
}

function propLabel(def: ComponentDef, name: string): string {
  const p = def.props.find((x) => x.name === name);
  return quote(p?.label ?? name);
}

function validateExtension(project: Project, ext: Extension, c: Collector): void {
  const extLoc = (field?: string): Loc => ({ extensionId: ext.id, ...(field ? { field } : {}) });
  const kindLabel = ext.kind === 'settings' ? 'settings page' : ext.kind === 'home' ? 'app home page' : 'card';

  if (!str(ext.name).trim()) c.add('extension-name', 'error', `This ${kindLabel} needs a name. It’s the title shown in HubSpot.`, extLoc('name'));
  const uid = str(ext.uid);
  if (!uid.trim()) c.add('invalid-uid', 'error', `This ${kindLabel} needs a uid (an internal id such as “contact_summary_card”).`, extLoc('uid'));
  else if (uidProblem(uid)) {
    c.add('invalid-uid', 'error', `The ${kindLabel} uid ${quote(uid)} ${uidProblem(uid)}.`, extLoc('uid'));
  }
  if (ext.kind === 'card') {
    if (!CARD_LOCATIONS.has(ext.location)) {
      c.add('location', 'error', `${quote(str(ext.location))} is not a card location. Choose record tab, record sidebar, preview panel or help desk sidebar.`, extLoc('location'));
    }
    const objectTypes = asArray(ext.objectTypes).filter((t) => typeof t === 'string' && t.trim());
    if (objectTypes.length === 0) {
      c.add('object-types', 'error', 'Choose at least one CRM object (e.g. Contacts) where this card appears.', extLoc('objectTypes'));
    } else if (ext.location === 'helpdesk.sidebar' && objectTypes.some((t) => t !== 'tickets')) {
      c.add('helpdesk-object-type', 'warning', 'Help desk sidebar cards only appear on tickets. Set the object type to Tickets.', extLoc('objectTypes'));
    }
  }

  const state = asArray(ext.state).filter(Boolean);
  const dataSources = asArray(ext.dataSources).filter(Boolean);
  const computed = asArray(ext.computed).filter(Boolean);
  const helpers = typeof ext.helpers === 'string' ? ext.helpers : '';
  const helperList = helperNames(helpers);

  // ---- names: identifiers & duplicates
  const owners = new Map<string, string>();
  const claim = (name: string, owner: string, field: string, derivedNote?: string) => {
    if (!name) return;
    const prev = owners.get(name);
    if (prev && prev !== owner) {
      c.add(
        'duplicate-name',
        'error',
        `${quote(name)} is already used by ${prev}${derivedNote ? ` (${derivedNote})` : ''}. Pick a different name.`,
        extLoc(field),
        name,
      );
    } else if (!prev) owners.set(name, owner);
  };
  for (const h of helperList) claim(h, `the helper function ${quote(h)}`, 'helpers');
  for (const s of state) {
    const field = `state:${s.id}`;
    const problem = declarationProblem(str(s.name));
    if (problem) {
      c.add('invalid-identifier', 'error', `State variable ${quote(str(s.name))} ${problem}.`, extLoc(field));
      continue;
    }
    claim(s.name, `the state variable ${quote(s.name)}`, field);
    claim(setterName(s.name), `the state variable ${quote(s.name)}`, field, `its setter is ${setterName(s.name)}`);
    checkStateInitial(s, c, extLoc(field));
  }
  for (const ds of dataSources) {
    const field = `dataSource:${ds.id}`;
    const problem = declarationProblem(str(ds.name));
    if (problem) {
      c.add('invalid-identifier', 'error', `Data source ${quote(str(ds.name))} ${problem}.`, extLoc(field));
      continue;
    }
    const owner = `the data source ${quote(ds.name)}`;
    claim(ds.name, owner, field);
    claim(`${ds.name}Loading`, owner, field, 'its loading flag');
    claim(`${ds.name}Error`, owner, field, 'its error message');
    if (ds.kind === 'fetch' || ds.kind === 'function') {
      for (const n of [ds.name, `${ds.name}Loading`, `${ds.name}Error`]) claim(setterName(n), owner, field, 'used internally to load it');
    }
  }
  for (const cv of computed) {
    const field = `computed:${cv.id}`;
    const problem = declarationProblem(str(cv.name));
    if (problem) {
      c.add('invalid-identifier', 'error', `Computed value ${quote(str(cv.name))} ${problem}.`, extLoc(field));
      continue;
    }
    claim(cv.name, `the computed value ${quote(cv.name)}`, field);
  }

  // ---- scope
  const baseNames = new Set<string>(['context']);
  for (const s of state) if (s.name) baseNames.add(s.name);
  for (const cv of computed) if (cv.name) baseNames.add(cv.name);
  for (const h of helperList) baseNames.add(h);
  for (const ds of dataSources) {
    if (!ds.name) continue;
    baseNames.add(ds.name);
    baseNames.add(`${ds.name}Loading`);
    baseNames.add(`${ds.name}Error`);
  }
  const base: NameScope = (name) => baseNames.has(name);
  const computedNames = new Set(computed.map((cv) => str(cv.name)).filter(Boolean));
  const dataScope: NameScope = (name) => baseNames.has(name) && !computedNames.has(name);
  const chk: CodeChecker = { c };
  const shadowable = new Set<string>(baseNames);
  shadowable.delete('context');

  const overlayNodes = new Set<NodeId>();
  for (const node of Object.values(isRecord(ext.nodes) ? ext.nodes : {})) {
    if (node && getComponent(node.type)?.overlay) overlayNodes.add(node.id);
  }

  const ctx: ExtContext = {
    project,
    ext,
    c,
    chk,
    base,
    dataScope,
    setters: state.filter((s) => s.name).map((s) => setterName(s.name)),
    stateByName: new Map(state.map((s) => [s.name, s])),
    shadowable,
    dataSourceIds: new Set(dataSources.map((d) => d.id)),
    functionIds: new Set(asArray(project.functions).map((f) => f?.id)),
    overlayNodes,
    overlayIds: new Map(),
    isCrm: ext.kind === 'card',
  };

  // ---- data sources (declared before computed values, so they cannot use them)
  chk.computedInDataSource = computedNames;
  for (const ds of dataSources) validateDataSource(ctx, ds);
  chk.computedInDataSource = undefined;

  // ---- computed values (each may use the ones declared before it)
  computed.forEach((cv, i) => {
    const later = new Set(computed.slice(i).map((x) => x.name));
    const scope: NameScope = (name) => baseNames.has(name) && !later.has(name);
    const field = `computed:${cv.id}`;
    if (!str(cv.expr).trim()) {
      c.add('expression-syntax', 'warning', `Computed value ${quote(str(cv.name))} has no expression yet.`, extLoc(field));
      return;
    }
    const prevLater = chk.laterComputed;
    chk.laterComputed = new Set(computed.slice(i + 1).map((x) => x.name));
    checkExpression(chk, cv.expr, scope, extLoc(field), `the computed value ${quote(str(cv.name))}`);
    chk.laterComputed = prevLater;
  });

  // ---- helpers
  if (helpers.trim()) {
    const err = helperSyntax(helpers);
    if (err) c.add('helpers-syntax', 'error', `Helper functions have a syntax error: ${err}.`, extLoc('helpers'));
  }

  // ---- node tree
  const nodes = isRecord(ext.nodes) ? (ext.nodes as Record<NodeId, UINode>) : {};
  const root = nodes[ext.rootId];
  if (!root) return;
  if (asArray(root.children).length === 0) {
    c.add(
      'empty-extension',
      'info',
      `This ${kindLabel} is empty. Drag components from the left panel, or start from a template.`,
      extLoc(),
    );
  }
  const visited = new Set<NodeId>([root.id]);
  asArray(root.children).forEach((cid, index) => visitNode(ctx, nodes, visited, cid, { parentId: root.id, index }, base));

  // Duplicate overlay ids were collected during the walk (first owner kept in overlayIds).
}

function checkStateInitial(s: Extension['state'][number], c: Collector, loc: Loc): void {
  const v = s.initial;
  if (v === null || v === undefined || s.type === 'any') return;
  const ok =
    (s.type === 'string' && typeof v === 'string') ||
    (s.type === 'number' && typeof v === 'number') ||
    (s.type === 'boolean' && typeof v === 'boolean') ||
    (s.type === 'array' && Array.isArray(v)) ||
    (s.type === 'object' && isRecord(v));
  if (!ok) {
    c.add('state-initial', 'warning', `State variable ${quote(s.name)} is a ${s.type} but its initial value is ${JSON.stringify(v)}.`, loc, 'initial');
  }
}

function validateDataSource(ctx: ExtContext, ds: DataSource): void {
  const { c, chk, ext } = ctx;
  const loc: Loc = { extensionId: ext.id, field: `dataSource:${ds.id}` };
  const label = `data source ${quote(str(ds.name))}`;
  switch (ds.kind) {
    case 'crmProperties':
      if (asArray(ds.properties).length === 0) {
        c.add('data-source-properties', 'warning', `The ${label} doesn’t load any properties yet. Pick the record properties you need.`, loc);
      }
      if (!ctx.isCrm) {
        c.add('data-source-location', 'warning', `The ${label} reads the current CRM record, which only exists on record cards — not on this page.`, loc);
      }
      break;
    case 'associations':
      if (!str(ds.toObjectType).trim()) c.add('data-source-config', 'error', `Choose which associated object the ${label} loads.`, loc, 'toObjectType');
      if (asArray(ds.properties).length === 0) {
        c.add('data-source-properties', 'warning', `The ${label} doesn’t load any properties yet. Pick the properties to show.`, loc);
      }
      if (!ctx.isCrm) {
        c.add('data-source-location', 'warning', `The ${label} loads records associated with the current CRM record, which only exists on record cards.`, loc);
      }
      break;
    case 'crmSearch':
      if (!str(ds.objectType).trim()) c.add('data-source-config', 'error', `Choose which object type the ${label} searches.`, loc, 'objectType');
      if (asArray(ds.properties).length === 0) {
        c.add('data-source-properties', 'warning', `The ${label} doesn’t load any properties yet. Pick the properties to show.`, loc);
      }
      checkTemplate(chk, ds.query, ctx.dataScope, loc, `the search text of the ${label}`);
      for (const f of asArray(ds.filters)) checkTemplate(chk, f?.value, ctx.dataScope, loc, `a filter of the ${label}`);
      break;
    case 'fetch': {
      const url = str(ds.url).trim();
      checkTemplate(chk, url, ctx.dataScope, loc, `the URL of the ${label}`);
      checkExpression(chk, ds.body, ctx.dataScope, loc, `the request body of the ${label}`);
      checkFetchUrl(c, url, loc, `The ${label}`);
      break;
    }
    case 'function':
      if (!ctx.functionIds.has(ds.functionId)) {
        c.add('unknown-function', 'error', `The ${label} runs an app function that doesn’t exist. Choose a function in the data source settings.`, loc);
      }
      checkExpression(chk, ds.parameters, ctx.dataScope, loc, `the parameters of the ${label}`);
      break;
    default:
      break;
  }
}

function checkFetchUrl(c: Collector, url: string, loc: Loc, subject: string): void {
  if (!url) {
    c.add('fetch-url', 'error', `${subject} has no URL.`, loc, 'url');
    return;
  }
  if (!/^https:\/\//i.test(url)) {
    c.add('fetch-url', 'warning', `${subject} must call a full https:// URL — hubspot.fetch doesn’t support relative or http URLs.`, loc, 'url');
    return;
  }
  if (!staticOrigin(url)) {
    c.add(
      'fetch-url',
      'warning',
      `${subject} builds its host from an expression, so it can’t be added to the permitted URLs automatically. Add the host in App settings → Permitted URLs.`,
      loc,
      'url',
    );
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

interface ParentPos {
  parentId: NodeId;
  index: number;
  slot?: string;
}

function isMissingValue(value: PropValue | undefined, def: PropDef): boolean {
  if (value === undefined || value === null) return true;
  if (isExpr(value)) return !value.$expr.trim();
  if (typeof value === 'string') {
    const k = def.type.kind;
    return value.trim() === '' && (k === 'string' || k === 'url' || k === 'href' || k === 'icon' || k === 'enum');
  }
  return false;
}

const hasTemplateSyntax = (v: unknown): boolean => typeof v === 'string' && v.includes('{{');

function checkPropShape(ctx: ExtContext, node: UINode, def: ComponentDef, p: PropDef, value: PropValue): void {
  if (isExpr(value) || hasTemplateSyntax(value)) return;
  const loc: Loc = { extensionId: ctx.ext.id, nodeId: node.id, field: p.name };
  const label = quote(p.label);
  const t = p.type;
  switch (t.kind) {
    case 'enum':
      if (!t.options.some((o) => o.value === value)) {
        const allowed = t.options.slice(0, 6).map((o) => String(o.value)).join(', ');
        ctx.c.add(
          'invalid-prop-value',
          'warning',
          `${label} is set to ${JSON.stringify(value)}, which ${def.label} doesn’t support. Use one of: ${allowed}${t.options.length > 6 ? ', …' : ''}.`,
          loc,
        );
      }
      break;
    case 'number':
      if (typeof value !== 'number') ctx.c.add('invalid-prop-value', 'error', `${label} must be a number (it is ${JSON.stringify(value)}).`, loc);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') ctx.c.add('invalid-prop-value', 'error', `${label} must be on or off (it is ${JSON.stringify(value)}).`, loc);
      break;
    case 'options': {
      if (!Array.isArray(value)) {
        ctx.c.add('invalid-options', 'error', `${label} must be a list of options with a label and a value.`, loc);
        break;
      }
      const allowed = new Set(['label', 'value', ...(t.optionFields ?? ['description'])]);
      value.forEach((opt, i) => {
        if (!isRecord(opt)) {
          ctx.c.add('invalid-options', 'error', `Option ${i + 1} of ${label} must have a label and a value.`, loc, `opt${i}`);
          return;
        }
        if (opt.label === undefined || opt.label === null || opt.value === undefined || opt.value === null) {
          ctx.c.add('invalid-options', 'error', `Option ${i + 1} of ${label} needs both a label and a value.`, loc, `opt${i}`);
          return;
        }
        const extra = Object.keys(opt).filter((k) => !allowed.has(k));
        if (extra.length) {
          ctx.c.add('invalid-options', 'error', `Option ${i + 1} of ${label} has unsupported field ${quote(extra[0])}. Options only accept ${[...allowed].join(', ')}.`, loc, `opt${i}`);
        }
      });
      if (value.length === 0 && (p.required || safePredicate(p.requiredWhen, node.props))) {
        ctx.c.add('required-prop', 'warning', `${def.label} has no options yet. Add at least one option to ${label}.`, loc);
      }
      break;
    }
    case 'stringList':
      if (!Array.isArray(value)) {
        ctx.c.add('invalid-prop-value', 'error', `${label} must be a list of text values.`, loc);
        break;
      }
      if (t.options) {
        const ok = new Set(t.options.map((o) => o.value));
        const bad = value.find((v) => !hasTemplateSyntax(v) && !ok.has(v as string));
        if (bad !== undefined) ctx.c.add('invalid-prop-value', 'error', `${label} contains ${JSON.stringify(bad)}, which is not one of the allowed values.`, loc);
      }
      if (value.length === 0 && (p.required || safePredicate(p.requiredWhen, node.props))) {
        ctx.c.add('required-prop', 'warning', `${label} is empty. Add at least one value.`, loc);
      }
      break;
    default:
      break;
  }
}

function visitNode(
  ctx: ExtContext,
  nodes: Record<NodeId, UINode>,
  visited: Set<NodeId>,
  id: NodeId,
  pos: ParentPos,
  scope: NameScope,
): void {
  const node = nodes[id];
  if (!node || visited.has(id)) return;
  visited.add(id);
  const { ext, chk } = ctx;
  const collector = ctx.c;
  const loc = (field?: string): Loc => ({ extensionId: ext.id, nodeId: node.id, ...(field ? { field } : {}) });
  const def = getComponent(node.type);
  if (!def) {
    collector.add('unknown-component', 'error', `${quote(String(node.type))} is not a known HubSpot component. Remove it or replace it.`, loc());
    return;
  }
  const props: Record<string, PropValue> = isRecord(node.props) ? node.props : {};
  const subject = nodeSubject(def, node);

  // ---- availability & placement
  if (!isAvailableIn(def, ext)) {
    const where = LOCATION_LABELS[ext.kind === 'card' ? ext.location : ext.kind] ?? 'this location';
    collector.add('unavailable-component', 'error', `${def.label} isn’t available on a ${where}. Remove it or move the extension to a CRM record location.`, loc());
  } else {
    const parent = nodes[pos.parentId];
    if (pos.slot) {
      const parentDef = parent ? getComponent(parent.type) : undefined;
      const slotDef = parentDef?.slots?.find((s) => s.name === pos.slot);
      if (!slotDef) {
        collector.add('invalid-placement', 'error', `${subject} is attached to ${parentDef?.label ?? 'a component'} in a way it doesn’t support.`, loc());
      } else if (!slotDef.accepts.includes(node.type)) {
        collector.add('invalid-placement', 'error', `${slotDef.label} of ${parentDef!.label} accepts ${slotDef.accepts.join(' or ')}, not ${def.label}.`, loc());
      } else if (slotDef.max !== undefined && pos.index >= slotDef.max) {
        collector.add('invalid-placement', 'error', `${parentDef!.label} can have only ${slotDef.max} ${slotDef.label.toLowerCase()}. Remove the extra ${def.label}.`, loc());
      }
    } else {
      const res = canAccept(ext, pos.parentId, node.type);
      if (!res.ok) collector.add('invalid-placement', 'error', `${subject} can’t be placed here: ${res.reason ?? 'not allowed'}.`, loc());
    }
  }

  // ---- repeat (items are evaluated outside the repeat; the rest sees item/index)
  let inner = scope;
  if (node.repeat) {
    const r = node.repeat;
    const items = str(r.items);
    if (!items.trim()) {
      collector.add('repeat-items', 'warning', `${subject} repeats, but no list is set. Choose the list to repeat over (e.g. a data source).`, loc('repeat'));
    } else {
      checkExpression(chk, items, scope, loc('repeat'), 'the repeat list');
    }
    const names: string[] = [];
    for (const [key, label] of [
      ['itemName', 'item'],
      ['indexName', 'index'],
    ] as const) {
      const name = str(r[key]);
      const problem = identifierProblem(name);
      // Keep even invalid names in scope so one bad name doesn't cascade into "unknown name" warnings.
      if (name) names.push(name);
      if (problem) {
        collector.add('repeat-name', 'error', `Repeat ${label} name ${quote(name)} ${problem}.`, loc('repeat'), key);
        continue;
      }
      if (ctx.shadowable.has(name)) {
        collector.add(
          'repeat-shadow',
          'warning',
          `Repeat ${label} name ${quote(name)} hides the ${ctx.stateByName.has(name) ? 'state variable' : 'value'} with the same name inside this repeat. Rename it (e.g. ${quote(`${name}Item`)}).`,
          loc('repeat'),
          key,
        );
      }
    }
    if (r.itemName && r.itemName === r.indexName) {
      collector.add('repeat-name', 'error', 'The repeat item and index need different names.', loc('repeat'), 'same');
    }
    inner = scopeWith(scope, names);
    checkExpression(chk, r.key, inner, loc('repeat'), 'the repeat key');
  }

  // ---- condition
  checkExpression(chk, node.condition, inner, loc('condition'), 'the visibility condition');

  // ---- binding
  let boundProp: string | null = null;
  if (node.binding) {
    const stateName = str(node.binding.state);
    const st = ctx.stateByName.get(stateName);
    if (!def.valueBinding) {
      collector.add('binding-unsupported', 'warning', `${def.label} can’t be bound to a state variable; the binding is ignored.`, loc('binding'));
    } else if (!st) {
      collector.add(
        'unknown-state',
        'error',
        `${subject} is bound to ${quote(stateName)}, which doesn’t exist. Create that state variable or pick another one.`,
        loc('binding'),
        '',
        stateName,
      );
    } else {
      boundProp = def.valueBinding.prop;
      const want = def.valueBinding.stateType;
      if (st.type !== 'any' && want !== 'any' && st.type !== want) {
        collector.add(
          'binding-type',
          'warning',
          `${subject} produces a ${want} value but ${quote(stateName)} is a ${st.type}. Change the variable’s type to ${want}.`,
          loc('binding'),
        );
      }
    }
  }

  // ---- props
  for (const p of def.props) {
    if (p.visibleWhen && !safePredicate(p.visibleWhen, props)) continue;
    const value = props[p.name];
    const required = !!p.required || safePredicate(p.requiredWhen, props);
    if (required && boundProp !== p.name && isMissingValue(value, p)) {
      collector.add(
        'required-prop',
        'error',
        `${def.label} needs ${propLabel(def, p.name)}${p.requiredWhen && !p.required ? ' with its current settings' : ''}. Set it in the Properties panel.`,
        loc(p.name),
      );
    }
    if (value !== undefined && value !== null) checkPropShape(ctx, node, def, p, value);
  }
  for (const [name, value] of Object.entries(props)) {
    const what = `${propLabel(def, name)}`;
    if (isExpr(value)) checkExpression(chk, value.$expr, inner, loc(name), what);
    else if (value !== null && value !== undefined) checkLiteralTemplates(chk, value as JsonValue, inner, loc(name), what);
  }

  // ---- overlay ids (Modal / Panel)
  if (def.overlay) {
    const idValue = props[def.overlay.idProp];
    if (typeof idValue === 'string' && idValue.trim()) {
      const prev = ctx.overlayIds.get(idValue);
      if (prev && prev !== node.id) {
        collector.add(
          'duplicate-overlay-id',
          'error',
          `Another ${nodes[prev] ? getComponent(nodes[prev].type)?.label ?? 'overlay' : 'overlay'} already uses the id ${quote(idValue)}. Each modal and panel needs its own id.`,
          loc(def.overlay.idProp),
        );
      } else ctx.overlayIds.set(idValue, node.id);
    }
  }

  // ---- text
  if (def.children.mode === 'text') {
    const text = str(node.text);
    if (LABEL_TEXT_TYPES.has(node.type) && !text.trim()) {
      collector.add('empty-text', 'warning', `${subject} has no text, so it renders empty. Add a label.`, loc('text'));
    }
    checkTemplate(chk, text, inner, loc('text'), 'the text');
  }

  // ---- children
  const children = asArray(node.children);
  if (def.children.mode === 'nodes' && def.children.required && children.length === 0) {
    collector.add('required-children', 'warning', `${subject} is empty. Add at least one component inside it.`, loc());
  }
  if (node.type === 'Tabs') {
    const seen = new Set<string>();
    for (const cid of children) {
      const tab = nodes[cid];
      const tabId = tab?.props?.tabId;
      if (typeof tabId !== 'string' || !tabId) continue;
      if (seen.has(tabId)) {
        collector.add('duplicate-tab-id', 'warning', `Two tabs use the id ${quote(tabId)}. Give each tab a unique id so selection works.`, { extensionId: ext.id, nodeId: cid, field: 'tabId' });
      }
      seen.add(tabId);
    }
  }

  // ---- events
  const literalProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!isExpr(v)) literalProps[k] = v;
  for (const [eventName, rawSteps] of Object.entries(isRecord(node.events) ? node.events : {})) {
    const steps = asArray(rawSteps as ActionStep[]);
    const field = `event:${eventName}`;
    const evDef = def.events?.find((e) => e.name === eventName);
    if (!evDef) {
      if (steps.length) {
        collector.add('unknown-event', 'warning', `${def.label} has no ${quote(eventName)} event, so these actions never run.`, loc(field));
      }
      continue;
    }
    if (steps.length && evDef.requiredWhen && !safePredicate(evDef.requiredWhen, literalProps)) {
      const hint =
        node.type === 'Table'
          ? ' Turn on “Paginated” or remove these actions.'
          : node.type === 'TableHeader'
            ? ' Set a sort direction or remove these actions.'
            : ' Change the component’s settings or remove these actions.';
      collector.add('event-variant', 'warning', `${quote(evDef.label)} never fires with this ${def.label}’s current settings.${hint}`, loc(field));
    }
    const handlerScope = scopeWith(scopeWith(inner, ctx.setters), evDef.params.map((p) => p.name));
    checkSteps(ctx, steps, handlerScope, loc(field), quote(evDef.label));
  }

  // ---- recurse
  children.forEach((cid, index) => visitNode(ctx, nodes, visited, cid, { parentId: node.id, index }, inner));
  if (isRecord(node.slots)) {
    for (const [slot, ids] of Object.entries(node.slots)) {
      asArray(ids).forEach((cid, index) => visitNode(ctx, nodes, visited, cid, { parentId: node.id, index, slot }, inner));
    }
  }
}

function checkSteps(ctx: ExtContext, steps: ActionStep[], scope: NameScope, loc: Loc, eventLabel: string): void {
  const { c: collector, chk } = ctx;
  const where = (part: string) => `${part} (${eventLabel})`;
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const key = str(step.id);
    switch (step.type) {
      case 'setState':
        if (!ctx.stateByName.has(str(step.state))) {
          collector.add(
            'unknown-state',
            'error',
            step.state
              ? `A “Set state” action uses ${quote(step.state)}, which doesn’t exist. Pick an existing state variable.`
              : 'A “Set state” action has no state variable selected.',
            loc,
            `set:${key}`,
          );
        }
        checkExpression(chk, step.value, scope, loc, where('the new value of a “Set state” action'));
        break;
      case 'addAlert':
        if (!str(step.message).trim() && !str(step.title).trim()) {
          collector.add('empty-alert', 'warning', 'A “Show alert” action has no title or message.', loc, `alert:${key}`);
        }
        checkTemplate(chk, step.title, scope, loc, where('an alert title'));
        checkTemplate(chk, step.message, scope, loc, where('an alert message'));
        break;
      case 'refreshObjectProperties':
        if (!ctx.isCrm) {
          collector.add(
            'refresh-unsupported',
            'warning',
            '“Refresh record properties” only works on CRM record cards; it is skipped in the generated code for this page.',
            loc,
            `refresh:${key}`,
          );
        }
        break;
      case 'openIframeModal':
        if (!str(step.uri).trim()) collector.add('iframe-url', 'error', 'An “Open iframe” action has no URL.', loc, `iframe:${key}`);
        checkTemplate(chk, step.uri, scope, loc, where('an iframe URL'));
        checkTemplate(chk, step.title, scope, loc, where('an iframe title'));
        break;
      case 'closeOverlay': {
        const target = str(step.overlayNodeId);
        if (!target || !ctx.overlayNodes.has(target)) {
          collector.add(
            'missing-overlay',
            'error',
            target
              ? 'A “Close overlay” action points to a modal or panel that no longer exists. Pick an existing overlay or remove the action.'
              : 'A “Close overlay” action has no modal or panel chosen. Pick the overlay to close.',
            loc,
            `close:${key}`,
          );
        }
        break;
      }
      case 'copyToClipboard':
        checkTemplate(chk, step.text, scope, loc, where('the text to copy'));
        break;
      case 'runDataSource':
        if (!ctx.dataSourceIds.has(str(step.dataSourceId))) {
          collector.add(
            'unknown-data-source',
            'error',
            str(step.dataSourceId)
              ? 'A “Refresh data” action points to a data source that no longer exists.'
              : 'A “Refresh data” action has no data source chosen. Pick one, or add a data source in the Data panel.',
            loc,
            `run:${key}`,
          );
        }
        break;
      case 'fetch': {
        const url = str(step.url).trim();
        checkTemplate(chk, url, scope, loc, where('a request URL'));
        checkFetchUrl(collector, url, loc, 'A “Fetch” action');
        checkExpression(chk, step.body, scope, loc, where('a request body'));
        checkResultState(ctx, step.resultState, loc, key);
        checkSteps(ctx, asArray(step.onSuccess), scopeWith(scope, ['response']), loc, eventLabel);
        checkSteps(ctx, asArray(step.onError), scopeWith(scope, ['error']), loc, eventLabel);
        break;
      }
      case 'runFunction':
        if (!ctx.functionIds.has(str(step.functionId))) {
          collector.add('unknown-function', 'error', 'A “Run app function” action points to a function that doesn’t exist. Choose one or create it in App functions.', loc, `fn:${key}`);
        }
        checkExpression(chk, step.parameters, scope, loc, where('function parameters'));
        checkResultState(ctx, step.resultState, loc, key);
        checkSteps(ctx, asArray(step.onSuccess), scopeWith(scope, ['response']), loc, eventLabel);
        checkSteps(ctx, asArray(step.onError), scopeWith(scope, ['error']), loc, eventLabel);
        break;
      case 'log':
        checkTemplate(chk, step.message, scope, loc, where('a log message'));
        break;
      case 'if':
        if (!str(step.condition).trim()) {
          collector.add('expression-syntax', 'warning', `An “If” action has no condition (${eventLabel}).`, loc, `if:${key}`);
        }
        checkExpression(chk, step.condition, scope, loc, where('an “If” condition'));
        checkSteps(ctx, asArray(step.then), scope, loc, eventLabel);
        checkSteps(ctx, asArray(step.else), scope, loc, eventLabel);
        break;
      case 'custom':
        checkStatements(chk, step.code, scopeWith(scope, CUSTOM_CODE_NAMES), loc, where('custom code'));
        break;
      default:
        break;
    }
  }
}

function checkResultState(ctx: ExtContext, resultState: string | undefined, loc: Loc, key: string): void {
  if (!resultState) return;
  if (!ctx.stateByName.has(resultState)) {
    ctx.c.add(
      'unknown-state',
      'error',
      `The response is saved to ${quote(resultState)}, which doesn’t exist. Create that state variable or pick another one.`,
      loc,
      `result:${key}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateProject(project: Project): Issue[] {
  const c = new Collector();
  if (!isRecord(project)) return c.issues;
  validateApp(project, c);
  validateUniqueness(project, c);
  for (const ext of asArray(project.extensions)) {
    if (isRecord(ext)) validateExtension(project, ext, c);
  }
  validateFunctions(project, c);
  validateRequirements(project, c);
  return c.issues;
}

/** Counts issues per severity (handy for badges and export gates). */
export function countIssues(issues: Issue[]): Record<IssueSeverity, number> {
  const out: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) out[i.severity] += 1;
  return out;
}

