/**
 * Recently run command palette commands (most recent first), kept per browser in localStorage.
 * Storage failures (private mode, blocked site data) degrade to an in-memory list.
 *
 * The key is this module's own: the component palette keeps its "Recently used" components under
 * `uiex-builder:palette-recent` (src/shell/prefs.ts), so the two lists never overwrite each other.
 */
export const RECENT_COMMANDS_KEY = 'uiex-builder:command-recent';
/**
 * Where earlier versions stored recent commands (shared by mistake with the component palette).
 * Read once, never written: command ids always contain `:`, component types never do.
 */
const LEGACY_KEY = 'uiex-builder:palette-recent';
export const MAX_RECENT = 8;

let memory: string[] = [];

function sanitize(list: unknown, keep: (id: string) => boolean = () => true): string[] {
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && keep(x)).slice(0, MAX_RECENT) : [];
}

export function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_COMMANDS_KEY);
    if (raw !== null) return sanitize(JSON.parse(raw) as unknown);
    if (memory.length) return memory;
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    return legacy ? sanitize(JSON.parse(legacy) as unknown, (id) => id.includes(':')) : [];
  } catch {
    return memory;
  }
}

export function pushRecent(id: string): string[] {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
  memory = next;
  try {
    window.localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    /* keep the in-memory list */
  }
  return next;
}

export function clearRecent(): void {
  memory = [];
  try {
    // An empty list (not a removed key), so the legacy key is not migrated again.
    window.localStorage.setItem(RECENT_COMMANDS_KEY, '[]');
  } catch {
    /* ignore */
  }
}
