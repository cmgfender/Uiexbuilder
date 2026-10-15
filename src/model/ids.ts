import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const gen = customAlphabet(alphabet, 10);

/** Generates a short unique id with a readable prefix, e.g. `n_k3j9x0a1bc`. */
export function newId(prefix: 'n' | 'a' | 's' | 'd' | 'e' | 'f' | 'p' = 'n'): string {
  return `${prefix}_${gen()}`;
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while ' +
    'with yield let static enum await implements package protected interface private public undefined NaN ' +
    'Infinity arguments eval context actions hubspot React useState useEffect useCallback useMemo'
  ).split(' '),
);

/** True when `name` can be used as a generated JS identifier (state var, data source, repeat item). */
export function isValidIdentifier(name: string): boolean {
  return IDENT_RE.test(name) && !RESERVED.has(name);
}

/** Converts arbitrary text into a camelCase identifier, e.g. "First name" -> "firstName". */
export function toIdentifier(text: string, fallback = 'value'): string {
  const words = text
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  let id = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return isValidIdentifier(id) ? id : `${id}Value`;
}

/** Converts text into PascalCase, e.g. "contact summary card" -> "ContactSummaryCard". */
export function toPascalCase(text: string, fallback = 'Extension'): string {
  const id = toIdentifier(text, fallback);
  const pascal = id.charAt(0).toUpperCase() + id.slice(1);
  return pascal.replace(/^_/, 'X');
}

/** Converts text into a HubSpot uid: lowercase letters, digits, underscores. */
export function toUid(text: string, fallback = 'extension'): string {
  const uid = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return uid || fallback;
}

/** Returns `base` or `base2`, `base3`, ... — the first not present in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}
