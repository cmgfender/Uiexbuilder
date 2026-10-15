/**
 * Computed values (Extension.computed): `const <name> = (<expr>)` recomputed on every render,
 * declared after state, data hooks and data source loaders, in list order (each sees the ones
 * before it). Pure helpers shared by the store, the runtime and the editor UI.
 */
import { isValidIdentifier } from '../model/ids';
import type { ComputedValue, DataSource, Extension } from '../model/types';
import { helperNames } from './helpers';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** JavaScript reserved words (cannot be declared). */
const RESERVED_WORDS = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'yield let static implements interface package private protected public await'
  ).split(' '),
);

/**
 * Names a computed value can never take although they are not JavaScript keywords: component
 * parameters, values every generated file imports (`hubspot`, React and its hooks — a
 * `const useState` in the component would break the hook calls above it) and globals it would
 * break. Together with the keywords this is the reserved set of `isValidIdentifier`
 * (src/model/ids.ts), which validation uses; codegen skips these names too.
 */
export const COMPUTED_FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  'context',
  'actions',
  'undefined',
  'NaN',
  'Infinity',
  'arguments',
  'eval',
  'hubspot',
  'React',
  'useState',
  'useEffect',
  'useCallback',
  'useMemo',
]);

/** Globals and generated names that a computed value should not shadow (rejected by validation). */
const BUILT_IN_NAMES = new Set([
  'Math', 'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Error', 'Intl', 'RegExp',
  'Map', 'Set', 'Symbol', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'console', 'window', 'document',
  'hubspot', 'logger', 'React', 'toText', 'asArray',
]);

function setterOf(name: string): string {
  return `set${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Component-scope names a data source declares in generated code. */
function dataSourceNames(ds: DataSource): string[] {
  const base = [ds.name, `${ds.name}Loading`, `${ds.name}Error`];
  return ds.kind === 'fetch' || ds.kind === 'function' ? [...base, ...base.map(setterOf)] : base;
}

/** Names declared by state variables and data sources (what a computed value must not redeclare). */
export function declaredScopeNames(ext: Pick<Extension, 'state' | 'dataSources'>): Set<string> {
  const out = new Set<string>();
  for (const s of Array.isArray(ext.state) ? ext.state : []) {
    if (!s || typeof s.name !== 'string') continue;
    out.add(s.name);
    out.add(setterOf(s.name));
  }
  for (const ds of Array.isArray(ext.dataSources) ? ext.dataSources : []) {
    if (!ds || typeof ds.name !== 'string') continue;
    dataSourceNames(ds).forEach((n) => out.add(n));
  }
  return out;
}

/**
 * True when `name` is a syntactically valid, non-reserved identifier — the same rule validation
 * applies (`isValidIdentifier`), so a name the Data panel accepts is never a Problems error.
 */
export function isComputedIdentifier(name: string): boolean {
  return IDENT_RE.test(name) && !RESERVED_WORDS.has(name) && !COMPUTED_FORBIDDEN_NAMES.has(name) && isValidIdentifier(name);
}

/**
 * The computed values that are declared (in order): valid identifiers that do not redeclare a
 * state variable, data source name or an earlier computed value. Runtime and codegen both skip
 * the others (the problems panel reports them).
 */
export function usableComputed(ext: Pick<Extension, 'state' | 'dataSources' | 'computed'>): ComputedValue[] {
  const list = Array.isArray(ext.computed) ? ext.computed : [];
  if (list.length === 0) return [];
  const taken = declaredScopeNames(ext);
  const out: ComputedValue[] = [];
  for (const c of list) {
    if (!c || typeof c.name !== 'string' || !isComputedIdentifier(c.name) || taken.has(c.name)) continue;
    taken.add(c.name);
    out.push(c);
  }
  return out;
}

/**
 * Validation message for a computed value's name, or null when valid. `selfId` is the computed
 * value being renamed (its own current name does not count as taken).
 */
export function validateComputedName(ext: Extension, name: string, selfId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name is required';
  if (!IDENT_RE.test(trimmed)) {
    return /^[0-9]/.test(trimmed) ? 'Names cannot start with a number' : 'Use letters, numbers, _ or $ only (no spaces or dashes)';
  }
  if (!isComputedIdentifier(trimmed)) return `“${trimmed}” is a reserved word`;
  if (BUILT_IN_NAMES.has(trimmed)) return `“${trimmed}” is a built-in name — expressions would lose access to it`;
  for (const s of ext.state ?? []) {
    if (s.name === trimmed) return `Already used by state variable “${s.name}”`;
    if (setterOf(s.name) === trimmed) return `Conflicts with the setter of state variable “${s.name}”`;
  }
  for (const ds of ext.dataSources ?? []) {
    if (dataSourceNames(ds).includes(trimmed)) return `Conflicts with data source “${ds.name}”`;
  }
  for (const c of ext.computed ?? []) {
    if (c.id !== selfId && c.name === trimmed) return `Already used by another computed value`;
  }
  if (helperNames(ext.helpers).includes(trimmed)) return `Already used by helper “${trimmed}”`;
  return null;
}

/** Every name a new computed value must avoid (state, data, computed, helpers). */
export function takenComputedNames(ext: Extension): Set<string> {
  const taken = declaredScopeNames(ext);
  for (const c of ext.computed ?? []) if (c && typeof c.name === 'string') taken.add(c.name);
  for (const h of helperNames(ext.helpers)) taken.add(h);
  COMPUTED_FORBIDDEN_NAMES.forEach((n) => taken.add(n));
  BUILT_IN_NAMES.forEach((n) => taken.add(n));
  return taken;
}

/** Converts free text to a camelCase identifier (`"Total amount"` -> `totalAmount`). */
export function toComputedIdentifier(text: string, fallback = 'computed'): string {
  const words = text
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return fallback;
  let id = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return isComputedIdentifier(id) ? id : `${id}Value`;
}

/** A free computed value name based on `base` (`total`, `total2`, ...). */
export function uniqueComputedName(ext: Extension, base = 'computed'): string {
  const root = toComputedIdentifier(base);
  const taken = takenComputedNames(ext);
  if (!taken.has(root)) return root;
  let i = 2;
  while (taken.has(`${root}${i}`)) i++;
  return `${root}${i}`;
}
