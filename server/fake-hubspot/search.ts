/**
 * CRM search engine of the fake HubSpot: free-text `query`, filterGroups (OR of AND-ed filters)
 * with EQ/NEQ/LT/LTE/GT/GTE/BETWEEN/IN/NOT_IN/HAS_PROPERTY/NOT_HAS_PROPERTY/CONTAINS_TOKEN/
 * NOT_CONTAINS_TOKEN, sorts and offset paging (`after`).
 */
import type { FakeObjectType, FakeRecord } from './seed';

export interface FakeSearchFilter {
  propertyName?: unknown;
  operator?: unknown;
  value?: unknown;
  values?: unknown;
  highValue?: unknown;
}

export interface FakeSearchRequest {
  query?: unknown;
  filterGroups?: unknown;
  sorts?: unknown;
  properties?: unknown;
  limit?: unknown;
  after?: unknown;
}

export type FakeSearchOutcome =
  | { ok: true; records: FakeRecord[]; total: number; nextAfter?: string; properties: string[] | null }
  | { ok: false; message: string };

const OPERATORS = new Set([
  'EQ',
  'NEQ',
  'LT',
  'LTE',
  'GT',
  'GTE',
  'BETWEEN',
  'IN',
  'NOT_IN',
  'HAS_PROPERTY',
  'NOT_HAS_PROPERTY',
  'CONTAINS_TOKEN',
  'NOT_CONTAINS_TOKEN',
]);

function asComparable(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Compare a record value with a filter value: numbers / dates numerically, else case-insensitive text. */
export function compareValues(recordValue: string, filterValue: string): number {
  const a = asComparable(recordValue);
  const b = asComparable(filterValue);
  if (a !== null && b !== null) return a === b ? 0 : a < b ? -1 : 1;
  return recordValue.toLowerCase().localeCompare(filterValue.toLowerCase());
}

function equalsValue(recordValue: string | null, filterValue: string): boolean {
  if (recordValue === null) return false;
  if (recordValue.toLowerCase() === filterValue.toLowerCase()) return true;
  const a = asComparable(recordValue);
  const b = asComparable(filterValue);
  return a !== null && b !== null && a === b;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}@._-]+/u)
    .filter(Boolean);
}

function containsToken(recordValue: string | null, filterValue: string): boolean {
  if (recordValue === null || recordValue === '') return false;
  const needle = filterValue.toLowerCase();
  if (needle.includes('*')) {
    const re = new RegExp(`^${needle.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'u');
    return re.test(recordValue.toLowerCase()) || tokens(recordValue).some((t) => re.test(t));
  }
  return recordValue.toLowerCase() === needle || tokens(recordValue).includes(needle);
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function matchesFilter(record: FakeRecord, f: FakeSearchFilter): boolean {
  const name = str(f.propertyName);
  const op = str(f.operator);
  const value = record.properties[name] ?? null;
  const fv = str(f.value);
  const values = Array.isArray(f.values) ? f.values.map(str) : [];
  const multi = value === null ? [] : value.split(';');
  switch (op) {
    case 'EQ':
      return equalsValue(value, fv);
    case 'NEQ':
      return !equalsValue(value, fv);
    case 'LT':
      return value !== null && value !== '' && compareValues(value, fv) < 0;
    case 'LTE':
      return value !== null && value !== '' && compareValues(value, fv) <= 0;
    case 'GT':
      return value !== null && value !== '' && compareValues(value, fv) > 0;
    case 'GTE':
      return value !== null && value !== '' && compareValues(value, fv) >= 0;
    case 'BETWEEN':
      return value !== null && value !== '' && compareValues(value, fv) >= 0 && compareValues(value, str(f.highValue)) <= 0;
    case 'IN':
      return multi.some((m) => values.some((v) => equalsValue(m, v)));
    case 'NOT_IN':
      return !multi.some((m) => values.some((v) => equalsValue(m, v)));
    case 'HAS_PROPERTY':
      return value !== null && value !== '';
    case 'NOT_HAS_PROPERTY':
      return value === null || value === '';
    case 'CONTAINS_TOKEN':
      return containsToken(value, fv);
    case 'NOT_CONTAINS_TOKEN':
      return !containsToken(value, fv);
    default:
      return false;
  }
}

function sortSpec(raw: unknown): { name: string; desc: boolean } | null {
  if (typeof raw === 'string') {
    return raw.startsWith('-') ? { name: raw.slice(1), desc: true } : { name: raw, desc: false };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { propertyName?: unknown; direction?: unknown };
    if (typeof o.propertyName === 'string') return { name: o.propertyName, desc: o.direction === 'DESCENDING' };
  }
  return null;
}

export function runSearch(type: FakeObjectType, records: FakeRecord[], req: FakeSearchRequest): FakeSearchOutcome {
  const known = new Set(type.properties.map((p) => p.name));
  const limit = req.limit === undefined ? 10 : Number(req.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return { ok: false, message: 'limit must be between 1 and 200' };
  const offset = req.after === undefined || req.after === null || req.after === '' ? 0 : Number(req.after);
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, message: 'after must be a non-negative integer' };

  let groups: FakeSearchFilter[][] = [];
  if (req.filterGroups !== undefined) {
    if (!Array.isArray(req.filterGroups)) return { ok: false, message: 'filterGroups must be an array' };
    if (req.filterGroups.length > 5) return { ok: false, message: 'Too many filter groups (max 5)' };
    groups = [];
    for (const g of req.filterGroups as Array<{ filters?: unknown }>) {
      if (!g || !Array.isArray(g.filters)) return { ok: false, message: 'Each filter group needs filters' };
      if (g.filters.length > 6) return { ok: false, message: 'Too many filters in a group (max 6)' };
      for (const f of g.filters as FakeSearchFilter[]) {
        const op = str(f?.operator);
        if (!OPERATORS.has(op)) {
          return { ok: false, message: `Invalid input JSON: Cannot deserialize value of type \`FilterOperatorEnum\` from String "${op}"` };
        }
        const name = str(f?.propertyName);
        if (!known.has(name)) return { ok: false, message: `There was a problem with the request: property "${name}" does not exist on ${type.name}` };
      }
      groups.push(g.filters as FakeSearchFilter[]);
    }
  }

  const query = typeof req.query === 'string' ? req.query.trim().toLowerCase() : '';
  let matched = records.filter((r) => {
    if (query) {
      const hit = r.id === query || type.searchable.some((p) => (r.properties[p] ?? '').toLowerCase().includes(query));
      if (!hit) return false;
    }
    if (groups.length === 0) return true;
    return groups.some((filters) => filters.every((f) => matchesFilter(r, f)));
  });

  const sorts = Array.isArray(req.sorts) ? req.sorts.map(sortSpec).filter((s): s is { name: string; desc: boolean } => s !== null) : [];
  if (sorts.length > 0) {
    matched = [...matched].sort((a, b) => {
      for (const s of sorts) {
        const av = a.properties[s.name] ?? null;
        const bv = b.properties[s.name] ?? null;
        if (av === bv) continue;
        if (av === null || av === '') return 1;
        if (bv === null || bv === '') return -1;
        const c = compareValues(av, bv);
        if (c !== 0) return s.desc ? -c : c;
      }
      return Number(a.id) - Number(b.id);
    });
  } else {
    matched = [...matched].sort((a, b) => Number(a.id) - Number(b.id));
  }

  const page = matched.slice(offset, offset + limit);
  const nextAfter = offset + limit < matched.length ? String(offset + limit) : undefined;
  const properties = Array.isArray(req.properties) ? req.properties.filter((p): p is string => typeof p === 'string') : null;
  return { ok: true, records: page, total: matched.length, nextAfter, properties };
}
