/**
 * Recently run command palette commands (most recent first), kept per browser in localStorage.
 * Storage failures (private mode, blocked site data) degrade to an in-memory list.
 */
const KEY = 'uiex-builder:palette-recent';
export const MAX_RECENT = 8;

let memory: string[] = [];

export function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : memory;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return memory;
  }
}

export function pushRecent(id: string): string[] {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* keep the in-memory list */
  }
  return next;
}

export function clearRecent(): void {
  memory = [];
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
