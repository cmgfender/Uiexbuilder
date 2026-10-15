/**
 * Identifier rules for names declared by the Data panel (state variables, data sources) and
 * the names each declaration adds to component scope:
 *   state `x`                      -> x, setX
 *   CRM data source `x`            -> x, xLoading, xError
 *   fetch / function data source `x` -> x, xLoading, xError + setX, setXLoading, setXError
 *   computed value `x`             -> x
 *   helper declarations            -> their names
 */
import { BASE_RESERVED } from '../codegen/context';
import { isValidIdentifier, toIdentifier } from '../model/ids';
import type { DataSource, Extension } from '../model/types';
import { helperNames } from '../power/helpers';

export function setterOf(name: string): string {
  return `set${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Names a state variable declares. */
export function stateDeclaredNames(name: string): string[] {
  return [name, setterOf(name)];
}

/** Names a data source declares (fetch/function sources also declare setters). */
export function dataSourceDeclaredNames(name: string, kind: DataSource['kind']): string[] {
  const base = [name, `${name}Loading`, `${name}Error`];
  if (kind === 'fetch' || kind === 'function') return [...base, ...base.map(setterOf)];
  return base;
}

export type NamedEntity =
  | { kind: 'state'; id: string }
  | { kind: 'dataSource'; id: string; dsKind: DataSource['kind'] }
  | { kind: 'computed'; id: string };

/** Every declared name of the extension mapped to a human description of its owner. */
export function declaredNames(ext: Extension, except?: { kind: NamedEntity['kind']; id: string }): Map<string, string> {
  const out = new Map<string, string>();
  const skip = (kind: NamedEntity['kind'], id: string) => except?.kind === kind && except.id === id;
  for (const s of ext.state ?? []) {
    if (skip('state', s.id)) continue;
    for (const n of stateDeclaredNames(s.name)) if (!out.has(n)) out.set(n, `state variable “${s.name}”`);
  }
  for (const d of ext.dataSources ?? []) {
    if (skip('dataSource', d.id)) continue;
    for (const n of dataSourceDeclaredNames(d.name, d.kind)) if (!out.has(n)) out.set(n, `data source “${d.name}”`);
  }
  for (const c of ext.computed ?? []) {
    if (skip('computed', c.id)) continue;
    if (!out.has(c.name)) out.set(c.name, `computed value “${c.name}”`);
  }
  for (const h of helperNames(ext.helpers)) if (!out.has(h)) out.set(h, `helper “${h}”`);
  return out;
}

const RESERVED = new Set<string>(BASE_RESERVED);

/**
 * Validates a new name for a state variable / data source. Returns an error message or null.
 * `entity` identifies the item being renamed (its own current names do not count as taken).
 */
export function validateDeclaredName(ext: Extension, name: string, entity: NamedEntity): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name is required';
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    return /^[0-9]/.test(trimmed)
      ? 'Names cannot start with a number'
      : 'Use letters, numbers, _ or $ only (no spaces or dashes)';
  }
  if (!isValidIdentifier(trimmed) || RESERVED.has(trimmed)) return `“${trimmed}” is a reserved word`;
  const declares =
    entity.kind === 'state'
      ? stateDeclaredNames(trimmed)
      : entity.kind === 'dataSource'
        ? dataSourceDeclaredNames(trimmed, entity.dsKind)
        : [trimmed];
  const taken = declaredNames(ext, entity);
  for (const n of declares) {
    const owner = taken.get(n);
    if (owner) return n === trimmed ? `Already used by ${owner}` : `Conflicts with “${n}” of ${owner}`;
  }
  for (const n of declares) if (RESERVED.has(n)) return `“${n}” is a reserved word`;
  return null;
}

/** First valid, free name derived from `base` (e.g. `record`, `record2`, ...). */
export function uniqueDeclaredName(ext: Extension, base: string, entity: NamedEntity): string {
  const root = toIdentifier(base, 'value');
  if (!validateDeclaredName(ext, root, entity)) return root;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${root}${i}`;
    if (!validateDeclaredName(ext, candidate, entity)) return candidate;
  }
  return `${root}_${Date.now().toString(36)}`;
}
